import 'server-only'

import { loadAccountPolicyInput } from '@/lib/crm/account-access'
import { decideAccountPermission } from '@/lib/crm/account-permissions'
import { ingestAccountJob } from '@/lib/crm/ingest-account-job'
import { ingestExtractionJob } from '@/lib/crm/ingest'
import { routeBatch } from '@/lib/crm/routing'
import { listMemberships, type WorkspaceSummary } from '@/lib/workspaces/context'
import { getWorkspaceEntitlements } from '@/lib/workspaces/entitlements'
import { decidePermission } from '@/lib/workspaces/permissions'

export type AutoSyncOutcome =
  | { synced: true; kind: 'leads' | 'accounts'; created: number; matched: number }
  | { synced: false; reason: 'no_single_workspace' | 'not_permitted' | 'failed' }

/**
 * Every finished extraction lands in the CRM by itself (owner, 2026-10-15).
 *
 * This replaces pressing "Send to CRM" after each upload, which is why it acts
 * AS THE UPLOADER and checks exactly what that button checks: `crm.import`,
 * plus `accounts.import` for an account upload. Someone who could not press
 * the button gets nothing synced — the button still works for a manager.
 *
 * Idempotent because both ingests are (one batch per job; matched rows fill
 * empty fields only), so a retried job never duplicates a contact.
 */
export class ExtractionCrmSync {
  constructor(
    private readonly jobId: string,
    private readonly userId: string,
    private readonly kind: 'leads' | 'accounts',
  ) {}

  /** Never throws: the extraction already succeeded, and this is a bonus. */
  async run(): Promise<AutoSyncOutcome> {
    try {
      const workspace = await this.workspace()
      if (!workspace) return { synced: false, reason: 'no_single_workspace' }

      if (!(await this.permitted(workspace))) return { synced: false, reason: 'not_permitted' }

      return this.kind === 'accounts' ? await this.syncAccounts(workspace.id) : await this.syncLeads(workspace.id)
    } catch (error) {
      console.error('[crm-auto-sync] failed', {
        jobId: this.jobId,
        message: error instanceof Error ? error.message : 'unknown',
      })
      return { synced: false, reason: 'failed' }
    }
  }

  /**
   * Only an unambiguous workspace. `extraction_jobs` does not record which
   * workspace an upload was made from, so for someone in two workspaces any
   * pick could file a team's leads into a personal CRM. They are skipped, and
   * "Send to CRM" (which uses the active workspace) still works for them.
   */
  private async workspace(): Promise<WorkspaceSummary | null> {
    const memberships = await listMemberships(this.userId)
    return memberships.length === 1 ? memberships[0] : null
  }

  private async permitted(workspace: WorkspaceSummary): Promise<boolean> {
    const { modules } = await getWorkspaceEntitlements(workspace.id)
    if (!decidePermission({ role: workspace.role, modules }, 'crm.import').allowed) return false
    if (this.kind === 'leads') return true

    const policy = await loadAccountPolicyInput({
      workspaceId: workspace.id,
      userId: this.userId,
      role: workspace.role,
      modules,
    })
    return decideAccountPermission(policy, 'accounts.import').allowed
  }

  private async syncLeads(workspaceId: string): Promise<AutoSyncOutcome> {
    const result = await ingestExtractionJob(workspaceId, this.jobId, {
      ownerUserId: null,
      actorUserId: this.userId,
    })
    // Routing failure leaves contacts unassigned, never un-imported.
    await routeBatch(workspaceId, result.batchId).catch(() => null)
    return { synced: true, kind: 'leads', created: result.contactsCreated, matched: result.contactsMatched }
  }

  private async syncAccounts(workspaceId: string): Promise<AutoSyncOutcome> {
    const result = await ingestAccountJob(workspaceId, this.jobId, this.userId)
    return { synced: true, kind: 'accounts', created: result.accountsCreated, matched: result.accountsMatched }
  }
}
