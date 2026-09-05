/**
 * Research findings must reach the CRM, and must reach the RIGHT tenant.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  MEASURED ON PRODUCTION BEFORE THIS EXISTED:                             ║
 * ║    research_evidence  ->  111 work_email / mobile_phone rows              ║
 * ║    crm_contact_emails ->  0                                              ║
 * ║                                                                           ║
 * ║  The enrichment had worked the whole time. `attachContactEmails` had one  ║
 * ║  caller — `upsertContact` — using only the addresses that arrived WITH a  ║
 * ║  contact at creation. Anything discovered afterwards had nowhere to go,   ║
 * ║  so the list said "No email" for people whose address we held and the     ║
 * ║  marketing export produced a header with no rows.                         ║
 * ║                                                                           ║
 * ║  ⚠️ THE ENGINE BEING CORRECT WAS NEVER THE PROBLEM. REACHABILITY WAS.     ║
 * ║  The wiring test below is the one that would have caught it.              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MIN_EVIDENCE_CONFIDENCE } from '@/lib/crm/evidence-bridge'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const BRIDGE = read('lib/crm/evidence-bridge.ts')
const TICK = read('lib/workers/tick.ts')

/**
 * ⚠️ COMMENTS ARE NOT CODE. An absence assertion — "this file must not mention
 * X" — is satisfied by prose EXPLAINING why X is wrong, which is exactly what
 * the comments here do. The first version of `never guesses a phone region`
 * failed against correct code because the sentence "passing a defaultCountry
 * would…" contains the word.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const BRIDGE_CODE = code(BRIDGE)

describe('the bridge is actually reachable', () => {
  it('is called from the background tick', () => {
    /*
     * ⚠️ THE GUARD THAT MATTERS MOST. Every prior worker in this codebase was
     * written, tested and never invoked. A bridge with no caller reproduces
     * the exact bug it exists to fix, and every unit test below would still
     * pass.
     *
     * VERIFIED NON-VACUOUS: removing the `sync_contact_evidence` job from
     * `runTick` fails this.
     */
    expect(TICK).toContain("import { syncContactEvidenceToCrm }")
    expect(TICK).toContain("runJob(result, 'sync_contact_evidence'")
    expect(TICK).toContain('await syncContactEvidenceToCrm(workspaceId)')
  })

  it('is bounded per tick like every other job', () => {
    // A tick runs inside a request. An unbounded loop over every workspace
    // would be killed by the function timeout mid-write.
    expect(TICK).toContain('evidenceWorkspacesPerTick')
    expect(TICK).toContain('LIMITS.evidenceWorkspacesPerTick')
  })

  it('isolates one workspace failure from the rest', () => {
    const job = TICK.slice(
      TICK.indexOf("runJob(result, 'sync_contact_evidence'"),
      TICK.indexOf('result.durationMs'),
    )
    expect(job).toContain('try {')
    expect(job).toContain('failures += 1')
  })
})

describe('the workspace boundary', () => {
  it('starts from contacts, not from evidence', () => {
    /*
     * ⚠️ THE DIRECTION IS THE TENANCY CONTROL. `research_evidence` is keyed by
     * `user_id` and its `entity_id` points at `extracted_leads` — it names no
     * workspace at all. Reading evidence first and looking contacts up
     * afterwards would mean an id from another table decided the tenant, and
     * the service role bypasses RLS, so nothing downstream would catch it.
     */
    const contactsAt = BRIDGE.indexOf("from('crm_contacts')")
    const evidenceAt = BRIDGE.indexOf("from('research_evidence')")
    expect(contactsAt).toBeGreaterThan(-1)
    expect(evidenceAt).toBeGreaterThan(-1)
    expect(contactsAt, 'evidence is read before contacts are scoped').toBeLessThan(evidenceAt)
  })

  it('scopes the contact query by workspace', () => {
    const query = BRIDGE.slice(BRIDGE.indexOf("from('crm_contacts')"), BRIDGE.indexOf("from('research_evidence')"))
    expect(query).toContain(".eq('workspace_id', workspaceId)")
    expect(query).toContain(".is('deleted_at', null)")
  })

  it('constrains evidence to the leads those contacts came from', () => {
    // `in('entity_id', leadIds)` is what keeps one workspace's research from
    // being written onto another's contacts.
    expect(BRIDGE).toContain(".in('entity_id', leadIds)")
    expect(BRIDGE).toContain(".eq('entity_type', 'person')")
  })

  it('writes with the workspace id it was given', () => {
    expect(BRIDGE).toContain('attachContactEmails(workspaceId, contactId, emails')
    expect(BRIDGE).toContain('attachContactPhones(workspaceId, contactId, phones')
  })
})

describe('it copies, it never infers', () => {
  it('takes the literal observed string', () => {
    /*
     * CLAUDE.md rule 4. The failure this prevents is the tempting one:
     * synthesising `first.last@company.com` from a name and a domain. It looks
     * right, it is often right, and when it is wrong nobody can tell.
     */
    expect(BRIDGE_CODE).toContain("const key = row.field === 'work_email' ? 'email' : 'phone'")
    expect(BRIDGE_CODE).toMatch(/typeof value === 'string'/)
    // No pattern construction anywhere.
    expect(BRIDGE_CODE).not.toMatch(/`\$\{[^}]*\}@\$\{/)
  })

  it('normalises through the CRM’s own functions', () => {
    /*
     * `crm_contact_emails` has an `address = lower(address)` check and a NOT
     * NULL `identity_key`. Writing the raw provider string violates both — and
     * going through `normalizeEmail` is also what makes a discovered address
     * dedupe against an imported one.
     */
    expect(BRIDGE).toContain('normalizeEmail(literal)')
    expect(BRIDGE).toContain('normalizePhoneNumber(literal)')
  })

  it('never guesses a phone region', () => {
    /*
     * `07700 900123` is a valid mobile in the UK and a landline elsewhere.
     * Passing a defaultCountry would silently rewrite every international
     * number into one that dials a stranger.
     */
    expect(BRIDGE_CODE).toContain('normalizePhoneNumber(literal)')
    expect(BRIDGE_CODE).not.toMatch(/normalizePhoneNumber\(literal,\s*\{/)
    expect(BRIDGE_CODE).not.toContain('defaultCountry')
  })
})

describe('weak evidence stays out of the address book', () => {
  it('sets a floor that admits the real data', () => {
    // Everything currently stored sits at 0.7-0.9.
    expect(MIN_EVIDENCE_CONFIDENCE).toBe(0.7)
  })

  it('rejects low source confidence outright', () => {
    expect(BRIDGE).toContain("row.source_confidence === 'low'")
    expect(BRIDGE).toContain('Number(row.confidence) < MIN_EVIDENCE_CONFIDENCE')
  })

  it('checks identity confidence separately from value confidence', () => {
    /*
     * ⚠️ TWO DIFFERENT QUESTIONS. `confidence` is "is this a real address";
     * `identityConfidence` is "does it belong to THIS person". A valid address
     * attached to the wrong human passes every other check, and is exactly the
     * error that gets a campaign sent to a stranger.
     */
    expect(BRIDGE).toContain('identityIsTrusted')
    expect(BRIDGE).toContain('row.value_json.identityConfidence')
  })

  it('counts what it skipped instead of dropping it silently', () => {
    // A bridge that reports "0 added" with no reason is indistinguishable from
    // a broken one.
    expect(BRIDGE).toContain('skipped: { lowConfidence: number; unusable: number; notLinked: number }')
    expect(BRIDGE).toContain('result.skipped.lowConfidence += 1')
    expect(BRIDGE).toContain('result.skipped.unusable += 1')
  })
})

describe('running it twice is safe', () => {
  it('relies on the unique violation the repository already swallows', () => {
    /*
     * It runs on every tick AND as a backfill, so it re-reads the same
     * evidence indefinitely. `attachContactEmails` continues past
     * UNIQUE_VIOLATION; verified live — a second run added nothing and the
     * count stayed at 12.
     */
    const repository = read('lib/crm/repository.ts')
    expect(repository).toContain('UNIQUE_VIOLATION')
    expect(repository).toContain('continue')
  })

  it('does not let one address be added twice within a single run', () => {
    // The same address can appear in several evidence rows from different
    // providers; deduping on the identity key stops a pointless insert storm.
    expect(BRIDGE).toContain('!list.some((e) => e.identityKey === identity.identityKey)')
  })
})
