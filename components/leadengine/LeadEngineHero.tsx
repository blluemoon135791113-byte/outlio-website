'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { OrbitalHeroSection } from '@/components/ui/orbital-hero-section'

/**
 * Keep the orbital composition intentional on narrow screens. The canvas
 * needs different focal and scrim directions when the copy and artwork can no
 * longer sit side by side; CSS alone cannot change those renderer props.
 */
function useNarrow(query = '(max-width: 767px)') {
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    const media = window.matchMedia(query)
    const sync = () => setNarrow(media.matches)

    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [query])

  return narrow
}

/**
 * Lead Engine's first impression: product copy laid over the supplied orbital
 * canvas. The canvas explains the idea of continuously moving intelligence;
 * the copy stays on a deliberately quiet, scrimmed edge rather than competing
 * with it.
 */
export function LeadEngineHero() {
  const narrow = useNarrow()

  return (
    <section className="bg-black text-white">
      <div className="relative min-h-[92svh] w-full md:min-h-[720px]">
        <OrbitalHeroSection
          focus={narrow ? [0.5, 0.86] : [0.74, 0.42]}
          scrim={narrow ? 'top' : 'left'}
          scrimStrength={narrow ? 0.94 : 0.92}
          viewRadius={narrow ? 2.1 : 3.1}
          lead={narrow ? 0.05 : 0.12}
          glow={narrow ? 0.5 : 1}
          starCount={narrow ? 850 : 1500}
          interactive={!narrow}
        >
          <div className="mx-auto flex h-full min-h-[92svh] w-full max-w-[1800px] items-start px-6 pb-16 pt-16 sm:px-10 md:min-h-[720px] md:items-center md:py-20 lg:px-[121px]">
            <div className="max-w-[35rem]">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60">
                Lead Engine
              </p>

              <h1 className="mt-5 text-balance font-heading text-[clamp(2.75rem,5.6vw,5.25rem)] font-light leading-[0.98] tracking-[-0.045em] text-white">
                Further Beyond
              </h1>

              <p className="mt-7 max-w-[34rem] text-pretty font-heading text-[1.0625rem] font-medium leading-[1.65] text-white/72 sm:text-lg">
                Outlio channels your Sales Navigator data, enriches it with
                AI-driven intelligence on every scale, and lands it in your
                systems. What arrives is the signal, clear of noise.
              </p>

              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link
                  href="/sign-in"
                  className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 font-heading text-sm font-semibold text-black transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-white/90 active:scale-[0.97]"
                >
                  Sign in
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-4"
                  >
                    <path d="M7 17 17 7" />
                    <path d="M8 7h9v9" />
                  </svg>
                </Link>

                <Link
                  href="#how-it-works"
                  className="inline-flex h-12 items-center rounded-full border border-white/25 px-6 font-heading text-sm font-medium text-white/85 transition-[transform,border-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-white/50 hover:text-white active:scale-[0.97]"
                >
                  See how it works
                </Link>
              </div>
            </div>
          </div>
        </OrbitalHeroSection>
      </div>

    </section>
  )
}
