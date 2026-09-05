import 'server-only'

import type { AnswerSource, AnswerStatus } from '@/lib/hubble/providers/types'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import {
  extractPublicEmail,
  extractPublicPhone,
} from '@/lib/intelligence/providers/search-contact'
import type { NormalizedEvidence, PersonEntity } from '@/lib/intelligence/types'

export type CitedContactSubject = {
  leadId: string | null
  companyId: string | null
  personName: string | null
  personTitle: string | null
  /** Corroborating identity signal, not display data. */
  personLocation: string | null
  companyName: string | null
  domain: string | null
}

/**
 * PURE. Converts only literal contacts in Hubble's CITED passages into typed
 * evidence. The answer prose is deliberately ignored: a model repeating a
 * plausible address cannot turn it into a saved fact.
 */
export function citedContactEvidence(
  subject: CitedContactSubject,
  status: AnswerStatus,
  sources: readonly AnswerSource[],
  retrievedAt: Date = new Date(),
): NormalizedEvidence[] {
  if (!subject.leadId || !subject.personName || status === 'unknown') return []

  const person: PersonEntity = {
    type: 'person',
    id: subject.leadId,
    fullName: subject.personName,
    linkedinUrl: null,
    jobTitle: subject.personTitle,
    location: subject.personLocation,
    companyName: subject.companyName,
    companyDomain: subject.domain,
    companyId: subject.companyId,
  }
  const hits = sources.map((source) => ({
    url: source.url,
    title: source.title,
    snippet: source.quote,
    publishedDate: null,
  }))
  const email = extractPublicEmail(person, hits)
  const phone = extractPublicPhone(person, hits)
  const timestamp = retrievedAt.toISOString()
  const evidence: NormalizedEvidence[] = []

  const push = (
    field: 'work_email' | 'email_status' | 'mobile_phone' | 'phone_status',
    value: Record<string, unknown>,
    finding: NonNullable<typeof email>,
  ) => {
    evidence.push({
      field,
      entityType: 'person',
      entityId: subject.leadId!,
      value,
      sourceProvider: 'hubble-cited-page',
      sourceUrl: finding.sourceUrl,
      sourceConfidence: finding.sourceConfidence,
      confidence: finding.confidence,
      retrievedAt: timestamp,
      expiresAt: expiresAtFor(field, retrievedAt)?.toISOString() ?? null,
    })
  }

  if (email) {
    push('work_email', { email: email.value, sourceTitle: email.sourceTitle }, email)
    push('email_status', { status: 'publicly_found', sourceTitle: email.sourceTitle }, email)
  }
  if (phone) {
    push('mobile_phone', { phone: phone.value, sourceTitle: phone.sourceTitle }, phone)
    push('phone_status', { status: 'publicly_found', sourceTitle: phone.sourceTitle }, phone)
  }

  return evidence
}
