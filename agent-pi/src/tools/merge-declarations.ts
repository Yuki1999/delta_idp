/**
 * Deterministic merge of multiple invoices + packing lists into a single
 * consolidated customs declaration.
 *
 * Rules (see skills/customs-merge/SKILL.md):
 * - Header fields that are identical across all invoices → take one value.
 * - Header fields that differ → join with `/`.
 * - Numeric fields (qty, amount, net/gross weight, volume, ctn count) → sum.
 * - Line items → concatenate vertically, tagging `source_invoice`. PL entries
 *   are matched to IV items by (invoice_no, samsung_pn) so we can copy over
 *   ctn_no / net_kg / gross_kg. When no match exists, IV item stands alone.
 */

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  Invoice,
  PackingList,
  PackingListItem,
  MergedDeclaration,
  MergedItem,
  ConsistencyWarning,
  SummaryContext,
} from "./types.js";

const HEADER_FIELDS: (keyof Invoice)[] = [
  "invoice_date",
  "shipper",
  "consignee",
  "notify_party",
  "port_of_loading",
  "destination",
  "trade_term",
  "currency",
  "country_of_origin",
  "commodity",
];

function joinDivergent<T>(values: (T | undefined)[]): T | string | undefined {
  const filtered = values.filter((v) => v !== undefined && v !== null && v !== "");
  if (filtered.length === 0) return undefined;
  const uniq = Array.from(new Set(filtered.map((v) => String(v).trim())));
  if (uniq.length === 1) return filtered[0];
  return uniq.join(" / ");
}

function round(n: number, decimals: number): number {
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}

/** Match PL item to IV item within the same invoice_no by samsung_pn (or part_no). */
function findPlItem(
  pl: PackingList | undefined,
  ivItem: { samsung_pn?: string; part_no?: string; item_no?: string | number },
): PackingListItem | undefined {
  if (!pl) return undefined;
  return pl.items.find(
    (p) =>
      (ivItem.samsung_pn && p.samsung_pn === ivItem.samsung_pn) ||
      (ivItem.item_no !== undefined && p.item_no === ivItem.item_no),
  );
}

export function mergeDeclarations(
  invoices: Invoice[],
  packing_lists: PackingList[],
  warnings: ConsistencyWarning[] = [],
): MergedDeclaration {
  // Index PLs by invoice_no for O(1) pairing during item merge.
  const plByInvoice = new Map<string, PackingList>();
  for (const pl of packing_lists) {
    plByInvoice.set(pl.invoice_no, pl);
  }

  // --- Header ---
  const invoiceNos = invoices.map((iv) => iv.invoice_no);
  const header: Partial<MergedDeclaration> = {
    invoice_no: invoiceNos.join(" / "),
  };
  for (const f of HEADER_FIELDS) {
    const values = invoices.map((iv) => iv[f]);
    (header as any)[f] = joinDivergent(values as any);
  }

  // --- Totals (sum across all invoices/packing_lists) ---
  const totalQty = invoices.reduce((s, iv) => s + (iv.totals?.qty || 0), 0);
  const totalAmount = invoices.reduce((s, iv) => s + (iv.totals?.amount || 0), 0);
  const totalCtn = packing_lists.reduce((s, pl) => s + (pl.totals?.ctn || 0), 0);
  const totalNet = packing_lists.reduce((s, pl) => s + (pl.totals?.net_kg || 0), 0);
  const totalGross = packing_lists.reduce((s, pl) => s + (pl.totals?.gross_kg || 0), 0);
  const totalVol = packing_lists.reduce((s, pl) => s + (pl.totals?.volume_cbm || 0), 0);

  // --- Line items ---
  const items: MergedItem[] = [];
  let seq = 1;
  for (const iv of invoices) {
    const pl = plByInvoice.get(iv.invoice_no);
    for (const ivItem of iv.items) {
      const plItem = findPlItem(pl, ivItem);
      items.push({
        seq: seq++,
        source_invoice: iv.invoice_no,
        item_no: ivItem.item_no,
        po: ivItem.po,
        part_no: ivItem.part_no,
        samsung_pn: ivItem.samsung_pn,
        qty: ivItem.qty,
        unit_price: ivItem.unit_price,
        amount: round(ivItem.amount, 2),
        ctn_no: plItem?.ctn_no,
        net_kg: plItem !== undefined ? round(plItem.net_kg, 3) : undefined,
        gross_kg: plItem !== undefined ? round(plItem.gross_kg, 3) : undefined,
      });
    }
  }

  return {
    invoice_no: invoiceNos.join(" / "),
    invoice_date: header.invoice_date as string | undefined,
    shipper: header.shipper as string | undefined,
    consignee: header.consignee as string | undefined,
    notify_party: header.notify_party as string | undefined,
    port_of_loading: header.port_of_loading as string | undefined,
    destination: header.destination as string | undefined,
    trade_term: header.trade_term as string | undefined,
    currency: header.currency as string | undefined,
    country_of_origin: header.country_of_origin as string | undefined,
    commodity: header.commodity as string | undefined,
    totals: {
      invoice_count: invoices.length,
      ctn: totalCtn,
      qty: totalQty,
      amount: round(totalAmount, 2),
      net_kg: round(totalNet, 3),
      gross_kg: round(totalGross, 3),
      volume_cbm: round(totalVol, 4),
    },
    items,
    warnings: warnings.length ? warnings : undefined,
  };
}

// ─── AgentTool wrapper ──────────────────────────────────────────────

export function makeMergeDeclarationsTool(ctx: SummaryContext): AgentTool {
  return {
    name: "merge_declarations",
    label: "合并多票申报数据",
    description:
      "把之前 read_invoice / read_packing_list 抽出的多张发票和箱单，按合并申报规则" +
      "合并成一份汇总报关单：主表一致字段取值/分歧字段用 '/' 拼接，数量/金额/毛净重/体积/箱数" +
      "全部精确累加，明细纵向拼接并标注来源发票。**参数为空**，工具会读取本次会话已抽取的所有单据。" +
      "必须先完成所有 read_invoice / read_packing_list 调用后才能使用本工具。",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute() {
      if (ctx.invoices.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "无法合并：还没有 read_invoice 抽取过任何发票。请先对每份 _IV 文件调用 read_invoice。",
            },
          ],
          details: {},
          isError: true,
        };
      }
      const warnings = ctx.consistency?.warnings || [];
      const merged = mergeDeclarations(ctx.invoices, ctx.packing_lists, warnings);
      ctx.merged = merged;

      // Build a compact human-readable summary so the LLM can see progress.
      const t = merged.totals;
      const summary = [
        `合并完成：${t.invoice_count} 张发票`,
        `发票号: ${merged.invoice_no}`,
        `总数量: ${t.qty.toLocaleString()} PC`,
        `总金额: ${t.amount.toFixed(2)} ${merged.currency || ""}`,
        `总箱数: ${t.ctn} C/T`,
        `总净重: ${t.net_kg.toFixed(3)} KG`,
        `总毛重: ${t.gross_kg.toFixed(3)} KG`,
        `总体积: ${t.volume_cbm.toFixed(4)} CBM`,
        `明细行: ${merged.items.length}`,
        warnings.length ? `⚠️ 一致性警告 ${warnings.length} 条（已附在合并结果中）` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text", text: summary }],
        details: merged as any,
      };
    },
  };
}
