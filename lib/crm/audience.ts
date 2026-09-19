/**
 * Turning "who do you want to reach" into a set of contact ids.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ONE RESOLVER, BECAUSE THERE ARE TWO CHANNELS AND FOUR SOURCES.          ║
 * ║                                                                           ║
 * ║  Email enrolment and LinkedIn enrolment ask exactly the same question and ║
 * ║  differ only in what they do with the answer. Written twice, the two      ║
 * ║  would drift on the parts that are easy to get wrong and invisible when   ║
 * ║  wrong: the owner scope, the cap, and the de-duplication.                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THIS RESOLVES IDENTITY ONLY. It answers "which contacts", never "should
 * these be contacted". Suppression, unsubscribes, bounces, missing email
 * addresses, do-not-contact and duplicate enrolment are the enroller's job —
 * `bulkEnroll` already refuses each with a named reason, and re-checking any of
 * them here would produce a second opinion that can disagree with the first.
 */
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * ⚠️ A CEILING, NOT A PAGE SIZE. Nothing pages through an audience — it is
 * resolved in one go and handed to an enroller, so an unbounded list becomes an
 * unbounded `.in()` and a request that never returns. 5,000 is well above any
 * real sequence and well below the point where the query stops being a query.
 *
 * `truncated` is returned rather than silently swallowed: quietly enrolling the
 * first 5,000 of 8,000 people is the kind of wrong that is only discovered when
 * someone asks why 3,000 prospects were never contacted.
 */
export const AUDIENCE_LIMIT = 5_000

export type AudienceSource =
  /** Explicit selection — the checkboxes on the contacts table. */
  | { kind: 'contacts'; contactIds: string[] }
  /** Everyone on a CRM list. */
  | { kind: 'list'; listId: string }
  /** The contacts on the open deals in one pipeline stage. */
  | { kind: 'stage'; stageId: string }
  /** The contacts on the open deals across a whole pipeline. */
  | { kind: 'pipeline'; pipelineId: string }
  /** Everyone a single CSV import brought in or matched. */
  | { kind: 'batch'; batchId: string }

export type ResolvedAudience = {
  contactIds: string[]
  /** True when the source held more than `AUDIENCE_LIMIT` people. */
  truncated: boolean
}

export type ResolveOptions = {
  /**
   * Narrows to one person's records.
   *
   * ⚠️ NOT OPTIONAL IN PRACTICE — pass `dataScope(role) === 'assigned' ?
   * userId : null`. RLS grants a member the whole workspace, so "a setter sees
   * only their own" is a policy decision that has to be applied to the QUERY.
   * Every other CRM read in this codebase does it and the ones that forgot are
   * recorded as bugs in `PROGRESS.md`.
   */
  ownerUserId?: string | null
}

/**
 * ⚠️ WORKSPACE IS ALWAYS APPLIED, ON EVERY BRANCH. The service role bypasses
 * RLS, and every id below arrives from a form — a list id, a stage id and a
 * batch id are all claims until this function proves they belong here. Omitting
 * the scope on one branch would let a crafted id enrol another tenant's people.
 */
export async function resolveAudience(
  workspaceId: string,
  source: AudienceSource,
  options: ResolveOptions = {},
): Promise<ResolvedAudience> {
  const ownerUserId = options.ownerUserId ?? null

  switch (source.kind) {
    case 'contacts':
      return contactsById(workspaceId, source.contactIds, ownerUserId)
    case 'list':
      return fromList(workspaceId, source.listId, ownerUserId)
    case 'stage':
      return fromDeals(workspaceId, { stageId: source.stageId }, ownerUserId)
    case 'pipeline':
      return fromDeals(workspaceId, { pipelineId: source.pipelineId }, ownerUserId)
    case 'batch':
      return fromBatch(workspaceId, source.batchId, ownerUserId)
  }
}

/**
 * Filters an explicit selection down to contacts that really are in scope.
 *
 * ⚠️ THE IDS ARE RE-CHECKED EVEN THOUGH THEY CAME FROM OUR OWN TABLE. A server
 * action is a public HTTP endpoint: the checkboxes are a suggestion, not a
 * guarantee, and a deleted contact can also be selected and then deleted before
 * the form is submitted.
 */
async function contactsById(
  workspaceId: string,
  contactIds: string[],
  ownerUserId: string | null,
): Promise<ResolvedAudience> {
  const unique = [...new Set(contactIds.filter(Boolean))]
  if (unique.length === 0) return { contactIds: [], truncated: false }

  const capped = unique.slice(0, AUDIENCE_LIMIT)
  const db = createAdminClient()

  let query = db
    .from('crm_contacts')
    .select('id')
    .eq('workspace_id', workspaceId)
    .in('id', capped)
    .is('deleted_at', null)

  if (ownerUserId) query = query.eq('owner_user_id', ownerUserId)

  const { data, error } = await query
  if (error) throw new Error(`resolveAudience(contacts) failed: ${error.message}`)

  return {
    contactIds: (data ?? []).map((row) => row.id),
    truncated: unique.length > AUDIENCE_LIMIT,
  }
}

async function fromList(
  workspaceId: string,
  listId: string,
  ownerUserId: string | null,
): Promise<ResolvedAudience> {
  const db = createAdminClient()

  /*
   * ⚠️ THE LIST IS PROVEN TO EXIST IN THIS WORKSPACE FIRST. `crm_list_members`
   * is scoped too, so a foreign id would return zero rows either way — but zero
   * rows reads as "this list is empty", and an empty audience and a list that
   * is not yours deserve different answers.
   */
  const { data: list } = await db
    .from('crm_lists')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('id', listId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!list) throw new AudienceNotFoundError('That list no longer exists.')

  const { data, error } = await db
    .from('crm_list_members')
    .select('contact_id')
    .eq('workspace_id', workspaceId)
    .eq('list_id', listId)
    .limit(AUDIENCE_LIMIT + 1)

  if (error) throw new Error(`resolveAudience(list) failed: ${error.message}`)

  return scopeContacts(workspaceId, (data ?? []).map((r) => r.contact_id), ownerUserId)
}

/**
 * The people attached to deals.
 *
 * ⚠️ OPEN DEALS ONLY. A stage's won and lost deals are its history, and a
 * sequence aimed at "everyone in Proposal" means the deals sitting there now —
 * not every deal that has ever passed through, which on an established pipeline
 * is most of the CRM and includes customers who already bought.
 *
 * ⚠️ AND A DEAL NEED NOT HAVE A CONTACT. `crm_opportunities.contact_id` is
 * nullable, so the null rows are dropped rather than counted; an audience of
 * "12 deals" that resolves to 9 people is correct and the caller shows the
 * resolved number.
 */
async function fromDeals(
  workspaceId: string,
  scope: { stageId: string } | { pipelineId: string },
  ownerUserId: string | null,
): Promise<ResolvedAudience> {
  const db = createAdminClient()

  let query = db
    .from('crm_opportunities')
    .select('contact_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'open')
    .not('contact_id', 'is', null)
    .limit(AUDIENCE_LIMIT + 1)

  query =
    'stageId' in scope
      ? query.eq('stage_id', scope.stageId)
      : query.eq('pipeline_id', scope.pipelineId)

  /*
   * ⚠️ SCOPED ON THE DEAL'S OWNER, NOT ONLY THE CONTACT'S. A setter's deal can
   * point at a contact somebody else owns; filtering only on the contact would
   * drop people out of their own pipeline stage. `scopeContacts` below still
   * applies the contact-side scope, so both halves have to pass.
   */
  if (ownerUserId) query = query.eq('owner_user_id', ownerUserId)

  const { data, error } = await query
  if (error) throw new Error(`resolveAudience(deals) failed: ${error.message}`)

  const ids = (data ?? [])
    .map((row) => row.contact_id)
    .filter((id): id is string => Boolean(id))

  return scopeContacts(workspaceId, ids, ownerUserId)
}

async function fromBatch(
  workspaceId: string,
  batchId: string,
  ownerUserId: string | null,
): Promise<ResolvedAudience> {
  const db = createAdminClient()

  const { data, error } = await db
    .from('crm_batch_members')
    .select('contact_id')
    .eq('workspace_id', workspaceId)
    .eq('batch_id', batchId)
    .limit(AUDIENCE_LIMIT + 1)

  if (error) throw new Error(`resolveAudience(batch) failed: ${error.message}`)

  /*
   * ⚠️ EVERYONE IN THE BATCH, INCLUDING THE PEOPLE IT ONLY MATCHED. A batch
   * member with `created_contact = false` is somebody the CRM already knew and
   * this file also named — they are in the uploaded list, so they belong in the
   * audience. That flag exists for UNDO, which must not delete a pre-existing
   * person, and it means nothing here.
   */
  return scopeContacts(workspaceId, (data ?? []).map((r) => r.contact_id), ownerUserId)
}

/**
 * De-duplicates, caps, and confirms each contact is live and in scope.
 *
 * ⚠️ THE DE-DUPLICATION IS NOT DECORATIVE. Someone can sit on two deals in the
 * same pipeline, or be added to a list twice through two imports. Passing the
 * duplicate through would enrol them once and report them twice — and for
 * LinkedIn, where enrolment creates a task card, it would put the same person
 * in an operator's inbox two or three times.
 */
async function scopeContacts(
  workspaceId: string,
  rawIds: string[],
  ownerUserId: string | null,
): Promise<ResolvedAudience> {
  const unique = [...new Set(rawIds.filter(Boolean))]
  if (unique.length === 0) return { contactIds: [], truncated: false }

  const truncated = unique.length > AUDIENCE_LIMIT
  const capped = unique.slice(0, AUDIENCE_LIMIT)

  const db = createAdminClient()
  let query = db
    .from('crm_contacts')
    .select('id')
    .eq('workspace_id', workspaceId)
    .in('id', capped)
    .is('deleted_at', null)

  if (ownerUserId) query = query.eq('owner_user_id', ownerUserId)

  const { data, error } = await query
  if (error) throw new Error(`resolveAudience scope failed: ${error.message}`)

  return { contactIds: (data ?? []).map((row) => row.id), truncated }
}

/** A source the caller named that does not exist in this workspace. */
export class AudienceNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AudienceNotFoundError'
  }
}

/**
 * Reads an `AudienceSource` out of a submitted form, or returns null.
 *
 * ⚠️ ONE PARSER, SHARED BY BOTH CHANNELS, so the email and LinkedIn forms
 * cannot disagree about what `audienceKind` means. Returning null rather than
 * throwing keeps "you did not choose a source" a message the user sees instead
 * of a 500.
 */
export function audienceFromFormData(formData: FormData): AudienceSource | null {
  const kind = String(formData.get('audienceKind') ?? '')
  const value = String(formData.get('audienceId') ?? '')

  switch (kind) {
    case 'contacts': {
      const contactIds = formData.getAll('contactId').map(String).filter(Boolean)
      return contactIds.length > 0 ? { kind: 'contacts', contactIds } : null
    }
    case 'list':
      return value ? { kind: 'list', listId: value } : null
    case 'stage':
      return value ? { kind: 'stage', stageId: value } : null
    case 'pipeline':
      return value ? { kind: 'pipeline', pipelineId: value } : null
    case 'batch':
      return value ? { kind: 'batch', batchId: value } : null
    default:
      return null
  }
}
