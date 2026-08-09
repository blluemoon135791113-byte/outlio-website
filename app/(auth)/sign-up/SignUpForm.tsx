'use client'

import { useActionState } from 'react'

import { Field } from '@/components/auth/Field'
import { FormFeedback } from '@/components/auth/FormFeedback'
import { PhoneField } from '@/components/auth/PhoneField'
import { SubmitButton } from '@/components/auth/SubmitButton'
import { signUpAction, type ActionState } from '@/lib/auth/actions'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password'

const INITIAL: ActionState = { status: 'idle' }

export function SignUpForm() {
  const [state, formAction] = useActionState(signUpAction, INITIAL)

  // React 19 resets uncontrolled fields once a form action completes, so the
  // action echoes back what was submitted and we restore it here. Without this
  // a single mistyped field wipes the whole form. Password is never echoed.
  const prior = state.status === 'error' ? (state.values ?? {}) : {}

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />

      <Field
        id="full_name"
        name="full_name"
        label="Full name"
        type="text"
        autoComplete="name"
        required
        defaultValue={prior.full_name ?? ''}
      />

      <Field
        id="email"
        name="email"
        label="Work email"
        type="email"
        autoComplete="email"
        required
        defaultValue={prior.email ?? ''}
      />

      <PhoneField
        defaultCountry={prior.phone_country ?? 'US'}
        defaultValue={prior.phone ?? ''}
      />

      <Field
        id="linkedin_url"
        name="linkedin_url"
        label="LinkedIn profile"
        type="url"
        autoComplete="url"
        required
        placeholder="linkedin.com/in/your-name"
        hint="Your own profile. We use it to verify your request and never visit or scrape it."
        defaultValue={prior.linkedin_url ?? ''}
      />

      <Field
        id="password"
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. A memorable phrase beats a short complicated one.`}
      />

      <SubmitButton>Create account</SubmitButton>
    </form>
  )
}
