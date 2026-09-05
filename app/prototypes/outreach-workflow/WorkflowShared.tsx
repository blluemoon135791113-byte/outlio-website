import type { ReactNode } from 'react'

import styles from './prototype.module.css'

const ACCOUNTS = [
  ['Northstar Labs', 'A'],
  ['Atlas Systems', 'D'],
  ['Evergreen Collective', 'A+'],
  ['Horizon Analytics', 'A'],
  ['Redwood Technologies', 'B'],
  ['Summit Works', 'C'],
  ['Beacon Industries', 'A+'],
  ['Velocity Group', 'D'],
] as const

type IconName = 'inbox' | 'verify' | 'score' | 'mail' | 'linkedin' | 'sync' | 'watch'

export function Icon({ name }: { name: IconName }) {
  if (name === 'linkedin') return <span className={styles.linkedinIcon}>in</span>

  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      {name === 'inbox' && <><path d="M4 5.5h16v13H4z" /><path d="M4 14h4l1.5 2h5l1.5-2h4" /></>}
      {name === 'verify' && <><circle cx="9" cy="9" r="3" /><path d="M4.5 18c.7-3 2.2-4.5 4.5-4.5s3.8 1.5 4.5 4.5m2-6.5 1.8 1.8 3.2-3.8" /></>}
      {name === 'score' && <><circle cx="12" cy="12" r="8" /><path d="m12 12 4-4M8 17h8" /></>}
      {name === 'mail' && <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m5 8 7 5 7-5" /></>}
      {name === 'sync' && <><path d="M19.5 8.5A8 8 0 0 0 6 5.5L3.5 8m0-3.5V8H7M4.5 15.5A8 8 0 0 0 18 18.5l2.5-2.5m0 3.5V16H17" /></>}
      {name === 'watch' && <><path d="M4 12s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" /><circle cx="12" cy="12" r="2" /></>}
    </svg>
  )
}

export function Feature({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <article className={styles.feature}>
      <span className={styles.featureCircle}><Icon name={icon} /></span>
      <strong>{children}</strong>
    </article>
  )
}

export function Outcome({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <article className={styles.outcome}>
      <span className={styles.outcomeCircle}><Icon name={icon} /></span>
      <strong>{children}</strong>
    </article>
  )
}

export function ScoreTable({ className = '' }: { className?: string }) {
  return (
    <article className={`${styles.scoreTable} ${className}`}>
      <header>
        <span>Account name</span>
        <span>Score signals data <i className={styles.signalBurst} /></span>
      </header>
      {ACCOUNTS.map(([name, score]) => (
        <div className={styles.scoreRow} data-score={score} key={name}>
          <strong>{name}</strong>
          <span>{score}</span>
        </div>
      ))}
    </article>
  )
}

export function ConceptShell({ children, note }: { children: ReactNode; note: string }) {
  return (
    <main className={styles.page}>
      <section className={styles.module}>
        <div className={styles.copy}>
          <span className={styles.brandMark}><span /></span>
          <p className={styles.eyebrow}>Outlio outreach</p>
          <h1>Turn CRM scores into timely conversations.</h1>
          <p className={styles.description}>
            Connect inboxes, score every account, and turn verified lead context into personalized email campaigns or LinkedIn drafts ready for rep review.
          </p>
          <button className={styles.cta} type="button">Book a demo <span>→</span></button>
          <p className={styles.note}>{note}</p>
        </div>
        <div className={styles.visual}>{children}</div>
      </section>
    </main>
  )
}
