'use client'

import { useActionState } from 'react'

import { FormFeedback } from '@/components/auth/FormFeedback'
import { PasswordField } from '@/components/auth/PasswordField'
import { SubmitButton } from '@/components/auth/SubmitButton'
import { updatePasswordAction, type ActionState } from '@/lib/auth/actions'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password'

const INITIAL: ActionState = { status: 'idle' }

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(updatePasswordAction, INITIAL)

  const errorFor = (name: string) =>
    state.status === 'error' && state.field === name ? state.message : undefined

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />

      <PasswordField
        id="password"
        name="password"
        label="New password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        error={errorFor('password')}
      />

      <PasswordField
        id="confirm_password"
        name="confirm_password"
        label="Confirm new password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        error={errorFor('confirm_password')}
      />

      <SubmitButton>Update password</SubmitButton>
    </form>
  )
}
