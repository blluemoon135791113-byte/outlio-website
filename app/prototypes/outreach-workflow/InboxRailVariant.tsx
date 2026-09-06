import { ConceptShell, Feature, Outcome, ScoreTable, Icon } from './WorkflowShared'
import styles from './prototype.module.css'

export function InboxRailVariant() {
  return (
    <ConceptShell note="Inbox-led · sender readiness is the first workflow decision">
      <div className={`${styles.workflow} ${styles.inboxWorkflow}`}>
        <div className={styles.grain} />
        <div className={styles.inboxRail}>
          <span><Icon name="inbox" /></span>
          <div><small>Connected inboxes</small><strong>3 senders ready for campaigns</strong></div>
        </div>
        <div className={styles.compactFeatures}>
          <Feature icon="verify">Verified<br />contacts</Feature>
          <Feature icon="score">Account<br />scores</Feature>
          <Feature icon="sync">Reply<br />capture</Feature>
        </div>
        <div className={styles.highRoute}><i /><span>SCORE B–A+ · LAUNCH</span><b /></div>
        <ScoreTable className={styles.emergingTable} />
        <div className={styles.lowRoute}><i /><span>SCORE C–D · HOLD</span><b>⌄</b></div>
        <div className={`${styles.outcomes} ${styles.stackOutcomes}`}>
          <Outcome icon="mail">Personalized<br />email sequence</Outcome>
          <Outcome icon="watch">Monitor signals<br />and re-score</Outcome>
        </div>
      </div>
    </ConceptShell>
  )
}
