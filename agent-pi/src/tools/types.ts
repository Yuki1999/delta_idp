/**
 * Shared types for the customs-merge (summary mode) tool set.
 *
 * The tools work on structured data. To avoid asking the LLM to re-type large
 * JSON blobs across tool calls, we hang a per-request `SummaryContext` off
 * the tools by closure — `read_invoice` writes into it, later tools read
 * from it. The LLM only sees short summaries in tool results.
 */

export interface InvoiceItem {
  item_no?: string | number;
  po?: string;
  part_no?: string;
  samsung_pn?: string;
  qty: number;
  unit_price?: number;
  amount: number;
}

export interface Invoice {
  file_path: string;
  invoice_no: string;
  invoice_date?: string;
  shipper?: string;
  consignee?: string;
  notify_party?: string;
  port_of_loading?: string;
  destination?: string;
  trade_term?: string;
  currency?: string;
  country_of_origin?: string;
  commodity?: string;
  items: InvoiceItem[];
  totals: { qty: number; amount: number };
}

export interface PackingListItem {
  ctn_no?: string | number;
  item_no?: string | number;
  po?: string;
  samsung_pn?: string;
  qty: number;
  net_kg: number;
  gross_kg: number;
  volume_cbm: number;
}

export interface PackingList {
  file_path: string;
  invoice_no: string;
  items: PackingListItem[];
  totals: {
    ctn: number;
    qty: number;
    net_kg: number;
    gross_kg: number;
    volume_cbm: number;
  };
}

export interface ConsistencyWarning {
  field: string;
  values_by_file: { file: string; invoice_no: string; value: unknown }[];
  note?: string;
}

export interface ConsistencyReport {
  ok: boolean;
  iv_pl_pairs: { invoice_no: string; iv_file: string; pl_file?: string }[];
  unpaired_iv: string[]; // invoice_no
  unpaired_pl: string[]; // invoice_no
  warnings: ConsistencyWarning[];
}

export interface MergedItem {
  seq: number;
  source_invoice: string;
  item_no?: string | number;
  po?: string;
  part_no?: string;
  samsung_pn?: string;
  qty: number;
  unit_price?: number;
  amount: number;
  ctn_no?: string | number;
  net_kg?: number;
  gross_kg?: number;
}

export interface MergedDeclaration {
  invoice_no: string; // "-1 / -2 / -3"
  invoice_date?: string;
  shipper?: string;
  consignee?: string;
  notify_party?: string;
  port_of_loading?: string;
  destination?: string;
  trade_term?: string;
  currency?: string;
  country_of_origin?: string;
  commodity?: string;
  totals: {
    invoice_count: number;
    ctn: number;
    qty: number;
    amount: number;
    net_kg: number;
    gross_kg: number;
    volume_cbm: number;
  };
  items: MergedItem[];
  warnings?: ConsistencyWarning[];
}

/** Per-request accumulator shared by all tools in a single agent invocation. */
export interface SummaryContext {
  invoices: Invoice[];
  packing_lists: PackingList[];
  consistency?: ConsistencyReport;
  merged?: MergedDeclaration;
}

export function makeContext(): SummaryContext {
  return { invoices: [], packing_lists: [] };
}
