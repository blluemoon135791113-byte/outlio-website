/**
 * Integration test helpers.
 *
 * These tests run against the real Supabase project. Every user created here is
 * deleted in cleanup. Nothing in this file may be imported by application code.
 */
import { createHash, randomBytes } from 'node:crypto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
export const PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

/** True when the environment can reach a real Supabase project. */
export const hasSupabaseEnv = Boolean(
  SUPABASE_URL &&
    PUBLISHABLE_KEY &&
    SERVICE_ROLE_KEY &&
    SERVICE_ROLE_KEY !== 'PASTE_SERVICE_ROLE_KEY_HERE',
)

export function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export type TestUser = {
  id: string
  email: string
  password: string
  client: SupabaseClient<Database>
}

export type TestAuthUser = { id: string; email: string }

export type TestSignupReservation = {
  ipHash: string
  token: string
  tokenHash: string
}

export type TestSignupSecurityMetadata = {
  signup_device_hash: string
  signup_email_hash: string
  signup_phone_hash: string
  signup_linkedin_hash: string
}

export function createTestSignupSecurityMetadata(
  label: string,
  overrides: Partial<TestSignupSecurityMetadata> = {},
): TestSignupSecurityMetadata {
  const unique = `${label}:${Date.now()}:${Math.random()}`
  const digest = (kind: string) =>
    createHash('sha256').update(`test-${kind}:${unique}`).digest('hex')

  return {
    signup_device_hash: digest('device'),
    signup_email_hash: digest('email'),
    signup_phone_hash: digest('phone'),
    signup_linkedin_hash: digest('linkedin'),
    ...overrides,
  }
}

/** Reserve a fabricated network identity through the same database gate as production. */
export async function createTestSignupReservation(
  label: string,
  ipHashOverride?: string,
): Promise<TestSignupReservation> {
  const unique = `${label}:${Date.now()}:${Math.random()}`
  const ipHash =
    ipHashOverride ?? createHash('sha256').update(`test-ip:${unique}`).digest('hex')
  const token = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const { data, error } = await adminClient().rpc('reserve_signup_ip', {
    p_ip_hash: ipHash,
    p_token_hash: tokenHash,
    p_reservation_seconds: 600,
  })

  if (error || !data) {
    throw new Error(`createTestSignupReservation failed: ${error?.message ?? 'blocked'}`)
  }

  return { ipHash, token, tokenHash }
}

/**
 * Creates a confirmed auth user WITHOUT signing in.
 *
 * Use this whenever a test only needs a user to exist — for example anything
 * driven through service-role RPCs. Supabase rate-limits the token endpoint per
 * IP, so signing in users that never make an authenticated request burns that
 * budget and makes the suite flaky.
 *
 * Reach for `createTestUser` only when you genuinely need an RLS-scoped client.
 */
export async function createAuthUser(label: string): Promise<TestAuthUser> {
  const admin = adminClient()
  const reservation = await createTestSignupReservation(label)
  const securityMetadata = createTestSignupSecurityMetadata(label)
  const email = `outlio-test-${label}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@example.com`

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: `Test-${Math.random().toString(36).slice(2)}-Aa1!`,
    email_confirm: true,
    user_metadata: {
      signup_reservation_token: reservation.token,
      ...securityMetadata,
    },
  })
  if (error || !data.user) {
    await admin
      .from('signup_ip_claims')
      .delete()
      .eq('ip_hash', reservation.ipHash)
    throw new Error(`createAuthUser failed: ${error?.message ?? 'no user returned'}`)
  }

  return { id: data.user.id, email }
}

/** Creates a confirmed auth user and returns a client signed in as them. */
export async function createTestUser(label: string): Promise<TestUser> {
  const admin = adminClient()
  const reservation = await createTestSignupReservation(label)
  const securityMetadata = createTestSignupSecurityMetadata(label)
  const email = `outlio-test-${label}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@example.com`
  const password = `Test-${Math.random().toString(36).slice(2)}-Aa1!`

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      signup_reservation_token: reservation.token,
      ...securityMetadata,
    },
  })
  if (error || !data.user) {
    await admin
      .from('signup_ip_claims')
      .delete()
      .eq('ip_hash', reservation.ipHash)
    throw new Error(`createTestUser failed: ${error?.message ?? 'no user'}`)
  }

  const client = anonClient()
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  })

  if (signInError) {
    // The user EXISTS at this point. Throwing without cleaning up leaks it —
    // the caller never learns its id, so no afterAll can remove it. That is
    // exactly how orphans accumulated in the project during a failed run.
    await adminClient().auth.admin.deleteUser(data.user.id)
    throw new Error(
      `sign-in failed for a freshly created user: ${signInError.message || signInError.name || 'unknown'}. ` +
        'Supabase rate-limits the token endpoint per IP — prefer createAuthUser() ' +
        'for tests that do not need an RLS-scoped client.',
    )
  }

  return { id: data.user.id, email, password, client }
}

export async function deleteTestUser(userId: string): Promise<void> {
  const admin = adminClient()
  await admin.auth.admin.deleteUser(userId)
  await admin.from('signup_ip_claims').delete().eq('user_id', userId)
  await admin.from('signup_device_claims').delete().eq('user_id', userId)
  await admin.from('signup_identity_claims').delete().eq('user_id', userId)
}

/** Inserts a lead owned by `userId`, bypassing RLS. Returns the row id. */
export async function seedLead(
  userId: string,
  jobId: string,
  fullName: string,
): Promise<string> {
  const admin = adminClient()
  const { data, error } = await admin
    .from('extracted_leads')
    .insert({
      user_id: userId,
      extraction_job_id: jobId,
      full_name: fullName,
      linkedin_url: `https://www.linkedin.com/sales/lead/fabricated-${fullName}`,
      dedupe_key: `li:lead:fabricated-${fullName}`,
      dedupe_strategy: 'linkedin_url_canonical',
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`seedLead failed: ${error?.message ?? 'no row'}`)
  }
  return data.id
}

/** Creates a job owned by `userId`, bypassing RLS. Returns the job id. */
export async function seedJob(userId: string): Promise<string> {
  const admin = adminClient()
  const { data, error } = await admin
    .from('extraction_jobs')
    .insert({ user_id: userId, status: 'completed' })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`seedJob failed: ${error?.message ?? 'no row'}`)
  }
  return data.id
}
