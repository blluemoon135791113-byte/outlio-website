import Link from 'next/link'

import { SingularityHeroScene } from '@/components/ui/singularity-hero-scene'

/**
 * Lead Engine's first impression: product copy laid over the supplied hand and
 * singularity artwork, animated as a responsive interactive scene.
 */
export function LeadEngineHero() {
  return (
    <section className="min-h-[100svh] bg-black text-white">
      <div className="relative min-h-[100svh] w-full">
        <SingularityHeroScene className="min-h-[100svh]">
          <div className="mx-auto flex min-h-[100svh] w-full max-w-[1800px] items-start px-6 pb-16 pt-28 sm:px-10 sm:pt-32 md:items-center md:py-20 lg:px-[121px]">
            <div className="max-w-[35rem]">
              <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.2em] text-white/72">
                Lead Engine
              </p>

              <h1 className="mt-5 text-balance font-heading text-[clamp(2.75rem,5.6vw,5.25rem)] font-light leading-[0.98] tracking-[-0.045em] text-white">
                Further and Beyond
              </h1>

              <p className="mt-7 max-w-[34rem] text-pretty font-heading text-[1.0625rem] font-medium leading-[1.65] text-white/84 sm:text-lg">
                The lead engine channels a database of 1.3 billion people across
                the globe - in to your systems, enriched with our intelligence
                and clear of noise.
              </p>

              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link
                  href="/sign-up"
                  className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 font-heading text-sm font-semibold text-black transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-white/90 active:scale-[0.97]"
                >
                  Start free trial
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
                  href="/how-it-works"
                  className="inline-flex h-12 items-center rounded-full border border-white/25 px-6 font-heading text-sm font-medium text-white/85 transition-[transform,border-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-white/50 hover:text-white active:scale-[0.97]"
                >
                  See how it works
                </Link>
              </div>
            </div>
          </div>
        </SingularityHeroScene>
      </div>
    </section>
  )
}
