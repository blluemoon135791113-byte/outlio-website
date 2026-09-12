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
 * ║  this function is the ONE reader. Two channels asking the same question    ║
 * ║  two ways is how a stop ends up honoured on one and not the other.        ║
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
