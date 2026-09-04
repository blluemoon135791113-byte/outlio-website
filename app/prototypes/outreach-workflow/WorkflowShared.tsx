import type { ReactNode } from 'react'

import styles from './prototype.module.css'

export const ACCOUNTS = [
  { name: 'Northstar Labs', score: 'A', route: 'priority' },
  { name: 'Atlas Systems', score: 'D', route: 'nurture' },
  { name: 'Evergreen Collective', score: 'A+', route: 'priority' },
  { name: 'Horizon Analytics', score: 'A', route: 'priority' },
  { name: 'Redwood Technologies', score: 'B', route: 'priority' },
  { name: 'Summit Works', score: 'C', route: 'nurture' },
] as const

type IconName = 'inbox' | 'score' | 'mail' | 'linkedin' | 'sync' | 'context'

export function WorkflowIcon({ name }: { name: IconName }) {
  if (name === 'linkedin') {
    return <span className={styles.linkedinGlyph} aria-hidden="true">in</span>
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.lineIcon}>
      {name === 'inbox' && (
        <>
          <path d="M4 5.5h16v13H4z" />
          <path d="M4 14h4l1.4 2h5.2l1.4-2h4" />
        </>
      )}
      {name === 'score' && (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="m12 12 4-4M8 17h8" />
        </>
      )}
      {name === 'mail' && (
        <>
          <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
          <path d="m5 8 7 5 7-5" />
        </>
      )}
      {name === 'sync' && (
        <>
          <path d="M19.5 8.5A8 8 0 0 0 6 5.5L3.5 8" />
          <path d="M3.5 4.5V8H7" />
          <path d="M4.5 15.5A8 8 0 0 0 18 18.5l2.5-2.5" />
          <path d="M20.5 19.5V16H17" />
        </>
      )}
      {name === 'context' && (
        <>
          <circle cx="9" cy="9" r="3" />
          <path d="M4.5 18c.7-3 2.2-4.5 4.5-4.5s3.8 1.5 4.5 4.5" />
          <path d="m15.5 11.5 1.7 1.7 3.3-3.7" />
        </>
      )}
    </svg>
  )
}

export function FeatureNode({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className={styles.featureNode}>
      <span className={styles.featureIcon}><WorkflowIcon name={icon} /></span>
      <strong>{children}</strong>
    </div>
  )
}

export function PrototypeShell({ children, direction }: { children: ReactNode; direction: string }) {
  return (
    <main className={styles.prototypePage}>
      <section className={styles.moduleShell}>
        <div className={styles.copyBlock}>
          <span className={styles.brandMark} aria-hidden="true">
            <span />
          </span>
          <p className={styles.eyebrow}>Outlio outreach</p>
          <h1>Run targeted outreach from CRM scores.</h1>
          <p className={styles.copyText}>
            Connect your inboxes, score every account for outreach viability, and route qualified leads into personalized email campaigns or LinkedIn drafts for rep review.
          </p>
          <button type="button" className={styles.cta}>Book a demo <span aria-hidden="true">→</span></button>
          <p className={styles.directionNote}>{direction}</p>
        </div>
        <div className={styles.workflowColumn}>{children}</div>
      </section>
    </main>
  )
}

export function CompactTable({ className = '' }: { className?: string }) {
  return (
    <article className={`${styles.crmTable} ${className}`}>
      <header className={styles.crmHead}>
        <span>Account name</span>
        <span>Score · signals</span>
      </header>
      <div>
        {ACCOUNTS.map((account) => (
          <div className={styles.crmRow} data-route={account.route} key={account.name}>
            <strong>{account.name}</strong>
            <span>{account.score}</span>
          </div>
        ))}
      </div>
      <footer className={styles.crmFooter}>
        <WorkflowIcon name="sync" />
        Replies sync to CRM
      </footer>
    </article>
  )
}
