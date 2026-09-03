import { CALENDLY_URL } from '@/app/lib/constants'

import styles from './HubbleIntelligence.module.css'

function SatelliteMark() {
  return (
    <svg
      className={styles.satelliteMark}
      viewBox="0 0 180 116"
      aria-hidden="true"
      fill="none"
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M68 43 92 66M82 31l43 43M62 54l43 43" strokeWidth="4" />
        <path d="m80 25 12-12 55 55-12 12z" fill="#799b91" strokeWidth="4" />
        <path d="m56 49 12-12 55 55-12 12z" fill="#799b91" strokeWidth="4" />
        <path d="m91 43 12-12 26 26-12 12z" fill="#426e63" strokeWidth="4" />
        <path d="m107 74 8-8 15 15-8 8z" fill="#d9e6e1" strokeWidth="3" />
        <path d="M65 76c-13 2-24-2-29-11 12-2 22 2 29 11Z" fill="#edf4f1" strokeWidth="4" />
        <path d="M45 65c-4 11-2 22 6 29 4-11 2-21-6-29Z" fill="#c6d9d2" strokeWidth="4" />
        <path d="M130 34c10-6 20-5 28 2-8 7-18 8-28-2Z" fill="#edf4f1" strokeWidth="4" />
        <path d="M146 37c3 10 1 19-6 26-4-9-2-18 6-26Z" fill="#c6d9d2" strokeWidth="4" />
        <circle cx="102" cy="58" r="8" fill="#f7fbf9" strokeWidth="4" />
        <path d="m108 52 17-17" strokeWidth="4" />
        <path d="M41 82c20 20 48 24 72 12M124 25c-12-9-29-12-44-7" strokeWidth="2" opacity=".45" />
      </g>
      <g fill="currentColor" opacity=".42">
        <path d="m31 31 2.5 6.5L40 40l-6.5 2.5L31 49l-2.5-6.5L22 40l6.5-2.5z" />
        <path d="m151 16 2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
        <circle cx="159" cy="87" r="3" />
        <circle cx="19" cy="68" r="2.5" />
      </g>
    </svg>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="m4 14 23-9-8.5 23-4.2-9.8L4 14Z" />
      <path d="m14.3 18.2 6.8-6.7" />
    </svg>
  )
}

function InsightIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6 25V14m7 11V8m7 17v-7m6 7V5" />
      <path d="m5 11 8-5 7 8 7-10" />
    </svg>
  )
}

export function HubbleIntelligence() {
  return (
    <section className={styles.section} aria-labelledby="hubble-intelligence-title">
      <div className={styles.layout}>
        <div
          className={styles.animationBox}
          role="img"
          aria-label="Hubble Intelligence workflow: ask what is changing across a market, identify macro trends across multiple data sources, and create a market insight brief"
        >
          <div className={styles.workflowSurface} aria-hidden="true">
            <article className={styles.promptCard}>
              <span className={styles.workflowMark}>✦</span>
              <strong>What is changing<br />across this market?</strong>
              <span className={styles.sendButton}><SendIcon /></span>
            </article>

            <span className={`${styles.connector} ${styles.connectorTop}`}><i /></span>

            <article className={styles.resultCard}>
              <header>
                <span className={styles.resultIcon}>✦</span>
                <strong>3 macro trends<br />worth acting on</strong>
              </header>
              <div className={styles.resultRow}>
                <span className={styles.rowIcon}>▦</span>
                <strong>AI hiring — accelerating</strong>
              </div>
              <div className={styles.resultRow}>
                <span className={styles.rowIcon}>▣</span>
                <strong>Buying cycles — shortening</strong>
              </div>
            </article>

            <span className={`${styles.connector} ${styles.connectorBottom}`}><i /></span>

            <article className={styles.savedCard}>
              <span className={styles.savedIcon}><InsightIcon /></span>
              <strong>Market insight brief ready</strong>
              <span className={styles.savedCheck}>✓</span>
            </article>
          </div>
        </div>

        <div className={styles.copy}>
          <SatelliteMark />
          <p className={styles.eyebrow}>Hubble Intelligence</p>
          <h2 id="hubble-intelligence-title" className={styles.heading}>
            See the pattern across the market.
          </h2>
          <p className={styles.description}>
            Hubble analyzes company, people, hiring, funding, market, and engagement
            data at scale—surfacing trends, correlations, and opportunities across
            entire lead sets.
          </p>
          <a href={CALENDLY_URL} target="_blank" rel="noopener noreferrer" className={styles.cta}>
            Book a demo <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </section>
  )
}
