import 'server-only'

import { Environment, Paddle } from '@paddle/paddle-node-sdk'

import { getPaddleEnvironment } from '@/lib/paddle/config'

let cached: Paddle | null = null

export function getPaddleClient(): Paddle {
  if (cached) return cached

  const apiKey = process.env.PADDLE_API_KEY?.trim()
  if (!apiKey) throw new Error('Missing required environment variable PADDLE_API_KEY')

  cached = new Paddle(apiKey, {
    environment:
      getPaddleEnvironment() === 'production' ? Environment.production : Environment.sandbox,
  })
  return cached
}

export function getPaddleWebhookSecret(): string {
  const secret = process.env.PADDLE_WEBHOOK_SECRET?.trim()
  if (!secret) throw new Error('Missing required environment variable PADDLE_WEBHOOK_SECRET')
  return secret
}

