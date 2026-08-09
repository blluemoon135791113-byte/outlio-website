/**
 * Browser Supabase client.
 *
 * Uses the publishable (anon) key, which is safe in the client bundle by design.
 * RLS is the enforcement layer for everything this client can reach.
 *
 * Never import `admin.ts` from anything that reaches this file.
 */
import { createBrowserClient } from '@supabase/ssr'

import type { Database } from '@/types/database'

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    )
  }

  return createBrowserClient<Database>(url, key, {
    cookieOptions: {
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  })
}
