import 'server-only'

/**
 * Capture session lifecycle.
 *
 * Duplicate protection lives in the DATABASE, not here — `claim_capture_page`
 * wraps a unique index on (user_id, content_hash). That matters because the
 * realistic duplicate cases are races: two tabs on the same search, a refresh
 * mid-request, a retry after a dropped connection. Checking in application
 * code before inserting would leave a window between the check and the write.
 */
import { createHash } from 'node:crypto'

import { createAdminClient } from '@/lib/supabase/admin'
import type { CaptureSessionRow, DedupeMode } from '@/types/database'

export type ClaimOutcome =
  | { status: 'claimed'; pageId: string }
  | { status: 'duplicate' }
  | { status: 'session_closed' }
  | { status: 'not_found' }

/** SHA-256 of the captured HTML. Must match what the client computed. */
export function contentHash(html: string): string {
  return createHash('sha256').update(html).digest('hex')
}

/**
 * Starts a session, or returns the one already running.
 *
 * A partial unique index enforces one active session per user, so pressing
 * Start Capture twice — or on a second device — resumes rather than splitting
 * the counters across two rows.
 */
export async function startCaptureSession(input: {
  userId: string
  deviceId: string
  browser: string | null
  dedupeMode: DedupeMode
}): Promise<CaptureSessionRow> {
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('capture_sessions')
    .select('*')
    .eq('user_id', input.userId)
    .eq('status', 'active')
    .maybeSingle()

  if (existing) return existing as CaptureSessionRow

  const { data, error } = await admin
    .from('capture_sessions')
    .insert({
      user_id: input.userId,
      device_id: input.deviceId,
      browser: input.browser,
      status: 'active',
      source: 'salesnav',
      dedupe_mode: input.dedupeMode,
    })
    .select('*')
    .single()

  if (error) {
    // Lost the race against another request; adopt the winner's session.
    const { data: raced } = await admin
      .from('capture_sessions')
      .select('*')
      .eq('user_id', input.userId)
      .eq('status', 'active')
      .maybeSingle()

    if (raced) return raced as CaptureSessionRow
    throw new Error(`startCaptureSession failed: ${error.message}`)
  }

  return data as CaptureSessionRow
}

export async function finishCaptureSession(
  userId: string,
  sessionId: string,
): Promise<CaptureSessionRow | null> {
  const admin = createAdminClient()

  const { data } = await admin
    .from('capture_sessions')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', sessionId)
    // Service role bypasses RLS — ownership must be asserted here.
    .eq('user_id', userId)
    .eq('status', 'active')
    .select('*')
    .maybeSingle()

  return (data as CaptureSessionRow | null) ?? null
}

export async function getActiveSession(
  userId: string,
): Promise<CaptureSessionRow | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('capture_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()

  return (data as CaptureSessionRow | null) ?? null
}

/**
 * Reserves this page for processing, or reports it as already seen.
 *
 * Returning `duplicate` costs the user nothing: no job, no credit, no parse.
 */
export async function claimPage(input: {
  userId: string
  sessionId: string
  html: string
  sourceUrl: string | null
  pageIdentifier: string | null
}): Promise<ClaimOutcome> {
  const admin = createAdminClient()

  // The RPC declares source URL and page identifier NOT NULL; a capture
  // without them cannot be claimed, which is a miss — not a crash.
  if (!input.sourceUrl || !input.pageIdentifier) return { status: 'not_found' }

  const { data, error } = await admin.rpc('claim_capture_page', {
    p_session_id: input.sessionId,
    p_user_id: input.userId,
    p_content_hash: contentHash(input.html),
    p_source_url: input.sourceUrl,
    p_page_ident: input.pageIdentifier,
  })

  if (error) throw new Error(`claimPage failed: ${error.message}`)

  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { status: 'not_found' }

  if (row.status === 'claimed' && row.page_id) {
    return { status: 'claimed', pageId: row.page_id }
  }

  return { status: row.status as 'duplicate' | 'session_closed' | 'not_found' }
}

/** Marks a claimed page failed and frees nothing — the hash stays reserved. */
export async function markPageFailed(
  userId: string,
  pageId: string,
  message: string,
): Promise<void> {
  const admin = createAdminClient()
  await admin.rpc('roll_capture_totals', {
    p_page_id: pageId,
    p_user_id: userId,
    p_job_id: '',
    p_leads_found: 0,
    p_leads_kept: 0,
    p_status: 'failed',
    p_error: message.slice(0, 200),
  })
}
