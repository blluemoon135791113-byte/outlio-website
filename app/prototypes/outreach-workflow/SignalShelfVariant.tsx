import styles from './prototype.module.css'
import { ACCOUNTS, PrototypeShell, WorkflowIcon } from './WorkflowShared'

export function SignalShelfVariant() {
  return (
    <PrototypeShell direction="Editorial · contained signal shelf">
      <div className={`${styles.workflowPanel} ${styles.shelfPanel}`}>
        <div className={styles.grain} aria-hidden="true" />
        <header className={styles.shelfHeader}>
          <div><span>OUTLIO / ROUTING DESK</span><strong>Campaign readiness</strong></div>
          <div className={styles.shelfInbox}><WorkflowIcon name="inbox" /><span>3 inboxes connected</span></div>
        </header>

        <div className={styles.shelfBody}>
          <section className={styles.shelfAccounts}>
            <p>CRM score queue</p>
            {ACCOUNTS.map((account) => (
              <div className={styles.shelfAccount} key={account.name}>
                <span>{account.name}</span>
                <strong>{account.score}</strong>
              </div>
            ))}
          </section>

          <div className={styles.shelfRoutes} aria-hidden="true">
            <div><span>B–A+</span><i /></div>
            <div><span>C–D</span><i /></div>
          </div>

          <section className={styles.shelfDestinations}>
            <article>
              <span className={styles.shelfDestinationIcon}><WorkflowIcon name="mail" /></span>
              <div><small>Priority</small><strong>Email campaign</strong><p>Personalized and ready</p></div>
            </article>
            <article>
              <span className={styles.shelfDestinationIcon}><WorkflowIcon name="linkedin" /></span>
              <div><small>Priority</small><strong>LinkedIn draft</strong><p>Queued for rep review</p></div>
            </article>
            <article className={styles.shelfNurture}>
              <span className={styles.shelfDestinationIcon}><WorkflowIcon name="score" /></span>
              <div><small>Nurture</small><strong>Monitor signals</strong><p>Re-score when intent changes</p></div>
            </article>
          </section>
        </div>

        <footer className={styles.shelfFooter}><WorkflowIcon name="sync" /> Replies and engagement return to CRM</footer>
      </div>
    </PrototypeShell>
  )
}
