/**
 * Render the merged declaration into the customer-facing Markdown format:
 * 1) 报关单主要信息 table  (字段 | 值 | 数据来源)
 * 2) 商品明细 table  with 「来源发票」 column
 * 3) An optional warnings block if consistency issues were flagged.
 */

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { MergedDeclaration, SummaryContext } from "./types.js";

function fmtNum(n: number | undefined, decimals: number): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtInt(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "";
  return n.toLocaleString("en-US");
}

function fmtWt(n: number | undefined): string {
  return fmtNum(n, 3);
}

function fmtVol(n: number | undefined): string {
  return fmtNum(n, 4);
}

function fmtAmt(n: number | undefined): string {
  return fmtNum(n, 2);
}

function esc(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function renderDeclaration(m: MergedDeclaration): string {
  const t = m.totals;

  // ── Main info table ─────────────────────────────────────────────
  const rows: [string, string, string][] = [
    ["1", "发票号", `${m.invoice_no}`],
    ["2", "发票日期", `${m.invoice_date || ""}`],
    ["3", "发货人 (Shipper)", `${m.shipper || ""}`],
    ["4", "收货人 (Consignee)", `${m.consignee || ""}`],
    ["5", "通知方 (Notify Party)", `${m.notify_party || ""}`],
    ["6", "装货港 (Port of Loading)", `${m.port_of_loading || ""}`],
    ["7", "目的地 (Destination)", `${m.destination || ""}`],
    ["8", "贸易术语 (Trade Term)", `${m.trade_term || ""}`],
    ["9", "币制 (Currency)", `${m.currency || ""}`],
    ["10", "原产国 (Country of Origin)", `${m.country_of_origin || ""}`],
    ["11", "商品名称", `${m.commodity || ""}`],
    ["12", "合并票数", `${t.invoice_count}`],
    ["13", "总件数", `${fmtInt(t.ctn)} C/T`],
    ["14", "总数量", `${fmtInt(t.qty)} PC`],
    ["15", "总金额", `${fmtAmt(t.amount)} ${m.currency || "RMB"}`],
    ["16", "总净重", `${fmtWt(t.net_kg)} KG`],
    ["17", "总毛重", `${fmtWt(t.gross_kg)} KG`],
    ["18", "总体积", `${fmtVol(t.volume_cbm)} CBM`],
    ["19", "产品编号", "见商品明细"],
  ];

  const lines: string[] = [];
  lines.push(`### 报关单主要信息（多票合并申报）`);
  lines.push("");
  lines.push(`| 序号 | 字段 | 值 |`);
  lines.push(`|-----:|:-----|:---|`);
  for (const [i, k, v] of rows) {
    lines.push(`| ${i} | ${k} | ${esc(v)} |`);
  }

  // ── Line items table ────────────────────────────────────────────
  lines.push("");
  lines.push(`### 商品明细（共 ${m.items.length} 行）`);
  lines.push("");
  lines.push(
    "| 序号 | ITEM | P/O | 型号 (Part No) | SAMSUNG P/N | 数量 (PC) | 单价 (@RMB/1000) | 金额 (RMB) | 箱号 | 净重 (KG) | 毛重 (KG) | 来源发票 |",
  );
  lines.push(
    "|-----:|:-----|:----|:---------------|:------------|----------:|-----------------:|-----------:|-----:|----------:|----------:|:---------|",
  );
  for (const it of m.items) {
    lines.push(
      "| " +
        [
          it.seq,
          esc(it.item_no ?? ""),
          esc(it.po ?? ""),
          esc(it.part_no ?? ""),
          esc(it.samsung_pn ?? ""),
          fmtInt(it.qty),
          it.unit_price !== undefined ? String(it.unit_price) : "",
          fmtAmt(it.amount),
          esc(it.ctn_no ?? ""),
          it.net_kg !== undefined ? fmtWt(it.net_kg) : "",
          it.gross_kg !== undefined ? fmtWt(it.gross_kg) : "",
          esc(it.source_invoice),
        ].join(" | ") +
        " |",
    );
  }

  // Totals row
  lines.push(
    "| " +
      [
        "**合计**",
        "",
        "",
        "",
        "",
        `**${fmtInt(t.qty)}**`,
        "",
        `**${fmtAmt(t.amount)}**`,
        `**${fmtInt(t.ctn)} C/T**`,
        `**${fmtWt(t.net_kg)}**`,
        `**${fmtWt(t.gross_kg)}**`,
        "—",
      ].join(" | ") +
      " |",
  );

  // ── Warnings ────────────────────────────────────────────────────
  if (m.warnings && m.warnings.length) {
    lines.push("");
    lines.push(`### ⚠️ 一致性提醒 (${m.warnings.length})`);
    for (const w of m.warnings) {
      lines.push(`- **${w.field}**：${w.note || ""}`);
      for (const v of w.values_by_file) {
        lines.push(`  - \`${v.invoice_no}\` → ${esc(v.value)}`);
      }
    }
  }

  return lines.join("\n");
}

// ─── AgentTool wrapper ──────────────────────────────────────────────

export function makeRenderDeclarationTool(ctx: SummaryContext): AgentTool {
  return {
    name: "render_declaration",
    label: "输出合并报关单",
    description:
      "把 merge_declarations 得到的汇总数据渲染成最终的两张 Markdown 表：报关单主要信息 + 商品明细。" +
      "**参数为空**，读取本次会话已合并的结果。必须在 merge_declarations 之后调用。" +
      "这是本次任务的最终输出——调用完毕后可直接结束。",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute() {
      if (!ctx.merged) {
        return {
          content: [
            {
              type: "text",
              text: "无法渲染：尚未调用 merge_declarations。请先调用 check_consistency 和 merge_declarations。",
            },
          ],
          details: {},
          isError: true,
        };
      }
      const md = renderDeclaration(ctx.merged);
      return {
        content: [{ type: "text", text: md }],
        details: { markdown: md, item_count: ctx.merged.items.length } as any,
      };
    },
  };
}
