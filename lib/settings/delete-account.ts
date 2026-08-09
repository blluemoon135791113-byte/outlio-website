import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

const PAGE_SIZE = 100
const REMOVE_BATCH_SIZE = 100

async function listPaths(
  client: SupabaseClient<Database>,
  bucket: string,
  folder: string,
): Promise<string[]> {
  const paths: string[] = []

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client.storage
      .from(bucket)
      .list(folder, { limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } })

    if (error) throw new Error(`Could not inspect ${bucket} storage`)
    const entries = data ?? []

    for (const entry of entries) {
      const path = `${folder}/${entry.name}`
      if (entry.id) paths.push(path)
      else paths.push(...(await listPaths(client, bucket, path)))
    }

    if (entries.length < PAGE_SIZE) break
  }

  return paths
}

/** Remove every private object under the verified user's storage prefix. */
export async function removeUserStorage(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  for (const bucket of ['uploads', 'exports', 'avatars']) {
    const paths = await listPaths(client, bucket, userId)
    for (let index = 0; index < paths.length; index += REMOVE_BATCH_SIZE) {
      const { error } = await client.storage
        .from(bucket)
        .remove(paths.slice(index, index + REMOVE_BATCH_SIZE))
      if (error) throw new Error(`Could not clear ${bucket} storage`)
    }
  }
}
