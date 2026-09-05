import Link from 'next/link'

import { BookingModal } from '@/components/leadengine/BookingModal'

import styles from './Pricing.module.css'

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
    cta: { label: 'See monthly & yearly prices', href: '/pricing' },
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
    cta: { label: 'See monthly & yearly prices', href: '/pricing' },
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
    cta: { label: 'See monthly & yearly prices', href: '/pricing' },
  },
]

/** Renders **bold** segments without dangerouslySetInnerHTML. */
function RichText({ value }: { value: string }) {
  const parts = value.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className={styles.featureStrong}>
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

type PricingProps = {
  ctaHref?: string
  ctaLabel?: string
}

type PlanPanelProps = Pick<PricingProps, 'ctaHref' | 'ctaLabel'> & {
  tier: Tier
}

export function Pricing({ ctaHref, ctaLabel }: PricingProps = {}) {
  return (
    <section id="pricing" className={styles.section} aria-labelledby="pricing-title">
      <div className={styles.container}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>
            Pricing
          </p>
          <h2 id="pricing-title" className={styles.heading}>
            A Model that Fits your Workflow
          </h2>
        </div>

        <div className={styles.pricingStrip}>
          <div className={styles.plansTrack}>
            {TIERS.map((tier) => (
              <HoverPlan
                key={tier.key}
                tier={tier}
                ctaHref={ctaHref}
                ctaLabel={ctaLabel}
              />
            ))}
          </div>
        </div>

        {/*
          The long credit explainer lived here. It now sits in the product, on
          the dashboard and the upload page, where a customer is actually
          spending credits. The per-card lines carry what a prospect needs, and
          this slot books a call instead.
        */}
        <BookingModal />
      </div>
    </section>
  )
}

function HoverPlan({
  tier,
  ctaHref,
  ctaLabel,
}: PlanPanelProps) {
  return (
    <article
      className={`${styles.planPanel} ${tier.featured ? styles.featuredPlan : ''}`}
    >
      <div className={styles.planIntro}>
        <header>
          <div className={styles.planTopline}>
            {tier.badge ? <span className={styles.badge}>{tier.badge}</span> : null}
            <span className={styles.drawerHint} aria-hidden>→</span>
          </div>
          <h3 className={styles.planName}>{tier.name}</h3>
          <p className={styles.planBlurb}>{tier.blurb}</p>
        </header>

        <div className={styles.priceBlock}>
          <p className={styles.price}>{tier.price}</p>
          <p className={styles.period}>{tier.period}</p>
        </div>

        <dl className={styles.planMetrics}>
          <PlanStat label="Credits" value={tier.credits} />
          <PlanStat label="Capacity" value={`${tier.leads} / month`} />
        </dl>

        <PlanLink
          tier={tier}
          ctaHref={ctaHref}
          ctaLabel={ctaLabel}
          featured={tier.featured}
        />
      </div>

      <div className={styles.planIncludes}>
        <div className={styles.includesInner}>
          <p className={styles.listLabel}>Plan Includes</p>
          <FeatureList tier={tier} />
        </div>
      </div>
    </article>
  )
}

function PlanStat({ label, value }: {
  label: string
  value: string
}) {
  return (
    <div className={styles.planStat}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function FeatureList({
  tier,
}: {
  tier: Tier
}) {
  return (
    <ul className={styles.features}>
      {tier.features.map((feature) => (
        <li key={feature}>
          <Tick />
          <span>
            <RichText value={feature} />
          </span>
        </li>
      ))}
    </ul>
  )
}

function PlanLink({
  tier,
  ctaHref,
  ctaLabel,
  featured = false,
}: PlanPanelProps & { featured?: boolean }) {
  return (
    <Link
      href={ctaHref ?? tier.cta.href}
      target={tier.cta.external ? '_blank' : undefined}
      rel={tier.cta.external ? 'noopener noreferrer' : undefined}
      className={`${styles.cta} ${featured ? styles.ctaFeatured : ''}`}
    >
      {ctaLabel ?? 'Get This'}
      <span aria-hidden>↗</span>
    </Link>
  )
}

function Tick() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className={styles.tick}
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
