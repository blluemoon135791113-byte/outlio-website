import 'server-only'

/**
 * The opener and pitch a rep writes for one prospect — 0133.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  Owner, 2026-09-15: "the user or the assigned person can add his or her   ║
 * ║  opener dm and a pitch dm in the pipeline section for each prospect".     ║
 * ║                                                                           ║
 * ║  ⚠️ THESE ARE NOT WORKFLOW STEP BODIES. A step body is the CAMPAIGN'S     ║
 * ║  copy, written once and applied to everybody in it. These are             ║
 * ║  per-prospect: what THIS rep decided to say to THIS person. Two reps       ║
 * ║  working the same campaign write different openers, and "what is working"  ║
 * ║  is largely a question about that difference.                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ EVERY QUERY SCOPES BY `workspace_id` IN CODE. The service role bypasses
 * RLS, so the policy on the table protects the browser client and nothing here.
 */
import { validateBody } from '@/lib/linkedin/placeholders'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

export type ProspectMessageKind =
  Database['public']['Enums']['linkedin_prospect_message_kind']

export const PROSPECT_MESSAGE_KINDS: readonly ProspectMessageKind[] = ['OPENER', 'PITCH']

export const PROSPECT_MESSAGE_LABEL: Readonly<Record<ProspectMessageKind, string>> = {
  OPENER: 'Opener',
  PITCH: 'Pitch',
}

export const PROSPECT_MESSAGE_HELP: Readonly<Record<ProspectMessageKind, string>> = {
  OPENER: 'The first thing you would say to this person.',
  PITCH: 'What you would say once they reply.',
}

export const MAX_PROSPECT_MESSAGE = 8_000

export type ProspectMessage = {
  id: string
  kind: ProspectMessageKind
  body: string
  authoredBy: string
  authorName: string | null
  updatedAt: string
}

export type SaveProspectMessageResult =
  | { ok: true; message: ProspectMessage }
  | { ok: false; error: string }

/** Both messages for one prospect, whichever exist. */
export async function prospectMessages(
  workspaceId: string,
  contactId: string,
): Promise<ProspectMessage[]> {
  const db = createAdminClient()

  const { data, error } = await db
    .from('linkedin_prospect_messages')
    .select('id, kind, body, authored_by, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .order('kind', { ascending: true })

  if (error) throw new Error(`prospectMessages failed: ${error.message}`)

  const rows = data ?? []
  if (rows.length === 0) return []

  /*
   * ⚠️ THE AUTHOR'S NAME IS RESOLVED SEPARATELY, NOT JOINED. `authored_by`
   * references `auth.users`, which PostgREST cannot embed — the profile lives in
   * `profiles`. Two reads rather than a join that silently returns nothing.
   */
  const authorIds = [...new Set(rows.map((row) => row.authored_by))]
  const { data: profiles } = await db
    .from('profiles')
    .select('id, full_name, email')
    .in('id', authorIds)

  const names = new Map(
    (profiles ?? []).map((p) => [p.id, p.full_name?.trim() || p.email || null]),
  )

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    body: row.body,
    authoredBy: row.authored_by,
    authorName: names.get(row.authored_by) ?? null,
    updatedAt: row.updated_at,
  }))
}

/**
 * Writes one of the two messages, replacing what was there.
 *
 * ⚠️ UPSERT ON `(workspace_id, contact_id, kind)`, WHICH IS THE UNIQUE INDEX.
 * Two people editing the same prospect's opener at once both pass a
 * read-then-write; only the index can refuse the second, and `onConflict` turns
 * that refusal into the last write winning rather than into an error the rep
 * cannot act on.
 *
 * ⚠️ `authored_by` IS THE PERSON WRITING NOW, not the contact's owner. 0140
 * says why: deriving it later would attribute a message to whoever owns the
 * contact today, so reassigning a book of leads would silently rewrite every
 * past author — and the per-rep report the owner asked for is exactly that
 * grouping.
 */
export async function saveProspectMessage(input: {
  workspaceId: string
  contactId: string
  kind: ProspectMessageKind
  body: string
  actorUserId: string
}): Promise<SaveProspectMessageResult> {
  const body = input.body.trim()

  if (!body) {
    /*
     * ⚠️ NOT SILENTLY DELETED. An empty submission is ambiguous — it could be a
     * rep clearing a draft or a form that failed to carry its value — and
     * guessing the first would destroy work on the second. Removal has its own
     * verb below.
     */
    return { ok: false, error: 'Write something, or use Remove to clear it.' }
  }

  if (body.length > MAX_PROSPECT_MESSAGE) {
    return {
      ok: false,
      error: `That is ${body.length} characters — the limit is ${MAX_PROSPECT_MESSAGE}.`,
    }
  }

  /*
   * ⚠️ PLACEHOLDERS ARE VALIDATED HERE TOO, and for the same reason the workflow
   * builder validates them at save: `{{firstname}}` is a plausible typo for
   * `{{first_name}}`, and the only alternatives at use-time are leaking the
   * braces to a stranger or silently altering a sentence the rep wrote.
   */
  const placeholders = validateBody(body)
  if (!placeholders.ok) {
    return {
      ok: false,
      error:
        placeholders.unknown.length === 1
          ? `{{${placeholders.unknown[0]}}} is not a placeholder Outlio knows.`
          : `These are not placeholders Outlio knows: ${placeholders.unknown
              .map((name) => `{{${name}}}`)
              .join(', ')}.`,
    }
  }

  const db = createAdminClient()

  /*
   * ⚠️ THE CONTACT IS PROVEN TO BE IN THIS WORKSPACE FIRST. `contact_id` arrives
   * from a form, and the insert below would otherwise happily attach a message
   * to another tenant's contact under this workspace's id — a row that reads as
   * ours and points at theirs.
   */
  const { data: contact } = await db
    .from('crm_contacts')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.contactId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!contact) return { ok: false, error: 'That contact is not in this workspace.' }

  const { data, error } = await db
    .from('linkedin_prospect_messages')
    .upsert(
      {
        workspace_id: input.workspaceId,
        contact_id: input.contactId,
        kind: input.kind,
        body,
        authored_by: input.actorUserId,
      },
      { onConflict: 'workspace_id,contact_id,kind' },
    )
    .select('id, kind, body, authored_by, updated_at')
    .single()

  if (error || !data) {
    console.error('saveProspectMessage failed', { contactId: input.contactId, error })
    return { ok: false, error: 'That could not be saved.' }
  }

  return {
    ok: true,
    message: {
      id: data.id,
      kind: data.kind,
      body: data.body,
      authoredBy: data.authored_by,
      authorName: null,
      updatedAt: data.updated_at,
    },
  }
}

/** Clears one of the two messages. */
export async function removeProspectMessage(input: {
  workspaceId: string
  contactId: string
  kind: ProspectMessageKind
}): Promise<boolean> {
  const { error } = await createAdminClient()
    .from('linkedin_prospect_messages')
    .delete()
    .eq('workspace_id', input.workspaceId)
    .eq('contact_id', input.contactId)
    .eq('kind', input.kind)

  return !error
}

export type ProspectMessageRow = {
  contactId: string
  contactName: string | null
  ownerUserId: string | null
  kind: ProspectMessageKind
  body: string
  authoredBy: string
}

/**
 * Every prospect message in a workspace, for the analysis.
 *
 * ⚠️ BOUNDED, AND THE BOUND IS NOT A PAGINATION PLACEHOLDER. The analysis sends
 * these to a model; an unbounded read would build a prompt whose size depends on
 * how long the customer has been using the product, and the failure mode is a
 * request that is rejected or silently truncated at the vendor. Newest first, so
 * the cap keeps the most recent strategy rather than the oldest.
 */
export async function allProspectMessages(
  workspaceId: string,
  limit = 400,
  /**
   * Which period and whose writing.
   *
   * ⚠️ FILTERED IN THE QUERY, unlike the two reads in `gatherStats`. Nothing
   * downstream needs a message outside the window for attribution — a message
   * carries its own author — so there is no reason to fetch it. `gatherStats`
   * explains why the other two reads cannot do the same.
   *
   * ⚠️ AND THE `limit` APPLIES AFTER THE FILTER, which is the point. Ordered by
   * recency and capped at 400, an unfiltered read of a busy workspace would
   * return 400 messages from last month and none from the window the manager
   * asked about — a report about the wrong period, with no sign anything was
   * missing.
   */
  window: { from: string | null; to: string | null; userIds: string[] } = {
    from: null,
    to: null,
    userIds: [],
  },
): Promise<ProspectMessageRow[]> {
  const db = createAdminClient()

  let query = db
    .from('linkedin_prospect_messages')
    .select('contact_id, kind, body, authored_by, crm_contacts!inner(full_name, owner_user_id)')
    .eq('workspace_id', workspaceId)

  /*
   * ⚠️ `updated_at`, MATCHING THE COLUMN THE ORDER ALREADY USES. A message is
   * edited in place rather than versioned, so its latest text is what the
   * analysis reads — and dating that text by when it was first created would
   * put a pitch rewritten yesterday outside a window covering yesterday.
   */
  if (window.from) query = query.gte('updated_at', `${window.from}T00:00:00.000Z`)
  if (window.to) query = query.lte('updated_at', `${window.to}T23:59:59.999Z`)
  // Empty means the whole team, never nobody.
  if (window.userIds.length > 0) query = query.in('authored_by', window.userIds)

  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`allProspectMessages failed: ${error.message}`)

  return (data ?? []).map((row) => {
    const contact = row.crm_contacts as unknown as {
      full_name: string | null
      owner_user_id: string | null
    }
    return {
      contactId: row.contact_id,
      contactName: contact?.full_name ?? null,
      ownerUserId: contact?.owner_user_id ?? null,
      kind: row.kind,
      body: row.body,
      authoredBy: row.authored_by,
    }
  })
}
