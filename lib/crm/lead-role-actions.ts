'use server'

/**
 * Server actions for lead roles. Public endpoints: each one gates first, and
 * the service it calls checks the contact's visibility again.
 */
import { revalidatePath } from 'next/cache'

import { assertAccountPermission, canSeeAccount } from '@/lib/crm/account-access'
import { applyAutoRoles, setContactRoles } from '@/lib/crm/lead-role-service'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAppError } from '@/lib/errors/catalog'
import { assertWorkspacePermission } from '@/lib/workspaces/context'
import { dataScope } from '@/lib/workspaces/permissions'

export type RoleActionState = null | { ok: true; message: string } | { ok: false; message: string }

function message(error: unknown): string {
  if (isAppError(error)) {
    if (error.code === 'ERR_FORBIDDEN') return 'You do not have permission to do that.'
    if (error.code === 'ERR_NOT_FOUND') return 'That lead could not be found.'
    if (error.code === 'ERR_VALIDATION') return 'That role is no longer available. Refresh and try again.'
    return error.userMessage
  }
  console.error('[lead-role-actions]', error instanceof Error ? error.message : 'unknown error')
  return 'Something went wrong. Please try again.'
}

/**
 * A person's choice of roles for one lead — pins it against suggestions.
 * `reset=1` puts it back on suggestions instead.
 */
export async function setContactRolesAction(
  _previous: RoleActionState,
  form: FormData,
): Promise<RoleActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.contact.edit')
  } catch (error) {
    return { ok: false, message: message(error) }
  }

  const contactId = String(form.get('contactId') ?? '')
  const reset = form.get('reset') === '1'
  const roleIds = reset ? null : form.getAll('roleIds').map(String).filter(Boolean)

  try {
    await setContactRoles(ctx, contactId, roleIds)
  } catch (error) {
    return { ok: false, message: message(error) }
  }

  const companyId = String(form.get('companyId') ?? '')
  if (companyId) revalidatePath(`/crm/companies/${companyId}`)
  revalidatePath(`/crm/contacts/${contactId}`)
  return { ok: true, message: reset ? 'Back to suggestions.' : 'Roles saved.' }
}

/**
 * Re-runs suggestions for everyone at one account the caller may see. Leads
 * someone chose roles for by hand are left exactly as they are.
 */
export async function refreshAccountRolesAction(
  _previous: RoleActionState,
  form: FormData,
): Promise<RoleActionState> {
  let access
  try {
    access = await assertAccountPermission('accounts.edit')
    await assertWorkspacePermission('crm.contact.edit')
  } catch (error) {
    return { ok: false, message: message(error) }
  }

  const companyId = String(form.get('companyId') ?? '')
  try {
    if (!(await canSeeAccount(access, companyId))) return { ok: false, message: 'That account could not be found.' }

    let query = createAdminClient()
      .from('crm_contacts')
      .select('id')
      .eq('workspace_id', access.ctx.workspace.id)
      .eq('primary_company_id', companyId)
      .is('deleted_at', null)
      .limit(2000)
    // The contact rule: someone limited to their own contacts refreshes only those.
    if (dataScope(access.ctx.role) === 'assigned') query = query.eq('owner_user_id', access.ctx.userId)

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const result = await applyAutoRoles(access.ctx.workspace.id, (data ?? []).map((c) => c.id))
    revalidatePath(`/crm/companies/${companyId}`)
    const kept = result.skippedManual > 0 ? ` ${result.skippedManual} chosen by hand were left as they are.` : ''
    return { ok: true, message: `Suggestions updated for ${result.applied} lead${result.applied === 1 ? '' : 's'}.${kept}` }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}
