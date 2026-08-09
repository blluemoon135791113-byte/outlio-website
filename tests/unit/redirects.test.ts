import { afterEach, describe, expect, it, vi } from 'vitest'

import { appOrigin, safeRedirectPath } from '@/lib/auth/redirects'

describe('authentication redirects', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('uses the configured canonical HTTPS origin', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com/some/path')
    expect(appOrigin('http://attacker.test')).toBe('https://app.example.com')
  })

  it('never trusts a request host in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    expect(appOrigin('https://attacker.test')).toBe('https://outlio.io')
  })

  it('allows localhost request origins during development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    expect(appOrigin('http://localhost:3000')).toBe('http://localhost:3000')
  })

  it.each([
    'https://attacker.test',
    '//attacker.test',
    '/\\attacker.test',
    'dashboard',
    '/dashboard\nLocation: https://attacker.test',
  ])('rejects unsafe redirect path %j', (value) => {
    expect(safeRedirectPath(value)).toBe('/dashboard')
  })

  it('preserves a safe relative path and query', () => {
    expect(safeRedirectPath('/dashboard/jobs?page=2')).toBe('/dashboard/jobs?page=2')
  })
})
