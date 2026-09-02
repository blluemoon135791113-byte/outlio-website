import type { InputHTMLAttributes, ReactNode } from 'react'

/**
 * One definition of what an auth input looks like, so the password field —
 * which needs its own markup for the reveal button — cannot drift away from
 * every other field.
 */
export const AUTH_INPUT_CLASS =
  'auth-clay-field w-full rounded-[var(--radius-md)] border-0 bg-clay-sunken px-3.5 py-2.5 text-base text-ink shadow-[var(--neo-shadow-inset)] transition-[box-shadow,transform] duration-150 placeholder:text-muted/65 disabled:cursor-not-allowed disabled:opacity-60'

/** The ring that marks an invalid input, shared for the same reason. */
export const AUTH_INPUT_INVALID_CLASS = 'ring-1 ring-danger'

/** The ids an input must be described by, given its hint and error. */
export function describedBy(id: string, hint?: string, error?: string): string | undefined {
  return (
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined
  )
}

/**
 * Label, hint and inline error around any control.
 *
 * ⚠️ THE ERROR IS RENDERED UNDER THE INPUT, NOT ONLY AT THE TOP. A banner
 * saying "Enter a valid phone number" above a five-field form makes the reader
 * work out which of the five it means. `aria-describedby` carries the hint AND
 * the error, in that order, so a screen reader hears the requirement before the
 * complaint.
 */
export function FieldShell({
  label,
  id,
  hint,
  error,
  labelAside,
  children,
}: {
  label: string
  id: string
  hint?: string
  error?: string
  /** Sits opposite the label — "Forgot password?" and nothing heavier. */
  labelAside?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
        </label>
        {labelAside}
      </div>

      {children}

      {hint ? (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted">
          {hint}
        </p>
      ) : null}

      {error ? (
        /*
         * Not role="alert": the form-level banner already announces this
         * message, and two live regions reading the same sentence is worse
         * than one. This exists to be READ when focus lands on the input,
         * which is what aria-describedby does.
         */
        <p id={`${id}-error`} className="flex gap-1.5 text-xs leading-relaxed text-danger">
          <span aria-hidden="true">↳</span>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  )
}

export function Field({
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
  /** Message for THIS field. The form decides which field gets it. */
  error?: string
  labelAside?: ReactNode
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} id={id} hint={hint} error={error} labelAside={labelAside}>
      <input
        id={id}
        aria-describedby={describedBy(id, hint, error)}
        // Programmatic, not just a red edge — colour alone is not a signal.
        aria-invalid={error ? true : undefined}
        className={`${AUTH_INPUT_CLASS}${error ? ` ${AUTH_INPUT_INVALID_CLASS}` : ''}`}
        {...props}
      />
    </FieldShell>
  )
}
