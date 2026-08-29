const SIZE_CLASS = {
  nav: 'h-[18px] w-[18px]',
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
} as const

/**
 * Hubble's telescope/orbit mark, redrawn as interface-scale vector artwork.
 *
 * The original supplied PNG remains the source artwork. Rendering the mark as
 * SVG here avoids raster downsampling and keeps its lines as crisp as the
 * adjacent wordmark at every supported size.
 */
export function HubbleLogo({
  size = 'md',
  priority: _priority = false,
  className = '',
}: {
  size?: keyof typeof SIZE_CLASS
  /** Kept for compatibility with the former Next Image implementation. */
  priority?: boolean
  className?: string
}) {
  const compact = size === 'nav'

  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 text-ink ${SIZE_CLASS[size]} ${className}`}
    >
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-full"
        focusable="false"
      >
        <g
          stroke="currentColor"
          strokeWidth={compact ? 4.4 : 3.1}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Broken orbital shell */}
          <path d="M16 63A38 38 0 0 1 69 14" />
          <path d="M80 22A38 38 0 0 1 86 57" />
          <path d="M84 70A38 38 0 0 1 27 86" />

          {/* Telescope body */}
          <g transform="rotate(45 52 45)">
            <rect x="43" y="23" width="18" height="45" rx="9" fill="var(--background, #fff)" />
            <ellipse cx="52" cy="24" rx="9" ry="5.5" fill="var(--background, #fff)" />
            <ellipse cx="52" cy="24" rx="4.2" ry="2.55" fill="currentColor" stroke="none" />
            {!compact && <path d="M43 49H61M43 59H61" />}
          </g>

          {/* Foreground orbit */}
          <path d="M15 65C27 54 66 44 84 47" />
          <path d="M89 50C99 59 76 76 49 81C28 85 13 79 15 68" />

          {!compact && (
            <>
              {/* Telescope antenna */}
              <path d="M43 48V36" />

              {/* Solar panels */}
              <path d="M26 49L36 51L40 59L30 57Z" fill="currentColor" stroke="none" />
              <path d="M31 61L41 63L45 71L35 69Z" fill="currentColor" stroke="none" />
              <path d="M66 58L75 56L80 63L70 65Z" fill="currentColor" stroke="none" />
              <path d="M72 68L81 66L85 73L76 75Z" fill="currentColor" stroke="none" />
            </>
          )}
        </g>

        {/* Orbital nodes */}
        <circle cx="75" cy="18" r={compact ? 5 : 4.3} fill="currentColor" />
        <circle cx="57" cy="78" r={compact ? 4.5 : 3.7} fill="currentColor" />
        {!compact && <circle cx="43" cy="35" r="3.5" fill="currentColor" />}
      </svg>
    </span>
  )
}
