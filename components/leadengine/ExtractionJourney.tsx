import Image from 'next/image'

import { CALENDLY_URL } from '@/app/lib/constants'

import styles from './ExtractionJourney.module.css'

function FeatureLogo() {
  return (
    <span className={styles.featureLogo} aria-hidden="true">
      <svg viewBox="0 0 128 128" role="presentation">
        <g className={styles.logoSegments}>
          <path d="M64 49V11A38 38 0 0 0 30.7 30.6Z" fill="#d8a7ba" />
          <path d="M64 49 30.7 30.6A38 38 0 0 0 28.4 73.8Z" fill="#e6b16e" />
          <path d="M64 49 28.4 73.8A63 63 0 0 0 102.5 108Z" fill="#9dc9c6" />
          <path d="M64 49 88.6 25.7A34 34 0 0 0 64 15Z" fill="#b9d39b" />
          <path d="M64 49 88.6 25.7A34 34 0 0 1 92.3 74.2Z" fill="#dc7d89" />
        </g>
        <g className={styles.logoGuides}>
          <circle cx="64" cy="49" r="45" />
          <circle cx="64" cy="49" r="38" />
          <circle cx="64" cy="49" r="25" />
          <path d="M64 4v105M22 26l82 46M23 75l81-49" />
        </g>
      </svg>
    </span>
  )
}

export function ExtractionJourney() {
  return (
    <section className={styles.section} aria-labelledby="extraction-journey-title">
      <div className={styles.layout}>
        <div className={styles.copy}>
          <FeatureLogo />
          <p className={styles.eyebrow}>Lead Engine</p>
          <h2 id="extraction-journey-title" className={styles.heading}>
            Turn searches into CRM-ready records.
          </h2>
          <p className={styles.description}>
            Capture Sales Navigator profiles, verify every contact, and send complete
            records to your CRM.
          </p>
          <a href={CALENDLY_URL} target="_blank" rel="noopener noreferrer" className={styles.cta}>
            Book a demo
            <span aria-hidden="true">→</span>
          </a>
        </div>

        <div
          className={styles.animationBox}
          role="img"
          aria-label="Outlio workflow showing three Sales Navigator leads being verified by the browser extension and added to a CRM"
        >
          <div className={styles.workflowFrame}>
            <Image
              className={styles.workflowImage}
              src="/leadengine/extraction-workflow-reference-terra.png"
              width={1774}
              height={887}
              alt=""
              draggable={false}
              unoptimized
            />
          </div>
        </div>
      </div>
    </section>
  )
}
