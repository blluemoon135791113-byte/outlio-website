import type { ResearchScope } from '@/lib/intelligence/plan'

export const HUBBLE_FILTER_LIMIT = 25

/**
 * The filter bar is the research boundary.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  UNFILTERED MEANS THE WHOLE WORKSPACE, INCLUDING SAVED ACCOUNTS.         ║
 * ║                                                                          ║
 * ║  The console is the MACRO surface: it aggregates across companies. It    ║
 * ║  used to ask for `all_leads`, which resolves companies by walking leads  ║
 * ║  — so every company that arrived on a saved ACCOUNT LIST was invisible   ║
 * ║  to it, because an account list contains no people for the walk to start ║
 * ║  from. Large-scale analysis was therefore limited to whatever individual ║
 * ║  lead extractions happened to have turned up.                            ║
 * ║                                                                          ║
 * ║  `workspace` reads the companies directly, so one question covers        ║
 * ║  companies from lead extractions AND companies from account lists — one  ║
 * ║  set, because they are the same table and the same firms.                ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ A FILTER STILL WINS, AND STILL MEANS LEADS.
 *
 * Applying a list or a date range says "these people", so the scope narrows to
 * the 25 lead IDs actually on screen and the companies behind them — never
 * hidden rows from the same run, and never the account lists the filter said
 * nothing about. Widening a filtered view back out to the workspace would be
 * spending on records the user had just excluded.
 *
 * The micro surface is unaffected: a single lead is researched through the
 * lead modal, which does not use this function at all.
 */
export function researchScopeForView(input: {
  batchId: string | null
  from: string | null
  to: string | null
  visibleLeadIds: readonly string[]
}): ResearchScope | null {
  const filtered = Boolean(input.batchId || (input.from && input.to))
  if (!filtered) return { type: 'workspace' }

  const leadIds = [...new Set(input.visibleLeadIds)].slice(0, HUBBLE_FILTER_LIMIT)
  return leadIds.length > 0 ? { type: 'lead_ids', leadIds } : null
}
