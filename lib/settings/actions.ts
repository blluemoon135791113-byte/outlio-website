'use server'

import { randomUUID } from 'node:crypto'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { assertUser } from '@/lib/auth/access'
import { checkPassword } from '@/lib/auth/password'
import { normalizeFullName } from '@/lib/auth/profile-fields'
import { consume } from '@/lib/auth/rate-limit'
import { ACTION_LIMITS } from '@/lib/security/action-limits'
import { recordSecurityEvent } from '@/lib/security/events'
import { removeUserStorage } from '@/lib/settings/delete-account'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export type SettingsActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string }

const AVATAR_BUCKET = 'avatars'
const MAX_AVATAR_BYTES = 2 * 1024 * 1024

function imageType(bytes: Uint8Array): { extension: 'png' | 'jpg' | 'webp'; mime: string } | null {
  if (bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) {
    return { extension: 'png', mime: 'image/png' }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: 'jpg', mime: 'image/jpeg' }
  }
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  ) {
    return { extension: 'webp', mime: 'image/webp' }
  }
  return null
}

export async function updateProfileAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await assertUser()
  const limit = await consume(ACTION_LIMITS.profile, `user:${ctx.userId}`)
  if (!limit.allowed) return { status: 'error', message: 'Too many profile updates. Please wait and try again.' }
  const result = normalizeFullName(String(formData.get('full_name') ?? ''))
  if (!result.ok) return { status: 'error', message: result.reason }

  const { error } = await createAdminClient()
    .from('profiles')
    .update({ full_name: result.value })
    .eq('id', ctx.userId!)

  if (error) return { status: 'error', message: 'We could not update your profile.' }
  await recordSecurityEvent({ event: 'account.profile_updated', userId: ctx.userId })
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/settings')
  return { status: 'success', message: 'Profile updated.' }
}

export async function updateAvatarAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await assertUser()
  const limit = await consume(ACTION_LIMITS.profile, `user:${ctx.userId}`)
  if (!limit.allowed) return { status: 'error', message: 'Too many profile updates. Please wait and try again.' }
  const file = formData.get('avatar')
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'error', message: 'Choose a PNG, JPEG, or WebP image.' }
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { status: 'error', message: 'Profile images must be 2 MB or smaller.' }
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = imageType(bytes)
  if (!kind) return { status: 'error', message: 'Choose a valid PNG, JPEG, or WebP image.' }

  const admin = createAdminClient()
  const oldPath = ctx.profile?.avatar_path ?? null
  const path = `${ctx.userId}/profile-${randomUUID()}.${kind.extension}`
  const { error: uploadError } = await admin.storage
    .from(AVATAR_BUCKET)
    .upload(path, bytes, { contentType: kind.mime, upsert: false, cacheControl: '3600' })

  if (uploadError) return { status: 'error', message: 'We could not upload that image.' }

  const { error: profileError } = await admin
    .from('profiles')
    .update({ avatar_path: path })
    .eq('id', ctx.userId!)

  if (profileError) {
    await admin.storage.from(AVATAR_BUCKET).remove([path])
    return { status: 'error', message: 'We could not save that profile image.' }
  }

  if (oldPath && oldPath.startsWith(`${ctx.userId}/`)) {
    await admin.storage.from(AVATAR_BUCKET).remove([oldPath])
  }

  await recordSecurityEvent({ event: 'account.avatar_updated', userId: ctx.userId })
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/settings')
  return { status: 'success', message: 'Profile image updated.' }
}

export async function changePasswordAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await assertUser()
  const limit = await consume(ACTION_LIMITS.passwordChange, `user:${ctx.userId}`)
  if (!limit.allowed) return { status: 'error', message: 'Too many password attempts. Please wait and try again.' }
  const currentPassword = z.string().min(1).safeParse(formData.get('current_password'))
  const nextPassword = String(formData.get('password') ?? '')
  const confirmation = String(formData.get('confirm_password') ?? '')

  if (!currentPassword.success) return { status: 'error', message: 'Enter your current password.' }
  if (nextPassword !== confirmation) return { status: 'error', message: 'Both new passwords must match.' }
  const password = checkPassword(nextPassword)
  if (!password.ok) return { status: 'error', message: password.reason }

  const supabase = await createClient()
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: ctx.email ?? '',
    password: currentPassword.data,
  })
  if (verifyError) return { status: 'error', message: 'Your current password was not accepted.' }

  const { error } = await supabase.auth.updateUser({ password: nextPassword })
  if (error) return { status: 'error', message: 'We could not change your password.' }

  await recordSecurityEvent({ event: 'auth.password_changed', userId: ctx.userId })
  return { status: 'success', message: 'Password changed successfully.' }
}

export async function deleteAccountAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await assertUser()
  if (ctx.isAdmin) {
    return { status: 'error', message: 'Admin accounts cannot be self-deleted. Transfer admin responsibility first.' }
  }

  const limit = await consume(ACTION_LIMITS.accountDeletion, `user:${ctx.userId}`)
  if (!limit.allowed) {
    return { status: 'error', message: 'Too many deletion attempts. Please wait and try again.' }
  }

  const confirmation = String(formData.get('confirmation') ?? '').trim()
  const currentPassword = z.string().min(1).max(128).safeParse(formData.get('current_password'))
  if (confirmation !== 'DELETE') {
    return { status: 'error', message: 'Type DELETE exactly to confirm.' }
  }
  if (!currentPassword.success) {
    return { status: 'error', message: 'Enter your current password.' }
  }

  const supabase = await createClient()
  const { error: passwordError } = await supabase.auth.signInWithPassword({
    email: ctx.email ?? '',
    password: currentPassword.data,
  })
  if (passwordError) {
    return { status: 'error', message: 'Your current password was not accepted.' }
  }

  const admin = createAdminClient()
  try {
    await removeUserStorage(admin, ctx.userId!)
  } catch {
    return { status: 'error', message: 'We could not safely remove all account files. Nothing else was deleted.' }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(ctx.userId!)
  if (deleteError) {
    return { status: 'error', message: 'We could not delete the account. Please contact support.' }
  }

  await supabase.auth.signOut({ scope: 'local' })
  redirect('/?account_deleted=1')
}
