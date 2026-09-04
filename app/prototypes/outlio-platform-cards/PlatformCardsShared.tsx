import Image from 'next/image'

import { CALENDLY_URL } from '@/app/lib/constants'

import styles from './prototype.module.css'

export type PillarKey = 'outbound' | 'extraction' | 'intelligence'

export type Pillar = {
  key: PillarKey
  title: string
  description: string
  asset: string
  width: number
  height: number
  alt: string
  capabilities: readonly string[]
}

export const PILLARS: readonly Pillar[] = [
  {
    key: 'extraction',
    title: 'Safe Data Extraction',
    description:
      'Save Sales Navigator pages and turn them into structured, de-duplicated CRM records without sharing a LinkedIn password, storing session cookies, or letting Outlio navigate on your behalf.',
    asset: '/prototypes/outlio-platform-cards/safe-extraction-smooth-v5.png',
    width: 640,
    height: 656,
    alt: 'A smooth tilted blue data structure shaped like the number five',
    capabilities: ['User-saved pages', 'De-duplicated records', 'CRM-ready export'],
  },
  {
    key: 'outbound',
    title: 'Automated Outbound',
    description:
      'Connect your inboxes and build personalized campaigns from verified lead context. Outlio manages delivery, replies, bounces, and suppressions, while LinkedIn messages stay rep-reviewed before every manual send.',
    asset: '/prototypes/outlio-platform-cards/automated-outbound-clay-v3.png',
    width: 760,
    height: 297,
    alt: 'A smooth black three-dimensional waveform representing engagement signals',
    capabilities: ['Connected inboxes', 'Personalized campaigns', 'Reply handling'],
  },
  {
    key: 'intelligence',
    title: 'Intelligence',
    description:
      'Research companies and people across reputable sources, preserve citations, score account fit, assign clear owners, and move qualified leads through shared pipelines with complete context.',
    asset: '/prototypes/outlio-platform-cards/intelligence-smooth-v5.png',
    width: 680,
    height: 552,
    alt: 'A detailed ivory and olive intelligence architecture of connected modules',
    capabilities: ['Source-backed research', 'Account scoring', 'Pipeline ownership'],
  },
] as const

export function PlatformHeader() {
  return (
    <header className={styles.header}>
      <h1 id="platform-cards-title">Three systems. One complete outbound engine.</h1>
      <p className={styles.intro}>
        Capture lead data safely, turn it into cited intelligence, and activate it through
        user-controlled outreach—without stitching together a fragile stack.
      </p>
      <a className={styles.cta} href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">
        Book a demo <span aria-hidden="true">→</span>
      </a>
    </header>
  )
}

export function PillarObject({ pillar }: { pillar: Pillar }) {
  return (
    <div className={`${styles.objectStage} ${styles[`objectStage_${pillar.key}`]}`}>
      <Image
        src={pillar.asset}
        width={pillar.width}
        height={pillar.height}
        alt={pillar.alt}
        className={styles.objectImage}
        sizes="112px"
        priority
      />
    </div>
  )
}

export function FeatureCard({
  pillar,
  mode,
}: {
  pillar: Pillar
  mode: 'editorial' | 'ledger' | 'gallery'
}) {
  return (
    <article className={`${styles.card} ${styles[`card_${mode}`]}`} data-pillar={pillar.key}>
      <PillarObject pillar={pillar} />
      <div className={styles.cardCopy}>
        <h2>{pillar.title}</h2>
        <p>{pillar.description}</p>
      </div>
      {mode !== 'editorial' && (
        <ul className={styles.capabilities} aria-label={`${pillar.title} capabilities`}>
          {pillar.capabilities.map((capability) => <li key={capability}>{capability}</li>)}
        </ul>
      )}
    </article>
  )
}

export function CardsFrame({
  mode,
}: {
  mode: 'editorial' | 'ledger' | 'gallery'
}) {
  return (
    <main className={`${styles.page} ${styles[`page_${mode}`]}`}>
      <section className={styles.module} aria-labelledby="platform-cards-title">
        <PlatformHeader />
        <div className={styles.cards} id="capability-cards">
          {PILLARS.map((pillar) => (
            <FeatureCard pillar={pillar} mode={mode} key={pillar.key} />
          ))}
        </div>
      </section>
    </main>
  )
}
