/**
 * The pure pieces behind the Hubble dashboard: avatars and batch filtering.
 *
 * Both are places where a plausible-looking wrong answer is easy. A monogram
 * that changes colour reads as a different person; a batch that survives its
 * own date filter runs research on leads the filter says are not there.
 */
import { describe, expect, it } from 'vitest'

import { companyLogoUrl, initialsFor, tintFor } from '@/lib/intelligence/avatar'
import { batchLabel, batchesInRange, selectionStillValid } from '@/lib/intelligence/batches'
import { dateRangeBounds } from '@/lib/intelligence/date-range'

describe('initialsFor', () => {
  it('takes the first and LAST word', () => {
    // "Maria del Carmen Ruiz" is MR, not MD.
    expect(initialsFor('Maria del Carmen Ruiz')).toBe('MR')
    expect(initialsFor('Alex Thompson')).toBe('AT')
  })

  it('uses two letters of a single name', () => {
    expect(initialsFor('Cluely')).toBe('CL')
  })

  it('strips punctuation and titles rendered with dots', () => {
    expect(initialsFor('Dr. Sophie Chen')).toBe('DC')
    expect(initialsFor('Jean-Luc Picard')).toBe('JP')
  })

  it('handles non-Latin names without dropping to a placeholder', () => {
    expect(initialsFor('李 明')).toBe('李明')
  })

  it('falls back rather than rendering nothing', () => {
    for (const value of [null, undefined, '', '   ', '!!!']) {
      expect(initialsFor(value), JSON.stringify(value)).toBe('?')
    }
  })
})

describe('tintFor', () => {
  it('is DETERMINISTIC', () => {
    // A monogram that changes colour when you page back and forth reads as a
    // different person.
    expect(tintFor('Alex Thompson')).toBe(tintFor('Alex Thompson'))
  })

  it('spreads different names across the palette', () => {
    const names = ['Alex Thompson', 'Sophie Chen', 'Jason Rodriguez', 'Priya Shah', 'Michael Park']
    expect(new Set(names.map((name) => tintFor(name).bg)).size).toBeGreaterThan(1)
  })

  it('always returns a usable pair, even for nothing', () => {
    expect(tintFor(null).bg).toBeTruthy()
    expect(tintFor(null).fg).toBeTruthy()
  })
})

describe('companyLogoUrl', () => {
  it('builds a favicon URL from a domain', () => {
    expect(companyLogoUrl('acme.com')).toContain('domain=acme.com')
  })

  it('normalises what the database actually stores', () => {
    for (const stored of ['https://acme.com', 'https://www.acme.com/', 'ACME.com', 'acme.com/about']) {
      expect(companyLogoUrl(stored), stored).toContain('domain=acme.com')
    }
  })

  it('returns null when we have no domain — the monogram takes over', () => {
    for (const value of [null, undefined, '', '   ', 'localhost', 'notadomain']) {
      expect(companyLogoUrl(value), JSON.stringify(value)).toBeNull()
    }
  })

  it('refuses LinkedIn and our own domain, which are not the company mark', () => {
    expect(companyLogoUrl('linkedin.com')).toBeNull()
    expect(companyLogoUrl('lnkd.in')).toBeNull()
    expect(companyLogoUrl('outlio.io')).toBeNull()
  })

  it('refuses anything carrying URL grammar', () => {
    // A hostname is a hostname; a query string in it is not one.
    expect(companyLogoUrl('acme.com&x=1')).toBeNull()
    expect(companyLogoUrl('acme com')).toBeNull()
  })
})

describe('batch filtering', () => {
  const batches = [
    { id: 'a', label: 'Series A founders', leadCount: 25, createdAt: '2026-08-01T09:00:00.000Z' },
    { id: 'b', label: 'SaaS CTOs', leadCount: 25, createdAt: '2026-08-14T16:00:00.000Z' },
    { id: 'c', label: 'Old list', leadCount: 12, createdAt: '2026-07-02T11:00:00.000Z' },
  ]

  it('labels a batch with its name, size and exact time', () => {
    // Three lists extracted this morning are otherwise indistinguishable, and
    // picking the wrong one researches the wrong 25 people.
    expect(batchLabel(batches[0]!)).toBe('Series A founders · 25 leads · 1 Aug 2026, 09:00')
  })

  it('"All time" passes everything', () => {
    expect(batchesInRange(batches, null)).toHaveLength(3)
  })

  it('narrows to the picked range', () => {
    const bounds = dateRangeBounds('2026-08-01', '2026-08-14')
    expect(batchesInRange(batches, bounds).map((b) => b.id)).toEqual(['a', 'b'])
  })

  it('INCLUDES a batch extracted late on the closing day', () => {
    /*
     * Batch `b` ran at 16:00 on the 14th. A filter comparing against that
     * morning's midnight would drop it, and the user would be told the run
     * they just made does not exist.
     */
    const bounds = dateRangeBounds('2026-08-14', '2026-08-14')
    expect(batchesInRange(batches, bounds).map((b) => b.id)).toEqual(['b'])
  })

  it('returns nothing for a range with no extractions', () => {
    expect(batchesInRange(batches, dateRangeBounds('2026-01-01', '2026-01-31'))).toEqual([])
  })
})

describe('selectionStillValid', () => {
  const visible = [{ id: 'a', label: 'x', leadCount: 25, createdAt: '2026-08-01T09:00:00.000Z' }]

  it('keeps a selection that is still on screen', () => {
    expect(selectionStillValid('a', visible)).toBe(true)
  })

  it('REJECTS a selection the filter has hidden', () => {
    // Otherwise the user researches leads the filter says are not there.
    expect(selectionStillValid('b', visible)).toBe(false)
  })

  it('treats no selection as valid', () => {
    expect(selectionStillValid(null, visible)).toBe(true)
  })
})
