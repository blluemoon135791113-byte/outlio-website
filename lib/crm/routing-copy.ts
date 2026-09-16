/**
 * Words for routing — shared by the server and the settings screen.
 *
 * ⚠️ NO `server-only` HERE, ON PURPOSE. The settings screen is a client
 * component and has to describe a rule and a routing decision in the same words
 * the server uses; keeping the vocabulary in the server module would force a
 * second copy, and two copies of "why nobody got this lead" drift apart.
 */

export const ROUTING_RULE_KINDS = ['company_owner', 'named_user', 'pool'] as const
export type RoutingRuleKind = (typeof ROUTING_RULE_KINDS)[number]

export type RoutingRuleStatus = 'draft' | 'published' | 'archived'

/**
 * Sources a rule may route.
 *
 * ⚠️ `manual` IS NOT HERE AND CANNOT BE ADDED. A contact a member adds by hand
 * belongs to them (§5), and 0127 refuses a rule that names `manual` by
 * constraint. `api` is listed so a rule works the day the API creates contacts.
 */
export const ROUTING_SOURCES = ['csv_import', 'lead_engine', 'api'] as const
export type RoutingSource = (typeof ROUTING_SOURCES)[number]

export const KIND_LABEL: Record<RoutingRuleKind, string> = {
  company_owner: "The company's owner",
  named_user: 'One named person',
  pool: 'Shared across people',
}

export const KIND_HINT: Record<RoutingRuleKind, string> = {
  company_owner:
    'Goes to whoever owns the lead’s company. Skipped when the lead has no company, or the company has no owner.',
  named_user: 'Always goes to one person, while they are available and under the cap.',
  pool: 'Goes to whoever in the list owns the fewest contacts. Ties go to whoever is listed first.',
}

export const SOURCE_LABEL: Record<RoutingSource, string> = {
  csv_import: 'CSV import',
  lead_engine: 'Lead Engine',
  api: 'API',
}

export const STATUS_LABEL: Record<RoutingRuleStatus, string> = {
  draft: 'Draft',
  published: 'Live',
  archived: 'Archived',
}

/**
 * Why a lead is in the Unassigned queue.
 *
 * ⚠️ WORDED AS A FACT ABOUT THE RULES, NOT A FAULT WITH THE LEAD. The lead is
 * fine; what it says is that the rules as written had nobody for it, which is
 * the thing an admin can change.
 */
export const DECISION_REASON: Record<string, string> = {
  no_rule_matched: 'No live rule covers leads from this source.',
  no_eligible_owner: 'Every rule that applied had nobody available.',
}

/** Why one rule, among several, did not place a lead. */
export const RULE_SKIP_REASON: Record<string, string> = {
  contact_has_no_company: 'the lead has no company',
  company_has_no_owner: 'its company has no owner',
  no_eligible_owner: 'nobody it names is available or under the cap',
}

export function describeDecision(reason: string): string {
  return DECISION_REASON[reason] ?? 'Routing could not place this lead.'
}

export function describeRuleSkip(reason: string): string {
  return RULE_SKIP_REASON[reason] ?? 'it could not place the lead'
}
