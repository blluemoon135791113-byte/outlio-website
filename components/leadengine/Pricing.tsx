import Link from 'next/link'

import { BookingModal } from '@/components/leadengine/BookingModal'

/**
 * Pricing — a CREDIT model billed by LEAD.
 *
 * Credits buy EXTRACTION, and downloading the CSV is free. One run costs
 * ceil(total_leads / leads_per_credit) with leads_per_credit = 25 on every
 * plan, counted across the whole run rather than per file.
 *
 * These numbers mirror `plans.limits` seeded in migration 0030; if you change
 * one, change the other. The app reads limits from the database at runtime and
 * never from this file.
 *
 * Lead ceilings are simply credits × 25:
 *   starter       100 × 25 =  2,500
 *   professional  300 × 25 =  7,500
 *   custom       1000 × 25 = 25,000
 */

type Tier = {
  key: string
  name: string
  blurb: string
  price: string
  period: string
  credits: string
  /** Monthly lead ceiling at full batches. */
  leads: string
  features: string[]
  cta: { label: string; href: string; external?: boolean }
  featured?: boolean
  badge?: string
}

const TIERS: Tier[] = [
  {
    key: 'starter',
    name: 'Lead Engine',
    blurb: 'For steady, weekly prospecting.',
    price: '$28/month',
    period: 'or $245/year',
    credits: '100 credits',
    leads: '2,500',
    features: [
      '**1 credit per 25 leads** — counted across the whole run',
      'Charged by leads, **never by files**',
      '**No daily limit** — extract as often as you like',
      'Duplicate removal across every upload',
      'Free CSV export — downloads never cost credits',
    ],
    cta: { label: 'See monthly & yearly prices', href: '/leadengine/pricing' },
  },
  {
    key: 'professional',
    name: 'Pro',
    blurb: 'For teams running lists every day.',
    price: '$43/month',
    period: 'or $380/year',
    credits: '300 credits',
    leads: '7,500',
    features: [
      '**1 credit per 25 leads** — the same rate, three times the volume',
      '**30 files** per batch',
      'Everything in Lead Engine',
      'Longer export retention (90 days)',
      'Priority support',
    ],
    cta: { label: 'See monthly & yearly prices', href: '/leadengine/pricing' },
    featured: true,
    badge: 'Most popular',
  },
  {
    key: 'custom',
    name: 'Pro + Hubble',
    blurb: 'For agencies and high-volume teams.',
    price: '$69/month',
    period: 'or $612/year',
    credits: '1000+ credits',
    leads: '25,000+',
    features: [
      '**1 credit per 25 leads** — same rule, no ceiling we cannot raise',
      '**50 files** per batch',
      'Everything in Pro plus Hubble intelligence',
      'Retention and limits set with you',
      'Direct line to the team',
    ],
    cta: { label: 'See monthly & yearly prices', href: '/leadengine/pricing' },
  },
]

/** Renders **bold** segments without dangerouslySetInnerHTML. */
function RichText({ value }: { value: string }) {
  const parts = value.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className="font-semibold text-ink">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

export function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-20 bg-paper px-4 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
            Pricing
          </p>
          <h2 className="mt-4 text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
            Simple credits. Predictable cost.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            One credit covers 25 leads, counted across the whole run — so you pay
            for what you extract, not for how many files it arrived in.
            Downloading your CSV is always free.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.key}
              className={
                tier.featured
                  ? 'relative flex flex-col rounded-[var(--radius-xl)] border-2 border-accent bg-panel p-8 shadow-[var(--shadow-lg)]'
                  : 'relative flex flex-col rounded-[var(--radius-xl)] border border-border bg-panel p-8'
              }
            >
              {tier.badge ? (
                <span className="absolute -top-3 left-8 rounded-full bg-accent px-3 py-0.5 text-[11px] font-bold uppercase tracking-[0.16em] text-cream">
                  {tier.badge}
                </span>
              ) : null}

              <h3 className="text-2xl font-bold tracking-tight">{tier.name}</h3>
              <p className="mt-1.5 text-sm text-muted">{tier.blurb}</p>

              <p className="mt-6 flex items-baseline gap-2">
                <span className="text-3xl font-black tracking-tight">{tier.price}</span>
                <span className="text-base font-medium text-muted">{tier.period}</span>
              </p>

              <p className="mt-2 inline-flex w-fit rounded-full bg-accent-soft px-3 py-1 text-[12px] font-bold uppercase tracking-[0.14em] text-accent">
                {tier.credits}
              </p>

              <p className="mt-4 border-t border-border pt-4 text-lg font-bold tracking-tight text-ink">
                {tier.leads} leads
                <span className="ml-1.5 text-sm font-medium text-muted">a month</span>
              </p>

              <ul className="mt-7 flex-1 space-y-3 text-base">
                {tier.features.map((f) => (
                  <li key={f} className="flex gap-2.5 text-muted">
                    <Tick />
                    <span>
                      <RichText value={f} />
                    </span>
                  </li>
                ))}
              </ul>

              {/* CTA centred within the card, per spec. */}
              <div className="mt-8 flex justify-center">
                <Link
                  href={tier.cta.href}
                  target={tier.cta.external ? '_blank' : undefined}
                  rel={tier.cta.external ? 'noopener noreferrer' : undefined}
                  className={
                    tier.featured
                      ? 'w-full rounded-[var(--radius-md)] bg-accent px-5 py-3 text-center text-base font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep'
                      : 'w-full rounded-[var(--radius-md)] border border-ink px-5 py-3 text-center text-base font-semibold text-ink transition-colors duration-150 hover:bg-cream'
                  }
                >
                  {tier.cta.label}
                </Link>
              </div>
            </div>
          ))}
        </div>

        {/*
          The long credit explainer lived here. It now sits in the product, on
          the dashboard and the upload page, where a customer is actually
          spending credits. The per-card lines carry what a prospect needs, and
          this slot books a call instead.
        */}
        <BookingModal />

        <p className="mt-10 text-center text-sm text-muted">
          Lead totals are your credits × 25, and a part-full page still costs one credit.
          Credits are charged once a run is processed, so you always pay for the leads
          actually found. The{' '}
          <strong className="font-semibold text-ink">3-day free trial</strong> includes
          10 credits — 250 leads — and 5 files per batch. A payment method is
          required, but you are not charged until the trial ends.
        </p>

        <p className="mt-3 text-center text-sm text-muted">
          Access is approved manually so we can keep an eye on how the tool is used.
          You will normally hear back the same day.
        </p>
      </div>
    </section>
  )
}

function Tick() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="mt-1 h-4 w-4 shrink-0 text-accent"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
        clipRule="evenodd"
      />
    </svg>
  )
}
