/**
 * read_invoice tool — parse a raw INVOICE file into a structured Invoice JSON.
 *
 * Pipeline:
 *   1. Call the existing `scripts/read_document.py` to dump the .xlsx as plain
 *      text (all rows expanded, item rows preserved). Same pattern used by
 *      readDocumentTool.
 *   2. Send that text to Qwen (DashScope, OpenAI-compatible) with a strict
 *      "return JSON only" prompt. Parse the reply.
 *   3. Push the Invoice into the shared SummaryContext.
 *   4. Return a short human-readable summary line for the LLM to see.
 *
 * If Qwen fails or returns malformed JSON, the tool returns isError: true so
 * the agent can decide how to react (typically: skip or retry).
 */

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { execFileSync } from "node:child_process";
import type { Invoice, SummaryContext } from "./types.js";

const DASHSCOPE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const QWEN_MODEL =
  process.env.QWEN_MODEL_ID_JSON || process.env.QWEN_MODEL_ID || "qwen-plus";

function getApiKey(): string {
  return process.env.DASHSCOPE_API_KEY || "";
}

/** Extract the first JSON object appearing in a string (survives extra prose). */
function extractJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Read the raw .xlsx via the shared Python helper. */
function readRawText(filePath: string): { text: string; item_rows: number } {
  const scriptPath = new URL(
    "../../skills/doc-extraction/scripts/read_document.py",
    import.meta.url,
  ).pathname;
  // execFileSync (argv array) — filePath is a literal argument, never shell-parsed.
  // PYTHON_BIN pins the .venv python (has openpyxl); PATH can be clobbered.
  const raw = execFileSync(process.env.PYTHON_BIN || "python3", [scriptPath, filePath], {
    encoding: "utf-8",
    timeout: 30000,
    // WSL proxy env can wedge subprocess if left set; scrub it.
    env: {
      ...process.env,
      http_proxy: "",
      https_proxy: "",
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
    },
  });
  const data = JSON.parse(raw);
  if (data.error) throw new Error(data.error);
  return { text: data.text || "", item_rows: data.item_rows || 0 };
}

const INVOICE_EXTRACTION_PROMPT = `你是一个报关信息抽取器。以下是一份 INVOICE 单据的原始文本内容，请抽取为严格的 JSON。

**输出要求**（重要）：
- 只输出一个 JSON 对象，不要添加任何解释、注释、\`\`\`标记或前后缀
- 若某字段找不到就用 null
- 数字必须是数字类型（不要带千位分隔符、不要加单位）
- items 列出所有明细行（一行也不能省略），字段：item_no, po, part_no, samsung_pn, qty, unit_price, amount
- 金额（amount）= 数量(qty) * 单价(unit_price) / 1000（因为单价单位是 @RMB/1000）

**JSON 结构**：
{
  "invoice_no": "字符串",
  "invoice_date": "字符串或 null",
  "shipper": "字符串或 null",
  "consignee": "字符串或 null",
  "notify_party": "字符串或 null",
  "port_of_loading": "字符串或 null",
  "destination": "字符串或 null",
  "trade_term": "字符串或 null",
  "currency": "字符串或 null (RMB/USD/...)",
  "country_of_origin": "字符串或 null",
  "commodity": "字符串或 null",
  "items": [
    {"item_no": ..., "po": "...", "part_no": "...", "samsung_pn": "...", "qty": 数字, "unit_price": 数字, "amount": 数字}
  ],
  "totals": {"qty": 数字, "amount": 数字}
}

## 原始单据内容：

`;

async function callQwenForInvoice(rawText: string, apiKey: string): Promise<Invoice> {
  const resp = await fetch(DASHSCOPE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: QWEN_MODEL,
      temperature: 0.1,
      max_tokens: 4096,
      messages: [
        { role: "system", content: "你只输出 JSON，不做任何解释。" },
        { role: "user", content: INVOICE_EXTRACTION_PROMPT + rawText },
      ],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Qwen API ${resp.status}: ${body.slice(0, 200)}`);
  }
  const data = await resp.json();
  const reply: string = data?.choices?.[0]?.message?.content ?? "";
  const jsonStr = extractJsonObject(reply);
  if (!jsonStr) throw new Error(`Qwen 未返回 JSON。原始输出：${reply.slice(0, 200)}`);
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e: any) {
    throw new Error(`JSON 解析失败：${e.message}. 内容：${jsonStr.slice(0, 200)}`);
  }
  // Coerce / defaults
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const totals = parsed.totals || {};
  return {
    file_path: "", // filled by tool wrapper
    invoice_no: String(parsed.invoice_no || "").trim(),
    invoice_date: parsed.invoice_date ?? undefined,
    shipper: parsed.shipper ?? undefined,
    consignee: parsed.consignee ?? undefined,
    notify_party: parsed.notify_party ?? undefined,
    port_of_loading: parsed.port_of_loading ?? undefined,
    destination: parsed.destination ?? undefined,
    trade_term: parsed.trade_term ?? undefined,
    currency: parsed.currency ?? undefined,
    country_of_origin: parsed.country_of_origin ?? undefined,
    commodity: parsed.commodity ?? undefined,
    items: items.map((it: any) => ({
      item_no: it.item_no ?? undefined,
      po: it.po ?? undefined,
      part_no: it.part_no ?? undefined,
      samsung_pn: it.samsung_pn ?? undefined,
      qty: Number(it.qty) || 0,
      unit_price:
        it.unit_price === undefined || it.unit_price === null
          ? undefined
          : Number(it.unit_price),
      amount: Number(it.amount) || 0,
    })),
    totals: {
      qty: Number(totals.qty) || items.reduce((s: number, it: any) => s + (Number(it.qty) || 0), 0),
      amount:
        Number(totals.amount) ||
        items.reduce((s: number, it: any) => s + (Number(it.amount) || 0), 0),
    },
  };
}

// ─── AgentTool wrapper ──────────────────────────────────────────────

const readInvoiceParams = Type.Object({
  file_path: Type.String({
    description: "INVOICE 文件的绝对路径（.xlsx / .xls），通常文件名含 _IV 后缀",
  }),
});

export function makeReadInvoiceTool(ctx: SummaryContext): AgentTool {
  return {
    name: "read_invoice",
    label: "抽取单张发票 JSON",
    description:
      "解析一份 INVOICE 单据文件（.xlsx），抽取为结构化 JSON（发票号、发货人、收货人、贸易术语、" +
      "明细行、合计等），并累积到本次合并申报的上下文里。对每份 _IV 文件都应调用一次。" +
      "支持并行调用（一次响应中同时列出多个 read_invoice 调用）。",
    parameters: readInvoiceParams,
    executionMode: "parallel",
    async execute(_toolCallId, params) {
      const filePath = (params as { file_path: string }).file_path;
      try {
        const raw = readRawText(filePath);
        const invoice = await callQwenForInvoice(raw.text, getApiKey());
        invoice.file_path = filePath;
        ctx.invoices.push(invoice);

        const summary = [
          `✓ 已抽取发票 ${invoice.invoice_no || "(无发票号)"}`,
          `  文件: ${filePath.split("/").pop()}`,
          `  明细行: ${invoice.items.length}`,
          `  数量合计: ${invoice.totals.qty.toLocaleString()} PC`,
          `  金额合计: ${invoice.totals.amount.toFixed(2)} ${invoice.currency || ""}`,
          invoice.shipper ? `  发货人: ${invoice.shipper.slice(0, 50)}` : "",
          invoice.consignee ? `  收货人: ${invoice.consignee.slice(0, 50)}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        return {
          content: [{ type: "text", text: summary }],
          // Keep full invoice in details for observability, but LLM only sees summary.
          details: invoice as any,
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `读取发票失败：${e.message}` }],
          details: { file_path: filePath, error: e.message } as any,
          isError: true,
        };
      }
    },
  };
}
