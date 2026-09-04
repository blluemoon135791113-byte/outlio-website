/**
 * Provenance display, and the URL that arrives from a crawled page.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ `source_url` IS ATTACKER-INFLUENCED DATA THAT ENDS UP IN AN `href`.   ║
 * ║                                                                           ║
 * ║  It is not typed by a user and not chosen by us — it is whatever a page   ║
 * ║  we fetched supplied. Written once by a crawl, then rendered to every     ║
 * ║  person who opens that contact from then on. A `javascript:` URL there is ║
 * ║  stored XSS with a long fuse.                                            ║
 * ║                                                                           ║
 * ║  ⚠️ AND `entered` MUST NOT COLLAPSE INTO `unknown` (DECISION-11). If      ║
 * ║  hand-typed values were labelled "source not recorded", the genuine       ║
 * ║  unknowns would be invisible among thousands of them — the indicator      ║
 * ║  would be technically present and useless.                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { safeSourceUrl, withProvenance, type Provenance } from '@/lib/crm/provenance'

const SOURCE_PROVENANCE = readFileSync(
  join(__dirname, '..', '..', 'lib/crm/provenance.ts'),
  'utf8',
)

describe('safeSourceUrl', () => {
  it('accepts http and https', () => {
    expect(safeSourceUrl('https://example.com/team')).toBe('https://example.com/team')
    expect(safeSourceUrl('http://example.com')).toBe('http://example.com/')
  })

  it('rejects javascript:, which would be stored XSS', () => {
    /*
     * The whole reason this function exists. A provider that scraped a page
     * containing this, or a page that deliberately served it, would otherwise
     * get script execution in every CRM user who opens the contact.
     */
    expect(safeSourceUrl('javascript:alert(document.cookie)')).toBeNull()
    expect(safeSourceUrl('JaVaScRiPt:alert(1)')).toBeNull()
  })

  it('rejects data: and file:', () => {
    expect(safeSourceUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(safeSourceUrl('file:///etc/passwd')).toBeNull()
  })

  it('rejects something that is not a URL at all', () => {
    // A provider that stored a description here is not a reason to render an
    // unclickable link.
    expect(safeSourceUrl('found on their about page')).toBeNull()
    expect(safeSourceUrl('')).toBeNull()
    expect(safeSourceUrl(null)).toBeNull()
    expect(safeSourceUrl(undefined)).toBeNull()
  })

  it('does not try to repair a suspicious URL', () => {
    /*
     * ⚠️ REJECT, NEVER SANITISE. Stripping a scheme and hoping produces a
     * plausible-looking link to somewhere nobody chose — and the reader has no
     * way to know it was rewritten. Returning null degrades the citation
     * honestly: provider and date still show.
     */
    expect(safeSourceUrl('  javascript:alert(1)  ')).toBeNull()
    expect(safeSourceUrl('//evil.example.com')).toBeNull()
  })
})

describe('withProvenance', () => {
  const citation: Provenance = {
    kind: 'researched',
    provider: 'wikidata',
    url: 'https://example.com/x',
    retrievedAt: '2026-09-01T00:00:00Z',
    confidence: 0.82,
  }

  it('uses the citation when the value has one', () => {
    const [value] = withProvenance([{ evidenceId: 'e1' }], new Map([['e1', citation]]), 'lead_engine')
    expect(value!.provenance).toEqual(citation)
  })

  it('distinguishes entered from unknown', () => {
    /*
     * ⚠️ DECISION-11, AND THE REASON IT MATTERS. Both branches produce an
     * indicator, so a blank never reaches the page — but they say different
     * things, and a reader deciding whether to trust a phone number needs the
     * difference.
     */
    const [manual] = withProvenance([{ evidenceId: null }], new Map(), 'manual')
    expect(manual!.provenance).toEqual({ kind: 'entered', how: 'manual' })

    const [imported] = withProvenance([{ evidenceId: null }], new Map(), 'csv_import')
    expect(imported!.provenance).toEqual({ kind: 'entered', how: 'csv_import' })
  })

  it('calls a researched value with no citation unknown, not entered', () => {
    /*
     * ⚠️ THE SUBTLE ONE. `lead_engine` means the value came from research, so a
     * missing citation means it was genuinely lost — bridged before 0113.
     * Reporting "added by hand" would claim a person typed something a crawler
     * found, which is a fabrication about provenance rather than about the
     * value, and rule 4 does not distinguish those.
     */
    const [orphan] = withProvenance([{ evidenceId: null }], new Map(), 'lead_engine')
    expect(orphan!.provenance).toEqual({ kind: 'unknown' })
  })

  it('falls back to unknown when the evidence row has been pruned', () => {
    // research_evidence carries expires_at and is pruned; the address stays
    // true after its citation is collected.
    const [pruned] = withProvenance([{ evidenceId: 'gone' }], new Map(), 'lead_engine')
    expect(pruned!.provenance).toEqual({ kind: 'unknown' })
  })

  it('never leaves a value without a provenance', () => {
    /*
     * The property that makes the UI's "no silent branch" rule enforceable. An
     * empty cell reads as "not applicable" rather than "we do not know", and
     * the reader cannot tell those apart.
     */
    for (const source of ['manual', 'csv_import', 'api', 'flow', 'lead_engine', null, 'nonsense']) {
      const [value] = withProvenance([{ evidenceId: null }], new Map(), source)
      expect(value!.provenance, `source=${source} produced no provenance`).toBeTruthy()
      expect(['researched', 'entered', 'unknown']).toContain(value!.provenance.kind)
    }
  })
})

describe('the read path is scoped on the tenancy seam', () => {
  it('citationsFor filters by user_id as well as by id', async () => {
    /*
     * ⚠️ `research_evidence` IS user_id-KEYED AND `crm_contact_emails` IS
     * workspace_id-KEYED. The ids handed to `citationsFor` come from rows this
     * workspace owns, but the service role bypasses RLS — so if an
     * `evidence_id` were ever mis-set, only this filter stops it resolving to
     * another user's research.
     *
     * Asserted on the source because the alternative needs a database, and the
     * property is about what the code can do rather than what one run did.
     */
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(join(__dirname, '..', '..', 'lib/crm/provenance.ts'), 'utf8')

    const query = source.slice(source.indexOf(".from('research_evidence')"))
    expect(query.slice(0, 700)).toContain("eq('user_id'")
  })
})

describe('company citations only credit a value that still matches', () => {
  /*
   * ⚠️ THE PROPERTY THAT MAKES COMPANY CITATIONS HONEST.
   *
   * Contacts store each value as its own row, so `evidence_id` pins the exact
   * value that was observed. Company values are COLUMNS, and a column can be
   * edited after import — at which point the evidence explains a value that is
   * no longer there. Crediting a provider for a person's edit is a fabrication
   * about provenance, and rule 4 does not distinguish that from fabricating the
   * value itself.
   *
   * Asserted on the source, because the alternative needs a database and the
   * property is about what the code can do rather than what one run did.
   */
  it('compares the observed value against the stored one', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(join(__dirname, '..', '..', 'lib/crm/provenance.ts'), 'utf8')

    const fn = source.slice(source.indexOf('export async function companyCitations'))
    expect(
      fn,
      'companyCitations does not compare the observed value with the current one, ' +
        'so an edited column would still be credited to a provider',
    ).toMatch(/String\(current\)\.trim\(\) !== observed/)
  })

  it('starts from the workspace-scoped row and still filters by user_id', () => {
    /*
     * Same seam as `citationsFor`. `companies` and `research_evidence` are
     * user_id-keyed; `crm_companies` is workspace_id-keyed. The caller has
     * already proved the company belongs to this workspace — this is the second
     * filter, because the service role ignores RLS.
     */
    const source = SOURCE_PROVENANCE
    const fn = source.slice(source.indexOf('export async function companyCitations'))
    expect(fn).toContain("eq('user_id', scope.userId)")
    expect(fn).toContain("eq('entity_id', company.sourceCompanyId)")
  })
})
