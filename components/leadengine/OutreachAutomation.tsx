import Image from 'next/image'

import { CALENDLY_URL } from '@/app/lib/constants'

import styles from './OutreachAutomation.module.css'

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

type IconName = 'inbox' | 'verify' | 'score' | 'mail' | 'watch' | 'sync'

function WorkflowIcon({ name }: { name: IconName }) {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      {name === 'inbox' && (
        <>
          <path d="M4 5.5h16v13H4z" />
          <path d="M4 14h4l1.5 2h5l1.5-2h4" />
        </>
      )}
      {name === 'verify' && (
        <>
          <circle cx="9" cy="9" r="3" />
          <path d="M4.5 18c.7-3 2.2-4.5 4.5-4.5s3.8 1.5 4.5 4.5m2-6.5 1.8 1.8 3.2-3.8" />
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
      {name === 'watch' && (
        <>
          <path d="M4 12s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" />
          <circle cx="12" cy="12" r="2" />
        </>
      )}
      {name === 'sync' && (
        <>
          <path d="M19.5 8.5A8 8 0 0 0 6 5.5L3.5 8m0-3.5V8H7" />
          <path d="M4.5 15.5A8 8 0 0 0 18 18.5l2.5-2.5m0 3.5V16H17" />
        </>
      )}
    </svg>
  )
}

export function OutreachAutomation() {
  return (
    <section className={styles.section} aria-labelledby="outreach-automation-title">
      <div className={styles.layout}>
        <div className={styles.copy}>
          <Image
            className={styles.featureLogo}
            src="/leadengine/outreach-envelope-mark.png"
            alt=""
            width={512}
            height={512}
          />
          <p className={styles.eyebrow}>Outbound</p>
          <h2 id="outreach-automation-title" className={styles.heading}>
            Turn CRM scores into timely conversations.
          </h2>
          <p className={styles.description}>
            Connect inboxes, score every account, and turn verified lead context into
            personalized email campaigns or LinkedIn drafts ready for rep review.
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
          aria-label="Connected inboxes feed verified contacts, account scores, and reply capture into a CRM table. High-scoring accounts launch personalized email sequences while lower-scoring accounts are held for monitoring and re-scoring."
        >
          <div className={styles.texture} aria-hidden="true" />

          <article className={styles.inboxRail} aria-hidden="true">
            <span className={styles.inboxIcon}><WorkflowIcon name="inbox" /></span>
            <div>
              <small>Connected inboxes</small>
              <strong>3 senders ready for campaigns</strong>
            </div>
          </article>

          <div className={styles.featureRow} aria-hidden="true">
            <article className={styles.featureItem}>
              <span className={styles.featureIcon}><WorkflowIcon name="verify" /></span>
              <strong>Verified<br />contacts</strong>
            </article>
            <article className={styles.featureItem}>
              <span className={styles.featureIcon}><WorkflowIcon name="score" /></span>
              <strong>Account<br />scores</strong>
            </article>
            <article className={styles.featureItem}>
              <span className={styles.featureIcon}><WorkflowIcon name="sync" /></span>
              <strong>Reply<br />capture</strong>
            </article>
          </div>

          <div className={styles.highRoute} aria-hidden="true">
            <i />
            <span>Score B–A+ · launch</span>
            <b />
          </div>

          <article className={styles.scoreTable} aria-hidden="true">
            <header>
              <span>Account name</span>
              <span>Score signals data <i className={styles.signalBurst} /></span>
            </header>
            {ACCOUNTS.map(([account, score]) => (
              <div className={styles.scoreRow} data-score={score} key={account}>
                <strong>{account}</strong>
                <span>{score}</span>
              </div>
            ))}
          </article>

          <div className={styles.lowRoute} aria-hidden="true">
            <i />
            <span>Score C–D · hold</span>
            <b>⌄</b>
          </div>

          <div className={styles.outcomes} aria-hidden="true">
            <article className={styles.outcomeItem}>
              <span className={styles.outcomeIcon}><WorkflowIcon name="mail" /></span>
              <strong>Personalized<br />email sequence</strong>
            </article>
            <article className={styles.outcomeItem}>
              <span className={styles.outcomeIcon}><WorkflowIcon name="watch" /></span>
              <strong>Monitor signals<br />and re-score</strong>
            </article>
          </div>
        </div>
      </div>
    </section>
  )
}
