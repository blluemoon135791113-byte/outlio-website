'use server'

/**
 * Running the background pass on demand.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS IS A PLATFORM-ADMIN CONTROL, NOT A WORKSPACE ONE, AND THE        ║
 * ║  DISTINCTION IS THE WHOLE REASON IT LIVES HERE.                          ║
 * ║                                                                           ║
 * ║  `runTick()` takes no workspace and filters by none. It claims due        ║
 * ║  messages, syncs replies, advances flows and delivers webhooks for EVERY  ║
 * ║  tenant. Put behind `email.account.manage`, one customer's admin could    ║
 * ║  trigger another customer's sends at a moment of their choosing — a       ║
 * ║  cross-tenant action wearing a per-workspace button.                     ║
 * ║                                                                           ║
 * ║  `assertAdmin()` is the correct gate: it is the same authority the cron   ║
 * ║  acts with, and it additionally requires an AAL2 session.                ║
 * ║                                                                           ║
 * ║  ⚠️ WHY IT EXISTS AT ALL. `/api/cron` is guarded by `CRON_SECRET`, which   ║
 * ║  Vercel stores as a write-only Secret — it cannot be read back — and the  ║
 * ║  Hobby plan offers no manual cron trigger. So the only ways to flush a    ║
 * ║  due queue were to rotate a credential nobody can read, or to wait for    ║
 * ║  06:00 UTC. This is the missing control, not a convenience.              ║
 * ║                                                                           ║
 * ║  ⚠️ IT CHANGES NO SCHEDULE. It runs the same pass the cron runs. A message ║
 * ║  that is not due stays not due; send windows, `send_days` and ramp limits ║
 * ║  are enforced where they always were, at enqueue.                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { revalidatePath } from 'next/cache'

import { assertAdmin } from '@/lib/auth/access'
import { consume } from '@/lib/auth/rate-limit'
import { ACTION_LIMITS } from '@/lib/security/action-limits'
import { createAdminClient } from '@/lib/supabase/admin'
import { runTick } from '@/lib/workers/tick'
import type { Json } from '@/types/database'

export type AdminActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string }

export async function runWorkersNow(
  _previous: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  let adminId: string | null = null

  try {
    const admin = await assertAdmin()
    adminId = admin.userId

    /*
     * ⚠️ RATE LIMITED, BECAUSE THIS DOES REAL NETWORK WORK. Each press opens
     * SMTP and IMAP connections and posts to customer webhook endpoints.
     * Pressed in a loop it would hammer providers with our own domain's
     * reputation, which is the resource that cannot be bought back.
     */
    const limit = await consume(ACTION_LIMITS.adminMutation, `admin:${admin.userId}`)
    if (!limit.allowed) {
      return { status: 'error', message: 'Too many admin actions. Please wait and try again.' }
    }

    const result = await runTick()

    const summary = Object.entries(result.jobs)
      .map(([name, job]) => `${name}: ${job.ok ? job.detail : `failed — ${job.detail}`}`)
      .join(' · ')

    /*
     * ⚠️ AUDITED, LIKE EVERY OTHER STATE-CHANGING ADMIN ACTION (CLAUDE.md).
     * This one puts mail on the wire for tenants other than the operator's own,
     * so "who ran it and what happened" is exactly the record that has to exist.
     */
    await createAdminClient().from('admin_audit_logs').insert({
      admin_id: admin.userId,
      action: 'workers.run_now',
      target_type: 'system',
      target_id: null,
      target_user_id: admin.userId,
      before_state: null,
      after_state: result as unknown as Json,
      reason: 'Manual background pass from the admin dashboard.',
    })

    revalidatePath('/admin')
    return { status: 'success', message: summary || 'Nothing was due.' }
  } catch (error) {
    /*
     * The detail goes to the log, never to the client — a tick error can carry
     * provider text, and this response renders in a page.
     */
    console.error('[admin] run workers failed', {
      adminId,
      message: error instanceof Error ? error.message : 'failed',
    })
    return { status: 'error', message: 'Could not run the background workers.' }
  }
}
