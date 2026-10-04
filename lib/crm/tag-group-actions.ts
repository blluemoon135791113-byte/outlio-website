'use server'

/**
 * Server actions for Settings → Tags. Public endpoints: each one gates on
 * `config.manage` first, and the service (`lib/crm/tag-groups.ts`) checks it
 * again next to the write.
 */
import { revalidatePath } from 'next/cache'

import { assertAccountPermission, type AccountAccess } from '@/lib/crm/account-access'
import {
  createTagGroup,
  createTagValue,
  deleteTagGroup,
  deleteTagValue,
  moveTagGroup,
  moveTagValue,
  updateTagGroup,
  updateTagValue,
} from '@/lib/crm/tag-groups'
import { isAppError } from '@/lib/errors/catalog'

export type TagSettingsState = null | { ok: true; message: string } | { ok: false; message: string }

const PAGE = '/dashboard/settings/tags'

/** Refusals worded for the person; anything unexpected is logged and stays generic. */
function message(error: unknown): string {
  if (isAppError(error)) {
    if (error.code === 'ERR_FORBIDDEN') return 'Only people who manage workspace settings can change tags.'
    if (error.code === 'ERR_NOT_FOUND') return 'That no longer exists. Refresh the page.'
    if (error.code === 'ERR_VALIDATION') {
      const detail = error.detail ?? ''
      if (detail.includes('already tagged')) {
        return 'Accounts already carry values in this group, so a primary can no longer be required.'
      }
      if (detail.includes('exists')) return 'That name is already used here.'
      if (detail.includes('in use')) return 'Accounts or leads still carry this value. Disable it instead.'
      if (detail.includes('still has values')) return 'Delete or move its values first, or disable the group.'
      if (detail.includes('name length') || detail.includes('no letters')) return 'Give it a name of 1 to 60 characters.'
      if (detail.includes('aliases')) return 'At most 20 alternative spellings.'
      if (detail.includes('description')) return 'Keep the description under 200 characters.'
      if (detail.includes('primary')) return 'Only account groups can have a primary value.'
      return 'That was not accepted. Check the values and try again.'
    }
    return error.userMessage
  }
  console.error('[tag-group-actions]', error instanceof Error ? error.message : 'unknown error')
  return 'Something went wrong. Please try again.'
}

async function run(
  check: () => Promise<AccountAccess>,
  work: (access: AccountAccess) => Promise<unknown>,
  done: string,
): Promise<TagSettingsState> {
  let access: AccountAccess
  try {
    access = await check()
  } catch (error) {
    return { ok: false, message: message(error) }
  }
  try {
    await work(access)
  } catch (error) {
    return { ok: false, message: message(error) }
  }
  revalidatePath(PAGE)
  revalidatePath('/crm/companies')
  revalidatePath('/crm/contacts')
  return { ok: true, message: done }
}

const str = (form: FormData, key: string) => String(form.get(key) ?? '')

export async function createTagGroupAction(_p: TagSettingsState, form: FormData): Promise<TagSettingsState> {
  return run(
    () => assertAccountPermission('config.manage'),
    (access) =>
      createTagGroup(access, {
        entity: str(form, 'entity'),
        name: str(form, 'name'),
        hasPrimary: form.get('hasPrimary') === 'on',
      }),
    'Group added.',
  )
}

export async function updateTagGroupAction(_p: TagSettingsState, form: FormData): Promise<TagSettingsState> {
  const patch: { name?: string; isActive?: boolean; hasPrimary?: boolean } = {}
  if (form.has('name')) patch.name = str(form, 'name')
  if (form.has('isActive')) patch.isActive = str(form, 'isActive') === 'true'
  if (form.has('hasPrimary')) patch.hasPrimary = str(form, 'hasPrimary') === 'true'
  return run(
    () => assertAccountPermission('config.manage'),
    (access) => updateTagGroup(access, str(form, 'groupId'), patch),
    'Saved.',
  )
}

export async function deleteTagGroupAction(_p: TagSettingsState, form: FormData): Promise<TagSettingsState> {
  return run(
    () => assertAccountPermission('config.manage'),
    (access) => deleteTagGroup(access, str(form, 'groupId')),
    'Group deleted.',
  )
}

export async function moveTagGroupAction(_p: TagSettingsState, form: FormData): Promise<TagSettingsState> {
  return run(
    () => assertAccountPermission('config.manage'),
    (access) => moveTagGroup(access, str(form, 'groupId'), str(form, 'direction') === 'up' ? 'up' : 'down'),
    'Moved.',
  )
}

export async function createTagValueAction(_p: TagSettingsState, form: FormData): Promise<TagSettingsState> {
  return run(
    () => assertAccountPermission('config.manage'),
    (access) =>
      createTagValue(access, str(form, 'groupId'), {
        name: str(form, 'name'),
        description: str(form, 'description'),
        aliases: str(form, 'aliases'),
      }),
    'Value added.',
  )
}

export async function updateTagValueAction(_p: TagSettingsState, form: FormData): Promise<TagSettingsState> {
  const patch: { name?: string; description?: string; aliases?: string; isActive?: boolean } = {}
  if (form.has('name')) patch.name = str(form, 'name')
  if (form.has('description')) patch.description = str(form, 'description')
  if (form.has('aliases')) patch.aliases = str(form, 'aliases')
  if (form.has('isActive')) patch.isActive = str(form, 'isActive') === 'true'
  return run(
    () => assertAccountPermission('config.manage'),
    (access) => updateTagValue(access, str(form, 'valueId'), patch),
    'Saved.',
  )
}

export async function deleteTagValueAction(_p: TagSettingsState, form: FormData): Promise<TagSettingsState> {
  return run(
    () => assertAccountPermission('config.manage'),
    (access) => deleteTagValue(access, str(form, 'valueId')),
    'Value deleted.',
  )
}

export async function moveTagValueAction(_p: TagSettingsState, form: FormData): Promise<TagSettingsState> {
  return run(
    () => assertAccountPermission('config.manage'),
    (access) => moveTagValue(access, str(form, 'valueId'), str(form, 'direction') === 'up' ? 'up' : 'down'),
    'Moved.',
  )
}
