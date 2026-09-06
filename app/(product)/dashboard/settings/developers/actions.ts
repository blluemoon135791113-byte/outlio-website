'use server'

/**
 * API keys and webhook subscriptions — M8 Phase 25.5 UI.
 *
 * ⚠️ THE PLAINTEXT KEY IS RETURNED EXACTLY ONCE, from `createApiKey`, and is
 * never stored. Every other read returns the prefix only. That is what makes
 * "we cannot recover it for you" true rather than a policy we might quietly
 * break under support pressure.
 */
import { randomBytes } from 'node:crypto'

import { revalidatePath } from 'next/cache'

import { generateApiKey } from '@/lib/api/signing'
import { assertSafeWebhookUrl, UnsafeWebhookUrlError } from '@/lib/api/webhook-url'
import { WEBHOOK_EVENTS } from '@/lib/api/signing'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type DeveloperActionState =
  | { ok: true; message: string; secret?: string }
  | { ok: false; error: string }
  | null

/**
 * ⚠️ GATED ON `workspace.settings.manage`. An API key can read every contact in
 * the workspace, so issuing one is an administrative act — not something a
 * setter should be able to do because they can see the page.
 */
const PERMISSION = 'workspace.settings.manage' as const

export async function createApiKey(
  _previous: DeveloperActionState,
  formData: FormData,
): Promise<DeveloperActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission(PERMISSION)
  } catch {
    return { ok: false, error: 'You do not have permission to create API keys.' }
  }

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { ok: false, error: 'Give the key a name so you can recognise it later.' }

  const scopes = formData.getAll('scopes').map(String).filter(Boolean)
  if (scopes.length === 0) {
    /*
     * A key with no scopes can do nothing, and someone who creates one will
     * spend an afternoon wondering why every request is a 403.
     */
    return { ok: false, error: 'Choose at least one thing this key may access.' }
  }

  const generated = generateApiKey()

  const { error } = await createAdminClient().from('api_keys').insert({
    workspace_id: ctx.workspace.id,
    name,
    key_hash: generated.hash,
    key_prefix: generated.prefix,
    scopes: scopes as never,
    created_by: ctx.userId,
  })

  if (error) return { ok: false, error: 'Could not create that key.' }

  revalidatePath('/dashboard/settings/developers')

  return {
    ok: true,
    message: `${name} created.`,
    // ⚠️ The only time this value ever leaves the server.
    secret: generated.key,
  }
}

export async function revokeApiKey(
  _previous: DeveloperActionState,
  formData: FormData,
): Promise<DeveloperActionState> {
  try {
    const ctx = await assertWorkspacePermission(PERMISSION)
    const id = String(formData.get('keyId') ?? '')

    await createAdminClient()
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('workspace_id', ctx.workspace.id)
      .eq('id', id)

    revalidatePath('/dashboard/settings/developers')
    // Revocation is immediate, and saying so matters: someone revoking a
    // leaked key needs to know they do not have to wait.
    return { ok: true, message: 'Key revoked. It stopped working immediately.' }
  } catch {
    return { ok: false, error: 'Could not revoke that key.' }
  }
}

export async function createWebhook(
  _previous: DeveloperActionState,
  formData: FormData,
): Promise<DeveloperActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission(PERMISSION)
  } catch {
    return { ok: false, error: 'You do not have permission to add webhooks.' }
  }

  const name = String(formData.get('name') ?? '').trim()
  const url = String(formData.get('url') ?? '').trim()

  if (!name || !url) return { ok: false, error: 'A name and a URL are both needed.' }

  /*
   * ⚠️ VALIDATED BEFORE SAVING, with the same guard the delivery worker uses.
   * Saving an unreachable or unsafe URL and failing at delivery time means the
   * customer finds out from an empty log hours later.
   */
  try {
    assertSafeWebhookUrl(url)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof UnsafeWebhookUrlError ? error.message : 'That URL cannot be used.',
    }
  }

  const events = formData.getAll('events').map(String).filter((e) =>
    (WEBHOOK_EVENTS as readonly string[]).includes(e),
  )

  const secret = `whsec_${randomBytes(24).toString('base64url')}`

  const { error } = await createAdminClient().from('webhook_subscriptions').insert({
    workspace_id: ctx.workspace.id,
    name,
    url,
    // Empty means everything, which is what a first subscription usually wants.
    events,
    signing_secret: secret,
    created_by: ctx.userId,
  })

  if (error) return { ok: false, error: 'Could not save that webhook.' }

  revalidatePath('/dashboard/settings/developers')

  return {
    ok: true,
    message: `${name} added.`,
    // Shown once, like the API key: it is what the customer signs with.
    secret,
  }
}

export async function setWebhookActive(
  _previous: DeveloperActionState,
  formData: FormData,
): Promise<DeveloperActionState> {
  try {
    const ctx = await assertWorkspacePermission(PERMISSION)
    const id = String(formData.get('subscriptionId') ?? '')
    const active = formData.get('active') === 'true'

    await createAdminClient()
      .from('webhook_subscriptions')
      .update({
        is_active: active,
        // Re-enabling clears the failure count, or a subscription disabled for
        // repeated failures would be disabled again on its next single failure.
        ...(active ? { failure_count: 0, disabled_at: null, disabled_reason: null } : {}),
      })
      .eq('workspace_id', ctx.workspace.id)
      .eq('id', id)

    revalidatePath('/dashboard/settings/developers')
    return { ok: true, message: active ? 'Webhook enabled.' : 'Webhook paused.' }
  } catch {
    return { ok: false, error: 'Could not change that webhook.' }
  }
}

export async function deleteWebhook(
  _previous: DeveloperActionState,
  formData: FormData,
): Promise<DeveloperActionState> {
  try {
    const ctx = await assertWorkspacePermission(PERMISSION)
    const id = String(formData.get('subscriptionId') ?? '')

    await createAdminClient()
      .from('webhook_subscriptions')
      .delete()
      .eq('workspace_id', ctx.workspace.id)
      .eq('id', id)

    revalidatePath('/dashboard/settings/developers')
    return { ok: true, message: 'Webhook removed.' }
  } catch {
    return { ok: false, error: 'Could not remove that webhook.' }
  }
}
