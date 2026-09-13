import 'server-only'

/**
 * May we proactively contact this person? The only place that decides.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  TWO TABLES ANSWER TWO DIFFERENT QUESTIONS, AND BOTH ARE NEEDED.          ║
 * ║                                                                           ║
 * ║  `email_suppressions` is authoritative for ADDRESSES. A one-click          ║
 * ║  unsubscribe arrives for an address that may resolve to no contact, or to  ║
 * ║  an ambiguous shared inbox, and that has to be storable exactly as         ║
 * ║  observed.                                                                ║
 * ║                                                                           ║
 * ║  `crm_contact_suppressions` is authoritative for PEOPLE. A LinkedIn-only   ║
 * ║  contact has no address at all, so before 0121 "do not contact this        ║
 * ║  person" was simply unrecordable — which blocked §4.11's `Mark DNC`        ║
 * ║  outright.                                                                ║
 * ║                                                                           ║
 * ║  Neither can express the other's case. What stops them diverging is that   ║
 * ║  this MODULE is the one reader. Two callers asking the same question two   ║
 * ║  ways is how a stop ends up honoured on one path and not the other.       ║
 * ║                                                                           ║
 * ║  ⚠️ THAT CLAIM WAS FALSE WHEN IT WAS FIRST WRITTEN, and the wording is    ║
 * ║  now "module" rather than "function" because of how it was made true:      ║
 * ║  two bulk call sites were querying `email_suppressions` themselves and     ║
 * ║  never reading `crm_contact_suppressions` at all. They had a real reason   ║
 * ║  — a per-contact loop is two round trips each — so the fix was to give     ║
 * ║  them `contactsStopped` below, not to ask them to be slower.              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ IT FAILS CLOSED ON ERROR — the opposite of the rate limiter, deliberately.
 * `consume_rate_limit` fails open because refusing a legitimate action on an
 * infrastructure blip is worse than allowing an extra one. Here the asymmetry
 * runs the other way: mailing somebody who asked not to be mailed cannot be
 * undone, cannot be apologised away, and is the one failure with legal weight.
 * A database that will not answer is not permission.
 */
import { createAdminClient } from '@/lib/supabase/admin'

/** Which channel is asking. `all` scopes always apply. */
export type StopChannel = 'email' | 'linkedin'

export type ContactStop =
  | { stopped: false }
  | {
      stopped: true
      /** `contact` for a person-level DNC, `address` for an email suppression. */
      via: 'contact' | 'address'
      reason: string
    }
  /** The lookup itself failed. Treated as stopped by every caller. */
  | { stopped: true; via: 'unknown'; reason: 'lookup_failed' }

/**
 * Whether proactive outreach to this person on this channel is stopped.
 *
 * `contactId` or `email` may each be absent — a LinkedIn contact often has no
 * address, and an unsubscribe often has no resolvable contact — but supplying
 * neither is a programming error, because the answer would then be about
 * nobody.
 */
export async function contactIsStopped(input: {
  workspaceId: string
  channel: StopChannel
  contactId?: string | null
  email?: string | null
}): Promise<ContactStop> {
  const contactId = input.contactId ?? null
  const email = input.email?.trim().toLowerCase() ?? null

  if (!contactId && !email) {
    throw new Error('contactIsStopped needs a contactId or an email')
  }

  try {
    const db = createAdminClient()

    const [byContact, byAddress] = await Promise.all([
      contactId
        ? db
            .from('crm_contact_suppressions')
            .select('reason, scope')
            // Service role bypasses RLS — scoping by workspace is mandatory.
            .eq('workspace_id', input.workspaceId)
            .eq('contact_id', contactId)
            /*
             * `all` OR this channel. A person who said "stop emailing me" has
             * not said "stop connecting on LinkedIn", and §4.15 requires the
             * scope to be respected exactly rather than widened for
             * convenience.
             */
            .in('scope', ['all', input.channel])
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      email
        ? db
            .from('email_suppressions')
            .select('reason')
            .eq('workspace_id', input.workspaceId)
            .eq('email', email)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    if (byContact.error || byAddress.error) {
      return { stopped: true, via: 'unknown', reason: 'lookup_failed' }
    }

    if (byContact.data) {
      return { stopped: true, via: 'contact', reason: byContact.data.reason }
    }

    /*
     * ⚠️ AN ADDRESS SUPPRESSION ONLY STOPS THE EMAIL CHANNEL. It is evidence
     * that one mailbox asked to be left alone; it says nothing about whether
     * that person may be approached on LinkedIn, and treating it as if it did
     * would be inventing the scope of somebody's request.
     */
    if (byAddress.data && input.channel === 'email') {
      return { stopped: true, via: 'address', reason: byAddress.data.reason }
    }

    return { stopped: false }
  } catch {
    // See the note above: a database that will not answer is not permission.
    return { stopped: true, via: 'unknown', reason: 'lookup_failed' }
  }
}

/**
 * The same question, asked about many people at once.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS EXISTS SO THE BULK PATHS STOP ASKING THE QUESTION THEMSELVES.    ║
 * ║                                                                           ║
 * ║  The banner above claims `contactIsStopped` is the ONE reader. It was not: ║
 * ║  `lib/email/enrollment.ts` and `lib/flows/actions/email.ts` each queried   ║
 * ║  `email_suppressions` directly and checked `crm_contact_suppressions`      ║
 * ║  NOWHERE — so a person marked do-not-contact was reported as enrolled and  ║
 * ║  as eligible, then silently skipped at every send by `enqueueEmail`.       ║
 * ║                                                                           ║
 * ║  No mail went out, because the send gate was always complete. What was     ║
 * ║  wrong was everything the customer was TOLD: they marked somebody DNC,     ║
 * ║  watched the product enrol them anyway, and had no way to learn why        ║
 * ║  nothing was ever sent.                                                    ║
 * ║                                                                           ║
 * ║  A per-contact loop would be two round trips each, which is why those      ║
 * ║  call sites hand-rolled a bulk query in the first place. Two queries total ║
 * ║  removes the reason to.                                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Keyed by `contactId`. A contact absent from the result is not stopped.
 */
export async function contactsStopped(input: {
  workspaceId: string
  channel: StopChannel
  contacts: readonly { contactId: string; email?: string | null }[]
}): Promise<Map<string, ContactStop>> {
  const stops = new Map<string, ContactStop>()
  if (input.contacts.length === 0) return stops

  const contactIds = [...new Set(input.contacts.map((c) => c.contactId))]
  const emailOf = new Map(
    input.contacts.map((c) => [c.contactId, c.email?.trim().toLowerCase() ?? null]),
  )
  const addresses = [...new Set([...emailOf.values()].filter((e): e is string => e !== null))]

  /** Fails CLOSED, for the reason in the banner at the top of this file. */
  const allStopped = (): Map<string, ContactStop> =>
    new Map(contactIds.map((id) => [id, { stopped: true, via: 'unknown', reason: 'lookup_failed' }]))

  try {
    const db = createAdminClient()

    const [byContact, byAddress] = await Promise.all([
      db
        .from('crm_contact_suppressions')
        .select('contact_id, reason')
        // Service role bypasses RLS — scoping by workspace is mandatory.
        .eq('workspace_id', input.workspaceId)
        .in('contact_id', contactIds)
        .in('scope', ['all', input.channel]),
      addresses.length > 0
        ? db
            .from('email_suppressions')
            .select('email, reason')
            .eq('workspace_id', input.workspaceId)
            .in('email', addresses)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (byContact.error || byAddress.error) return allStopped()

    for (const row of byContact.data ?? []) {
      stops.set(row.contact_id, { stopped: true, via: 'contact', reason: row.reason })
    }

    /*
     * ⚠️ SAME SCOPE RULE AS THE SINGLE VERSION. An address suppression is
     * evidence about one mailbox and says nothing about LinkedIn; and a
     * person-level stop already recorded above is not overwritten by it,
     * because `via: 'contact'` is the more specific fact.
     */
    if (input.channel === 'email' && (byAddress.data ?? []).length > 0) {
      const suppressedAddresses = new Map(
        (byAddress.data ?? []).map((r) => [r.email, r.reason as string]),
      )
      for (const [contactId, email] of emailOf) {
        if (stops.has(contactId) || email === null) continue
        const reason = suppressedAddresses.get(email)
        if (reason !== undefined) {
          stops.set(contactId, { stopped: true, via: 'address', reason })
        }
      }
    }

    return stops
  } catch {
    return allStopped()
  }
}

/**
 * Records a do-not-contact against a person.
 *
 * ⚠️ THE FIRST REASON WINS, mirroring `suppressEmail`. If somebody asked to be
 * removed and a bounce arrives later, `explicit_request` is the fact that
 * matters — it is a stated wish rather than a delivery accident, and
 * overwriting it would lose the consent provenance that decides how the
 * request must be handled.
 */
export async function suppressContact(input: {
  workspaceId: string
  contactId: string
  reason:
    | 'unsubscribed'
    | 'not_interested'
    | 'explicit_request'
    | 'hostile'
    | 'privacy_request'
    | 'manual'
  /** Defaults to `all`: an ambiguous request is read broadly (§4.15). */
  scope?: 'all' | 'email' | 'linkedin'
  source?: string | null
  createdBy?: string | null
}): Promise<void> {
  const { error } = await createAdminClient()
    .from('crm_contact_suppressions')
    .upsert(
      {
        workspace_id: input.workspaceId,
        contact_id: input.contactId,
        scope: input.scope ?? 'all',
        reason: input.reason,
        source: input.source ?? null,
        created_by: input.createdBy ?? null,
      },
      { onConflict: 'workspace_id,contact_id,scope', ignoreDuplicates: true },
    )

  if (error) throw new Error(`suppressContact failed: ${error.message}`)
}
