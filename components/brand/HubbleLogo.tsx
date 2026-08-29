import Image from 'next/image'

const SIZE_CLASS = {
  nav: 'h-[18px] w-[18px]',
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
} as const

/**
 * The supplied Hubble telescope mark, optically cropped for interface use.
 *
 * The source artwork intentionally has a generous white canvas. Enlarging it
 * inside an overflow-hidden square makes the visible orbit—not the source
 * canvas—the sizing reference. `mix-blend-multiply` lets that white disappear
 * into Outlio's cream/clay surfaces while preserving the exact black artwork.
 */
export function HubbleLogo({
  size = 'md',
  priority = false,
  className = '',
}: {
  size?: keyof typeof SIZE_CLASS
  priority?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 overflow-hidden ${SIZE_CLASS[size]} ${className}`}
    >
      <Image
        src="/brand/hubble-logo-ui.png"
        alt=""
        width={884}
        height={884}
        preload={priority}
        unoptimized
        sizes="48px"
        className="h-full w-full object-cover mix-blend-multiply"
      />
    </span>
  )
}
