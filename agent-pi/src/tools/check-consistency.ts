/**
 * Consistency check: validate that multiple invoices/packing lists actually
 * belong to the same merged declaration.
 *
 * - Pair each IV with a PL by invoice_no.
 * - Flag header fields (shipper/consignee/trade_term/etc.) that differ across
 *   invoices — merging is still allowed, but the report surfaces the divergence
 *   so the operator can decide.
 * - For each IV/PL pair, cross-check that qty totals agree (invoice qty ==
 *   packing list qty). Any mismatch → warning.
 */

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  ConsistencyReport,
  ConsistencyWarning,
  Invoice,
  PackingList,
  SummaryContext,
} from "./types.js";

const CHECK_FIELDS: (keyof Invoice)[] = [
  "shipper",
  "consignee",
  "notify_party",
  "port_of_loading",
  "destination",
  "trade_term",
  "currency",
  "country_of_origin",
];

function norm(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).replace(/\s+/g, " ").trim().toUpperCase();
}

export function checkConsistency(
  invoices: Invoice[],
  packing_lists: PackingList[],
): ConsistencyReport {
  const warnings: ConsistencyWarning[] = [];

  // Header-field divergence
  for (const f of CHECK_FIELDS) {
    const uniq = new Set(invoices.map((iv) => norm(iv[f])).filter((v) => v));
    if (uniq.size > 1) {
      warnings.push({
        field: f,
        values_by_file: invoices.map((iv) => ({
          file: iv.file_path,
          invoice_no: iv.invoice_no,
          value: iv[f],
        })),
        note: `${uniq.size} 种不同取值，合并申报要求此字段一致`,
      });
    }
  }

  // IV ↔ PL pairing
  const plByInv = new Map<string, PackingList>();
  for (const pl of packing_lists) plByInv.set(pl.invoice_no, pl);

  const pairs: ConsistencyReport["iv_pl_pairs"] = [];
  const unpaired_iv: string[] = [];
  const iv_nos_seen = new Set<string>();
  for (const iv of invoices) {
    iv_nos_seen.add(iv.invoice_no);
    const pl = plByInv.get(iv.invoice_no);
    pairs.push({
      invoice_no: iv.invoice_no,
      iv_file: iv.file_path,
      pl_file: pl?.file_path,
    });
    if (!pl) unpaired_iv.push(iv.invoice_no);
  }
  const unpaired_pl = packing_lists
    .filter((pl) => !iv_nos_seen.has(pl.invoice_no))
    .map((pl) => pl.invoice_no);

  if (unpaired_iv.length) {
    warnings.push({
      field: "invoice_no",
      values_by_file: unpaired_iv.map((n) => ({ file: "", invoice_no: n, value: null })),
      note: `以下发票没有对应的箱单：${unpaired_iv.join(", ")}`,
    });
  }
  if (unpaired_pl.length) {
    warnings.push({
      field: "invoice_no",
      values_by_file: unpaired_pl.map((n) => ({ file: "", invoice_no: n, value: null })),
      note: `以下箱单没有对应的发票：${unpaired_pl.join(", ")}`,
    });
  }

  // Cross-check IV/PL qty totals per pair
  for (const iv of invoices) {
    const pl = plByInv.get(iv.invoice_no);
    if (!pl) continue;
    const ivQty = iv.totals?.qty ?? 0;
    const plQty = pl.totals?.qty ?? 0;
    if (ivQty && plQty && ivQty !== plQty) {
      warnings.push({
        field: "totals.qty (IV vs PL)",
        values_by_file: [
          { file: iv.file_path, invoice_no: iv.invoice_no, value: `IV=${ivQty}` },
          { file: pl.file_path, invoice_no: pl.invoice_no, value: `PL=${plQty}` },
        ],
        note: `发票与箱单数量不一致（差 ${Math.abs(ivQty - plQty)}）`,
      });
    }
  }

  return {
    ok: warnings.length === 0,
    iv_pl_pairs: pairs,
    unpaired_iv,
    unpaired_pl,
    warnings,
  };
}

// ─── AgentTool wrapper ──────────────────────────────────────────────

export function makeCheckConsistencyTool(ctx: SummaryContext): AgentTool {
  return {
    name: "check_consistency",
    label: "校验多票一致性",
    description:
      "对已 read_invoice / read_packing_list 抽出的多张单据做交叉一致性校验：" +
      "1) 主表关键字段（收发货人、贸易术语、目的港、原产地等）是否一致；" +
      "2) 发票和箱单是否一一配对；" +
      "3) 每张发票的数量总计与对应箱单是否吻合。**参数为空**，读取本次会话累积的所有单据。" +
      "在调用 merge_declarations 之前应先调用本工具。",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute() {
      if (ctx.invoices.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "无法校验：还没有 read_invoice 抽取过任何发票。",
            },
          ],
          details: {},
          isError: true,
        };
      }
      const report = checkConsistency(ctx.invoices, ctx.packing_lists);
      ctx.consistency = report;

      const lines: string[] = [];
      lines.push(
        report.ok
          ? "✅ 一致性校验通过：主表字段一致、IV/PL 一一配对、数量吻合"
          : `⚠️ 发现 ${report.warnings.length} 条一致性问题`,
      );
      lines.push(`已识别 ${report.iv_pl_pairs.length} 对 IV/PL 组合：`);
      for (const p of report.iv_pl_pairs) {
        lines.push(`  · ${p.invoice_no}  IV=${p.iv_file ? "✓" : "✗"}  PL=${p.pl_file ? "✓" : "✗"}`);
      }
      if (report.warnings.length) {
        lines.push("\n警告详情：");
        for (const w of report.warnings) {
          lines.push(`  · [${w.field}] ${w.note || ""}`);
        }
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: report as any,
      };
    },
  };
}
