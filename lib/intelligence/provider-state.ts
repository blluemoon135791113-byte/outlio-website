import 'server-only'

/**
 * Shared state for external intelligence providers.
 *
 * Next's normal server cache is deployment/instance scoped. Provider master
 * data and provider-wide traffic limits must survive a cold start and coordinate
 * every Vercel instance, so they live in Postgres instead.
 */
import type { Json } from '@/types/database'
import { createAdminClient } from '@/lib/supabase/admin'

export type ProviderCacheEntry<T> = {
  value: T
  retrievedAt: string
  expiresAt: string
}

/** Reads one unexpired global provider-cache entry. */
export async function readProviderCache<T>(
  provider: string,
  cacheKey: string,
  now: Date = new Date(),
): Promise<ProviderCacheEntry<T> | null> {
  const { data, error } = await createAdminClient()
    .from('provider_cache')
    .select('value_json, retrieved_at, expires_at')
    .eq('provider', provider)
    .eq('cache_key', cacheKey)
    .maybeSingle()

  if (error) throw new Error('Provider cache read failed')
  if (!data || Date.parse(data.expires_at) <= now.getTime()) return null

  return {
    value: data.value_json as T,
    retrievedAt: data.retrieved_at,
    expiresAt: data.expires_at,
  }
}

/** Atomically replaces one global provider-cache entry. */
export async function writeProviderCache(
  provider: string,
  cacheKey: string,
  value: Json,
  retrievedAt: Date,
  expiresAt: Date,
): Promise<void> {
  const { error } = await createAdminClient().from('provider_cache').upsert(
    {
      provider,
      cache_key: cacheKey,
      value_json: value,
      retrieved_at: retrievedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      updated_at: retrievedAt.toISOString(),
    },
    { onConflict: 'provider,cache_key' },
  )

  if (error) throw new Error('Provider cache write failed')
}

/**
 * Waits for a globally serialized provider request slot.
 *
 * The SQL function takes a transaction-scoped advisory lock and sleeps inside
 * that lock until the minimum interval has elapsed. It coordinates all server
 * processes; an in-memory timer cannot do that in a serverless deployment.
 * Any database error rejects, so the caller makes no external request.
 */
export async function awaitProviderRequestSlot(
  provider: string,
  minIntervalMs: number,
): Promise<void> {
  const { error } = await createAdminClient().rpc('await_provider_request_slot', {
    p_provider: provider,
    p_min_interval_ms: minIntervalMs,
  })

  if (error) throw new Error('Provider request limiter unavailable')
}
