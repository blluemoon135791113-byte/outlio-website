import type { ResearchPlan } from '@/lib/intelligence/plan'

type MatchCell = { state: 'known'; value: unknown } | { state: 'unknown' }

export type MatchableRow = {
  /** NULL for a company no lead points at — an account-list company. */
  leadId: string | null
  companyId: string | null
  fields: Record<string, MatchCell>
}

/** One row per entity the question is about, before qualification filters run. */
export function dedupeRowsForPlan<T extends MatchableRow>(
  rows: readonly T[],
  plan: ResearchPlan,
): T[] {
  return plan.entityScope === 'companies'
    ? [
        ...new Map(
          rows.map((row, index) => [
            /*
             * A row with neither id cannot be deduped against anything, so it
             * gets a key unique to itself. Falling back to a shared constant
             * would collapse every such row into one.
             */
            row.companyId ?? (row.leadId ? `lead:${row.leadId}` : `row:${index}`),
            row,
          ]),
        ).values(),
      ]
    : [...rows]
}

function recordValue(row: MatchableRow, field: string): Record<string, unknown> | null {
  const cell = row.fields[field]
  if (!cell || cell.state !== 'known' || !cell.value || typeof cell.value !== 'object') return null
  return cell.value as Record<string, unknown>
}

function hasSupportedFilter(filters: Readonly<Record<string, unknown>>): boolean {
  return ['funding_round', 'minimum_investor_count', 'funded_after', 'minimum_funding_amount_usd', 'business_model', 'hiring_roles']
    .some((key) => filters[key] !== undefined)
}

export function rowMatchesPlan(row: MatchableRow, plan: ResearchPlan): boolean {
  const filters = plan.filters

  if (typeof filters.funding_round === 'string') {
    const round = recordValue(row, 'funding_round')?.round
    if (typeof round !== 'string' || round.toLowerCase() !== filters.funding_round.toLowerCase()) {
      return false
    }
  }

  if (typeof filters.minimum_investor_count === 'number') {
    const investors = recordValue(row, 'funding_investors')?.investors
    if (!Array.isArray(investors) || investors.length < filters.minimum_investor_count) return false
  }

  if (typeof filters.funded_after === 'string') {
    const announcedAt = recordValue(row, 'funding_date')?.announcedAt
    if (typeof announcedAt !== 'string') return false
    const announced = Date.parse(announcedAt)
    const boundary = Date.parse(filters.funded_after)
    if (!Number.isFinite(announced) || !Number.isFinite(boundary) || announced < boundary) return false
  }

  if (typeof filters.minimum_funding_amount_usd === 'number') {
    const amount = recordValue(row, 'funding_amount')
    if (amount?.currency !== 'USD' || typeof amount.amount !== 'number') return false
    if (amount.amount < filters.minimum_funding_amount_usd) return false
  }

  if (typeof filters.business_model === 'string') {
    const wantedModel = filters.business_model.toLowerCase()
    const value = recordValue(row, 'business_model')
    const models = Array.isArray(value?.models)
      ? value.models.filter((item): item is string => typeof item === 'string')
      : typeof value?.model === 'string' ? [value.model] : []
    if (!models.some((model) => model.toLowerCase().includes(wantedModel))) {
      return false
    }
  }

  if (Array.isArray(filters.hiring_roles) && filters.hiring_roles.length > 0) {
    const value = recordValue(row, 'hiring_signals')
    const roles = Array.isArray(value?.roles)
      ? value.roles.filter((item): item is string => typeof item === 'string')
      : []
    const wanted = filters.hiring_roles.filter((item): item is string => typeof item === 'string')
    if (!wanted.every((role) => roles.some((found) => found.toLowerCase().includes(role.toLowerCase())))) {
      return false
    }
  }

  return true
}

/** Company questions return one matched company, not every person at it. */
export function shapeRowsForPlan<T extends MatchableRow>(rows: readonly T[], plan: ResearchPlan): T[] {
  const deduped = dedupeRowsForPlan(rows, plan)

  return hasSupportedFilter(plan.filters)
    ? deduped.filter((row) => rowMatchesPlan(row, plan))
    : deduped
}
