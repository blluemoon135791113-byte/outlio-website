import Link from 'next/link'

/**
 * Pricing — a CREDIT model.
 *
 * Credits buy EXTRACTION. One run costs ceil(files / files_per_credit), and
 * downloading the CSV is free. These numbers mirror `plans.limits` seeded in
 * migrations 0015 and 0027; if you change one, change the other. The app reads
 * limits from the database at runtime and never from this file.
 *
 * Lead ceilings below are credits ÷ cost-of-a-full-batch × files × LEADS_PER_PAGE:
 *   starter       100 ÷ 2 =  50 runs × 10 files × 25 =  12,500
 *   professional  300 ÷ 3 = 100 runs × 30 files × 25 =  75,000
 *   custom       1000 ÷ 5 = 200 runs × 50 files × 25 = 250,000
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
  cta: { label: string; href: string }
  featured?: boolean
  badge?: string
}

const TIERS: Tier[] = [
  {
    key: 'starter',
    name: 'Lead Engine',
    blurb: 'For steady, weekly prospecting.',
    price: '$38',
    period: '/ month',
    credits: '100 credits',
    leads: '12,500',
    features: [
      '**10 files** per batch — 1 credit per 5 files',
      'Roughly 25 leads per Sales Navigator page',
      'Duplicate removal across every upload',
      'Free CSV export — downloads never cost credits',
    ],
    cta: { label: 'Convert your first list free', href: '/sign-up' },
  },
  {
    key: 'professional',
    name: 'Pro',
    blurb: 'For teams running lists every day.',
    price: '$73',
    period: '/ month',
    credits: '300 credits',
    leads: '75,000',
    features: [
      '**30 files** per batch — 1 credit per 10 files',
      'Everything in Lead Engine',
      'Longer export retention (90 days)',
      'Priority support',
    ],
    cta: { label: 'Get Pro plan', href: '/sign-up?plan=professional' },
    featured: true,
    badge: 'Most popular',
  },
  {
    key: 'custom',
    name: 'Custom',
    blurb: 'For agencies and high-volume teams.',
    price: '1000+',
    period: 'credits',
    credits: '1000+ credits',
    leads: '250,000+',
    features: [
      '**50 files** per batch — 1 credit per 10 files',
      'Everything in Pro',
      'Retention and limits set with you',
      'Direct line to the team',
    ],
    cta: { label: 'Contact us', href: 'mailto:husnain@outlio.io?subject=Outlio%20Lead%20Engine%20Custom%20plan' },
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
            Credits buy extraction, and downloading your CSV is always free.
            Start free, then choose a monthly allowance that matches your workflow.
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
                <span className="text-5xl font-black tracking-tight">{tier.price}</span>
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

        <div className="mx-auto mt-10 max-w-2xl rounded-[var(--radius-lg)] border border-border bg-panel p-5">
          <h3 className="text-base font-semibold text-ink">How credits work</h3>
          <ul className="mt-2.5 space-y-1.5 text-sm leading-relaxed text-muted">
            <li>
              <strong className="font-semibold text-ink">1 credit:</strong> a block of
              files in one run — 5 files on Lead Engine, 10 on Pro and Custom
            </li>
            <li>
              So a full batch costs{' '}
              <strong className="font-semibold text-ink">2 credits</strong> on Lead
              Engine, <strong className="font-semibold text-ink">3</strong> on Pro and{' '}
              <strong className="font-semibold text-ink">5</strong> on Custom. Smaller
              batches cost less.
            </li>
            <li>
              <strong className="font-semibold text-ink">Free:</strong> every CSV export.
              Downloading never costs a credit.
            </li>
            <li>Credits reset at the start of each month. Unused credits do not roll over.</li>
            <li>
              Lead totals assume full batches at roughly 25 leads per saved page.
            </li>
            <li>
              The <strong className="font-semibold text-ink">3-day free trial</strong>{' '}
              includes 10 credits and 5 files per batch. No card required.
            </li>
          </ul>
        </div>

        <p className="mt-8 text-center text-sm text-muted">
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
