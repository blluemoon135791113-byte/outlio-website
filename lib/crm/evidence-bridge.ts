import 'server-only'

/**
 * Research findings become CRM contact details.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE RESEARCH ALREADY FOUND THE ADDRESSES. NOTHING CARRIED THEM ACROSS.  ║
 * ║                                                                           ║
 * ║  Measured on production: `research_evidence` holds 111 `work_email` and   ║
 * ║  `mobile_phone` rows — real, sourced values like `steve@powerconnect.ai`  ║
 * ║  — while `crm_contact_emails` held ZERO. `attachContactEmails` was called ║
 * ║  from exactly one place, `upsertContact`, using only the addresses that   ║
 * ║  arrived WITH the contact at creation time. Anything discovered later had ║
 * ║  nowhere to go.                                                           ║
 * ║                                                                           ║
 * ║  So the enrichment worked, the CRM looked empty, and the email export     ║
 * ║  produced a file with a header and no rows. The missing piece was never   ║
 * ║  the scraping.                                                            ║
 * ║                                                                           ║
 * ║  ⚠️ THIS COPIES, IT NEVER INFERS (CLAUDE.md rule 4). Every value written  ║
 * ║  here is the literal string a provider observed, and the evidence row it  ║
 * ║  came from stays queryable as the citation. No merging of partials, no    ║
 * ║  pattern-guessing `first.last@domain`, no LLM gap-filling.                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { attachContactEmails, attachContactPhones } from '@/lib/crm/repository'
import { normalizeEmail, normalizePhoneNumber } from '@/lib/crm/normalize'
import { createAdminClient } from '@/lib/supabase/admin'

/** The evidence fields that describe how to reach a PERSON. */
const CONTACT_FIELDS = ['work_email', 'mobile_phone'] as const

/**
 * ⚠️ A FLOOR, NOT A FILTER FOR SHOW. Everything currently stored sits at
 * 0.7–0.9, so this admits today's data — it exists so that a future provider
 * emitting weak guesses cannot quietly write them into the address book a
 * campaign sends to. A confidently wrong address is worse than a blank field:
 * a blank one is visibly missing, and a wrong one mails a stranger.
 */
export const MIN_EVIDENCE_CONFIDENCE = 0.7

export type EvidenceBridgeResult = {
  contactsConsidered: number
  emailsAdded: number
  phonesAdded: number
  /** Rows deliberately not written, by reason. Reported, never silent. */
  skipped: { lowConfidence: number; unusable: number; notLinked: number }
}

type EvidenceRow = {
  /** The citation this value carries into the CRM (0113). */
  id: string
  entity_id: string
  field: string
  value_json: Record<string, unknown>
  source_confidence: string
  confidence: number
}

/** The literal address or number a provider observed, or null. */
function literalValue(row: EvidenceRow): string | null {
  const key = row.field === 'work_email' ? 'email' : 'phone'
  const value = row.value_json[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Whether this row is about the PERSON we think it is.
 *
 * ⚠️ SEPARATE FROM `confidence`. `confidence` is "is this a real address";
 * `identityConfidence` is "does it belong to THIS human" — and only some
 * providers report it. A high-confidence address attached to the wrong person
 * is the failure mode that survives every other check, because the address
 * itself is perfectly valid.
 */
function identityIsTrusted(row: EvidenceRow): boolean {
  const stated = row.value_json.identityConfidence
  if (typeof stated === 'number') return stated >= MIN_EVIDENCE_CONFIDENCE
  if (typeof stated === 'string') return stated === 'high' || stated === 'medium'
  // Absent means the provider does not report it; the row is judged on the
  // other signals rather than discarded.
  return true
}

/**
 * Copies contact evidence onto the CRM contacts it belongs to.
 *
 * Idempotent: `attachContactEmails` and `attachContactPhones` both swallow the
 * unique violation, so running this twice adds nothing the second time. That
 * matters because it runs after every research run AND as a backfill.
 */
export async function syncContactEvidenceToCrm(
  workspaceId: string,
  options: { contactIds?: string[] } = {},
): Promise<EvidenceBridgeResult> {
  const db = createAdminClient()
  const result: EvidenceBridgeResult = {
    contactsConsidered: 0,
    emailsAdded: 0,
    phonesAdded: 0,
    skipped: { lowConfidence: 0, unusable: 0, notLinked: 0 },
  }

  /*
   * ⚠️ CONTACTS FIRST, EVIDENCE SECOND — the direction matters.
   *
   * `research_evidence` is keyed by `user_id` and its `entity_id` points at
   * `extracted_leads`, NOT at a workspace or a contact. Reading evidence first
   * and then looking up contacts would mean trusting an id from another table
   * to name the tenant. Starting from `crm_contacts` scoped to this workspace
   * makes the workspace boundary the first filter rather than the last.
   */
  let contactQuery = db
    .from('crm_contacts')
    .select('id, source_lead_id')
    .eq('workspace_id', workspaceId)
    .not('source_lead_id', 'is', null)
    .is('deleted_at', null)

  if (options.contactIds?.length) contactQuery = contactQuery.in('id', options.contactIds)

  const { data: contacts, error: contactError } = await contactQuery
  if (contactError) {
    throw new Error(`syncContactEvidenceToCrm failed: ${contactError.message}`)
  }

  const rows = contacts ?? []
  result.contactsConsidered = rows.length
  if (rows.length === 0) return result

  // One contact per lead. A lead re-ingested into two contacts would be a
  // de-duplication bug elsewhere; here the first one wins deterministically.
  const contactByLead = new Map<string, string>()
  for (const row of rows) {
    if (row.source_lead_id && !contactByLead.has(row.source_lead_id)) {
      contactByLead.set(row.source_lead_id, row.id)
    }
  }

  const leadIds = [...contactByLead.keys()]

  const { data: evidence, error: evidenceError } = await db
    .from('research_evidence')
    // `id` is the citation this value will carry into the CRM (0113).
    .select('id, entity_id, field, value_json, source_confidence, confidence')
    .eq('entity_type', 'person')
    .in('field', CONTACT_FIELDS as unknown as string[])
    .in('entity_id', leadIds)
    // Newest first, so the freshest observation becomes the primary address.
    .order('retrieved_at', { ascending: false })

  if (evidenceError) {
    throw new Error(`syncContactEvidenceToCrm failed: ${evidenceError.message}`)
  }

  const emailsFor = new Map<
    string,
    { address: string; identityKey: string; evidenceId: string }[]
  >()
  const phonesFor = new Map<
    string,
    { raw: string; e164: string | null; evidenceId: string }[]
  >()

  for (const row of (evidence ?? []) as EvidenceRow[]) {
    const contactId = contactByLead.get(row.entity_id)
    if (!contactId) {
      result.skipped.notLinked += 1
      continue
    }

    if (
      row.source_confidence === 'low' ||
      Number(row.confidence) < MIN_EVIDENCE_CONFIDENCE ||
      !identityIsTrusted(row)
    ) {
      result.skipped.lowConfidence += 1
      continue
    }

    const literal = literalValue(row)
    if (!literal) {
      result.skipped.unusable += 1
      continue
    }

    if (row.field === 'work_email') {
      /*
       * ⚠️ NORMALISED THROUGH THE SAME FUNCTION THE REST OF THE CRM USES.
       * `crm_contact_emails` has a `address = lower(address)` check and a NOT
       * NULL `identity_key`; writing the raw provider string would violate
       * both. Going through `normalizeEmail` also means a discovered address
       * dedupes against an imported one, which is the entire point of the
       * identity key.
       */
      const identity = normalizeEmail(literal)
      if (!identity) {
        result.skipped.unusable += 1
        continue
      }
      const list = emailsFor.get(contactId) ?? []
      if (!list.some((e) => e.identityKey === identity.identityKey)) {
        /*
         * ⚠️ THE ROW'S OWN ID, NOT A LOOKUP. This is what makes the citation
         * exact: the value and its provenance leave `research_evidence`
         * together, so nothing has to match them up again later across the
         * user_id/workspace_id seam.
         */
        list.push({
          address: identity.address,
          identityKey: identity.identityKey,
          evidenceId: row.id,
        })
      }
      emailsFor.set(contactId, list)
    } else {
      /*
       * ⚠️ NO `defaultCountry`. `normalizePhoneNumber` refuses to guess a
       * region, and that refusal is deliberate: `07700 900123` is a valid
       * mobile in the UK and a landline elsewhere. A national-format number
       * is still STORED — `raw` is preserved and `e164` is null — so nothing
       * is lost, it simply cannot be dialled confidently or used to merge.
       */
      const identity = normalizePhoneNumber(literal)
      if (!identity) {
        result.skipped.unusable += 1
        continue
      }
      const list = phonesFor.get(contactId) ?? []
      if (!list.some((p) => p.raw === identity.raw)) {
        list.push({ raw: identity.raw, e164: identity.e164, evidenceId: row.id })
      }
      phonesFor.set(contactId, list)
    }
  }

  for (const [contactId, emails] of emailsFor) {
    // `lead_engine` because that is where the research runs. The enum has no
    // `enrichment` member and inventing one is a migration, not a default.
    await attachContactEmails(workspaceId, contactId, emails, 'lead_engine')
    result.emailsAdded += emails.length
  }

  for (const [contactId, phones] of phonesFor) {
    await attachContactPhones(workspaceId, contactId, phones, 'lead_engine')
    result.phonesAdded += phones.length
  }

  return result
}
