/**
 * The website readers' page list and parallel reading.
 *
 * Pinned: the homepage plus the four fixed paths, in order, on the bare host;
 * nothing for an unusable domain; reads run at most N at once and keep their
 * order; and the reader actually reads in parallel, not one page at a time.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { inParallel, siteReadingList } from '@/lib/intelligence/site-pages'

describe('siteReadingList', () => {
  it('is the homepage and the fixed contact paths, on the bare host', () => {
    expect(siteReadingList('www.fabricated.example')).toEqual([
      'https://fabricated.example/',
      'https://fabricated.example/contact/',
      'https://fabricated.example/contact-us/',
      'https://fabricated.example/about/',
      'https://fabricated.example/about-us/',
    ])
  })

  it('is empty for an unusable domain', () => {
    expect(siteReadingList(null)).toEqual([])
    expect(siteReadingList('')).toEqual([])
  })
})

describe('inParallel', () => {
  it('never runs more than the limit at once, and keeps the input order', async () => {
    let running = 0
    let peak = 0
    const results = await inParallel([30, 5, 20, 1, 10], 3, async (ms) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, ms))
      running -= 1
      return ms * 2
    })
    expect(results).toEqual([60, 10, 40, 2, 20])
    expect(peak).toBe(3)
  })
})

describe('the website reader', () => {
  it('reads the homepage first, then the rest at most four at a time', async () => {
    const { harvestWebsiteContacts } = await import('@/lib/intelligence/providers/scout')
    let running = 0
    let peak = 0
    const order: string[] = []
    const contacts = await harvestWebsiteContacts('fabricated.example', async (url) => {
      order.push(url)
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 10))
      running -= 1
      return url.endsWith('/contact/') ? 'Write to hello@fabricated.example' : null
    })

    expect(order[0]).toBe('https://fabricated.example/')
    expect(peak).toBe(4)
    expect(contacts.onDomain).toEqual(['hello@fabricated.example'])
  })
})
