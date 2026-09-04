import styles from './prototype.module.css'
import { CompactTable, FeatureNode, PrototypeShell, WorkflowIcon } from './WorkflowShared'

export function LedgerVariant() {
  return (
    <PrototypeShell direction="Reference-faithful · emerging CRM ledger">
      <div className={`${styles.workflowPanel} ${styles.ledgerPanel}`}>
        <div className={styles.grain} aria-hidden="true" />
        <div className={styles.ledgerFeatures}>
          <FeatureNode icon="inbox">Connected<br />inboxes</FeatureNode>
          <FeatureNode icon="score">CRM account<br />scoring</FeatureNode>
          <FeatureNode icon="mail">Personalized<br />email</FeatureNode>
          <FeatureNode icon="linkedin">LinkedIn drafts<br />for review</FeatureNode>
        </div>

        <div className={styles.ledgerPriorityRoute} aria-hidden="true">
          <span className={styles.routeLine} />
          <span className={styles.routeLabel}>SCORE B–A+ · PRIORITY</span>
          <span className={styles.routeStem} />
        </div>

        <CompactTable className={styles.ledgerTable} />

        <div className={styles.ledgerNurtureRoute} aria-hidden="true">
          <span className={styles.routeLabel}>SCORE C–D · NURTURE</span>
          <span className={styles.routeLine} />
        </div>

        <div className={styles.ledgerOutputs}>
          <div className={styles.outputNode}>
            <span><WorkflowIcon name="mail" /></span>
            <strong>Automated email<br />campaigns</strong>
          </div>
          <div className={styles.outputNode}>
            <span><WorkflowIcon name="linkedin" /></span>
            <strong>Rep-reviewed<br />LinkedIn drafts</strong>
          </div>
        </div>
      </div>
    </PrototypeShell>
  )
}
