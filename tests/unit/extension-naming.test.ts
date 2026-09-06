import { describe, expect, it } from 'vitest'

import { extensionCaptureFilename } from '@/lib/extension/naming'

describe('extensionCaptureFilename', () => {
  it('uses the visible lead-list name and page number', () => {
    expect(extensionCaptureFilename('SaaS Founders UK', '2')).toBe(
      'SaaS Founders UK - Page 2.html',
    )
  })

  it('sanitizes path-like names and defaults the first page', () => {
    expect(extensionCaptureFilename('../../Enterprise Prospects', null)).toBe(
      'Enterprise Prospects - Page 1.html',
    )
  })

  it('uses a readable fallback when no title is exposed', () => {
    expect(extensionCaptureFilename(null, '3')).toBe(
      'Sales Navigator lead list - Page 3.html',
    )
  })
})
