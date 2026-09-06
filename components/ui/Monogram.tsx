/**
 * The initials block that anchors a record in a list.
 *
 * ⚠️ DECORATIVE, AND MARKED AS SUCH. It repeats the name rendered beside it, so
 * a screen reader announcing "R V, Raghunath Vijayaraghavan" would read every
 * row twice. `aria-hidden` is the point of this component being separate from
 * the name.
 *
 * ⚠️ THE TINT IS DERIVED, NOT RANDOM. The same person is the same colour on
 * every page and after every reload, which is what makes a monogram scannable
 * at all — a colour that changes per render is noise wearing the costume of
 * information.
 */
const TINTS = [
  'bg-accent-soft text-accent',
  'bg-info-soft text-info',
  'bg-success-soft text-success',
  'bg-warning-soft text-warning',
  'bg-surface-muted text-ink',
] as const

/** A stable index for a string. Not a hash — just needs to be deterministic. */
function tintFor(seed: string): string {
  let total = 0
  for (let i = 0; i < seed.length; i += 1) total = (total + seed.charCodeAt(i)) % 997
  return TINTS[total % TINTS.length]!
}

export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '—'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return `${words[0]![0]}${words[words.length - 1]![0]}`.toUpperCase()
}

export function Monogram({
  name,
  size = 'md',
  square = false,
}: {
  name: string | null | undefined
  size?: 'sm' | 'md'
  /** Companies read as squares, people as circles — the shape IS the type. */
  square?: boolean
}) {
  const label = initialsOf(name)

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center font-semibold ${
        size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-[11px]'
      } ${square ? 'rounded-[var(--radius-sm)]' : 'rounded-full'} ${tintFor(
        name ?? 'unknown',
      )}`}
    >
      {label}
    </span>
  )
}
