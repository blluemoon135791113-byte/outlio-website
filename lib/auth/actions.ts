'use server'

/**
 * The six auth flows (spec §8.3):
 *   sign-up + email verification · sign-in · password reset ·
 *   sign-out · resend verification · session refresh (middleware)
 *
 * Every flow is rate-limited and returns GENERIC errors that do not reveal
 * whether an account exists.
 */
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { checkPassword } from '@/lib/auth/password'
import {
  normalizeFullName,
  normalizeLinkedInUrl,
  normalizePhone,
} from '@/lib/auth/profile-fields'
import { RULES, enforce, subjectFor } from '@/lib/auth/rate-limit'
import { appOrigin, safeRedirectPath } from '@/lib/auth/redirects'
import {
  clientIp,
  releaseSignupIp,
  reserveSignupIp,
  signupClaimsWereClaimed,
  signupSecurityClaims,
} from '@/lib/auth/signup-gate'
import { isAppError } from '@/lib/errors/catalog'
import { createClient } from '@/lib/supabase/server'

/**
 * `values` echoes back what the user typed so the form can repopulate.
 *
 * React 19 resets uncontrolled fields once a form action completes, so without
 * this a single validation slip wipes every field the user filled in.
 *
 * The password is NEVER echoed back.
 */
export type ActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string; values?: Record<string, string> }
  | { status: 'success'; message: string }

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')

/**
 * Deliberately vague. Revealing "no account with that email" turns the sign-in
 * form into an account-enumeration oracle.
 */
const GENERIC_CREDENTIALS_ERROR =
  'That email and password combination did not work. Please try again.'

async function siteUrl(): Promise<string> {
  const h = await headers()
  const host = h.get('host')
  return appOrigin(host ? `http://${host}` : undefined)
}

function failure(message: string): ActionState {
  return { status: 'error', message }
}

// ---------------------------------------------------------------------------
// 1. Sign up (email verification required)
// ---------------------------------------------------------------------------

export async function signUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Echoed back on every failure so the user never retypes the whole form.
  // Password deliberately excluded.
  const submitted = {
    full_name: String(formData.get('full_name') ?? ''),
    email: String(formData.get('email') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    linkedin_url: String(formData.get('linkedin_url') ?? ''),
  }
  const reject = (message: string): ActionState => ({
    status: 'error',
    message,
    values: submitted,
  })

  const emailResult = emailSchema.safeParse(formData.get('email'))
  if (!emailResult.success) {
    return reject(emailResult.error.issues[0]?.message ?? 'Enter a valid email address.')
  }
  const email = emailResult.data
  const password = String(formData.get('password') ?? '')

  // All three are REQUIRED. Access is granted by manual review, so a human
  // needs a name, a reachable number, and a profile to vet before approving.
  const nameResult = normalizeFullName(submitted.full_name)
  if (!nameResult.ok) return reject(nameResult.reason)

  const phoneResult = normalizePhone(submitted.phone)
  if (!phoneResult.ok) return reject(phoneResult.reason)

  const linkedInResult = normalizeLinkedInUrl(submitted.linkedin_url)
  if (!linkedInResult.ok) return reject(linkedInResult.reason)

  const passwordCheck = checkPassword(password)
  if (!passwordCheck.ok) return reject(passwordCheck.reason)

  try {
    await enforce(RULES.signUp, subjectFor(await clientIp(), email))
  } catch (e) {
    return reject(
      isAppError(e) ? e.userMessage : 'Too many attempts. Please wait and try again.',
    )
  }

  const securityClaims = await signupSecurityClaims({
    email,
    phone: phoneResult.value,
    linkedinUrl: linkedInResult.value,
  })
  if (!securityClaims) {
    return reject(
      'We could not verify this browser for trial eligibility. Refresh the page and try again, or contact support.',
    )
  }

  const reservationResult = await reserveSignupIp()
  if (reservationResult.status === 'blocked') {
    return reject(
      'A trial account has already been created from this network. Sign in to continue or contact support if this is a shared network.',
    )
  }
  if (reservationResult.status === 'unavailable') {
    return reject(
      'We could not verify this network for trial eligibility. Please try again or contact support.',
    )
  }

  const { reservation } = reservationResult

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${await siteUrl()}/auth/callback`,
        // The database trigger consumes this one-time token before creating the
        // profile. Direct calls to Supabase Auth without a reservation fail.
        data: {
          full_name: nameResult.value,
          phone: phoneResult.value,
          linkedin_url: linkedInResult.value,
          signup_reservation_token: reservation.token,
          signup_device_hash: securityClaims.deviceHash,
          signup_email_hash: securityClaims.emailHash,
          signup_phone_hash: securityClaims.phoneHash,
          signup_linkedin_hash: securityClaims.linkedinHash,
        },
      },
    })

    if (error || !data.user) {
      await releaseSignupIp(reservation)
      // Do not distinguish "already registered" because that would leak
      // account existence.
      return reject('We could not complete sign-up. Please check your details and try again.')
    }

    // Supabase can return an obfuscated user for an already-registered email.
    // Confirming the trigger's claim prevents that response from burning a new
    // network reservation or appearing to create a second account.
    if (!(await signupClaimsWereClaimed(reservation, data.user.id, securityClaims))) {
      await releaseSignupIp(reservation)
      return reject('We could not complete sign-up. Please check your details and try again.')
    }
  } catch {
    await releaseSignupIp(reservation)
    return reject('We could not complete sign-up. Please try again.')
  }

  redirect('/verify-email?sent=1')
}

// ---------------------------------------------------------------------------
// 2. Sign in
// ---------------------------------------------------------------------------

export async function signInAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const submittedEmail = String(formData.get('email') ?? '')
  const reject = (message: string): ActionState => ({
    status: 'error',
    message,
    values: { email: submittedEmail },
  })

  const emailResult = emailSchema.safeParse(formData.get('email'))
  if (!emailResult.success) return reject(GENERIC_CREDENTIALS_ERROR)

  const email = emailResult.data
  const password = String(formData.get('password') ?? '')
  const next = String(formData.get('next') ?? '/dashboard')

  try {
    await enforce(RULES.signIn, subjectFor(await clientIp(), email))
  } catch (e) {
    return reject(
      isAppError(e) ? e.userMessage : 'Too many attempts. Please wait and try again.',
    )
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) return reject(GENERIC_CREDENTIALS_ERROR)

  // Only same-origin relative paths, so `next` cannot become an open redirect.
  redirect(safeRedirectPath(next))
}

// ---------------------------------------------------------------------------
// 3. Sign out
// ---------------------------------------------------------------------------

export async function signOutAction(): Promise<never> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/sign-in')
}

// ---------------------------------------------------------------------------
// 4. Request password reset
// ---------------------------------------------------------------------------

export async function requestPasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const emailResult = emailSchema.safeParse(formData.get('email'))

  // Always report the same thing, valid address or not.
  const confirmation: ActionState = {
    status: 'success',
    message: 'If an account exists for that address, we have sent a reset link.',
  }

  if (!emailResult.success) return confirmation
  const email = emailResult.data

  try {
    await enforce(RULES.passwordReset, subjectFor(await clientIp(), email))
  } catch {
    return confirmation
  }

  const supabase = await createClient()
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteUrl()}/auth/callback?next=/reset-password`,
  })

  return confirmation
}

// ---------------------------------------------------------------------------
// 5. Set a new password (from the reset link, or while signed in)
// ---------------------------------------------------------------------------

export async function updatePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm_password') ?? '')

  if (password !== confirm) return failure('Both passwords must match.')

  const passwordCheck = checkPassword(password)
  if (!passwordCheck.ok) return failure(passwordCheck.reason)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return failure('This reset link has expired. Request a new one.')

  const { error } = await supabase.auth.updateUser({ password })
  if (error) return failure('We could not update your password. Please try again.')

  redirect('/dashboard')
}

// ---------------------------------------------------------------------------
// 6. Resend verification email
// ---------------------------------------------------------------------------

export async function resendVerificationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const emailResult = emailSchema.safeParse(formData.get('email'))

  const confirmation: ActionState = {
    status: 'success',
    message: 'If that address needs verification, we have sent a new link.',
  }

  if (!emailResult.success) return confirmation
  const email = emailResult.data

  try {
    await enforce(RULES.resendVerification, subjectFor(await clientIp(), email))
  } catch {
    return confirmation
  }

  const supabase = await createClient()
  await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${await siteUrl()}/auth/callback` },
  })

  return confirmation
}
