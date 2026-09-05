import 'server-only'

/**
 * The provider-neutral sending contract — M5 Phase 11.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE CAMPAIGN ENGINE MUST NEVER KNOW WHICH PROVIDER IT IS TALKING TO.     ║
 * ║                                                                           ║
 * ║  Constitution, architecture invariants: "Campaign engine never depends on ║
 * ║  provider-specific logic." Every `if (provider === 'gmail')` outside      ║
 * ║  `lib/email/providers/` is a bug, because the next provider then needs a  ║
 * ║  change in a file that has nothing to do with it.                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ NO IMPLEMENTATION LIVES HERE. Phase 11 defines the contract; Phase 12
 * builds Gmail, Microsoft 365 and SMTP against it, in that order, verified
 * against real provider behaviour. Nothing in this file is a stub — it is a
 * type, and a type with no implementor yet is a specification, not a pretence
 * that work is done.
 */
import type {
  EmailAccountConfiguration,
  EmailCapabilities,
  EmailProviderId,
} from '@/lib/email/capabilities'

/**
 * An account as an adapter sees it.
 *
 * ⚠️ SECRETS ARE FETCHED BY THE ADAPTER, NOT PASSED IN. The handle carries a
 * `secretReference`, not a token. If plaintext credentials travelled through
 * every layer as an ordinary field they would land in a log line or a
 * serialized error the first time something threw.
 */
export type EmailAccountHandle = {
  id: string
  workspaceId: string
  provider: EmailProviderId
  fromEmail: string
  fromName: string | null
  configuration: EmailAccountConfiguration
  secretReference: string
}

export type OutboundAttachment = {
  filename: string
  contentType: string
  /** Base64. Adapters decode; nothing here ever holds a file on disk. */
  content: string
}

export type OutboundMessage = {
  to: string
  subject: string
  text: string
  html: string | null
  replyTo?: string
  /** Set when this message continues an existing conversation. */
  inReplyToMessageId?: string
  threadId?: string
  attachments?: OutboundAttachment[]
  /**
   * Extra RFC 5322 headers to set on the outgoing message.
   *
   * ╔═════════════════════════════════════════════════════════════════════════╗
   * ║  THIS FIELD DID NOT EXIST UNTIL PHASE 0.5, AND ITS ABSENCE WAS THE      ║
   * ║  WHOLE OF FINDING #2.                                                   ║
   * ║                                                                         ║
   * ║  `unsubscribeHeaders()` in lib/email/unsubscribe.ts built                ║
   * ║  `List-Unsubscribe` and `List-Unsubscribe-Post` correctly, with a       ║
   * ║  comment explaining that RFC 8058 needs both. It was called by nothing. ║
   * ║  `shouldIncludeUnsubscribe()` decided which campaigns carry them. Also  ║
   * ║  called by nothing.                                                     ║
   * ║                                                                         ║
   * ║  Reconnecting them was not a one-line fix, because there was no slot to ║
   * ║  put a header in. The message type could not express the thing the      ║
   * ║  capability model (lib/email/capabilities.ts) already claimed to        ║
   * ║  support. Both functions were fully unit-tested and both tests passed.  ║
   * ║                                                                         ║
   * ║  ⚠️ ADAPTERS MUST PASS THIS THROUGH. A provider that silently drops it   ║
   * ║  puts us back where we started, and the recipient loses their one-click ║
   * ║  exit — which is a CAN-SPAM §7704(a)(3) problem before it is a          ║
   * ║  deliverability one.                                                    ║
   * ╚═════════════════════════════════════════════════════════════════════════╝
   */
  headers?: Record<string, string>
  /**
   * ⚠️ THE SAME KEY MUST NEVER PRODUCE TWO DELIVERIES.
   *
   * A worker that is killed after the provider accepted a message but before
   * the row was updated will retry — and the recipient must not receive it
   * twice. Adapters pass this to the provider's own dedupe mechanism where one
   * exists, and the send path checks it regardless. This is M5 acceptance
   * criterion 3 and it is enforced in Phase 14's engine, not left to callers.
   */
  idempotencyKey: string
}

export type SendResult =
  | {
      ok: true
      /** The provider's own id, needed later to match events to this message. */
      providerMessageId: string
      threadId: string | null
    }
  | {
      ok: false
      /** Whether trying the identical send again could succeed. */
      retryable: boolean
      /** Stable code for the error catalog. Never a raw provider body. */
      code: string
      /** Safe for a customer to read. */
      message: string
    }

export type ConnectionTest =
  | { ok: true; fromEmail: string; displayName: string | null }
  | { ok: false; reconnectRequired: boolean; code: string; message: string }

/**
 * A reply as the engine understands it, after the adapter has normalized away
 * every provider's own idea of what a thread is.
 */
export type NormalizedReply = {
  providerMessageId: string
  threadId: string | null
  /** The address that replied — matched to a Contact by the caller. */
  fromEmail: string
  subject: string | null
  text: string
  receivedAt: string
  /**
   * Raw headers the deterministic auto-reply pre-filter needs (M6 Phase 17):
   * `Auto-Submitted`, `X-Autoreply`, `Precedence`. Kept as headers rather than
   * a boolean so the classifier — not the adapter — decides what an OOO is.
   */
  headers: Record<string, string>
}

/** Where a sync should resume, so a re-sync is never a full re-read. */
export type SyncCursor = { cursor: string | null; syncedAt: string }

export type ProviderEvent = {
  providerMessageId: string
  type: 'delivered' | 'bounced' | 'complaint' | 'dropped'
  occurredAt: string
  /** Provider's reason, already stripped of anything recipient-identifying. */
  reason: string | null
}

export type AccountStatusReport = {
  reachable: boolean
  /** Provider-enforced ceiling, when it exposes one. Null when unknown. */
  dailySendLimit: number | null
  /** Sends the provider says have been used today, when it reports that. */
  sentToday: number | null
  code: string | null
  message: string | null
}

/**
 * Implemented once per provider in Phase 12.
 *
 * ⚠️ `syncReplies` AND `syncThreads` ARE NOT OPTIONAL METHODS — they are
 * present on every adapter and are allowed to refuse. An adapter for
 * send-only SMTP throws `EmailCapabilityError`, and the CALLER is expected to
 * have checked `getCapabilities()` first. Making them optional would push a
 * `typeof provider.syncReplies === 'function'` check into the engine, which is
 * exactly the provider-specific branching this interface exists to prevent.
 */
export interface EmailProvider {
  readonly id: EmailProviderId

  /**
   * Exchange whatever the connect flow produced for stored credentials.
   * Returns the envelope to encrypt; the caller persists it. The adapter never
   * writes to the database itself.
   */
  connect(input: unknown): Promise<{ secret: unknown; account: ConnectionTest }>

  /** Revoke upstream where the provider supports it, then forget locally. */
  disconnect(account: EmailAccountHandle): Promise<void>

  testConnection(account: EmailAccountHandle): Promise<ConnectionTest>

  send(account: EmailAccountHandle, message: OutboundMessage): Promise<SendResult>

  /** Translate one provider webhook/push payload into our event shape. */
  receiveProviderEvent(account: EmailAccountHandle, payload: unknown): Promise<ProviderEvent[]>

  syncThreads(account: EmailAccountHandle, since: SyncCursor): Promise<SyncCursor>

  syncReplies(
    account: EmailAccountHandle,
    since: SyncCursor,
  ): Promise<{ replies: NormalizedReply[]; next: SyncCursor }>

  /** Derived from provider and configuration. Never a hardcoded table. */
  getCapabilities(account: EmailAccountHandle): EmailCapabilities

  getStatus(account: EmailAccountHandle): Promise<AccountStatusReport>
}

/**
 * Thrown when an adapter is asked for something its capabilities say it cannot
 * do — a caller-side bug, not a customer-facing failure.
 */
export class EmailCapabilityError extends Error {
  constructor(
    readonly provider: EmailProviderId,
    readonly capability: keyof EmailCapabilities,
  ) {
    super(`The ${provider} adapter cannot ${capability} for this account.`)
    this.name = 'EmailCapabilityError'
  }
}
