import type { InputHTMLAttributes } from 'react'

/**
 * Labelled input. Real <label for>, visible focus ring inherited from
 * :focus-visible in globals.css, and hint text wired via aria-describedby.
 */
export function Field({
  label,
  id,
  hint,
  ...props
}: { label: string; id: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const hintId = hint ? `${id}-hint` : undefined

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hintId}
        className="auth-clay-field w-full rounded-[var(--radius-md)] border-0 bg-clay-sunken px-3.5 py-2.5 text-base text-ink shadow-[var(--neo-shadow-inset)] transition-[box-shadow,transform] duration-150 placeholder:text-muted/65 disabled:cursor-not-allowed disabled:opacity-60"
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-xs leading-relaxed text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
