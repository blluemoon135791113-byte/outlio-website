import styles from './prototype.module.css'
import { ACCOUNTS, FeatureNode, PrototypeShell, WorkflowIcon } from './WorkflowShared'

export function ScorecardVariant() {
  const priority = ACCOUNTS.filter((account) => account.route === 'priority')
  const nurture = ACCOUNTS.filter((account) => account.route === 'nurture')

  return (
    <PrototypeShell direction="Data-first · explicit score lanes">
      <div className={`${styles.workflowPanel} ${styles.scorecardPanel}`}>
        <div className={styles.grain} aria-hidden="true" />
        <div className={styles.scorecardHeader}>
          <div>
            <span>Connected inboxes</span>
            <strong>3 senders ready</strong>
          </div>
          <span className={styles.headerIcon}><WorkflowIcon name="inbox" /></span>
        </div>

        <div className={styles.scorecardGrid}>
          <section className={styles.scoreLane}>
            <header><span>Priority route</span><strong>B–A+</strong></header>
            <div className={styles.accountStack}>
              {priority.map((account) => (
                <div className={styles.accountCard} key={account.name}>
                  <span>{account.name}</span><strong>{account.score}</strong>
                </div>
              ))}
            </div>
          </section>

          <div className={styles.scorecardRail} aria-hidden="true">
            <span />
            <small>ROUTE</small>
            <span />
          </div>

          <section className={styles.destinationStack}>
            <FeatureNode icon="mail">Personalized email<br />campaigns</FeatureNode>
            <FeatureNode icon="linkedin">LinkedIn drafts<br />for rep review</FeatureNode>
            <div className={styles.syncChip}><WorkflowIcon name="sync" /> Replies sync to CRM</div>
          </section>
        </div>

        <div className={styles.nurtureStrip}>
          <span><strong>C–D</strong> Nurture lane</span>
          <div>{nurture.map((account) => <small key={account.name}>{account.name}</small>)}</div>
        </div>
      </div>
    </PrototypeShell>
  )
}
