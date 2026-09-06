import Image from 'next/image'

import { CALENDLY_URL } from '@/app/lib/constants'

import styles from './PlatformOverview.module.css'

const PILLARS = [
  {
    key: 'extraction',
    title: 'Safe Data Extraction',
    description:
      'Save Sales Navigator pages and turn them into structured, de-duplicated CRM records without sharing a LinkedIn password, storing session cookies, or letting Outlio navigate on your behalf.',
    asset: '/leadengine/platform-safe-extraction.png',
    width: 640,
    height: 656,
    alt: 'A smooth tilted blue data structure shaped like the number five',
  },
  {
    key: 'outbound',
    title: 'Automated Outbound',
    description:
      'Connect your inboxes and build personalized campaigns from verified lead context. Outlio manages delivery, replies, bounces, and suppressions, while LinkedIn messages stay rep-reviewed before every manual send.',
    asset: '/leadengine/platform-automated-outbound.png',
    width: 760,
    height: 297,
    alt: 'A smooth black three-dimensional waveform representing engagement signals',
  },
  {
    key: 'intelligence',
    title: 'Intelligence',
    description:
      'Research companies and people across reputable sources, preserve citations, score account fit, assign clear owners, and move qualified leads through shared pipelines with complete context.',
    asset: '/leadengine/platform-intelligence.png',
    width: 680,
    height: 552,
    alt: 'A detailed ivory and olive intelligence architecture of connected modules',
  },
] as const

export function PlatformOverview() {
  return (
    <section className={styles.section} aria-labelledby="platform-overview-title">
      <header className={styles.header}>
        <h2 id="platform-overview-title">Three systems. One complete outbound engine.</h2>
        <p>
          Capture lead data safely, turn it into cited intelligence, and activate it through
          user-controlled outreach—without stitching together a fragile stack.
        </p>
        <a
          className={styles.cta}
          href={CALENDLY_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Book a demo <span aria-hidden="true">→</span>
        </a>
      </header>

      <div className={styles.cards}>
        {PILLARS.map((pillar) => (
          <article className={styles.card} data-pillar={pillar.key} key={pillar.key}>
            <div className={`${styles.objectStage} ${styles[`objectStage_${pillar.key}`]}`}>
              <Image
                src={pillar.asset}
                width={pillar.width}
                height={pillar.height}
                alt={pillar.alt}
                className={styles.objectImage}
                sizes="112px"
              />
            </div>
            <div className={styles.cardCopy}>
              <h3>{pillar.title}</h3>
              <p>{pillar.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
