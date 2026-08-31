import 'server-only'

/**
 * Public API authentication — M8 Phase 25.5.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE WORKSPACE IS DERIVED FROM THE KEY. NEVER FROM THE REQUEST.          ║
 * ║                                                                           ║
 * ║  M8 criterion 7 is workspace scoping "tested with cross-tenant attempts". ║
 * ║  The only design that survives that is one where a request CANNOT name a  ║
 * ║  workspace: `authenticateApiKey` returns the workspace the key belongs    ║
 * ║  to, and every query is scoped to it.                                    ║
 * ║                                                                           ║
 * ║  The alternative — accept a workspace id and check it matches the key —   ║
 * ║  is one forgotten check away from a cross-tenant read, and that check has ║
 * ║  to be right in every handler forever. Here it cannot be forgotten,       ║
 * ║  because there is nothing to forget.                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { API_KEY_PREFIX, extractApiKey, hashApiKey } from '@/lib/api/signing'

export { extractApiKey, generateApiKey, hashApiKey, secretsMatch } from '@/lib/api/signing'

export type ApiScope =
  | 'contacts:read' | 'contacts:write'
  | 'companies:read' | 'companies:write'
  | 'opportunities:read' | 'opportunities:write'
  | 'activities:read' | 'activities:write'
  | 'tasks:read' | 'tasks:write'
  | 'lists:read' | 'lists:write'

/** Requests per minute when a key sets no limit of its own. */
export const DEFAULT_RATE_LIMIT = 120

export type ApiAuthContext = {
  apiKeyId: string
  /** Derived from the key. The request never gets to say. */
  workspaceId: string
  scopes: ApiScope[]
  rateLimitPerMinute: number
}

export type ApiAuthFailure =
  | 'missing_key'
  | 'malformed_key'
  | 'unknown_key'
  | 'rate_limited'
  | 'missing_scope'

export type ApiAuthResult =
  | { ok: true; context: ApiAuthContext }
  | { ok: false; failure: ApiAuthFailure; status: number; message: string; retryAfter?: number }

/**
 * Authenticates a request and enforces its rate limit.
 *
 * ⚠️ EVERY FAILURE RETURNS THE SAME SHAPE OF ANSWER and never says whether a
 * key EXISTS. "Unknown key" and "revoked key" are one message, because
 * distinguishing them tells someone probing which of their guesses was once
 * real.
 */
export async function authenticateApiKey(
  request: Request,
  required: ApiScope,
): Promise<ApiAuthResult> {
  const key = extractApiKey(request)

  if (!key) {
    return {
      ok: false,
      failure: 'missing_key',
      status: 401,
      message: 'Provide your API key as `Authorization: Bearer <key>`.',
    }
  }

  if (!key.startsWith(API_KEY_PREFIX)) {
    return {
      ok: false,
      failure: 'malformed_key',
      status: 401,
      message: 'That is not an Outlio API key.',
    }
  }

  const db = createAdminClient()
  const { data } = await db.rpc('api_key_for_hash', { p_key_hash: hashApiKey(key) })
  const row = data?.[0]

  if (!row) {
    return {
      ok: false,
      failure: 'unknown_key',
      status: 401,
      // Deliberately identical to the revoked/expired case.
      message: 'That API key is not valid.',
    }
  }

  const scopes = (row.scopes ?? []) as ApiScope[]
  const limit = row.rate_limit_per_minute ?? DEFAULT_RATE_LIMIT

  /*
   * ⚠️ RATE LIMITED BEFORE THE SCOPE CHECK. A caller hammering an endpoint they
   * lack the scope for is still hammering it, and refusing on scope first
   * would leave that traffic unmetered — an unauthenticated-in-effect DoS
   * against our own database.
   */
  const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString()
  const { data: limitRows } = await db.rpc('consume_rate_limit', {
    p_bucket: 'public_api',
    p_subject: row.api_key_id,
    p_window_start: windowStart,
    p_max_attempts: limit,
    p_block_seconds: 60,
  })

  const attempts = limitRows?.[0]?.attempts ?? 0
  if (attempts > limit) {
    return {
      ok: false,
      failure: 'rate_limited',
      status: 429,
      message: `That key is limited to ${limit} requests a minute.`,
      retryAfter: 60,
    }
  }

  if (!scopes.includes(required)) {
    return {
      ok: false,
      failure: 'missing_scope',
      status: 403,
      // Naming the scope is safe and saves a support round trip: the caller
      // already holds the key, so it tells them nothing they should not know.
      message: `This key does not have the "${required}" scope.`,
    }
  }

  // Best-effort: a failed timestamp update must not fail the request.
  await db
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.api_key_id)

  return {
    ok: true,
    context: {
      apiKeyId: row.api_key_id,
      workspaceId: row.workspace_id,
      scopes,
      rateLimitPerMinute: limit,
    },
  }
}

/**
 * Records the request.
 *
 * ⚠️ REFUSALS ARE LOGGED TOO. "Someone tried to read another workspace's
 * contacts with our key" is the most important thing this log can say, and a
 * log of successes cannot say it.
 */
export async function logApiRequest(input: {
  workspaceId: string | null
  apiKeyId: string | null
  method: string
  path: string
  status: number
  deniedReason?: string | null
  durationMs: number
}): Promise<void> {
  await createAdminClient().from('api_request_log').insert({
    workspace_id: input.workspaceId,
    api_key_id: input.apiKeyId,
    method: input.method,
    // The path only — a query string can carry a customer's search terms.
    path: input.path.split('?')[0]!,
    status: input.status,
    denied_reason: input.deniedReason ?? null,
    duration_ms: input.durationMs,
  })
}
