import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

export async function signedAvatarUrl(userId: string, path: string | null | undefined): Promise<string | null> {
  if (!path || !path.startsWith(`${userId}/`)) return null
  const { data, error } = await createAdminClient().storage.from('avatars').createSignedUrl(path, 60 * 60)
  return error ? null : (data?.signedUrl ?? null)
}
