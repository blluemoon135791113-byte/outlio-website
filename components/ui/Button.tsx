/**
 * The product's one button.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ MEASURED BEFORE IT WAS WRITTEN: 148 DISTINCT BUTTON CLASS STRINGS     ║
 * ║  ACROSS THE AUTHENTICATED PRODUCT.                                        ║
 * ║                                                                           ║
 * ║  Not 148 buttons — 148 distinct *definitions* of the same few buttons.    ║
 * ║  The primary action alone appeared as `font-semibold` and `font-medium`,  ║
 * ║  at `px-3 py-1.5 text-xs`, `px-4 py-2 text-sm` and `px-3 py-2 text-sm`,  ║
 * ║  with `rounded-[var(--radius-md)]` and `rounded-clay`.                    ║
 * ║                                                                           ║
 * ║  The Operate rule this breaks is stated plainly: "If the save button      ║
 * ║  looks different in two places, one is wrong." Here it looked different   ║
 * ║  in 148, and no reviewer could have held them all in their head.          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THIS CODIFIES THE DOMINANT EXISTING PATTERN RATHER THAN INVENTING ONE.
 * The shapes, sizes and tokens below are the ones already most used, because
 * this is a refinement of a shipped product — a new vocabulary would mean every
 * unmigrated screen is now the odd one out.
 *
 * ⚠️ WITH EXACTLY ONE DELIBERATE CORRECTION: A FILLED BUTTON DARKENS ON HOVER,
 * IT NEVER FADES.
 *
 * (And the script that applied that correction across 26 files rewrote this
 * very paragraph, because the prose describing the defect contained the defect.
 * Same trap this repository keeps paying for: always strip or exclude comments
 * before matching source.)
 *
 * A fading hover appeared on 42 filled buttons and `hover:bg-accent-deep` on 32
 * — the same component, split down the middle. They are not equivalent.
 * Fading a filled button blends it toward the page, so the contrast between
 * label and background DROPS at the moment the pointer arrives: hover says
 * "less available" when it should say "more". `--accent-deep` exists for this,
 * and CLAUDE.md records it contrast-measured at 6.70 on `--panel`.
 *
 * ⚠️ THE FOCUS RING IS NOT SET HERE, ON PURPOSE. `app/globals.css` already
 * carries a global `:focus-visible { outline: 2px solid var(--focus) }` with an
 * accent-coloured variant for product buttons. Re-declaring it per component is
 * how a product ends up with four focus rings; the 34 scattered
 * `focus-visible:border-accent` usages are that happening already.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

/**
 * ⚠️ `transition-colors`, NOT `transition-all`. `all` animates layout
 * properties too, so a button that changes padding or border width on hover
 * animates its own geometry and drags the row with it. 150ms is the project's
 * motion cap (DESIGN_TOKENS) and sits at the fast end of Operate's 150–250ms —
 * correct here, because the user is mid-task and not watching choreography.
 */
const BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] ' +
  'font-semibold whitespace-nowrap transition-colors duration-150 ' +
  /*
   * ⚠️ `cursor-not-allowed` IS PART OF THE DISABLED STATE AND WAS MISSING
   * EVERYWHERE. The existing pattern is `disabled:opacity-60` alone, which
   * dims the button while the pointer still says "clickable" — so a user
   * clicks a greyed control repeatedly and nothing acknowledges them.
   */
  'disabled:cursor-not-allowed disabled:opacity-60'

const VARIANT: Record<ButtonVariant, string> = {
  // Darkens, never fades. See the banner.
  primary: 'bg-accent text-cream hover:bg-accent-deep',
  /*
   * ⚠️ THE SECONDARY LIFTS TOWARD THE SURFACE RATHER THAN FADING. `bg-surface`
   * is lighter than `bg-surface-muted`, so this is the same "more available"
   * direction as the primary darkening — the two hovers agree instead of each
   * being a local guess.
   */
  secondary: 'bg-surface-muted text-ink hover:bg-surface',
  outline: 'border border-border text-ink hover:bg-surface-muted',
  ghost: 'text-muted hover:bg-surface-muted hover:text-ink',
  /*
   * ⚠️ A GHOST-WEIGHT DANGER, NOT A FILLED RED ONE. Destructive actions in this
   * product sit beside ordinary ones in dense rows ("Remove", "Erase"), and a
   * filled red button in that position reads as the primary action on the row.
   * The colour arrives on hover, when the pointer has already committed.
   */
  danger: 'text-muted hover:bg-danger-soft hover:text-danger',
}

/**
 * ⚠️ TWO SIZES, NOT FIVE. The measured usage clustered at exactly two — a
 * dense inline control and a form's submit — and every other combination in
 * those 148 strings was a one-off. A third size invites the drift back.
 *
 * `sm` computes to 28px tall, above WCAG 2.5.8 AA's 24×24 target minimum.
 */
const SIZE: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
}

export function buttonClass(
  options: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {},
): string {
  const { variant = 'primary', size = 'sm', className } = options
  return [BASE, VARIANT[variant], SIZE[size], className].filter(Boolean).join(' ')
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /**
   * In flight. Disables the button and swaps the label.
   *
   * ⚠️ A LABEL SWAP RATHER THAN A SPINNER, which is the pattern the product
   * already uses ("Saving…", "Analysing…"). It says WHICH action is in flight,
   * survives `prefers-reduced-motion` with nothing to disable, and does not
   * change the button's width enough to move the row it sits in.
   */
  pending?: boolean
  pendingLabel?: string
  children: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'sm',
  pending = false,
  pendingLabel,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      // ⚠️ DEFAULTS TO `button`. An unspecified `type` inside a form is
      // `submit`, so a "Write with AI" toggle would post the form instead.
      type={type}
      disabled={disabled || pending}
      /*
       * ⚠️ `aria-busy` AS WELL AS THE LABEL. A screen reader user who has
       * already moved focus past the button hears nothing from a visual text
       * swap; `aria-busy` is what a live region can announce.
       */
      aria-busy={pending || undefined}
      className={buttonClass({ variant, size, className })}
      {...rest}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  )
}
