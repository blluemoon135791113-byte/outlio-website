import 'server-only'

import { buildAccountRecordCsv } from '@/lib/export/accounts'
import { loadAccountExportRecords } from '@/lib/export/account-loader'
import { createAdminClient } from '@/lib/supabase/admin'

const EXPORT_BUCKET = process.env.SUPABASE_EXPORT_BUCKET ?? 'exports'

/** Rewrites the account CSV after company/person enrichment has completed. */
export async function rebuildAccountListExport(
  jobId: string,
  userId: string,
): Promise<boolean> {
  try {
    const records = await loadAccountExportRecords(userId, jobId)
    const csv = buildAccountRecordCsv(records)
    const supabase = createAdminClient()
    const { error } = await supabase.storage
      .from(EXPORT_BUCKET)
      .upload(`${userId}/${jobId}/accounts.csv`, new TextEncoder().encode(csv), {
        contentType: 'text/csv',
        upsert: true,
      })
    return !error
  } catch {
    // The durable rows remain exportable to connected CRMs even if this
    // convenience snapshot cannot be refreshed immediately.
    return false
  }
}
