'use server'

/**
 * Qualification profile actions.
 *
 * Every action calls `assertAccess()` and is rate-limited. Hiding a form is not
 * access control — the checks live here, not in the component.
 */
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { assertAccess } from '@/lib/auth/access'
import { consume } from '@/lib/auth/rate-limit'
import { parseCriterionValue } from '@/lib/qualification/parse'
import { createProfile, deleteProfile } from '@/lib/qualification/repository'
import { CRITERION_KINDS, CRITERION_OPERATORS } from '@/lib/qualification/score'
import { ACTION_LIMITS } from '@/lib/security/action-limits'
import { RESEARCH_FIELDS } from '@/lib/intelligence/types'

export type ProfileActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string }

const criterionSchema = z.object({
  field: z.enum(RESEARCH_FIELDS),
  operator: z.enum(CRITERION_OPERATORS),
  kind: z.enum(CRITERION_KINDS),
  weight: z.coerce.number().int().min(0).max(100),
  rawValue: z.string().max(400),
})

const profileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  qualifyAt: z.coerce.number().int().min(0).max(100),
  criteria: z.array(criterionSchema).min(1).max(20),
})

export async function createProfileAction(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  let userId: string
  try {
    const ctx = await assertAccess()
    userId = ctx.userId!
  } catch {
    return { status: 'error', message: 'Please sign in to continue.' }
  }

  const limit = await consume(ACTION_LIMITS.research, `user:${userId}`)
  if (!limit.allowed) {
    return { status: 'error', message: 'Too many changes. Please wait and try again.' }
  }

  let payload: unknown
  try {
    payload = JSON.parse(String(formData.get('profile') ?? ''))
  } catch {
    return { status: 'error', message: 'That profile could not be read.' }
  }

  const parsed = profileSchema.safeParse(payload)
  if (!parsed.success) {
    return { status: 'error', message: 'Give the profile a name and at least one criterion.' }
  }

  // Values are parsed HERE, on the server. A value the user typed is untrusted
  // input like any other, and a criterion that cannot be parsed must fail
  // loudly rather than default to something nobody asked for.
  const criteria = []
  for (const criterion of parsed.data.criteria) {
    const value = parseCriterionValue(criterion.operator, criterion.rawValue)
    if (!value.ok) {
      return { status: 'error', message: `${criterion.field}: ${value.reason}` }
    }

    criteria.push({
      field: criterion.field,
      operator: criterion.operator,
      kind: criterion.kind,
      weight: criterion.weight,
      value: value.value,
      // Tech-stack evidence nests its list under `detected`; without this the
      // comparison runs against the wrapper object and matches nothing.
      valuePath: criterion.field === 'tech_stack' ? 'detected' : undefined,
    })
  }

  const created = await createProfile(userId, {
    name: parsed.data.name,
    qualifyAt: parsed.data.qualifyAt,
    criteria,
  })

  if (!created.ok) {
    return {
      status: 'error',
      message:
        'That profile could not be saved. Outlio qualifies on business attributes only.',
    }
  }

  revalidatePath('/dashboard/intelligence')
  revalidatePath('/dashboard/intelligence/profiles')
  return { status: 'success', message: `Saved “${parsed.data.name}”.` }
}

export async function deleteProfileAction(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  let userId: string
  try {
    const ctx = await assertAccess()
    userId = ctx.userId!
  } catch {
    return { status: 'error', message: 'Please sign in to continue.' }
  }

  const limit = await consume(ACTION_LIMITS.research, `user:${userId}`)
  if (!limit.allowed) {
    return { status: 'error', message: 'Too many changes. Please wait and try again.' }
  }

  const profileId = z.string().uuid().safeParse(formData.get('profile_id'))
  if (!profileId.success) return { status: 'error', message: 'Invalid profile.' }

  // Scoped by user id, so a forged id deletes nothing.
  await deleteProfile(userId, profileId.data)

  revalidatePath('/dashboard/intelligence')
  revalidatePath('/dashboard/intelligence/profiles')
  return { status: 'success', message: 'Profile deleted.' }
}
