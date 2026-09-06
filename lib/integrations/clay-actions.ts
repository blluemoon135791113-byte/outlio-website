'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { assertAccess } from '@/lib/auth/access'
import { consume } from '@/lib/auth/rate-limit'
import { clayConnectionLabel, parseClayWebhookUrl, testClayCredentials } from '@/lib/integrations/clay'
import {
  disconnectClayConnection,
  getClayCredentials,
  saveClayConnection,
  updateClayConnectionTest,
} from '@/lib/integrations/repository'
import { recordSecurityEvent } from '@/lib/security/events'
import { ACTION_LIMITS } from '@/lib/security/action-limits'

export type ClayActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string }

const webhookSchema = z.string().trim().url().max(2048)
const tokenSchema = z.string().trim().max(1024)

async function allowed(userId: string): Promise<boolean> {
  return (await consume(ACTION_LIMITS.export, `user:${userId}`)).allowed
}

export async function connectClayAction(
  _previous: ClayActionState,
  formData: FormData,
): Promise<ClayActionState> {
  const ctx = await assertAccess()
  const userId = ctx.userId!
  if (!(await allowed(userId))) {
    return { status: 'error', message: 'Too many requests. Please wait and try again.' }
  }

  const webhookResult = webhookSchema.safeParse(formData.get('webhook_url'))
  const tokenResult = tokenSchema.safeParse(formData.get('authentication_token') ?? '')
  if (!webhookResult.success || !tokenResult.success) {
    return { status: 'error', message: 'Enter a valid Clay webhook URL and authentication token.' }
  }

  const webhook = parseClayWebhookUrl(webhookResult.data)
  if (!webhook) {
    return {
      status: 'error',
      message: 'Use the HTTPS webhook URL copied from your Clay table.',
    }
  }

  const credentials = {
    clayWebhookUrl: webhook.href,
    clayAuthenticationToken: tokenResult.data || undefined,
  }
  const test = await testClayCredentials(credentials)
  if (!test.ok) {
    await recordSecurityEvent({
      event: 'integration.connection_failed',
      level: 'warn',
      userId,
      context: { provider: 'clay', reason: 'connection_test_failed' },
    })
    return { status: 'error', message: test.message }
  }

  try {
    await saveClayConnection(userId, credentials, clayConnectionLabel(webhook.href))
  } catch {
    return {
      status: 'error',
      message: 'Clay was reached, but the connection could not be saved. Apply the integration database migration and try again.',
    }
  }

  await recordSecurityEvent({
    event: 'integration.connected',
    userId,
    context: { provider: 'clay' },
  })
  revalidatePath('/dashboard/settings')
  return { status: 'success', message: 'Clay connected successfully.' }
}

export async function testClayConnectionAction(
  _previous: ClayActionState,
): Promise<ClayActionState> {
  const ctx = await assertAccess()
  const userId = ctx.userId!
  if (!(await allowed(userId))) {
    return { status: 'error', message: 'Too many requests. Please wait and try again.' }
  }

  const stored = await getClayCredentials(userId)
  if (!stored) return { status: 'error', message: 'Connect Clay before testing it.' }

  const test = await testClayCredentials(stored.credentials)
  await updateClayConnectionTest(userId, test)
  revalidatePath('/dashboard/settings')

  if (!test.ok) return { status: 'error', message: test.message }

  await recordSecurityEvent({
    event: 'integration.connection_tested',
    userId,
    context: { provider: 'clay', result: 'ok' },
  })
  return { status: 'success', message: 'Clay connection is working.' }
}

export async function disconnectClayAction(
  _previous: ClayActionState,
): Promise<ClayActionState> {
  const ctx = await assertAccess()
  const userId = ctx.userId!
  if (!(await allowed(userId))) {
    return { status: 'error', message: 'Too many requests. Please wait and try again.' }
  }

  try {
    await disconnectClayConnection(userId)
  } catch {
    return { status: 'error', message: 'Clay could not be disconnected. Please try again.' }
  }

  await recordSecurityEvent({
    event: 'integration.disconnected',
    userId,
    context: { provider: 'clay' },
  })
  revalidatePath('/dashboard/settings')
  return { status: 'success', message: 'Clay disconnected.' }
}
