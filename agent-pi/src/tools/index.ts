/**
 * Barrel export for the customs-merge (summary mode) tool set.
 * Consumers call `summaryTools()` to get all 5 tools bound to a fresh
 * per-request SummaryContext.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { makeContext, type SummaryContext } from "./types.js";
import { makeReadInvoiceTool } from "./read-invoice.js";
import { makeReadPackingListTool } from "./read-packing-list.js";
import { makeCheckConsistencyTool } from "./check-consistency.js";
import { makeMergeDeclarationsTool } from "./merge-declarations.js";
import { makeRenderDeclarationTool } from "./render-declaration.js";

export { makeContext };
export type { SummaryContext } from "./types.js";
export * from "./types.js";
export { mergeDeclarations } from "./merge-declarations.js";
export { checkConsistency } from "./check-consistency.js";
export { renderDeclaration } from "./render-declaration.js";

export interface SummaryToolset {
  ctx: SummaryContext;
  tools: AgentTool[];
}

/** Build a fresh SummaryContext + the 5 bound tools. Call once per request. */
export function summaryTools(): SummaryToolset {
  const ctx = makeContext();
  const tools: AgentTool[] = [
    makeReadInvoiceTool(ctx),
    makeReadPackingListTool(ctx),
    makeCheckConsistencyTool(ctx),
    makeMergeDeclarationsTool(ctx),
    makeRenderDeclarationTool(ctx),
  ];
  return { ctx, tools };
}
