import { ConceptShell, Feature, Outcome, ScoreTable } from './WorkflowShared'
import styles from './prototype.module.css'

export function ChannelRowVariant() {
  return (
    <ConceptShell note="Reference-faithful · capabilities above, destinations beside CRM">
      <div className={`${styles.workflow} ${styles.channelWorkflow}`}>
        <div className={styles.grain} />
        <div className={styles.featureRow}>
          <Feature icon="inbox">Connected<br />inboxes</Feature>
          <Feature icon="verify">Verified lead<br />context</Feature>
          <Feature icon="score">CRM score<br />signals</Feature>
          <Feature icon="sync">Replies sync<br />to CRM</Feature>
        </div>
        <div className={styles.highRoute}><i /><span>SCORE B–A+ · TRIGGER</span><b /></div>
        <ScoreTable className={styles.emergingTable} />
        <div className={styles.lowRoute}><i /><span>SCORE C–D · NURTURE</span><b>⌄</b></div>
        <div className={styles.outcomes}>
          <Outcome icon="mail">Automated email<br />campaigns</Outcome>
          <Outcome icon="linkedin">LinkedIn drafts<br />for rep review</Outcome>
        </div>
      </div>
    </ConceptShell>
  )
}
