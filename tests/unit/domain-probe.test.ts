/**
 * Finding a domain without a search engine.
 *
 * ⚠️ GUESSING A HOSTNAME IS NOT FINDING A DOMAIN. `acme.com` resolving proves
 * a domain exists, not that it belongs to the Acme in this database. A wrong
 * domain is worse than none: it becomes the company's identity and drags
 * another company's funding, headcount and staff onto these leads.
 */
import { describe, expect, it } from 'vitest'

import { candidateHosts, candidateStems, nameAsHost, pageNamesCompany } from '@/lib/companies/domain-probe'

describe('candidateStems', () => {
  it('strips legal suffixes a company never puts in a hostname', () => {
    expect(candidateStems('Acme Systems Ltd')).toContain('acmesystems')
    expect(candidateStems('Acme Systems Ltd').join()).not.toContain('ltd')
  })

  it('offers full name, name-minus-last-word, and first word', () => {
    expect(candidateStems('Atlas AI Solutions')).toEqual(['atlasaisolutions', 'atlasai', 'atlas'])
  })

  it('REFUSES stems under five characters', () => {
    // Short stems collide with unrelated domains far too easily.
    expect(candidateStems('Bun')).toEqual([])
    expect(candidateStems('Arc')).toEqual([])
  })

  it('is bounded at three, so a backfill is not a port scan', () => {
    expect(candidateStems('Alpha Beta Gamma Delta Epsilon').length).toBeLessThanOrEqual(3)
  })
})

describe('nameAsHost — try the obvious first', () => {
  it('recognises a company whose NAME is its domain', () => {
    /*
     * ⚠️ A REAL MISS. A sample run failed on evry.space, Litigators.org and
     * echomode.io while probing a dozen invented candidates for each — and
     * "found" evryspace.com for evry.space, a different string that may be a
     * different company.
     */
    expect(nameAsHost('evry.space')).toBe('evry.space')
    expect(nameAsHost('Litigators.org')).toBe('litigators.org')
    expect(nameAsHost('echomode.io')).toBe('echomode.io')
  })

  it('normalises scheme, www and trailing path', () => {
    expect(nameAsHost('https://www.Acme.com/about')).toBe('acme.com')
  })

  it('is null for an ordinary company name', () => {
    expect(nameAsHost('Atlas AI Solutions')).toBeNull()
    expect(nameAsHost('Acme Inc.')).toBeNull()
  })

  it('puts the literal host FIRST among candidates', () => {
    expect(candidateHosts('evry.space')[0]).toBe('evry.space')
  })
})

describe('pageNamesCompany — the only thing separating this from fabrication', () => {
  it('accepts a page that names the company', () => {
    expect(
      pageNamesCompany('Atlas AI Solutions', 'Atlas AI', 'Atlas AI builds solutions for planning'),
    ).toBe(true)
  })

  it('REJECTS an unrelated namesake', () => {
    // atlas.com might be a moving company. Attaching it would put another
    // firm's staff and funding onto these leads.
    expect(pageNamesCompany('Atlas AI Solutions', 'Atlas Moving', 'Atlas is a moving company in Ohio')).toBe(false)
  })

  it('REJECTS a parking page', () => {
    expect(pageNamesCompany('Atlas AI Solutions', 'Domain for sale', 'This domain may be for sale')).toBe(false)
  })

  it('requires EVERY distinctive word, not just one', () => {
    // Matching on "atlas" alone is how the wrong company gets attached.
    expect(pageNamesCompany('Blue Sherpa', 'Blue', 'Blue paint supplies')).toBe(false)
    expect(pageNamesCompany('Blue Sherpa', 'Blue Sherpa', 'Blue Sherpa advisory')).toBe(true)
  })

  it('refuses when the name yields nothing distinctive', () => {
    expect(pageNamesCompany('Ltd', null, 'anything at all')).toBe(false)
  })
})
