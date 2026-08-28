'use client'

/**
 * Lead and company avatars.
 *
 * A person gets a monogram — we hold no photographs and will not invent any.
 * A company gets its own favicon when we know its domain. See
 * `lib/intelligence/avatar.ts` for why.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE MONOGRAM IS ALWAYS RENDERED, AND THE FAVICON SITS ON TOP.        ║
 * ║                                                                          ║
 * ║  An `onError` handler is not enough. The image can fail BEFORE React     ║
 * ║  hydrates and attaches the handler — which is exactly what happened:     ║
 * ║  `complete: true, naturalWidth: 0`, and a broken-image glyph left on     ║
 * ║  screen with nothing to clear it.                                        ║
 * ║                                                                          ║
 * ║  Layering removes the failure mode instead of handling it. If the        ║
 * ║  favicon never paints, the monogram underneath is simply what shows.     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { useState } from 'react'

import { companyLogoUrl, initialsFor, tintFor } from '@/lib/intelligence/avatar'

const SIZES = {
  sm: 'h-9 w-9 text-[11px]',
  md: 'h-11 w-11 text-xs',
  lg: 'h-[72px] w-[72px] text-xl',
} as const

function Monogram({
  name,
  size,
  rounded,
}: {
  name: string | null
  size: keyof typeof SIZES
  rounded: string
}) {
  const tint = tintFor(name)

  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center font-semibold ${SIZES[size]} ${rounded}`}
      // Resolved from the token palette, not a literal in a colour position.
      style={{ backgroundColor: tint.bg, color: tint.fg }}
    >
      {initialsFor(name)}
    </span>
  )
}

export function PersonAvatar({
  name,
  size = 'md',
}: {
  name: string | null
  size?: keyof typeof SIZES
}) {
  return (
    /* The avatar is decorative: every current use renders the person's name
       beside it. Repeating that name in sr-only text made each row's accessible
       label sound like two merged people. */
    <span aria-hidden title={name ?? undefined} className="shrink-0">
      <Monogram name={name} size={size} rounded="rounded-full" />
    </span>
  )
}

export function CompanyAvatar({
  name,
  domain,
  size = 'md',
}: {
  name: string | null
  domain: string | null
  size?: keyof typeof SIZES
}) {
  const [loaded, setLoaded] = useState(false)
  const src = companyLogoUrl(domain, size === 'lg' ? 128 : 64)

  return (
    <span className={`relative inline-flex shrink-0 ${SIZES[size]}`} title={name ?? undefined}>
      <Monogram name={name} size={size} rounded="rounded-[var(--radius-lg)]" />

      {src ? (
        /*
         * A third-party favicon, not an asset we host. next/image would proxy
         * and cache someone else's logo on our infrastructure.
         *
         * ⚠️ The directive must be the LAST line before the element. It was
         * written as the first of three comment lines, so `next-line` pointed
         * at the comment continuation and suppressed nothing — eslint reported
         * both an unused directive and the warning it was meant to silence.
         */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          /*
           * Our URLs must not travel with this. The request already reveals the
           * domain being viewed; it should reveal nothing else.
           */
          referrerPolicy="no-referrer"
          /*
           * Only shown once it has genuinely painted. `naturalWidth` is the
           * check that matters — a blocked request still reports `complete`.
           */
          onLoad={(event) => setLoaded(event.currentTarget.naturalWidth > 0)}
          onError={() => setLoaded(false)}
          className={`absolute inset-0 h-full w-full rounded-[var(--radius-lg)] bg-clay-raised object-contain p-1.5 transition-opacity duration-150 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ) : null}
    </span>
  )
}
