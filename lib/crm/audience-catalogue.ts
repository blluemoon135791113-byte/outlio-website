/**
 * The sources a workspace can enrol from, for `AudiencePicker`.
 *
 * ⚠️ READ-ONLY AND SCOPED, like every other CRM read. The service role bypasses
 * RLS, so each query carries the workspace, and a setter is narrowed to their
 * own pipelines and imports — offering a manager's stage in the dropdown and
 * then resolving it to zero people is a worse experience than not offering it.
 */
import type { AudienceCatalogue } from '@/components/crm/AudiencePicker'
import { createAdminClient } from '@/lib/supabase/admin'

/** Kept small: this is a dropdown, not a browser. */
const PER_SOURCE = 100

export async function loadAudienceCatalogue(
  workspaceId: string,
  options: { ownerUserId?: string | null } = {},
): Promise<AudienceCatalogue> {
  const db = createAdminClient()
  const ownerUserId = options.ownerUserId ?? null

  const [lists, pipelines, stages, batches] = await Promise.all([
    (async () => {
      const { data } = await db
        .from('crm_lists')
        .select('id, name')
        .eq('workspace_id', workspaceId)
        .is('deleted_at', null)
        .order('name')
        .limit(PER_SOURCE)
      return (data ?? []).map((row) => ({ id: row.id, name: row.name }))
    })(),

    (async () => {
      const { data } = await db
        .from('crm_pipelines')
        .select('id, name')
        .eq('workspace_id', workspaceId)
        .is('archived_at', null)
        .order('sort_order', { ascending: true })
        .limit(PER_SOURCE)
      return (data ?? []).map((row) => ({ id: row.id, name: row.name }))
    })(),

    (async () => {
      /*
       * ⚠️ STAGES CARRY THEIR PIPELINE'S NAME. "Qualified" is the single most
       * commonly duplicated stage name across pipelines, and an unqualified
       * dropdown entry is a coin flip between two different audiences.
       */
      const { data } = await db
        .from('crm_pipeline_stages')
        .select('id, name, sort_order, pipeline_id, crm_pipelines(name)')
        .eq('workspace_id', workspaceId)
        .is('archived_at', null)
        .order('sort_order', { ascending: true })
        .limit(PER_SOURCE)

      return (data ?? []).map((row) => {
        const pipeline = row.crm_pipelines as { name: string } | { name: string }[] | null
        const pipelineName = Array.isArray(pipeline) ? pipeline[0]?.name : pipeline?.name
        return {
          id: row.id,
          name: pipelineName ? `${pipelineName} · ${row.name}` : row.name,
        }
      })
    })(),

    (async () => {
      /*
       * ⚠️ BATCHES, NOT IMPORT JOBS. `crm_batch_members` hangs off
       * `crm_lead_batches`, so the batch id is what `resolveAudience` can
       * actually resolve; offering a `crm_import_jobs.id` here would produce a
       * dropdown of plausible names that all resolve to nobody.
       */
      let query = db
        .from('crm_lead_batches')
        .select('id, name, source, contacts_created, contacts_matched, created_by')
        .eq('workspace_id', workspaceId)
        /*
         * ⚠️ AN UNDONE BATCH RESOLVES TO NOBODY. `undoImport` deletes the
         * contacts it created and clears the memberships, so offering one here
         * puts a familiar, correct-looking filename in the dropdown that
         * enrols zero people — and the user reasonably reads that as the
         * enrolment being broken rather than the batch being empty.
         */
        .is('undone_at', null)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(PER_SOURCE)

      if (ownerUserId) query = query.eq('created_by', ownerUserId)

      const { data } = await query
      return (data ?? []).map((row) => {
        /*
         * ⚠️ A SIZE, NOT A DATE, AND THAT IS NOT A WORKAROUND.
         *
         * A date was the obvious label and `reader-clock.test.ts` refused it:
         * formatting one here uses the SERVER's timezone (Vercel runs in UTC),
         * so a batch imported late in the evening in Karachi would be labelled
         * with the previous day. The usual remedy is `<LocalTime>`, and it
         * cannot be used here — an `<option>` holds text, not elements.
         *
         * The size is the better label anyway. "Yesterday" does not tell you
         * which of two imports you want; "412 people" does, and it also
         * previews how many the enrolment is about to touch.
         *
         * ⚠️ IT IS THE BATCH'S OWN RECORD OF WHAT IT INGESTED, so it can drift
         * above the live figure if contacts were deleted afterwards. The
         * enrolment reports the real number it acted on; this is a label for
         * telling two imports apart, not a count to reconcile against.
         */
        const people = (row.contacts_created ?? 0) + (row.contacts_matched ?? 0)
        const kind = row.source === 'csv_import' ? 'CSV' : 'extraction'
        return {
          id: row.id,
          name: row.name,
          note: `${kind} · ${people.toLocaleString()} ${people === 1 ? 'person' : 'people'}`,
        }
      })
    })(),
  ])

  return { lists, stages, pipelines, batches }
}
