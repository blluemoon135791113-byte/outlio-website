import 'server-only'

/**
 * Jev (TypeSafe) as a decision provider — the only file that talks to it.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ HOSTED, NOT LOCAL — THE OPPOSITE OF `ollama-llm.ts`.                  ║
 * ║                                                                           ║
 * ║  Whatever is put in `state` leaves Outlio for api.typesafe.ai. Callers    ║
 * ║  minimise first (see `lib/jev/reply.ts`), and the whole provider is OFF   ║
 * ║  unless `JEV_ENABLED=true` AND a key is set. TypeSafe's legal page offers ║
 * ║  zero data retention only to enterprise customers and says it does not    ║
 * ║  train on user data; the default retention for other accounts is not      ║
 * ║  published. Production traffic waits for the owner to accept those terms  ║
 * ║  and add TypeSafe to the privacy policy's sub-processors.                 ║
 * ║                                                                           ║
 * ║  ⚠️ INSIDE THE METERED BOUNDARY. Listed in `PROVIDER_MODULES` of          ║
 * ║  `tests/unit/model-call-boundary.test.ts`: only `lib/hubble/execute.ts`   ║
 * ║  may import this at runtime, and it hands the decider to a runner as a    ║
 * ║  tool. A Jev call is therefore always credit-checked and recorded in      ║
 * ║  `hubble_calls`, like every other model call.                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import {
  APIConnectionError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
  TypeSafeClient,
  UnprocessableEntityError,
  type EntryType,
  type Fetch,
  type Questions,
} from '@typesafe-ai/sdk'

import {
  JevError,
  validateJevResponse,
  type JevResult,
  type QuestionSet,
} from '@/lib/jev/decision'

/** Per attempt. The SDK's own default; stated so a change is a visible diff. */
const TIMEOUT_MS = 10_000
/** Retries after the first attempt, for 408/429/5xx and connection failures. */
const MAX_RETRIES = 2

export type JevConfig =
  | { enabled: true; apiKey: string; model: string; baseURL: string | undefined }
  | { enabled: false; reason: 'disabled' | 'no_key' }

/**
 * ⚠️ TWO SWITCHES, BOTH REQUIRED. A key alone does not turn Jev on — setting a
 * key to try something in one environment must not quietly start sending
 * customer data from every environment that shares the variable.
 */
export function jevConfig(env: NodeJS.ProcessEnv = process.env): JevConfig {
  if (env.JEV_ENABLED?.trim() !== 'true') return { enabled: false, reason: 'disabled' }
  const apiKey = env.TYPESAFE_API_KEY?.trim()
  if (!apiKey) return { enabled: false, reason: 'no_key' }
  return {
    enabled: true,
    apiKey,
    // Pinned per environment when set; the alias otherwise. The model that
    // actually answered is read from each response and stored with it.
    model: env.TYPESAFE_DEFAULT_MODEL?.trim() || 'jev-latest',
    baseURL: env.TYPESAFE_BASE_URL?.trim() || undefined,
  }
}

export type JevDecider = {
  ask(set: QuestionSet, state: unknown, signal?: AbortSignal): Promise<JevResult>
}

/**
 * Maps SDK failures to a fixed code and sentence.
 *
 * ⚠️ `error.message` AND `error.body` ARE NEVER PASSED ON. Either can carry the
 * request back, and the request is customer data.
 */
function toJevError(error: unknown): JevError {
  if (error instanceof JevError) return error
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new JevError('JEV_AUTH', 'Jev rejected the API key.')
  }
  if (error instanceof RateLimitError) {
    return new JevError('JEV_RATE_LIMITED', 'Jev is rate limiting requests. Try again shortly.')
  }
  if (error instanceof BadRequestError || error instanceof UnprocessableEntityError) {
    return new JevError('JEV_BAD_REQUEST', 'Jev refused the request as invalid.')
  }
  if (error instanceof APITimeoutError || error instanceof APIUserAbortError) {
    return new JevError('JEV_TIMEOUT', 'Jev did not answer in time.')
  }
  if (error instanceof APIConnectionError) {
    return new JevError('JEV_UNAVAILABLE', 'Jev could not be reached.')
  }
  return new JevError('JEV_UNAVAILABLE', 'Jev failed to answer.')
}

export function createJevDecider(
  options: { env?: NodeJS.ProcessEnv; fetch?: Fetch } = {},
): JevDecider {
  const config = jevConfig(options.env)

  if (!config.enabled) {
    const message =
      config.reason === 'no_key'
        ? 'Jev is enabled but TYPESAFE_API_KEY is not set.'
        : 'Jev is turned off (JEV_ENABLED is not "true").'
    return {
      ask: async () => {
        throw new JevError('JEV_DISABLED', message)
      },
    }
  }

  const client = new TypeSafeClient({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultModel: config.model,
    timeout: TIMEOUT_MS,
    retry: { maxRetries: MAX_RETRIES },
    /*
     * ⚠️ OFF. The SDK redacts credential headers but NOT bodies, and at `debug`
     * it logs both. A body here is a customer's reply or lead record, which
     * CLAUDE.md forbids in logs. Failures are reported through `JevError`.
     */
    logLevel: 'off',
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })

  return {
    async ask(set, state, signal) {
      try {
        const { data, requestId } = await client
          .systemOne(
            // The shapes match the SDK's `Questions` by construction (decision.ts mirrors it).
            { state: state as EntryType, questions: set.questions as unknown as Questions },
            signal ? { signal } : undefined,
          )
          .withResponse()
        return validateJevResponse(set, data, requestId ?? null)
      } catch (error) {
        throw toJevError(error)
      }
    },
  }
}
