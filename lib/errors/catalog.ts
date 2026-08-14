/**
 * Typed error catalog.
 *
 * Users see `message`. Logs get the detail. NEVER return a stack trace, SQL
 * string, storage path, or internal identifier to the client.
 */

export const ERROR_CATALOG = {
  // ---- upload / parsing -------------------------------------------------
  ERR_FILE_TYPE: {
    status: 400,
    message:
      "That file type isn't supported. Upload `.html` files saved from a lead search-results page.",
  },
  ERR_FILE_EMPTY: {
    status: 400,
    message: 'This file appears to be empty.',
  },
  ERR_FILE_FORMAT: {
    status: 400,
    message:
      "We couldn't recognize this as a lead search-results page. Make sure you saved the full page.",
  },
  ERR_NO_LEADS: {
    status: 400,
    message: 'No leads were found in this file.',
  },
  ERR_PARTIAL: {
    status: 200,
    message:
      "Some files couldn't be processed. Your results include everything we could read.",
  },
  ERR_TIMEOUT: {
    status: 504,
    message: 'This file took too long to process. Try uploading fewer files at once.',
  },
  ERR_WORKER_DOWN: {
    status: 503,
    message:
      'Processing is temporarily unavailable. Your job is queued and will run automatically.',
  },
  ERR_EXPORT: {
    status: 500,
    message: "We couldn't build your export. Please try again.",
  },
  ERR_STORAGE: {
    status: 500,
    message: "We couldn't save your file. Please try again.",
  },

  // ---- access -----------------------------------------------------------
  ERR_UNAUTHENTICATED: {
    status: 401,
    message: 'Please sign in to continue.',
  },
  ERR_EMAIL_UNVERIFIED: {
    status: 403,
    message: 'Please verify your email address to continue. Check your inbox.',
  },
  ERR_NO_ACCESS: {
    status: 403,
    message: "You don't have access yet. Request access to get started.",
  },
  ERR_ACCESS_PENDING: {
    status: 403,
    message: "Your access request is under review. We'll email you when it's approved.",
  },
  ERR_ACCESS_REJECTED: {
    status: 403,
    message: 'Your access request was not approved. Contact support if you think this is a mistake.',
  },
  ERR_ACCESS_EXPIRED: {
    status: 403,
    message: 'Your access has expired. Renew to continue.',
  },
  ERR_ACCOUNT_SUSPENDED: {
    status: 403,
    message: 'This account is suspended. Contact support.',
  },
  ERR_PAYMENT_REQUIRED: {
    status: 402,
    message: 'This feature requires an active plan.',
  },
  ERR_LIMIT_REACHED: {
    status: 429,
    message: "You've reached your plan limit for this period.",
  },
  ERR_FORBIDDEN: {
    status: 403,
    message: "You don't have permission to do that.",
  },

  // ---- research and enrichment ------------------------------------------
  ERR_PROVIDER_UNAVAILABLE: {
    status: 503,
    message: "A data source wasn't reachable, so some fields are unknown.",
  },
  ERR_RESEARCH_FAILED: {
    status: 500,
    message: "We couldn't finish researching that. No usage was charged.",
  },
  ERR_RESEARCH_BUDGET: {
    status: 429,
    message: "This would exceed your research allowance for this period.",
  },

  // ---- generic ----------------------------------------------------------
  ERR_RATE_LIMITED: {
    status: 429,
    message: 'Too many attempts. Please wait and try again.',
  },
  ERR_VALIDATION: {
    status: 400,
    message: 'Some of the information provided was invalid.',
  },
  ERR_NOT_FOUND: {
    status: 404,
    message: "We couldn't find what you were looking for.",
  },
  ERR_INTERNAL: {
    status: 500,
    message: 'Something went wrong on our end. Please try again.',
  },
} as const

export type ErrorCode = keyof typeof ERROR_CATALOG

/**
 * An error safe to surface to a user.
 *
 * `detail` is for logs only and must never be serialised into a response.
 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly userMessage: string
  readonly detail?: string

  constructor(code: ErrorCode, detail?: string) {
    const entry = ERROR_CATALOG[code]
    super(entry.message)
    this.name = 'AppError'
    this.code = code
    this.status = entry.status
    this.userMessage = entry.message
    this.detail = detail
  }

  /** The ONLY shape that may be sent to a client. */
  toResponseBody(): { error: { code: ErrorCode; message: string } } {
    return { error: { code: this.code, message: this.userMessage } }
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError
}

/**
 * Convert anything thrown into a client-safe payload. Unknown errors collapse
 * to ERR_INTERNAL so internal detail cannot leak.
 */
export function toClientError(e: unknown): {
  status: number
  body: { error: { code: ErrorCode; message: string } }
} {
  if (isAppError(e)) {
    return { status: e.status, body: e.toResponseBody() }
  }
  const fallback = new AppError('ERR_INTERNAL')
  return { status: fallback.status, body: fallback.toResponseBody() }
}
