'use client'

import { useFormStatus } from 'react-dom'

/**
 * Submit button with a designed pending state.
 *
 * Motion is 150ms per docs/DESIGN_TOKENS.md §8 — the landing page's 500ms
 * overshoot curve reads as latency on functional surfaces.
 */
export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="w-full rounded-[var(--radius-md)] bg-accent px-4 py-3 text-sm font-semibold text-cream shadow-[var(--shadow-button)] transition-[background-color,box-shadow,transform] duration-150 hover:bg-accent-deep active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Working…' : children}
    </button>
  )
}
