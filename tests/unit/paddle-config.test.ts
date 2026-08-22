import { afterEach, describe, expect, it } from 'vitest'

import {
  countryCodeFromHeader,
  getPaddleBrowserConfig,
  getPaddleEnvironment,
} from '@/lib/paddle/config'

const originalEnvironment = process.env.PADDLE_ENVIRONMENT
const originalToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN

afterEach(() => {
  if (originalEnvironment === undefined) delete process.env.PADDLE_ENVIRONMENT
  else process.env.PADDLE_ENVIRONMENT = originalEnvironment

  if (originalToken === undefined) delete process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN
  else process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN = originalToken
})

describe('Paddle environment configuration', () => {
  it('fails loudly when the environment is absent', () => {
    delete process.env.PADDLE_ENVIRONMENT
    expect(() => getPaddleEnvironment()).toThrow('PADDLE_ENVIRONMENT')
  })

  it('rejects a sandbox token in production', () => {
    process.env.PADDLE_ENVIRONMENT = 'production'
    process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN = 'test_wrong-account'
    expect(() => getPaddleBrowserConfig()).toThrow('live_')
  })

  it('accepts a live client token in production', () => {
    process.env.PADDLE_ENVIRONMENT = 'production'
    process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN = 'live_example'
    expect(getPaddleBrowserConfig()).toEqual({
      environment: 'production',
      token: 'live_example',
    })
  })
})

describe('countryCodeFromHeader', () => {
  it('normalizes a valid Vercel country code', () => {
    expect(countryCodeFromHeader(' gb ')).toBe('GB')
  })

  it.each([null, '', 'OTHERS', 'unknown', 'USA', '1A'])('omits invalid country %s', (value) => {
    expect(countryCodeFromHeader(value)).toBeUndefined()
  })
})
