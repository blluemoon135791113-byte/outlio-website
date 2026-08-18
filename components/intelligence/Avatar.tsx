'use client'

/**
 * Lead and company avatars.
 *
 * A person gets a monogram — we hold no photographs and will not invent any.
 * A company gets its own favicon when we know its domain, and the same monogram
 * when we do not. See `lib/intelligence/avatar.ts` for why.
 */
import { useState } from 'react'

import { companyLogoUrl, initialsFor, tintFor } from '@/lib/intelligence/avatar'

const SIZES = {
  sm: 'h-9 w-9 text-[11px]',
  md: 'h-11 w-11 text-xs',
  lg: 'h-20 w-20 text-2xl',
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
    <span title={name ?? undefined}>
      <Monogram name={name} size={size} rounded="rounded-full" />
      <span className="sr-only">{name ?? 'Unnamed lead'}</span>
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
  const [failed, setFailed] = useState(false)
  const src = failed ? null : companyLogoUrl(domain, size === 'lg' ? 128 : 64)

  if (!src) return <Monogram name={name} size={size} rounded="rounded-[var(--radius-lg)]" />

  /*
   * A third-party favicon, not an asset we host. `next/image` would proxy and
   * cache someone else's logo on our infrastructure, and optimising a 64px
   * icon buys nothing.
   */
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size === 'lg' ? 80 : 44}
      height={size === 'lg' ? 80 : 44}
      loading="lazy"
      decoding="async"
      /*
       * ⚠️ Our URLs must not travel to Google with this. The request already
       * reveals which domain is being viewed; it should reveal nothing else.
       */
      referrerPolicy="no-referrer"
      // A domain Google does not know returns a generic globe. Falling back to
      // the monogram is better than a globe on every unknown company.
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-[var(--radius-lg)] bg-clay-raised object-contain p-1.5 ${SIZES[size]}`}
    />
  )
}
