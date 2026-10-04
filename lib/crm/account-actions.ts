'use server'

/**
 * Server actions for the account workspace.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  A SERVER ACTION IS A PUBLIC HTTP ENDPOINT.                              ║
 * ║                                                                          ║
 * ║  Every action below gates with `assertAccountPermission` before reading  ║
 * ║  its input, and the service it calls (`lib/crm/account-writes.ts`)       ║
 * ║  checks the permission AND the account's visibility again. The second    ║
 * ║  check is the one that matters; this one exists so a refused caller      ║
 * ║  gets a sentence instead of a stack trace.                               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ NOTHING FROM THE DATABASE REACHES THE BROWSER. A refusal the person can
 * act on comes back as a typed result; anything else becomes one fixed
 * sentence, with the detail logged (CLAUDE.md: never return SQL or ids).
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { assertAccountPermission, type AccountAccess } from '@/lib/crm/account-access'
import type { AccountPermission } from '@/lib/crm/account-permissions'
import {
  addAccountTag,
  addAccountNote,
  assignAccount,
  createAccount,
  deleteAccount,
  setAccountTags,
  setAccountStatus,
  unassignAccount,
  updateAccount,
  type AccountWriteResult,
} from '@/lib/crm/account-writes'
import { moveAccountsToPipeline } from '@/lib/crm/account-deals'
import { isAppError } from '@/lib/errors/catalog'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type AccountFormState = null | AccountWriteResult | { ok: false; reason: 'error'; message: string }

export type AccountActionState = null | { ok: true; message?: string } | { ok: false; message: string }

const LIST = '/crm/companies'
const BULK_LIMIT = 100

function message(error: unknown): string {
  if (isAppError(error)) {
    if (error.code === 'ERR_FORBIDDEN') return 'You do not have permission to do that.'
    if (error.code === 'ERR_NOT_FOUND') return 'That account could not be found.'
    if (error.code === 'ERR_VALIDATION') return 'That value is no longer available. Refresh and try again.'
    return error.userMessage
  }
  console.error('[account-actions]', error instanceof Error ? error.message : 'unknown error')
  return 'Something went wrong. Please try again.'
}

/**
 * Runs the gate and turns a refusal into a sentence.
 *
 * ⚠️ TAKES THE GATE CALL, NOT A PERMISSION NAME, so every exported action
 * names `assertAccountPermission(...)` in its own body — which is what
 * `tests/unit/action-authorization.test.ts` reads, and what a reviewer reads.
 */
async function gate(
  check: () => Promise<AccountAccess>,
): Promise<AccountAccess | { ok: false; message: string }> {
  try {
    return await check()
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}

function text(form: FormData, key: string): string | undefined {
  return form.has(key) ? String(form.get(key) ?? '') : undefined
}

function companyIdOf(form: FormData): string {
  return String(form.get('companyId') ?? '')
}

function refresh(companyId?: string) {
  revalidatePath(LIST)
  if (companyId) revalidatePath(`${LIST}/${companyId}`)
}

/**
 * The create form's tag fields, one set per group: `tag:<groupId>` (repeated)
 * and `tag_primary:<groupId>`. Ids are validated by the service, not trusted.
 */
function tagsFromForm(form: FormData): { groupId: string; primaryId: string | null; tagIds: string[] }[] {
  const groups = new Map<string, { groupId: string; primaryId: string | null; tagIds: string[] }>()
  const entry = (groupId: string) => {
    const existing = groups.get(groupId)
    if (existing) return existing
    const created = { groupId, primaryId: null as string | null, tagIds: [] as string[] }
    groups.set(groupId, created)
    return created
  }
  for (const [key, raw] of form.entries()) {
    const value = String(raw)
    if (!value) continue
    if (key.startsWith('tag_primary:')) entry(key.slice('tag_primary:'.length)).primaryId = value
    else if (key.startsWith('tag:')) entry(key.slice('tag:'.length)).tagIds.push(value)
  }
  for (const g of groups.values()) g.tagIds = [...new Set(g.tagIds)].filter((id) => id !== g.primaryId)
  return [...groups.values()]
}

/** Only the fields the form actually carried, so a partial form edits only its own. */
function fieldsFrom(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of [
    'name',
    'websiteUrl',
    'linkedInUrl',
    'salesNavigatorUrl',
    'location',
    'employeeCountRange',
    'summary',
  ]) {
    const value = text(form, key)
    if (value !== undefined) out[key] = value
  }
  const priority = text(form, 'priority')
  if (priority !== undefined) out.priority = priority === '' ? null : priority
  const count = text(form, 'employeeCount')
  if (count !== undefined) {
    const trimmed = count.replace(/[,\s]/g, '')
    out.employeeCount = trimmed === '' ? null : Number(trimmed)
  }
  return out
}

// ---------------------------------------------------------------------------
// Create and edit
// ---------------------------------------------------------------------------

export async function createAccountAction(
  _previous: AccountFormState,
  form: FormData,
): Promise<AccountFormState> {
  const access = await gate(() => assertAccountPermission('accounts.create'))
  if ('ok' in access) return { ok: false, reason: 'error', message: access.message }

  try {
    const result = await createAccount(access, {
      ...fieldsFrom(form),
      statusId: text(form, 'statusId') || undefined,
      tags: tagsFromForm(form),
      assigneeUserId: text(form, 'assigneeUserId') || undefined,
      confirmPossibleDuplicate: form.get('confirmPossibleDuplicate') === '1',
    })
    if (result.ok) refresh()
    return result
  } catch (error) {
    return { ok: false, reason: 'error', message: message(error) }
  }
}

export async function updateAccountAction(
  _previous: AccountFormState,
  form: FormData,
): Promise<AccountFormState> {
  const access = await gate(() => assertAccountPermission('accounts.edit'))
  if ('ok' in access) return { ok: false, reason: 'error', message: access.message }

  const companyId = companyIdOf(form)
  try {
    const result = await updateAccount(access, companyId, fieldsFrom(form))
    if (result.ok) refresh(companyId)
    return result
  } catch (error) {
    return { ok: false, reason: 'error', message: message(error) }
  }
}

// ---------------------------------------------------------------------------
// Status, tags, assignment, notes
// ---------------------------------------------------------------------------

async function simple(
  check: () => Promise<AccountAccess>,
  form: FormData,
  run: (access: AccountAccess, companyId: string) => Promise<unknown>,
  done = 'Saved.',
): Promise<AccountActionState> {
  const access = await gate(check)
  if ('ok' in access) return access
  const companyId = companyIdOf(form)
  try {
    await run(access, companyId)
    refresh(companyId)
    return { ok: true, message: done }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}

export async function setAccountStatusAction(
  _previous: AccountActionState,
  form: FormData,
): Promise<AccountActionState> {
  return simple(() => assertAccountPermission('accounts.edit'), form, (access, id) =>
    setAccountStatus(access, id, String(form.get('statusId') ?? '')),
  )
}

/**
 * One tag group's values on one account. The form carries `groupId`, the
 * ticked values as `tagIds`, and `primaryId` when the group has a primary.
 */
export async function setAccountTagsAction(
  _previous: AccountActionState,
  form: FormData,
): Promise<AccountActionState> {
  const primaryId = String(form.get('primaryId') ?? '') || null
  return simple(() => assertAccountPermission('accounts.edit_tags'), form, (access, id) =>
    setAccountTags(access, id, {
      groupId: String(form.get('groupId') ?? ''),
      primaryId,
      // The primary is sent once, as the primary — never also as a value.
      tagIds: form
        .getAll('tagIds')
        .map(String)
        .filter((v) => v && v !== primaryId),
    }),
  )
}

export async function assignAccountAction(
  _previous: AccountActionState,
  form: FormData,
): Promise<AccountActionState> {
  const userId = String(form.get('userId') ?? '')
  const mode = form.get('mode') === 'add' ? 'add' : 'replace'
  /*
   * ⚠️ AN EMPTY CHOICE IS NOT "REMOVE EVERYONE". Reading it that way meant a
   * Reassign click with nothing selected silently unassigned the account.
   * Removing people is `unassignAccountAction`, and only that.
   */
  // Nothing is read or written on this path, so it needs no gate of its own.
  if (userId === '') return { ok: false, message: 'Choose who to assign it to.' }
  return simple(() => assertAccountPermission('accounts.assign'), form, (access, id) => assignAccount(access, id, userId, mode), 'Assigned.')
}

export async function unassignAccountAction(
  _previous: AccountActionState,
  form: FormData,
): Promise<AccountActionState> {
  const userId = String(form.get('userId') ?? '') || undefined
  return simple(() => assertAccountPermission('accounts.assign'), form, (access, id) => unassignAccount(access, id, userId), 'Removed.')
}

export async function addAccountNoteAction(
  _previous: AccountActionState,
  form: FormData,
): Promise<AccountActionState> {
  return simple(() => assertAccountPermission('accounts.edit'), form, (access, id) => addAccountNote(access, id, form.get('body')), 'Note added.')
}

export async function deleteAccountAction(
  _previous: AccountActionState,
  form: FormData,
): Promise<AccountActionState> {
  const access = await gate(() => assertAccountPermission('accounts.delete'))
  if ('ok' in access) return access
  const companyId = companyIdOf(form)
  try {
    await deleteAccount(access, companyId)
  } catch (error) {
    return { ok: false, message: message(error) }
  }
  revalidatePath(LIST)
  // Outside the try: `redirect` works by throwing, and must not be caught.
  redirect(LIST)
}

// ---------------------------------------------------------------------------
// Bulk
// ---------------------------------------------------------------------------

const BULK_OPS = {
  assign: 'accounts.assign',
  status: 'accounts.edit',
  add_tag: 'accounts.edit_tags',
} as const satisfies Record<string, AccountPermission>

type BulkOp = keyof typeof BULK_OPS

/**
 * Applies one change to the ticked accounts.
 *
 * ⚠️ ONE ACCOUNT AT A TIME, THROUGH THE SAME SERVICE AS A SINGLE EDIT — so each
 * account is visibility-checked on its own, and one that cannot be changed
 * (gone, not visible, a value since disabled) is counted and skipped rather
 * than failing the other ninety-nine.
 */
export async function bulkAccountAction(
  _previous: AccountActionState,
  form: FormData,
): Promise<AccountActionState> {
  const raw = String(form.get('op') ?? '')
  if (raw === 'deal') return moveToPipeline(form)
  // `Object.hasOwn`, not `in`: `in` also accepts inherited names like "constructor".
  if (!Object.hasOwn(BULK_OPS, raw)) return { ok: false, message: 'Choose what to change.' }
  const op = raw as BulkOp

  const access = await gate(() => assertAccountPermission(BULK_OPS[op]))
  if ('ok' in access) return access

  const ids = [...new Set(form.getAll('accountId').map(String).filter(Boolean))]
  if (ids.length === 0) return { ok: false, message: 'Tick at least one account.' }
  if (ids.length > BULK_LIMIT) return { ok: false, message: `Change at most ${BULK_LIMIT} accounts at once.` }

  const value = String(form.get(`value_${op}`) ?? '')
  if (value === '') return { ok: false, message: 'Choose a value.' }

  let changed = 0
  let skipped = 0
  for (const id of ids) {
    try {
      const result =
        op === 'assign'
          ? await assignAccount(access, id, value, 'replace')
          : op === 'status'
            ? await setAccountStatus(access, id, value)
            : op === 'add_tag'
              ? await addAccountTag(access, id, value)
              : { changed: false }
      if (result.changed) changed += 1
    } catch (error) {
      skipped += 1
      if (!isAppError(error)) message(error)
    }
  }

  refresh()
  const unchanged = ids.length - changed - skipped
  const parts = [`${changed} updated`]
  if (unchanged > 0) parts.push(`${unchanged} already set`)
  if (skipped > 0) parts.push(`${skipped} skipped`)
  const summary = `${parts.join(', ')}.`
  return skipped === 0 ? { ok: true, message: summary } : { ok: false, message: summary }
}

/**
 * Bulk "Move to pipeline": one deal per ticked account, in the chosen stage.
 *
 * ⚠️ TWO GATES. Creating a deal is `crm.opportunity.create`, a WORKSPACE
 * permission; which accounts may be touched is the ACCOUNT rule. Each is
 * checked here and the service re-checks visibility per account.
 */
async function moveToPipeline(form: FormData): Promise<AccountActionState> {
  const access = await gate(() => assertAccountPermission(null))
  if ('ok' in access) return access
  try {
    await assertWorkspacePermission('crm.opportunity.create')
  } catch {
    return { ok: false, message: 'You do not have permission to create deals.' }
  }

  const ids = [...new Set(form.getAll('accountId').map(String).filter(Boolean))]
  if (ids.length === 0) return { ok: false, message: 'Tick at least one account.' }
  if (ids.length > BULK_LIMIT) return { ok: false, message: `Move at most ${BULK_LIMIT} accounts at once.` }
  const stageId = String(form.get('value_deal') ?? '')
  if (!stageId) return { ok: false, message: 'Choose a pipeline stage.' }

  let result
  try {
    result = await moveAccountsToPipeline(access, stageId, ids)
  } catch (error) {
    if (isAppError(error) && error.code === 'ERR_VALIDATION') {
      return { ok: false, message: 'That stage is no longer available. Refresh and try again.' }
    }
    return { ok: false, message: message(error) }
  }

  refresh()
  revalidatePath('/crm/pipeline')
  const parts = [`${result.created} ${result.created === 1 ? 'deal' : 'deals'} created`]
  if (result.alreadyThere > 0) parts.push(`${result.alreadyThere} already in that pipeline`)
  if (result.unnamed > 0) parts.push(`${result.unnamed} skipped (no name or website to call the deal)`)
  if (result.notFound > 0) parts.push(`${result.notFound} not found`)
  const summary = `${parts.join(', ')}.`
  return result.unnamed + result.notFound === 0 ? { ok: true, message: summary } : { ok: false, message: summary }
}
