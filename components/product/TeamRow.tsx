import Link from 'next/link'

import { ExcludedDeals } from '@/components/product/ExcludedDeals'
import { formatMoney } from '@/lib/format/money'

/**
 * The team's headline figures, for whoever is entitled to see them.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS SITS BESIDE "YOUR ACTIVITY", IT DOES NOT REPLACE IT.            ║
 * ║                                                                           ║
 * ║  A manager still has their own numbers and still wants them. Swapping the  ║
 * ║  panel by role would mean an owner could no longer see their own work at   ║
 * ║  all, and the two answer different questions: "how am I doing" and "how is ║
 * ║  the team doing".                                                         ║
 * ║                                                                           ║
 * ║  ⚠️ AND THE HEADINGS MUST STAY DISTINCT. `PerformanceRow` says "Your      ║
 * ║  activity" in its heading, its aria-label and its empty state. Two panels  ║
 * ║  of similar-looking figures where one is yours and one is everyone's is    ║
 * ║  exactly how a manager reads their own pipeline as the company's.         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * It renders nothing without data rather than rendering zeroes — a workspace
 * that has not rolled up yet is not a workspace with no pipeline, and a zero
 * here reads as the most discouraging possible interpretation of missing data.
 */
export function TeamRow({
  openValue,
  openCount,
  unconvertible,
  overdueTasks,
}: {
  openValue: number | null
  openCount: number | null
  /**
   * ⚠️ DEALS LEFT OUT OF `openValue` FOR WANT OF AN EXCHANGE RATE, and the
   * reason this component cannot just show the two figures side by side.
   *
   * 0124 sums `value_amount_base`, which is NULL without a rate, and `sum()`
   * skips NULLs — so an unconvertible deal is COUNTED in "Open deals" and
   * ABSENT from "Open pipeline". Anyone dividing one by the other gets an
   * average deal size that is wrong, and nothing on screen would say so.
   */
  unconvertible: number | null
  overdueTasks: number | null
}) {
  // Nothing observed at all — say nothing rather than invent a zero.
  if (openValue === null && openCount === null && overdueTasks === null) return null

  return (
    <section aria-label="Team activity" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          Team activity
        </h2>
        <Link
          href="/crm/reports"
          className="text-xs font-medium text-accent underline underline-offset-2"
        >
          Full reports
        </Link>
      </div>

      {/*
        ⚠️ TWO-UP ON A PHONE, THREE FROM `sm`. These are stat cards like
        `PerformanceRow`'s, and stacking them one-up put a manager's three
        headline figures across three screens of scroll. Three columns at
        375px would give ~110px each, which is too narrow for "Open
        pipeline" plus a currency figure — so this row goes 2 → 3 rather
        than 1 → 3.
      */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Figure
          label="Open pipeline"
          /*
           * ⚠️ `formatMoney`, NOT A LOCAL FORMATTER — four of those existed
           * before they were consolidated and they disagreed.
           *
           * ⚠️ 'USD' IS THE BASE CURRENCY, NOT AN ASSUMPTION MADE HERE. 0124
           * stores `value_amount_base` already converted, and `/crm/reports`
           * formats the same totals the same way. Passing a per-deal currency
           * would label a converted total with one deal's currency.
           */
          value={openValue === null ? null : formatMoney(openValue, 'USD', 'whole')}
        />
        <Figure
          label="Open deals"
          value={openCount === null ? null : String(openCount)}
        />
        <Figure
          label="Overdue tasks"
          value={overdueTasks === null ? null : String(overdueTasks)}
        />
      </div>

      {/*
        The total is short by however many deals had no rate. A total nobody
        knows is short is worse than one that is wrong — same component the
        reports page uses, so the sentence cannot drift between the two.
      */}
      {unconvertible !== null ? <ExcludedDeals count={unconvertible} /> : null}
    </section>
  )
}

function Figure({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-line bg-surface p-3">
      <p className="text-xs text-muted">{label}</p>
      {/*
        ⚠️ "—" MEANS NOT COMPUTED, AND IT IS NOT THE SAME AS ZERO. The credits
        balance on this same page carries the identical note: it was once
        `?? 0`, so a missing row rendered as a hard zero indistinguishable from
        an exhausted account, and a user who reads 0 concludes they cannot work.
      */}
      <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{value ?? '—'}</p>
    </div>
  )
}
