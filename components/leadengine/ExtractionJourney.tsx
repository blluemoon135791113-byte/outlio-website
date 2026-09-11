import Image from 'next/image'
import type { ReactNode } from 'react'

import { CALENDLY_URL } from '@/app/lib/constants'

import styles from './ExtractionJourney.module.css'

function FeatureLogo() {
  return (
    <span className={styles.featureLogo} aria-hidden="true">
      <Image
        className={styles.featureLogoImage}
        src="/leadengine/lead-engine-sketch-02.png"
        width={1254}
        height={1254}
        alt=""
        draggable={false}
      />
    </span>
  )
}

export function ExtractionJourney({ artwork }: { artwork?: ReactNode }) {
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
          {artwork ?? <div className={styles.workflowFrame}>
            <Image
              className={styles.workflowImage}
              src="/leadengine/extraction-workflow-reference-terra-hq.png"
              width={3548}
              height={1774}
              alt=""
              draggable={false}
              unoptimized
            />
          </div>}
        </div>
      </div>
    </section>
  )
}
