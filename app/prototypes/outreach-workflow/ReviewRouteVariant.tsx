import { ConceptShell, Feature, Outcome, ScoreTable } from './WorkflowShared'
import styles from './prototype.module.css'

export function ReviewRouteVariant() {
  return (
    <ConceptShell note="Review-led · clear automation boundary between email and LinkedIn">
      <div className={`${styles.workflow} ${styles.reviewWorkflow}`}>
        <div className={styles.grain} />
        <div className={styles.featureRow}>
          <Feature icon="inbox">Connect<br />inboxes</Feature>
          <Feature icon="score">Score<br />accounts</Feature>
          <Feature icon="mail">Personalize<br />email</Feature>
          <Feature icon="linkedin">Draft<br />LinkedIn</Feature>
        </div>
        <div className={styles.highRoute}><i /><span>SCORE B–A+ · READY</span><b /></div>
        <ScoreTable className={styles.emergingTable} />
        <div className={styles.lowRoute}><i /><span>SCORE C–D · REVIEW</span><b>⌄</b></div>
        <div className={styles.outcomes}>
          <Outcome icon="mail">Email sends<br />automatically</Outcome>
          <Outcome icon="linkedin">LinkedIn waits<br />for rep review</Outcome>
        </div>
      </div>
    </ConceptShell>
  )
}
