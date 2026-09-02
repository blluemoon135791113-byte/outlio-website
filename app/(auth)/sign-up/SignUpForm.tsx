'use client'

import { useActionState } from 'react'

import { Field } from '@/components/auth/Field'
import { FormFeedback } from '@/components/auth/FormFeedback'
import { PasswordField } from '@/components/auth/PasswordField'
import { PhoneField } from '@/components/auth/PhoneField'
import { SubmitButton } from '@/components/auth/SubmitButton'
import { signUpAction, type ActionState } from '@/lib/auth/actions'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password'

const INITIAL: ActionState = { status: 'idle' }

export function SignUpForm({ referralCode = '' }: { referralCode?: string }) {
  const [state, formAction] = useActionState(signUpAction, INITIAL)

  // React 19 resets uncontrolled fields once a form action completes, so the
  // action echoes back what was submitted and we restore it here. Without this
  // a single mistyped field wipes the whole form. Password is never echoed.
  const prior = state.status === 'error' ? (state.values ?? {}) : {}

  // The action names the field it rejected, so the message can sit under that
  // input instead of leaving the reader to match a banner against five boxes.
  const errorFor = (name: string) =>
    state.status === 'error' && state.field === name ? state.message : undefined

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />

      {/* Carried through the failed-submit round trip like every other field. */}
      <input type="hidden" name="referral_code" value={referralCode} />

      <Field
        id="full_name"
        name="full_name"
        label="Full name"
        type="text"
        autoComplete="name"
        required
        defaultValue={prior.full_name ?? ''}
        error={errorFor('full_name')}
      />

      <Field
        id="email"
        name="email"
        label="Work email"
        type="email"
        autoComplete="email"
        required
        defaultValue={prior.email ?? ''}
        error={errorFor('email')}
      />

      <PhoneField
        defaultCountry={prior.phone_country ?? 'US'}
        defaultValue={prior.phone ?? ''}
        error={errorFor('phone')}
      />

      {/*
        ⚠️ type="text", NOT type="url". `normalizeLinkedInUrl` deliberately
        prepends https:// when the scheme is missing, and the placeholder below
        shows a schemeless address — but type="url" made the browser reject
        exactly that value before the form could submit, with a native tooltip
        and no way past it. The field demonstrated a value it would not accept,
        and the server code written to handle it was unreachable.

        `inputMode="url"` keeps the URL keyboard on mobile. Validation is the
        server's, which is the stricter and more useful rule: it also rejects a
        company page and a Sales Navigator link, which type="url" happily
        accepts.
      */}
      <Field
        id="linkedin_url"
        name="linkedin_url"
        label="LinkedIn profile"
        type="text"
        inputMode="url"
        autoComplete="url"
        required
        placeholder="linkedin.com/in/your-name"
        hint="Your own profile. We use it to verify your request and never visit or scrape it."
        defaultValue={prior.linkedin_url ?? ''}
        error={errorFor('linkedin_url')}
      />

      <PasswordField
        id="password"
        name="password"
        label="Password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. A memorable phrase beats a short complicated one.`}
        error={errorFor('password')}
      />

      <SubmitButton>Create account</SubmitButton>
    </form>
  )
}
