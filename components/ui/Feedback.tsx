/**
 * Form feedback, and the empty state.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ MEASURED: 94 `role="alert"` / `role="status"` BLOCKS WRITTEN WITH 31  ║
 * ║  DIFFERENT CLASS STRINGS.                                                 ║
 * ║                                                                           ║
 * ║  Every server action in this product ends the same way — a success line,  ║
 * ║  an error line — and each one was styled locally. That is 31 chances to   ║
 * ║  get the role wrong, and the role is the part that matters: `alert` is    ║
 * ║  announced immediately and interrupts, `status` is announced politely.    ║
 * ║  Reversing them either makes a success message shout over whatever the    ║
 * ║  user was reading, or leaves a failure silent.                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import type { ReactNode } from 'react'

export type FormMessageProps = {
  /**
   * ⚠️ THE TONE PICKS THE ARIA ROLE, so they cannot disagree. A component that
   * took `role` and `className` separately would allow a red error rendered as
   * a polite `status`, which is exactly the combination a screen-reader user
   * never hears.
   */
  tone: 'error' | 'success' | 'warning'
  children: ReactNode
  className?: string
}

const TONE: Record<FormMessageProps['tone'], { role: 'alert' | 'status'; text: string }> = {
  // Interrupts. Something failed and the user is about to act on stale belief.
  error: { role: 'alert', text: 'text-danger' },
  // Polite. Confirms what they just did; it must not talk over them.
  success: { role: 'status', text: 'text-muted' },
  /*
   * ⚠️ WARNING IS POLITE, NOT AN ALERT. In this product a warning is almost
   * always "it worked, but the evidence underneath it is thin" — the
   * unconfirmed-outcome case. That is context, not an interruption.
   */
  warning: { role: 'status', text: 'text-warning' },
}

export function FormMessage({ tone, children, className }: FormMessageProps) {
  const spec = TONE[tone]
  return (
    <p role={spec.role} className={['text-xs leading-relaxed', spec.text, className].filter(Boolean).join(' ')}>
      {children}
    </p>
  )
}

export type EmptyStateProps = {
  /** What is absent, in the product's own words. */
  title: string
  /**
   * ⚠️ REQUIRED, NOT OPTIONAL — AND THAT IS THE POINT OF THE COMPONENT.
   *
   * There are 36 empty states in this product and the good ones all do the same
   * thing: they explain what the thing IS, so a first-time user learns the
   * interface from the screen that has nothing on it. "No campaigns yet" alone
   * is a dead end; making the explanation impossible to omit is the cheapest
   * way to keep the next one from being one.
   */
  body: ReactNode
  /** The action that resolves it, when there is one. */
  action?: ReactNode
  className?: string
}

/**
 * ⚠️ NO ILLUSTRATION AND NO ICON. The craft floor refuses "same-size cards of
 * icon plus heading plus text as the page structure", and a decorative glyph
 * above every empty state is that pattern arriving one screen at a time. The
 * dashed border already says "this is a container with nothing in it".
 *
 * ⚠️ `border-dashed` RATHER THAN THE `clay` SHADOW, deliberately. A raised
 * surface says "here is some content"; a dashed outline says "content belongs
 * here and is missing", which is the actual message.
 */
export function EmptyState({ title, body, action, className }: EmptyStateProps) {
  return (
    <div
      className={[
        'rounded-[var(--radius-lg)] border border-dashed border-line px-6 py-10 text-center',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {/*
        ⚠️ `max-w-md` AND CENTRED. Empty-state copy explains something, so it is
        prose and takes prose measure — the craft floor's 65–75ch. Full-width at
        1280px this runs past 110ch and reads like a paragraph nobody finished.
      */}
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}

export type StatProps = {
  label: string
  value: string
  /** Dimmed — for "not enough data" and other non-numbers. */
  muted?: boolean
  /** Warning-toned — for a figure the reader should not trust at face value. */
  warn?: boolean
}

/**
 * One label-and-number pair.
 *
 * ⚠️ `tabular-nums` IS THE WHOLE REASON THIS IS A COMPONENT. Proportional
 * figures change width per digit, so a row of stats jitters horizontally
 * whenever a count ticks over and a column of them fails to align at all. It is
 * one class, it is invisible until it is missing, and the craft floor names it
 * as among the cheapest signals that a page was built rather than assembled.
 *
 * ⚠️ AND THE LABEL IS NOT A `<dt>` HERE — the caller supplies the `<dl>`. A
 * component that rendered its own list wrapper could not be used in a row of
 * siblings, which is the only way stats appear.
 */
export function Stat({ label, value, muted, warn }: StatProps) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</dt>
      <dd
        className={`mt-0.5 text-sm tabular-nums ${
          warn ? 'text-warning' : muted ? 'text-muted' : 'text-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
