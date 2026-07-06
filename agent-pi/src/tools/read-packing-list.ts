/**
 * read_packing_list tool — parse a raw PACKING LIST file into structured JSON.
 * Same pipeline as read_invoice (see that file for details).
 */

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { execSync } from "node:child_process";
import type { PackingList, SummaryContext } from "./types.js";

const DASHSCOPE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const QWEN_MODEL =
  process.env.QWEN_MODEL_ID_JSON || process.env.QWEN_MODEL_ID || "qwen-plus";

function getApiKey(): string {
  return (
    process.env.DASHSCOPE_API_KEY || "sk-17a229bf21204572b5bf1d00d16d558d"
  );
}

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

function readRawText(filePath: string): { text: string; item_rows: number } {
  const scriptPath = new URL(
    "../../skills/doc-extraction/scripts/read_document.py",
    import.meta.url,
  ).pathname;
  const raw = execSync(`python3 "${scriptPath}" "${filePath}"`, {
    encoding: "utf-8",
    timeout: 30000,
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

const PL_EXTRACTION_PROMPT = `你是一个报关信息抽取器。以下是一份 PACKING LIST 单据的原始文本内容，请抽取为严格的 JSON。

**输出要求**（重要）：
- 只输出一个 JSON 对象，不要添加任何解释、注释、\`\`\`标记或前后缀
- 若某字段找不到就用 null
- 数字必须是数字类型（不要带千位分隔符、不要加单位如 "KG"）
- items 列出所有明细行（一行也不能省略）
- totals 从 "TOTAL" 行取；若没有可从 items 累加

**JSON 结构**：
{
  "invoice_no": "字符串（该箱单对应的发票号）",
  "items": [
    {
      "ctn_no": "字符串或数字（箱号，如 '1' 或 '2-4'）",
      "item_no": "字符串或数字",
      "po": "字符串或 null",
      "samsung_pn": "字符串或 null",
      "qty": 数字 (PC),
      "net_kg": 数字 (每行/每箱净重，可为 null),
      "gross_kg": 数字 (每行/每箱毛重，可为 null),
      "volume_cbm": 数字 (每行/每箱体积，可为 null)
    }
  ],
  "totals": {
    "ctn": 数字 (总箱数),
    "qty": 数字 (总数量 PC),
    "net_kg": 数字 (总净重 KG),
    "gross_kg": 数字 (总毛重 KG),
    "volume_cbm": 数字 (总体积 CBM)
  }
}

## 原始单据内容：

`;

async function callQwenForPackingList(
  rawText: string,
  apiKey: string,
): Promise<PackingList> {
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
        { role: "user", content: PL_EXTRACTION_PROMPT + rawText },
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
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const totals = parsed.totals || {};
  const norm = (v: any) =>
    v === undefined || v === null || v === "" ? undefined : Number(v);

  return {
    file_path: "",
    invoice_no: String(parsed.invoice_no || "").trim(),
    items: items.map((it: any) => ({
      ctn_no: it.ctn_no ?? undefined,
      item_no: it.item_no ?? undefined,
      po: it.po ?? undefined,
      samsung_pn: it.samsung_pn ?? undefined,
      qty: Number(it.qty) || 0,
      net_kg: norm(it.net_kg) ?? 0,
      gross_kg: norm(it.gross_kg) ?? 0,
      volume_cbm: norm(it.volume_cbm) ?? 0,
    })),
    totals: {
      ctn: Number(totals.ctn) || items.length,
      qty:
        Number(totals.qty) ||
        items.reduce((s: number, it: any) => s + (Number(it.qty) || 0), 0),
      net_kg:
        Number(totals.net_kg) ||
        items.reduce((s: number, it: any) => s + (Number(it.net_kg) || 0), 0),
      gross_kg:
        Number(totals.gross_kg) ||
        items.reduce((s: number, it: any) => s + (Number(it.gross_kg) || 0), 0),
      volume_cbm:
        Number(totals.volume_cbm) ||
        items.reduce((s: number, it: any) => s + (Number(it.volume_cbm) || 0), 0),
    },
  };
}

// ─── AgentTool wrapper ──────────────────────────────────────────────

const readPackingParams = Type.Object({
  file_path: Type.String({
    description: "PACKING LIST 文件的绝对路径（.xlsx / .xls），通常文件名含 _PL 后缀",
  }),
});

export function makeReadPackingListTool(ctx: SummaryContext): AgentTool {
  return {
    name: "read_packing_list",
    label: "抽取单张箱单 JSON",
    description:
      "解析一份 PACKING LIST 单据（.xlsx），抽取为结构化 JSON（箱数、每行数量/净毛重/体积、合计等）" +
      "，并累积到本次合并申报的上下文里。对每份 _PL 文件都应调用一次。支持并行。",
    parameters: readPackingParams,
    executionMode: "parallel",
    async execute(_toolCallId, params) {
      const filePath = (params as { file_path: string }).file_path;
      try {
        const raw = readRawText(filePath);
        const pl = await callQwenForPackingList(raw.text, getApiKey());
        pl.file_path = filePath;
        ctx.packing_lists.push(pl);

        const summary = [
          `✓ 已抽取箱单（对应发票 ${pl.invoice_no || "?"}）`,
          `  文件: ${filePath.split("/").pop()}`,
          `  明细行: ${pl.items.length}`,
          `  箱数: ${pl.totals.ctn}`,
          `  数量合计: ${pl.totals.qty.toLocaleString()} PC`,
          `  净重合计: ${pl.totals.net_kg.toFixed(3)} KG`,
          `  毛重合计: ${pl.totals.gross_kg.toFixed(3)} KG`,
          `  体积合计: ${pl.totals.volume_cbm.toFixed(4)} CBM`,
        ].join("\n");

        return {
          content: [{ type: "text", text: summary }],
          details: pl as any,
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `读取箱单失败：${e.message}` }],
          details: { file_path: filePath, error: e.message } as any,
          isError: true,
        };
      }
    },
  };
}
