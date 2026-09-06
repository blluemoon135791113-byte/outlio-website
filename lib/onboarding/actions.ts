'use server'

/**
 * Dismissing the first-run checklist — M9.
 *
 * ⚠️ DISMISSAL IS WORKSPACE-WIDE, so it is a settings-level act rather than a
 * personal preference: one person hiding it hides it for everyone. That is the
 * right scope for a shared setup checklist — but it means the permission has
 * to be checked, not assumed from the fact that the button rendered.
 */
import { revalidatePath } from 'next/cache'

import { createAdminClient } from '@/lib/supabase/admin'
import { requireWorkspace } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export type DismissState = { ok: true } | { ok: false; error: string } | null

export async function dismissFirstRun(): Promise<DismissState> {
  let ctx
  try {
    ctx = await requireWorkspace()
  } catch {
    return { ok: false, error: 'Could not hide the checklist.' }
  }

  if (!can({ role: ctx.role, modules: ctx.modules }, 'workspace.settings.manage')) {
    return { ok: false, error: 'Only a workspace admin can hide the setup checklist.' }
  }

  const { error } = await createAdminClient()
    .from('workspace_onboarding_state')
    .upsert(
      {
        workspace_id: ctx.workspace.id,
        dismissed_at: new Date().toISOString(),
        dismissed_by: ctx.userId,
      },
      { onConflict: 'workspace_id' },
    )

  if (error) return { ok: false, error: 'Could not hide the checklist.' }

  revalidatePath('/dashboard')
  return { ok: true }
}
