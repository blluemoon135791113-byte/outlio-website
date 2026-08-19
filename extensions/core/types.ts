/**
 * Shared contracts between the extension and the Outlio API.
 *
 * Kept browser-agnostic on purpose: Chrome, Firefox and Safari all import
 * these, and nothing here may reference a `chrome.*` or `browser.*` API.
 */

/** What the popup is allowed to render. Derived from the SERVER, never local. */
export type ExtensionState =
  | { kind: 'loading' }
  | { kind: 'not_connected' }
  | { kind: 'no_subscription'; message: string }
  | { kind: 'disabled'; message: string }
  | { kind: 'ready'; account: Account; supported: boolean }
  | { kind: 'capturing'; account: Account; session: SessionTotals; supported: boolean }
  | { kind: 'processing'; account: Account; session: SessionTotals }
  | { kind: 'complete'; session: SessionTotals }
  | { kind: 'error'; message: string; retryable: boolean }

export type Account = {
  email: string | null
  plan: string | null
  deviceLabel: string
}

export type SessionTotals = {
  id: string
  pagesProcessed: number
  leadsFound: number
  leadsImported: number
  duplicatesSkipped: number
}

/** Credentials at rest. Never logged, never sent anywhere but our own API. */
export type StoredAuth = {
  accessToken: string
  refreshToken: string
  deviceId: string
}

/** A page the adapter judged ready to send. */
export type CapturedPage = {
  html: string
  sourceUrl: string
  pageName: string
  pageIdentifier: string | null
  contentHash: string
}

/** Everything a company page yielded. See adapters/salesnav-company.ts. */
export type CompanyObservationMessage = {
  companyId: string
  companyName: string | null
  websiteUrl: string | null
  publicLinkedinUrl: string | null
  employeeCount: number | null
  decisionMakerCount: number | null
  investorCount: number | null
  people: Array<{
    name: string
    salesNavUrl: string | null
    linkedinUrl: string | null
    jobTitle: string | null
    role: 'decision_maker' | 'investor'
  }>
}

export type CaptureOptions = {
  includeCompanyWebsites: boolean
}

export type DedupeMode = 'remove_exact' | 'remove_likely' | 'review' | 'keep_all'

/**
 * Page-specific integration, isolated behind one interface.
 *
 * The site's DOM will change. When it does, only an adapter should need
 * rewriting — not authentication, not the popup, not the capture loop.
 */
export interface PageAdapter {
  readonly id: string
  /** Is this a page this adapter understands? */
  supports(url: string): boolean
  /** Have the results finished rendering? */
  isReady(): boolean
  /** Page number or equivalent, when the page exposes one. */
  getPageIdentifier(): string | null
  /** Visible saved-list/search name used only for a human-readable filename. */
  getPageName(): string
  /** Extract exactly what the backend parser needs. */
  capture(options?: CaptureOptions): Promise<CapturedPage>
}

/** Messages between popup, background and content script. */
export type ExtensionMessage =
  | { type: 'GET_STATE' }
  | { type: 'CONNECT' }
  | { type: 'START_CAPTURE'; includeCompanyWebsites?: boolean; dedupeMode?: DedupeMode }
  | { type: 'FINISH_CAPTURE' }
  | { type: 'RETRY' }
  | { type: 'OPEN_DASHBOARD' }
  /** Content script → background: the user navigated to a new results page. */
  | { type: 'PAGE_CHANGED'; url: string; pageIdentifier: string | null }
  /** Content script → background: pairing code found on the connect page. */
  | { type: 'PAIRING_CODE'; code: string; state: string }
  /**
   * Content script → background: the user opened a company page that lists a
   * website. NOT a capture — no HTML, no leads, no credit. See
   * `extensions/adapters/salesnav-company.ts`.
   */
  | ({ type: 'COMPANY_SEEN' } & CompanyObservationMessage)

export type ContentMessage =
  | { type: 'IS_SUPPORTED' }
  | { type: 'CAPTURE_NOW'; includeCompanyWebsites?: boolean }

export type ContentReply =
  | { ok: true; supported: boolean; ready: boolean; pageIdentifier: string | null }
  | { ok: true; captured: CapturedPage }
  | { ok: false; error: string }

/** Machine codes the API returns. The popup maps these to states. */
export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'DEVICE_REVOKED'
  | 'EXTENSION_DISABLED'
  | 'SUBSCRIPTION_REQUIRED'
  | 'ACCESS_DENIED'
  | 'RATE_LIMITED'
  | 'SESSION_CLOSED'
  | 'SESSION_NOT_FOUND'
  | 'ERR_LIMIT_REACHED'
  | 'NETWORK'
  | 'UNKNOWN'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number

  constructor(code: ApiErrorCode, status: number, message?: string) {
    super(message ?? code)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}
