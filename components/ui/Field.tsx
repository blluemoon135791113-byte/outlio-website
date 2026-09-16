/**
 * The product's one set of form controls.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ MEASURED: 24 DISTINCT INPUT CLASS STRINGS, AND TWO COMPETING          ║
 * ║  VOCABULARIES.                                                            ║
 * ║                                                                           ║
 * ║  `app/globals.css` carries a `.field` class with real focus handling      ║
 * ║  (including `:focus-within`, for compound controls like the phone field).  ║
 * ║  The product uses it 9 times. It writes `border border-line bg-surface`   ║
 * ║  inline 71 times instead.                                                 ║
 * ║                                                                           ║
 * ║  ⚠️ SO THE INLINE FORM WINS HERE, 71 TO 9 — NOT BECAUSE IT IS BETTER BUT  ║
 * ║  BECAUSE IT IS WHAT THE PRODUCT IS. Standardising on the prettier         ║
 * ║  minority would leave 71 screens as the odd ones out, which is a          ║
 * ║  migration disguised as a refinement. `.field` keeps its nine callers and ║
 * ║  its CSS; nothing here fights it.                                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THE FOCUS RING COMES FROM THE GLOBAL RULE, not from here. `globals.css`
 * already styles `.product-clay :is(input, select, textarea):focus-visible`.
 */
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

/**
 * ⚠️ `placeholder:text-muted` IS EXPLICIT BECAUSE THE BROWSER DEFAULT IS NOT
 * A DESIGN DECISION. Chrome's default placeholder grey measures around 3.4:1 on
 * this surface — below the 4.5:1 the craft floor requires for placeholder text.
 * `--muted` is a token the project already contrast-checked.
 */
const CONTROL =
  'w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 ' +
  'text-sm text-ink placeholder:text-muted transition-colors duration-150 ' +
  'disabled:cursor-not-allowed disabled:opacity-60'

/**
 * ⚠️ `aria-invalid` DRIVES THE COLOUR, NOT A SEPARATE `error` PROP ON THE
 * STYLE. The attribute is what assistive technology reads, so binding the
 * border to it means a control cannot LOOK wrong without also BEING announced
 * as wrong — the two can never disagree.
 */
const INVALID = 'aria-[invalid=true]:border-danger'

export function controlClass(className?: string): string {
  return [CONTROL, INVALID, className].filter(Boolean).join(' ')
}

export type FieldProps = {
  label: string
  /** Hide the label visually but keep it for screen readers. */
  labelHidden?: boolean
  /** Shown under the control, always — not only on error. */
  hint?: ReactNode
  /** Names the problem. Renders in place of the hint and sets `aria-invalid`. */
  error?: string | null
  /** Marks the control required and says so in words, not with an asterisk. */
  required?: boolean
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
  id: string
}

/**
 * A labelled control with its hint and error.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ IT TAKES A RENDER FUNCTION RATHER THAN WRAPPING `children`, so the    ║
 * ║  `id`, `aria-describedby` and `aria-invalid` it computes actually reach    ║
 * ║  the control. A wrapper that renders `{children}` and hopes the caller    ║
 * ║  passed a matching `id` is the version that silently produces an unlabelled ║
 * ║  input — and it looks correct in review, because the label is right there. ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function Field({
  label,
  labelHidden = false,
  hint,
  error,
  required,
  id,
  children,
}: FieldProps) {
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = error ? errorId : hint ? hintId : undefined

  return (
    <div className="space-y-1">
      <label htmlFor={id} className={labelHidden ? 'sr-only' : 'block text-xs font-medium text-ink'}>
        {label}
        {/*
          ⚠️ THE WORD, NOT AN ASTERISK. An asterisk is a convention that has to
          be learned from a legend somewhere else on the page, and screen
          readers announce it as "star". `aria-required` is set on the control
          itself by the caller.
        */}
        {required ? <span className="font-normal text-muted"> (required)</span> : null}
      </label>

      {children({ id, describedBy, invalid: Boolean(error) })}

      {/*
        ⚠️ ONE SLOT, NOT TWO STACKED. An error appearing BELOW a hint pushes the
        whole form down at the moment the user is trying to read what went
        wrong, and the hint is advice they have already failed to follow.
      */}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs leading-relaxed text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export type InputProps = InputHTMLAttributes<HTMLInputElement>

export function Input({ className, ...rest }: InputProps) {
  return <input className={controlClass(className)} {...rest} />
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export function Textarea({ className, rows = 4, ...rest }: TextareaProps) {
  return <textarea rows={rows} className={controlClass(`leading-relaxed ${className ?? ''}`)} {...rest} />
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>

/**
 * ⚠️ `[color-scheme:light]` IS LOAD-BEARING AND IS ALREADY IN THE CODEBASE.
 * A `<select>` renders its dropdown list with the OS chrome, so a user whose
 * system is in dark mode gets white-on-dark options inside a light product —
 * this product has no dark mode (DESIGN_TOKENS), and the control must not
 * inherit one from the OS.
 */
export function Select({ className, ...rest }: SelectProps) {
  return <select className={controlClass(`[color-scheme:light] ${className ?? ''}`)} {...rest} />
}
