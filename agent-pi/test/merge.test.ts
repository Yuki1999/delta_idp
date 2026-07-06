/**
 * Standalone functional test for the deterministic summary tools.
 * Not a framework-based test — just a plain Node script that asserts
 * the merge/consistency/render output for the DS12650253_MULTI fixture.
 *
 * Run with:   npx tsx test/merge.test.ts
 * Or:         node --loader=tsx test/merge.test.ts
 *
 * Expected merged totals (from samples/DS12650253_MULTI/业务说明.txt):
 *   数量 = 2,038,000 PC
 *   金额 = 4,626.00 RMB
 *   箱数 = 12 C/T
 *   净重 = 70.800 KG
 *   毛重 = 78.000 KG
 *   体积 = 0.3240 CBM
 */

import { mergeDeclarations } from "../src/tools/merge-declarations.js";
import { checkConsistency } from "../src/tools/check-consistency.js";
import { renderDeclaration } from "../src/tools/render-declaration.js";
import type { Invoice, PackingList } from "../src/tools/types.js";

// ── Shared header (all three parts identical) ─────────────────────
const SHARED_HEADER = {
  invoice_date: "MAY.11,2026",
  shipper: "SAMSUNG ELECTRO-MECHANICS(SHENZHEN) CO., LTD",
  consignee: "XIAMEN HOLDER ELECTRONICS CO.,LTD",
  notify_party: "G-PULSE_HOLDER",
  port_of_loading: "SHENZHEN",
  destination: "SUZHOU, CHINA",
  trade_term: "DAP SUZHOU",
  currency: "RMB",
  country_of_origin: "CHINA",
  commodity: "MULTI LAYER CERAMIC CAPACITOR",
};

const PART_ITEMS = [
  // Part 1 — 4 items, 1,078,000 PC / 2,440 RMB
  [
    { item_no: 5, po: "XHD01-20251009-015", samsung_pn: "CL10B332KB8WPNC", qty: 164000, unit_price: 1, amount: 164 },
    { item_no: 8, po: "XHD01-20251027-003", samsung_pn: "CL10B104KB8WPNC", qty: 668000, unit_price: 2, amount: 1336 },
    { item_no: 22, po: "XHD01-20251027-003", samsung_pn: "CL21B474KBFVPNE", qty: 44000, unit_price: 3, amount: 132 },
    { item_no: 26, po: "XHD01-20251027-003", samsung_pn: "CL32Y106KBJ4PNE", qty: 202000, unit_price: 4, amount: 808 },
  ],
  // Part 2 — 4 items, 600,000 PC / 1,308 RMB
  [
    { item_no: 8, po: "XHD01-20251105-027", samsung_pn: "CL31B106KOHVPNE", qty: 224000, unit_price: 1, amount: 224 },
    { item_no: 7, po: "XHD01-20251110-020", samsung_pn: "CL21B104KBFWPNE", qty: 80000, unit_price: 2, amount: 160 },
    { item_no: 10, po: "XHD01-20251110-020", samsung_pn: "CL21Y475KBBVPNE", qty: 260000, unit_price: 3, amount: 780 },
    { item_no: 2, po: "XHD01-20260106-035", samsung_pn: "CL10B103KC8WPNC", qty: 36000, unit_price: 4, amount: 144 },
  ],
  // Part 3 — 4 items, 360,000 PC / 878 RMB
  [
    { item_no: 1, po: "XHD01-20260126-008", samsung_pn: "CL10B103KC8WPNC", qty: 32000, unit_price: 1, amount: 32 },
    { item_no: 2, po: "XHD01-20260130-026", samsung_pn: "CL10B103KC8WPNC", qty: 188000, unit_price: 2, amount: 376 },
    { item_no: 9, po: "XHD01-20260213-009", samsung_pn: "CL05B472KB5VPNC", qty: 90000, unit_price: 3, amount: 270 },
    { item_no: 14, po: "XHD01-20260213-009", samsung_pn: "CL05C470JB51PNC", qty: 50000, unit_price: 4, amount: 200 },
  ],
];

const PART_QTY_TOTALS = [1078000, 600000, 360000];
const PART_AMT_TOTALS = [2440, 1308, 878];

function makeInvoice(idx: number): Invoice {
  const invNo = `DS12650253-${idx + 1}`;
  return {
    ...SHARED_HEADER,
    file_path: `/fake/${invNo}_IV.xlsx`,
    invoice_no: invNo,
    items: PART_ITEMS[idx],
    totals: { qty: PART_QTY_TOTALS[idx], amount: PART_AMT_TOTALS[idx] },
  };
}

function makePackingList(idx: number): PackingList {
  const invNo = `DS12650253-${idx + 1}`;
  const items = PART_ITEMS[idx].map((it, i) => ({
    ctn_no: i + 1,
    item_no: it.item_no,
    po: it.po,
    samsung_pn: it.samsung_pn,
    qty: it.qty,
    net_kg: 5.9,
    gross_kg: 6.5,
    volume_cbm: 0.027,
  }));
  return {
    file_path: `/fake/${invNo}_PL.xlsx`,
    invoice_no: invNo,
    items,
    totals: {
      ctn: 4,
      qty: PART_QTY_TOTALS[idx],
      net_kg: +(4 * 5.9).toFixed(3),
      gross_kg: +(4 * 6.5).toFixed(3),
      volume_cbm: +(4 * 0.027).toFixed(4),
    },
  };
}

let failed = 0;
function assertEq(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${label}  (${actual})`);
  } else {
    console.log(`  ✗ ${label}  actual=${actual}  expected=${expected}`);
    failed++;
  }
}

// ─── Test 1: merge happy-path (three consistent parts) ──────────────

console.log("\n[test] merge — 3 parts, all consistent");
const invoices = [0, 1, 2].map(makeInvoice);
const packing = [0, 1, 2].map(makePackingList);
const consistency = checkConsistency(invoices, packing);
const merged = mergeDeclarations(invoices, packing, consistency.warnings);

assertEq(consistency.ok, true, "consistency.ok");
assertEq(consistency.iv_pl_pairs.length, 3, "iv_pl_pairs.length");
assertEq(consistency.warnings.length, 0, "no warnings");

assertEq(merged.invoice_no, "DS12650253-1 / DS12650253-2 / DS12650253-3", "merged invoice_no");
assertEq(merged.shipper, invoices[0].shipper, "merged shipper (uniform)");
assertEq(merged.totals.invoice_count, 3, "invoice_count");
assertEq(merged.totals.qty, 2038000, "总数量 = 2,038,000 PC");
assertEq(merged.totals.amount, 4626, "总金额 = 4,626.00 RMB");
assertEq(merged.totals.ctn, 12, "总箱数 = 12");
assertEq(merged.totals.net_kg, 70.8, "总净重 = 70.800 KG");
assertEq(merged.totals.gross_kg, 78, "总毛重 = 78.000 KG");
assertEq(merged.totals.volume_cbm, 0.324, "总体积 = 0.3240 CBM");
assertEq(merged.items.length, 12, "明细行 = 12");

// Spot check: first merged item should carry source_invoice + net_kg from PL
const first = merged.items[0];
assertEq(first.source_invoice, "DS12650253-1", "item[0].source_invoice");
assertEq(first.net_kg, 5.9, "item[0].net_kg copied from PL");
assertEq(first.ctn_no, 1, "item[0].ctn_no copied from PL");

// ─── Test 2: divergent header field → warning surfaces ─────────────

console.log("\n[test] divergent shipper → consistency warning");
const bad = [makeInvoice(0), makeInvoice(1), makeInvoice(2)];
bad[1].consignee = "SOME OTHER CO.";
const badReport = checkConsistency(bad, packing);
assertEq(badReport.ok, false, "consistency should be NOT ok");
const consigneeWarn = badReport.warnings.find((w) => w.field === "consignee");
assertEq(consigneeWarn !== undefined, true, "consignee warning present");

// Merge still works, but joins the divergent value with '/'
const mergedBad = mergeDeclarations(bad, packing, badReport.warnings);
const consigneeMerged = mergedBad.consignee as string;
assertEq(consigneeMerged.includes(" / "), true, "divergent consignee joined with /");
assertEq(mergedBad.warnings?.length, badReport.warnings.length, "warnings passed through");

// ─── Test 3: qty mismatch between IV and PL → warning ───────────────

console.log("\n[test] IV/PL qty mismatch → warning");
const invMis = [makeInvoice(0), makeInvoice(1), makeInvoice(2)];
const plMis = [makePackingList(0), makePackingList(1), makePackingList(2)];
plMis[0].totals.qty = plMis[0].totals.qty - 5; // introduce delta
const misReport = checkConsistency(invMis, plMis);
const qtyWarn = misReport.warnings.find((w) => w.field.includes("qty"));
assertEq(qtyWarn !== undefined, true, "qty-mismatch warning present");

// ─── Test 4: render — spot check the output markdown ────────────────

console.log("\n[test] render markdown");
const md = renderDeclaration(merged);
assertEq(md.includes("### 报关单主要信息"), true, "main-info heading");
assertEq(md.includes("### 商品明细（共 12 行）"), true, "detail heading with count");
assertEq(md.includes("2,038,000 PC"), true, "总数量 rendered");
assertEq(md.includes("4,626.00"), true, "总金额 rendered");
assertEq(md.includes("70.800 KG"), true, "总净重 rendered");
assertEq(md.includes("DS12650253-1 / DS12650253-2 / DS12650253-3"), true, "joined invoice_no rendered");
assertEq(md.includes("| 来源发票 |"), true, "source_invoice column present");
assertEq(md.split("\n").filter((l) => l.includes("DS12650253-2")).length >= 4, true, "≥4 rows tagged DS12650253-2");

// ─── Summary ────────────────────────────────────────────────────────

console.log(failed ? `\n❌ ${failed} check(s) failed` : "\n✅ all deterministic checks passed");
process.exit(failed ? 1 : 0);
