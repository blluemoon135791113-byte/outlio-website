import 'server-only'

/**
 * Provider lookup — M5 Phase 12.
 *
 * ⚠️ THIS IS THE ONLY PLACE THAT MAPS A PROVIDER ID TO AN IMPLEMENTATION.
 * Everything downstream takes an `EmailProvider` and never asks which one it
 * has, which is the invariant the interface exists to protect.
 *
 * ⚠️ AN ABSENT ADAPTER IS ABSENT, NOT STUBBED. Gmail and Microsoft 365 have no
 * entry because they have no implementation — deliberately, since neither can
 * be built against real provider behaviour in this environment yet (see
 * `smtp.ts` for the evidence, and Ledger D33). `providerFor` returns
 * `undefined` rather than a placeholder object that would throw somewhere
 * further away, so a caller is forced to handle the gap at the point it exists.
 */
import type { EmailProviderId } from '@/lib/email/capabilities'
import type { EmailProvider } from '@/lib/email/provider'
import { smtpProvider } from '@/lib/email/providers/smtp'

const IMPLEMENTED: Partial<Record<EmailProviderId, EmailProvider>> = {
  smtp: smtpProvider,
}

/** The adapter for a provider, or `undefined` if it is not built yet. */
export function providerFor(id: EmailProviderId): EmailProvider | undefined {
  return IMPLEMENTED[id]
}

/** Which providers a customer can actually connect today. */
export function connectableProviders(): EmailProviderId[] {
  return Object.keys(IMPLEMENTED) as EmailProviderId[]
}

export class ProviderNotAvailableError extends Error {
  constructor(readonly provider: EmailProviderId) {
    super(
      `Outlio cannot connect ${provider} mailboxes yet. Connect an SMTP mailbox instead.`,
    )
    this.name = 'ProviderNotAvailableError'
  }
}

/** The adapter, or a typed error naming the provider that is missing. */
export function requireProvider(id: EmailProviderId): EmailProvider {
  const provider = providerFor(id)
  if (!provider) throw new ProviderNotAvailableError(id)
  return provider
}
