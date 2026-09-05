'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { Field } from '@/components/auth/Field'
import { FormFeedback } from '@/components/auth/FormFeedback'
import { PasswordField } from '@/components/auth/PasswordField'
import { SubmitButton } from '@/components/auth/SubmitButton'
import { signInAction, type ActionState } from '@/lib/auth/actions'

const INITIAL: ActionState = { status: 'idle' }

export function SignInForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(signInAction, INITIAL)

  // React 19 clears uncontrolled fields after a form action; restore the email
  // so a wrong password does not also mean retyping the address.
  const priorEmail = state.status === 'error' ? (state.values?.email ?? '') : ''

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />

      {next ? <input type="hidden" name="next" value={next} /> : null}

      <Field
        id="email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        spellCheck={false}
        required
        defaultValue={priorEmail}
      />

      {/*
        "Forgot password?" sits BESIDE THE LABEL, not under the input. Below, it
        was the last thing between the password box and the sign-in button —
        directly in the path of someone who has typed their password correctly
        and is heading for submit.
      */}
      <PasswordField
        id="password"
        name="password"
        label="Password"
        autoComplete="current-password"
        required
        labelAside={
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-accent hover:underline"
          >
            Forgot password?
          </Link>
        }
      />

      <SubmitButton>Sign in</SubmitButton>
    </form>
  )
}
