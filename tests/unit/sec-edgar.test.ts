import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  requestJson as liveRequestJson,
  type ProviderRequest,
} from '@/lib/intelligence/http'
import {
  cleanRecentFilings,
  extractSecCompanyMetadata,
  parseSecMasterList,
  pickSecCompany,
  SEC_MIN_REQUEST_INTERVAL_MS,
  SEC_REQUEST_HEADERS,
  SecEdgarService,
  secEdgarProvider,
  type SecCompanyMatch,
  type SecEdgarDependencies,
} from '@/lib/intelligence/providers/sec-edgar'
import type { ResearchTask } from '@/lib/intelligence/types'

const COMPANY_ID = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-08-15T12:00:00.000Z')
const MATCH: SecCompanyMatch = {
  cik: '0000320193',
  matchedName: 'Apple Inc.',
  tickers: ['AAPL', 'APC.F'],
}

const MASTER = {
  0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  1: { cik_str: 320193, ticker: 'APC.F', title: 'APPLE INC /DE/' },
  2: { cik_str: 1652044, ticker: 'GOOGL', title: 'Alphabet Inc.' },
}

const PROFILE = {
  cik: '0000320193',
  entityType: 'operating',
  sic: '3571',
  sicDescription: 'Electronic Computers',
  name: 'Apple Inc.',
  tickers: ['AAPL'],
  exchanges: ['Nasdaq'],
  ein: '942404110',
  lei: 'HWUPKR0MPOU8FGXBT394',
  stateOfIncorporation: 'CA',
  stateOfIncorporationDescription: 'California',
  fiscalYearEnd: '0926',
  addresses: {
    business: {
      street1: 'ONE APPLE PARK WAY',
      street2: null,
      city: 'CUPERTINO',
      stateOrCountry: 'CA',
      zipCode: '95014',
      country: null,
    },
  },
  website: 'https://www.apple.com/',
  investorWebsite: 'investor.apple.com',
  formerNames: [{ name: 'APPLE COMPUTER INC', from: '1994-01-26T05:00:00.000Z', to: '2007-01-04T05:00:00.000Z' }],
  filings: {
    recent: {
      accessionNumber: ['0000320193-26-000001', 'bad'],
      form: ['10-K', '8-K'],
      filingDate: ['2026-08-01', '2026-08-02'],
      reportDate: ['2026-07-31', ''],
      acceptanceDateTime: ['2026-08-01T10:30:00.000Z', 'bad'],
      fileNumber: ['001-36743', ''],
      items: ['', '2.02'],
      primaryDocument: ['aapl-20260731.htm', '../secret'],
    },
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function task(fields: ResearchTask['fields'] = ['sec_legal_name']): ResearchTask {
  return {
    id: `company_profile:company:${COMPANY_ID}`,
    category: 'company_profile',
    entity: {
      type: 'company',
      id: COMPANY_ID,
      name: 'Apple',
      domain: 'apple.com',
      linkedinUrl: null,
    },
    fields,
  }
}

function cachedDependencies(
  overrides: Partial<SecEdgarDependencies> = {},
): SecEdgarDependencies {
  return {
    requestJson: async <T>() => PROFILE as T,
    readCache: async <T>() => ({
      value: parseSecMasterList(MASTER) as T,
      retrievedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    }),
    writeCache: async () => undefined,
    awaitRequestSlot: async () => undefined,
    now: () => NOW,
    ...overrides,
  }
}

describe('SEC ticker/CIK identity resolution', () => {
  it('parses, validates, and groups multiple tickers under one padded CIK', () => {
    expect(parseSecMasterList({
      ...MASTER,
      3: { cik_str: '../bad', ticker: 'BAD', title: 'Bad Co' },
      4: { cik_str: 123, ticker: '<script>', title: '' },
    })).toEqual([
      {
        cik: '0000320193',
        names: ['Apple Inc.', 'APPLE INC /DE/'],
        tickers: ['AAPL', 'APC.F'],
      },
      {
        cik: '0001652044',
        names: ['Alphabet Inc.'],
        tickers: ['GOOGL'],
      },
    ])
  })

  it('matches one exact normalized legal name including SEC annotations', () => {
    expect(pickSecCompany('Apple', parseSecMasterList(MASTER))).toEqual(MATCH)
    expect(pickSecCompany('Apple Incorporated', parseSecMasterList(MASTER))).toEqual(MATCH)
  })

  it('refuses fuzzy and ambiguous company names', () => {
    expect(pickSecCompany('Apple Software', parseSecMasterList(MASTER))).toBeNull()
    expect(pickSecCompany('Meta', parseSecMasterList(MASTER))).toBeNull()
    expect(pickSecCompany('Apple', [
      ...parseSecMasterList(MASTER),
      { cik: '0000000001', names: ['Apple LLC'], tickers: [] },
    ])).toBeNull()
  })
})

describe('SEC submissions normalization', () => {
  it('returns a clean matching payload with identifiers, address, website, and filings', () => {
    expect(extractSecCompanyMetadata(PROFILE, MATCH)).toMatchObject({
      cik: '0000320193',
      legalName: 'Apple Inc.',
      entityType: 'operating',
      sic: '3571',
      sicDescription: 'Electronic Computers',
      ein: '942404110',
      lei: 'HWUPKR0MPOU8FGXBT394',
      tickers: ['AAPL', 'APC.F'],
      exchanges: ['Nasdaq'],
      stateOfIncorporation: 'CA',
      businessAddress: {
        formatted: 'ONE APPLE PARK WAY, CUPERTINO, CA, 95014',
      },
      website: 'https://apple.com',
      websiteDomain: 'apple.com',
      investorWebsite: 'https://investor.apple.com',
      formerNames: [{ name: 'APPLE COMPUTER INC' }],
      filingHistory: [{
        accessionNumber: '0000320193-26-000001',
        form: '10-K',
        filingDate: '2026-08-01',
        primaryDocumentUrl:
          'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-20260731.htm',
      }],
    })
  })

  it('rejects a submissions response whose CIK disagrees with the master match', () => {
    expect(extractSecCompanyMetadata({ ...PROFILE, cik: '1652044' }, MATCH)).toBeNull()
    expect(extractSecCompanyMetadata({ ...PROFILE, name: '' }, MATCH)).toBeNull()
  })

  it('caps filing history and discards malformed rows and unsafe document paths', () => {
    const count = 105
    const recent = {
      accessionNumber: Array.from({ length: count }, (_, i) =>
        i === 1 ? 'bad' : `0000320193-26-${String(i).padStart(6, '0')}`),
      form: Array.from({ length: count }, () => '8-K'),
      filingDate: Array.from({ length: count }, () => '2026-08-01'),
      primaryDocument: Array.from({ length: count }, (_, i) => i === 2 ? '../secret' : 'form.htm'),
    }

    const filings = cleanRecentFilings('0000320193', recent)
    expect(filings).toHaveLength(100)
    expect(filings.some((filing) => filing.accessionNumber === 'bad')).toBe(false)
    expect(filings.find((filing) => filing.accessionNumber.endsWith('000002'))?.primaryDocumentUrl)
      .toBeNull()
  })
})

describe('SEC EDGAR backend service', () => {
  it('reuses the shared master-list cache and only fetches submissions', async () => {
    const calls: ProviderRequest[] = []
    const reserve = vi.fn(async () => undefined)
    const service = new SecEdgarService(cachedDependencies({
      requestJson: async <T>(request: ProviderRequest) => {
        calls.push(request)
        return PROFILE as T
      },
      awaitRequestSlot: reserve,
    }))

    const result = await service.searchCompanyByName('Apple')

    expect(result?.cik).toBe('0000320193')
    expect(calls.map((call) => call.url)).toEqual([
      'https://data.sec.gov/submissions/CIK0000320193.json',
    ])
    expect(calls[0]?.headers).toEqual(SEC_REQUEST_HEADERS)
    expect(calls[0]?.beforeAttempt).toBeTypeOf('function')
    await calls[0]!.beforeAttempt!()
    expect(reserve).toHaveBeenCalledWith('sec.gov', SEC_MIN_REQUEST_INTERVAL_MS)
  })

  it('downloads, caches, and coalesces a cold master-list refresh', async () => {
    const requests: string[] = []
    const writes: unknown[] = []
    const service = new SecEdgarService(cachedDependencies({
      readCache: async () => null,
      requestJson: async <T>(request: ProviderRequest) => {
        requests.push(request.url)
        return MASTER as T
      },
      writeCache: async (...args) => {
        writes.push(args)
      },
    }))

    const [first, second] = await Promise.all([service.getMasterList(), service.getMasterList()])
    const third = await service.getMasterList()

    expect(first).toEqual(second)
    expect(third).toEqual(first)
    expect(requests).toEqual(['https://www.sec.gov/files/company_tickers.json'])
    expect(writes).toHaveLength(1)
  })

  it('sends the exact declared SEC headers through the shared HTTP client', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('user-agent')).toBe('OUTLIO husnain@outlio.io')
      expect(headers.get('accept-encoding')).toBe('gzip, deflate')
      return Response.json(PROFILE)
    })
    vi.stubGlobal('fetch', fetchMock)

    const service = new SecEdgarService(cachedDependencies({
      requestJson: liveRequestJson,
    }))
    await expect(service.searchCompanyByName('Apple')).resolves.toMatchObject({
      cik: '0000320193',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('SEC EDGAR provider evidence', () => {
  it('emits source-backed SEC facts and bonus official-domain evidence', () => {
    const metadata = extractSecCompanyMetadata(PROFILE, MATCH)!
    const evidence = secEdgarProvider.normalize(metadata, task(['sec_legal_name']))
    const byField = new Map(evidence.map((item) => [item.field, item]))

    expect(byField.get('sec_cik')?.value).toEqual({ value: '0000320193' })
    expect(byField.get('sec_legal_name')?.value).toEqual({ value: 'Apple Inc.' })
    expect(byField.get('sec_business_address')?.value).toMatchObject({
      value: 'ONE APPLE PARK WAY, CUPERTINO, CA, 95014',
    })
    expect(byField.get('sec_website')?.value).toMatchObject({
      value: 'apple.com',
      domain: 'apple.com',
    })
    expect(byField.get('sec_filing_history')?.value).toMatchObject({
      value: ['10-K'],
      filings: [{ form: '10-K' }],
    })
    expect(byField.get('company_domain')?.value).toEqual({
      domain: 'apple.com',
      website: 'https://apple.com',
    })
    expect(evidence.every((item) => item.sourceProvider === 'sec-edgar')).toBe(true)
    expect(evidence.every((item) => item.sourceConfidence === 'high')).toBe(true)
  })

  it('handles only SEC fields for named companies', () => {
    expect(secEdgarProvider.canHandle(task(['sec_cik']))).toBe(true)
    expect(secEdgarProvider.canHandle(task(['employee_count']))).toBe(false)
    expect(secEdgarProvider.canHandle({
      ...task(['sec_cik']),
      entity: {
        type: 'company',
        id: COMPANY_ID,
        name: null,
        domain: null,
        linkedinUrl: null,
      },
    })).toBe(false)
  })
})
