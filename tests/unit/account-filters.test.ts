/**
 * The Accounts list's URL query language — workspace tag groups (0153).
 */
import { describe, expect, it } from 'vitest'

import {
  NO_MATCH,
  accountQueryToParams,
  accountsHref,
  activeFilterCount,
  escapeLike,
  parseAccountQuery,
  toAccountRpcFilters,
  withTag,
} from '@/lib/crm/account-filters'

const VOCAB = {
  groups: new Map([
    ['industry', new Map([['saas', 'tag-saas'], ['fintech', 'tag-fintech']])],
    ['region', new Map([['emea', 'tag-emea']])],
  ]),
  statuses: new Map([['new', 'status-new']]),
}
const ADMIN = { userId: 'u-admin', viewAll: true }
const EMPLOYEE = { userId: 'u-sam', viewAll: false }

describe('parseAccountQuery', () => {
  it('reads every filter', () => {
    const q = parseAccountQuery({
      scope: 'mine',
      tag: ['industry:saas', 'region:emea'],
      assignee: 'unassigned',
      status: 'new',
      priority: 'high',
      source: 'manual',
      q: '  acme  ',
      sort: 'last_activity',
      dir: 'desc',
      page: '3',
    })
    expect(q).toEqual({
      scope: 'mine',
      tags: { industry: 'saas', region: 'emea' },
      assignee: 'unassigned',
      status: 'new',
      priority: 'high',
      source: 'manual',
      q: 'acme',
      sort: 'last_activity',
      desc: true,
      page: 3,
    })
  })

  it('drops what it cannot read instead of throwing — an old bookmark still opens', () => {
    const q = parseAccountQuery({
      scope: 'everyone',
      tag: ['../../etc', 'industry', 'a:b:c', ':saas', 'Industry:Has Space'],
      assignee: 'robert; drop table',
      priority: 'urgent',
      source: 'telepathy',
      sort: 'random()',
      page: '-4',
    })
    expect(q).toEqual({
      scope: undefined,
      tags: {},
      assignee: undefined,
      status: undefined,
      priority: undefined,
      source: undefined,
      q: undefined,
      sort: 'name',
      desc: false,
      page: 1,
    })
  })

  it('one value per group — the first wins', () => {
    expect(parseAccountQuery({ tag: ['industry:saas', 'industry:fintech'] }).tags).toEqual({ industry: 'saas' })
  })

  it('a single tag parameter works as well as a repeated one', () => {
    expect(parseAccountQuery({ tag: 'Region:EMEA' }).tags).toEqual({ region: 'emea' })
  })

  it('caps the search length', () => {
    expect(parseAccountQuery({ q: 'x'.repeat(500) }).q).toHaveLength(100)
  })

  it('round-trips through the URL, omitting defaults', () => {
    const q = parseAccountQuery({ tag: ['region:emea', 'industry:saas'], sort: 'name', page: '1' })
    // Sorted by group, so one view has one URL.
    expect(accountQueryToParams(q).toString()).toBe('tag=industry%3Asaas&tag=region%3Aemea')
    const again = new URLSearchParams(accountQueryToParams(q))
    expect(parseAccountQuery({ tag: again.getAll('tag') })).toEqual(q)
  })
})

describe('toAccountRpcFilters', () => {
  it('turns group:value slugs into tag ids', () => {
    const f = toAccountRpcFilters(
      parseAccountQuery({ tag: ['industry:saas', 'region:emea'], status: 'new' }),
      VOCAB,
      ADMIN,
    )
    expect(f).toMatchObject({ tags: ['tag-saas', 'tag-emea'], status: 'status-new' })
  })

  /*
   * ⚠️ THE ONE THAT MATTERS. Ignoring an unknown value would turn a shared
   * "SaaS accounts" link into "all accounts" after someone deletes the value
   * or the group — and the reader would work the wrong list.
   */
  it('an unknown value OR an unknown group filters to nothing rather than being ignored', () => {
    expect(toAccountRpcFilters(parseAccountQuery({ tag: 'industry:deleted' }), VOCAB, ADMIN).tags).toEqual([NO_MATCH])
    expect(toAccountRpcFilters(parseAccountQuery({ tag: 'gone-group:saas' }), VOCAB, ADMIN).tags).toEqual([NO_MATCH])
  })

  it('no tag filter is an empty list', () => {
    expect(toAccountRpcFilters(parseAccountQuery({}), VOCAB, ADMIN).tags).toEqual([])
  })

  it('an employee without view_all is always on My Accounts', () => {
    expect(toAccountRpcFilters(parseAccountQuery({ scope: 'all' }), VOCAB, EMPLOYEE).scope).toBe('mine')
    expect(toAccountRpcFilters(parseAccountQuery({}), VOCAB, EMPLOYEE).scope).toBe('mine')
  })

  it('a view_all member defaults to All and may choose Mine', () => {
    expect(toAccountRpcFilters(parseAccountQuery({}), VOCAB, ADMIN).scope).toBe('all')
    expect(toAccountRpcFilters(parseAccountQuery({ scope: 'mine' }), VOCAB, ADMIN).scope).toBe('mine')
  })

  it('assignee=me means the viewer', () => {
    expect(toAccountRpcFilters(parseAccountQuery({ assignee: 'me' }), VOCAB, EMPLOYEE).assignee).toBe('u-sam')
  })

  it('escapes the search for ILIKE', () => {
    expect(toAccountRpcFilters(parseAccountQuery({ q: '100%_off' }), VOCAB, ADMIN).q).toBe('100\\%\\_off')
  })
})

describe('helpers', () => {
  it('escapeLike escapes the escape character too', () => {
    expect(escapeLike('a\\b%c_d')).toBe('a\\\\b\\%c\\_d')
  })

  it('counts active filters, one per tag group, not sort or page', () => {
    expect(
      activeFilterCount(parseAccountQuery({ tag: ['industry:saas', 'region:emea'], q: 'x', sort: 'created', page: '2' })),
    ).toBe(3)
  })

  it('withTag sets, replaces and clears one group without touching the others', () => {
    const tags = { industry: 'saas', region: 'emea' }
    expect(withTag(tags, 'industry', 'fintech')).toEqual({ industry: 'fintech', region: 'emea' })
    expect(withTag(tags, 'industry', undefined)).toEqual({ region: 'emea' })
    expect(tags).toEqual({ industry: 'saas', region: 'emea' })
  })
})

describe('accountsHref', () => {
  const base = parseAccountQuery({ tag: 'industry:saas', sort: 'created', dir: 'desc', page: '4' })

  it('a filter change returns to page 1', () => {
    expect(accountsHref(base, { tags: withTag(base.tags, 'region', 'emea') })).toBe(
      '/crm/companies?tag=industry%3Asaas&tag=region%3Aemea&sort=created&dir=desc',
    )
  })

  it('removing a filter also returns to page 1', () => {
    expect(accountsHref(base, { tags: {} })).toBe('/crm/companies?sort=created&dir=desc')
  })

  it('sorting and paging keep everything else', () => {
    expect(accountsHref(base, { page: 5 })).toBe('/crm/companies?tag=industry%3Asaas&sort=created&dir=desc&page=5')
    expect(accountsHref(base, { sort: 'name', desc: false })).toBe('/crm/companies?tag=industry%3Asaas&page=4')
  })

  it('an empty view is the bare path', () => {
    expect(accountsHref(parseAccountQuery({}))).toBe('/crm/companies')
  })
})
