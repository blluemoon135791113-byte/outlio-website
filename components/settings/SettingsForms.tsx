'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useActionState, useState } from 'react'

import { FormFeedback } from '@/components/auth/FormFeedback'
import { SubmitButton } from '@/components/auth/SubmitButton'
import {
  cancelSubscriptionAction,
  changeEmailAction,
  changePasswordAction,
  deleteAccountAction,
  resumeSubscriptionAction,
  updateAvatarAction,
  updateProfileAction,
  type SettingsActionState,
} from '@/lib/settings/actions'
import { createClient } from '@/lib/supabase/client'

const INITIAL: SettingsActionState = { status: 'idle' }

const inputClass = 'w-full rounded-[var(--radius-md)] border border-border bg-paper px-3 py-2.5 text-base text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-muted/60 hover:border-border-strong focus:border-accent/60 focus:shadow-[0_0_0_3px_rgba(139,92,246,0.12)] focus:outline-none'

export function ProfileSettings({ fullName }: { fullName: string }) {
  const [state, action] = useActionState(updateProfileAction, INITIAL)
  return (
    <form action={action} className="space-y-4">
      <FormFeedback state={state} />
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-ink">Display name</span>
        <input className={inputClass} name="full_name" defaultValue={fullName} autoComplete="name" required maxLength={120} />
      </label>
      <SubmitButton>Save profile</SubmitButton>
    </form>
  )
}

export function AvatarSettings({ avatarUrl, initials }: { avatarUrl: string | null; initials: string }) {
  const [state, action] = useActionState(updateAvatarAction, INITIAL)
  return (
    <form action={action} className="space-y-4">
      <FormFeedback state={state} />
      <div className="flex items-center gap-4">
        <span
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-accent-soft bg-cover bg-center font-heading text-lg font-bold text-accent ring-1 ring-accent/15"
          style={avatarUrl ? { backgroundImage: `url(${JSON.stringify(avatarUrl).slice(1, -1)})` } : undefined}
          aria-label="Current profile image"
        >
          {avatarUrl ? null : initials}
        </span>
        <div className="min-w-0 flex-1">
          <label className="block text-sm font-medium text-ink" htmlFor="avatar">Profile image</label>
          <input id="avatar" name="avatar" type="file" accept="image/png,image/jpeg,image/webp" required className="mt-1.5 block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-accent-soft file:px-3 file:py-2 file:font-semibold file:text-accent" />
          <p className="mt-1 text-xs text-muted">PNG, JPEG, or WebP. Maximum 2 MB.</p>
        </div>
      </div>
      <SubmitButton>Upload image</SubmitButton>
    </form>
  )
}

export function PasswordSettings() {
  const [state, action] = useActionState(changePasswordAction, INITIAL)
  return (
    <form action={action} className="space-y-4">
      <FormFeedback state={state} />
      {[
        ['current_password', 'Current password', 'current-password'],
        ['password', 'New password', 'new-password'],
        ['confirm_password', 'Confirm new password', 'new-password'],
      ].map(([name, label, autoComplete]) => (
        <label key={name} className="block space-y-1.5">
          <span className="text-sm font-medium text-ink">{label}</span>
          <input className={inputClass} name={name} type="password" autoComplete={autoComplete} required minLength={name === 'current_password' ? 1 : 12} maxLength={128} />
        </label>
      ))}
      <SubmitButton>Change password</SubmitButton>
    </form>
  )
}

export function EmailSettings({ email }: { email: string }) {
  const [state, action] = useActionState(changeEmailAction, INITIAL)

  return (
    <form action={action} className="space-y-4">
      <FormFeedback state={state} />

      <div className="rounded-xl border border-border bg-app/70 p-4">
        <p className="text-xs font-medium text-muted">Current address</p>
        <p className="mt-1.5 truncate text-sm font-semibold text-ink" title={email}>
          {email}
        </p>
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-ink">New email address</span>
        <input
          className={inputClass}
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          placeholder="you@company.com"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-ink">Current password</span>
        <input
          className={inputClass}
          name="current_password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
        />
      </label>

      <p className="text-xs leading-5 text-muted">
        We email a confirmation link to both your current and your new address. The
        change takes effect only after you confirm from both, so losing access to one
        inbox cannot lock you out.
      </p>

      <SubmitButton>Send confirmation links</SubmitButton>
    </form>
  )
}

export function SubscriptionSettings({
  planName,
  cancelAt,
  hasActiveSubscription,
}: {
  planName: string
  /** ISO date when access ends, or `null` when the plan is renewing. */
  cancelAt: string | null
  hasActiveSubscription: boolean
}) {
  const [cancelState, cancelAction] = useActionState(cancelSubscriptionAction, INITIAL)
  const [resumeState, resumeAction] = useActionState(resumeSubscriptionAction, INITIAL)
  const [confirming, setConfirming] = useState(false)

  const endsOn = cancelAt
    ? new Date(cancelAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null

  if (cancelAt) {
    return (
      <form action={resumeAction} className="space-y-4">
        <FormFeedback state={resumeState} />
        <div className="rounded-xl border border-warning/25 bg-warning-soft p-4">
          <p className="text-sm font-semibold text-ink">Cancellation scheduled</p>
          <p className="mt-1 text-sm leading-6 text-muted">
            {planName} stays fully active until <strong className="font-semibold text-ink">{endsOn}</strong>.
            Your leads and exports are untouched until then. Change your mind any time
            before that date.
          </p>
        </div>
        <SubmitButton>Keep my plan</SubmitButton>
      </form>
    )
  }

  if (!hasActiveSubscription) {
    return (
      <p className="rounded-xl border border-border bg-app/70 p-4 text-sm leading-6 text-muted">
        There is no active plan to cancel on this account. If that looks wrong, email{' '}
        <a className="font-medium text-accent underline underline-offset-2" href="mailto:husnain@outlio.io">
          husnain@outlio.io
        </a>
        .
      </p>
    )
  }

  return (
    <form action={cancelAction} className="space-y-4">
      <FormFeedback state={cancelState} />

      {confirming ? (
        <div className="space-y-4 rounded-xl border border-danger/25 bg-danger-soft p-4">
          <div>
            <p className="text-sm font-semibold text-ink">Cancel {planName}?</p>
            <ul className="mt-2 space-y-1.5 text-sm leading-6 text-muted">
              <li>You keep full access until the end of the period you have paid for.</li>
              <li>Credits stop renewing after that date.</li>
              <li>Your leads and exports stay available until then — nothing is deleted today.</li>
              <li>You can undo this at any point before the date.</li>
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-danger/30 bg-panel px-4 text-sm font-semibold text-danger transition-[background-color,transform] duration-150 hover:bg-danger/10 active:scale-[0.97]"
            >
              Yes, cancel at period end
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-4 text-sm font-semibold text-ink transition-[border-color,transform] duration-150 hover:border-accent/35 active:scale-[0.97]"
            >
              Never mind
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-4 text-sm font-semibold text-ink transition-[border-color,background-color,transform] duration-150 hover:border-danger/35 hover:text-danger active:scale-[0.97]"
        >
          Cancel subscription
        </button>
      )}
    </form>
  )
}

export function DeleteAccountSettings({ isAdmin }: { isAdmin: boolean }) {
  const [state, action] = useActionState(deleteAccountAction, INITIAL)

  return (
    <form action={action} className="space-y-4">
      <FormFeedback state={state} />
      <p className="text-sm leading-6 text-muted">
        This permanently removes your Outlio account, profile, extractions, leads, exports, uploaded files, and signup restriction claims. You may create a new account later from the same network.
      </p>
      {isAdmin ? (
        <p className="rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger">
          Admin accounts cannot be deleted here. Transfer admin responsibility before requesting deletion.
        </p>
      ) : (
        <>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">Current password</span>
            <input className={inputClass} name="current_password" type="password" autoComplete="current-password" required maxLength={128} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">Type DELETE to confirm</span>
            <input className={inputClass} name="confirmation" autoComplete="off" required maxLength={6} />
          </label>
          <button type="submit" className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-danger/30 bg-danger-soft px-4 text-sm font-semibold text-danger transition-[background-color,transform] duration-150 hover:bg-danger/15 active:scale-[0.97]">
            Permanently delete account
          </button>
        </>
      )}
    </form>
  )
}

type Enrollment = { id: string; qr: string; secret: string }

export function MfaSettings({
  initialFactorId,
  returnToAdmin = false,
}: {
  initialFactorId: string | null
  returnToAdmin?: boolean
}) {
  const router = useRouter()
  const [factorId, setFactorId] = useState<string | null>(initialFactorId)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function refreshFactors() {
    const { data } = await createClient().auth.mfa.listFactors()
    setFactorId(data?.totp[0]?.id ?? null)
  }

  async function beginEnrollment() {
    setBusy(true)
    setMessage('')
    const { data, error } = await createClient().auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Outlio authenticator' })
    if (error || !data || data.type !== 'totp') setMessage('We could not start MFA setup. Please try again.')
    else setEnrollment({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    setBusy(false)
  }

  async function verifyEnrollment() {
    if (!enrollment || !/^\d{6}$/.test(code)) {
      setMessage('Enter the 6-digit code from your authenticator app.')
      return
    }
    setBusy(true)
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId: enrollment.id, code })
    if (error) setMessage('That code was not accepted. Wait for a new code and try again.')
    else {
      setEnrollment(null)
      setCode('')
      setMessage('Two-factor authentication is active.')
      await refreshFactors()
      if (returnToAdmin) router.replace('/admin')
      else router.refresh()
    }
    setBusy(false)
  }

  async function disableMfa() {
    if (!factorId) return
    setBusy(true)
    const { error } = await createClient().auth.mfa.unenroll({ factorId })
    setMessage(error ? 'Re-enter an MFA code, then try disabling it again.' : 'Two-factor authentication has been disabled.')
    if (!error) await refreshFactors()
    setBusy(false)
  }

  if (enrollment) {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted">Scan this code with Google Authenticator, 1Password, Authy, or another TOTP app.</p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Image src={enrollment.qr} alt="Authenticator QR code" width={156} height={156} unoptimized className="rounded-xl border border-border bg-white p-2" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted">Manual setup key</p>
            <code className="mt-1 block break-all rounded-lg bg-surface-muted p-2 font-mono text-xs text-ink">{enrollment.secret}</code>
          </div>
        </div>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink">6-digit code</span>
          <input className={inputClass} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" />
        </label>
        {message ? <p className="text-sm text-danger">{message}</p> : null}
        <button type="button" disabled={busy} onClick={verifyEnrollment} className="inline-flex h-10 items-center rounded-[var(--radius-md)] bg-accent px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.97] disabled:opacity-60">Verify and enable</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-ink">Authenticator app</p>
        <p className="mt-1 text-sm text-muted">{factorId ? 'Active. New sessions require a one-time code.' : 'Add a second factor to protect your account.'}</p>
        {message ? <p className="mt-2 text-sm text-muted">{message}</p> : null}
      </div>
      <button type="button" disabled={busy} onClick={factorId ? disableMfa : beginEnrollment} className={factorId ? 'inline-flex h-10 shrink-0 items-center rounded-[var(--radius-md)] border border-border px-4 text-sm font-semibold text-muted hover:border-danger/30 hover:text-danger disabled:opacity-60' : 'inline-flex h-10 shrink-0 items-center rounded-[var(--radius-md)] bg-accent px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.97] disabled:opacity-60'}>
        {factorId ? 'Disable MFA' : 'Set up MFA'}
      </button>
    </div>
  )
}
