import { CALENDLY_URL } from '@/app/lib/constants'

import styles from './OutreachAutomation.module.css'

const ACCOUNTS = [
  { account: 'Northstar Labs', score: 'A', tier: 'high' },
  { account: 'Atlas Systems', score: 'D', tier: 'low' },
  { account: 'Evergreen Collective', score: 'A+', tier: 'high' },
  { account: 'Horizon Analytics', score: 'A', tier: 'high' },
  { account: 'Redwood Technologies', score: 'B', tier: 'high' },
  { account: 'Summit Works', score: 'C', tier: 'low' },
  { account: 'Beacon Industries', score: 'A+', tier: 'high' },
  { account: 'Velocity Group', score: 'D', tier: 'low' },
] as const

function EmailMarketingMark() {
  return (
    <span className={styles.featureLogo} aria-hidden="true">
      <svg viewBox="0 0 80 80" role="presentation">
        <g className={styles.targetMark}>
          <path d="M39.5 11.5a24 24 0 0 1 22 14" />
          <path d="M63.5 39.5a24 24 0 0 1-9.5 19" />
          <path d="M29 61a24 24 0 0 1-13-18" />
          <path d="M16 34a24 24 0 0 1 15-20" />
          <circle cx="39.5" cy="39.5" r="11.5" />
          <path d="M39.5 5v12M39.5 62v12M5 39.5h12M62 39.5h12" />
        </g>
        <path
          className={styles.cursorMark}
          d="M43 38.5 67 51l-10 3.5 6 12-6.3 3.1-6-12-7.7 7.2V38.5Z"
        />
      </svg>
    </span>
  )
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m5 8 7 5 7-5" />
    </svg>
  )
}

function InboxIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5.5h16v13H4z" />
      <path d="M4 14h4l1.4 2h5.2l1.4-2h4" />
    </svg>
  )
}

function ScoreIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="m12 12 4-4M8 17h8" />
    </svg>
  )
}

function SyncIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.5 8.5A8 8 0 0 0 6 5.5L3.5 8" />
      <path d="M3.5 4.5V8H7" />
      <path d="M4.5 15.5A8 8 0 0 0 18 18.5l2.5-2.5" />
      <path d="M20.5 19.5V16H17" />
    </svg>
  )
}

export function OutreachAutomation() {
  return (
    <section className={styles.section} aria-labelledby="outreach-automation-title">
      <div className={styles.layout}>
        <div className={styles.copy}>
          <EmailMarketingMark />
          <p className={styles.eyebrow}>Email marketing</p>
          <h2 id="outreach-automation-title" className={styles.heading}>
            Turn CRM scores into timely outreach.
          </h2>
          <p className={styles.description}>
            Score every account for outreach viability, then route qualified leads
            into personalized email campaigns or rep-reviewed LinkedIn messages.
          </p>
          <a
            href={CALENDLY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.cta}
          >
            Book a demo <span aria-hidden="true">→</span>
          </a>
        </div>

        <div
          className={styles.workflow}
          role="img"
          aria-label="A CRM score table routes high-viability accounts into connected-inbox email campaigns or LinkedIn drafts for representative review, while lower-scored accounts enter nurture"
        >
          <div className={styles.texture} aria-hidden="true" />

          <div className={styles.featureRow} aria-hidden="true">
            <article className={styles.featureItem}>
              <span className={styles.featureIcon}><InboxIcon /></span>
              <strong>Connected<br />inboxes</strong>
            </article>
            <article className={styles.featureItem}>
              <span className={styles.featureIcon}><ScoreIcon /></span>
              <strong>CRM account<br />scoring</strong>
            </article>
            <article className={styles.featureItem}>
              <span className={styles.featureIcon}><MailIcon /></span>
              <strong>Personalized<br />email campaigns</strong>
            </article>
            <article className={styles.featureItem}>
              <span className={`${styles.featureIcon} ${styles.linkedinIcon}`}>in</span>
              <strong>LinkedIn drafts<br />for rep review</strong>
            </article>
          </div>

          <div className={styles.highRoute} aria-hidden="true">
            <span className={styles.highRouteLine} />
            <span className={styles.trigger}>IF SCORE IS B–A+ · TRIGGER</span>
            <span className={styles.highRouteStem} />
          </div>

          <article className={styles.crmPanel} aria-hidden="true">
            <header className={styles.tableHead}>
              <span>Account name</span>
              <span>Score · signals data</span>
            </header>
            <div className={styles.tableBody}>
              {ACCOUNTS.map((row) => (
                <div className={styles.tableRow} data-tier={row.tier} key={row.account}>
                  <strong>{row.account}</strong>
                  <span>{row.score}</span>
                </div>
              ))}
            </div>
            <footer className={styles.crmFooter}>
              <SyncIcon />
              <span>Replies sync to CRM</span>
            </footer>
          </article>

          <div className={styles.lowRoute} aria-hidden="true">
            <span className={styles.lowRouteLine} />
            <span className={styles.lowTrigger}>IF SCORE IS C–D · NURTURE</span>
            <span className={styles.lowRouteTurn}>⌄</span>
          </div>

          <div className={styles.outcomes} aria-hidden="true">
            <article className={styles.outcomeItem}>
              <span className={styles.outcomeIcon}><MailIcon /></span>
              <strong>Automated email<br />campaigns</strong>
            </article>
            <article className={styles.outcomeItem}>
              <span className={`${styles.outcomeIcon} ${styles.linkedinIcon}`}>in</span>
              <strong>LinkedIn drafts<br />for rep review</strong>
            </article>
          </div>
        </div>
      </div>
    </section>
  )
}
