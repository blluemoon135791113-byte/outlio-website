'use client'

import { useState, type InputHTMLAttributes, type ReactNode } from 'react'

import {
  AUTH_INPUT_CLASS,
  AUTH_INPUT_INVALID_CLASS,
  FieldShell,
  describedBy,
} from '@/components/auth/Field'

/**
 * Password input with a reveal toggle.
 *
 * ⚠️ REVEALING IS AN ACCESSIBILITY FEATURE, NOT A CONVENIENCE. A field that can
 * never be read back forces the user to hold a long password in working memory
 * and retype it blind after every mistake, which is the failure mode long
 * passphrases — the thing our own hint asks for — make worst.
 *
 * ⚠️ NEVER SET autocomplete="off" AND NEVER BLOCK PASTE. Both break password
 * managers, which is the only reason most people have a strong password at all.
 * WCAG 2.2 "Accessible Authentication" counts blocking paste as a failure.
 */
export function PasswordField({
  label,
  id,
  hint,
  error,
  labelAside,
  ...props
}: {
  label: string
  id: string
  hint?: string
  error?: string
  labelAside?: ReactNode
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [revealed, setRevealed] = useState(false)

  return (
    <FieldShell label={label} id={id} hint={hint} error={error} labelAside={labelAside}>
      <div className="relative">
        <input
          id={id}
          type={revealed ? 'text' : 'password'}
          aria-describedby={describedBy(id, hint, error)}
          aria-invalid={error ? true : undefined}
          className={`${AUTH_INPUT_CLASS} pr-20${
            error ? ` ${AUTH_INPUT_INVALID_CLASS}` : ''
          }`}
          {...props}
        />

        {/*
         * A real <button type="button"> with a text label, not an icon-only
         * eye. `type` matters: the default inside a form is "submit", so an
         * icon button here would submit half-filled credentials.
         *
         * Inset rather than overlapping, and the input reserves `pr-20` for it,
         * so a long password never runs underneath the control.
         */}
        <button
          type="button"
          onClick={() => setRevealed((current) => !current)}
          aria-pressed={revealed}
          aria-controls={id}
          className="absolute inset-y-1 right-1 rounded-[var(--radius-sm)] px-2.5 text-xs font-semibold text-muted transition-colors duration-150 hover:text-ink"
        >
          {revealed ? 'Hide' : 'Show'}
        </button>
      </div>

      {/*
       * Announced, because the visible change is to characters a screen-reader
       * user is not reading. Without this, toggling is silent.
       */}
      <p role="status" aria-live="polite" className="sr-only">
        {revealed ? 'Password is visible.' : 'Password is hidden.'}
      </p>
    </FieldShell>
  )
}
