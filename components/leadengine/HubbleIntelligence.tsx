import Image from 'next/image'

import { CALENDLY_URL } from '@/app/lib/constants'

import styles from './HubbleIntelligence.module.css'

function SatelliteMark() {
  return (
    <Image
      className={styles.satelliteMark}
      src="/brand/hubble-telescope-mark.png"
      width={720}
      height={720}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
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
          aria-label="Hubble AI Intelligence workflow: ask what is changing across a market, analyze multiple data sources for macro trends, and create a market insight brief"
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
              <div className={styles.resultRow}>
                <span className={styles.rowIcon}>◫</span>
                <strong>Decision teams — expanding</strong>
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
            Hubble uses AI to analyze company, people, hiring, funding, market, and
            engagement data at scale—surfacing trends, correlations, and opportunities
            across entire lead sets.
          </p>
          <a href={CALENDLY_URL} target="_blank" rel="noopener noreferrer" className={styles.cta}>
            Book a demo <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </section>
  )
}
