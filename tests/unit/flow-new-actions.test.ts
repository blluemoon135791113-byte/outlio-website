/**
 * The five actions that were offered and unbacked, now implemented.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ADD_TO_LIST, REMOVE_FROM_LIST, MOVE_STAGE, CREATE_OPPORTUNITY and       ║
 * ║  WEBHOOK sat in the catalogue, appeared in the step picker and published ║
 * ║  cleanly with no runner registered — so a flow using one died on its     ║
 * ║  first contact with "the X action is not available yet".                 ║
 * ║                                                                           ║
 * ║  These guard the parts a unit test can reach: tenancy on every id that    ║
 * ║  arrives from a stored definition, and the network surface WEBHOOK opens. ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const CRM = read('lib/flows/actions/crm.ts')
const WEBHOOK = read('lib/flows/actions/webhook.ts')

/** Strips comments so an absence assertion cannot be satisfied by prose. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** The body of one handler, up to the next top-level declaration. */
function handler(source: string, name: string): string {
  const start = source.indexOf(`const ${name}: ActionHandler`)
  expect(start, `${name} is missing`).toBeGreaterThan(-1)
  const next = source.indexOf('\nconst ', start + 10)
  return source.slice(start, next === -1 ? source.indexOf('\nexport function', start) : next)
}

describe('every id from a stored definition is checked against the workspace', () => {
  /*
   * ⚠️ AN ID IN A FLOW DEFINITION IS A CLAIM. The service role bypasses RLS,
   * and a definition can be hand-edited through the JSON editor — so without
   * these checks a flow could write into another tenant's list or move a deal
   * on somebody else's board.
   */
  it('addToList verifies the list', () => {
    const body = handler(CRM, 'addToList')
    expect(body).toContain("from('crm_lists')")
    expect(body).toContain(".eq('workspace_id', ctx.workspaceId)")
    expect(body).toContain('not in this workspace')
  })

  it('removeFromList scopes the delete by workspace', () => {
    /*
     * A delete needs no prior lookup, but it absolutely needs the workspace in
     * its WHERE — otherwise a list id from another tenant deletes their member
     * row.
     */
    const body = handler(CRM, 'removeFromList')
    expect(body).toContain(".eq('workspace_id', ctx.workspaceId)")
    expect(body).toContain(".eq('list_id', listId)")
    expect(body).toContain(".eq('contact_id', ctx.contactId)")
  })

  it('createOpportunityAction verifies the pipeline', () => {
    const body = handler(CRM, 'createOpportunityAction')
    expect(body).toContain("from('crm_pipelines')")
    expect(body).toContain('not in this workspace')
  })

  it('moveStageAction verifies the stage and stays on its own board', () => {
    /*
     * ⚠️ THE PIPELINE MATCH IS NOT COSMETIC. Moving a deal into a stage that
     * belongs to a different board is not a move, it is corruption — the deal
     * would show in a pipeline whose stages it does not share.
     */
    const body = handler(CRM, 'moveStageAction')
    expect(body).toContain("from('crm_pipeline_stages')")
    expect(body).toContain(".eq('pipeline_id', stage.pipeline_id)")
  })
})

describe('the CRM actions refuse rather than guess', () => {
  it('adding someone already on a list is success, not failure', () => {
    /*
     * The primary key is (list_id, contact_id), so a re-run hits a unique
     * violation. The step's intent is "be on this list", and they are —
     * failing here would make an idempotent action look broken on every
     * second tick.
     */
    const body = handler(CRM, 'addToList')
    expect(body).toContain("error.code !== UNIQUE_VIOLATION")
  })

  it('moveStage only touches an OPEN deal', () => {
    /*
     * Moving a closed deal back into an open stage rewrites history and every
     * revenue report that reads from it.
     */
    const body = handler(CRM, 'moveStageAction')
    expect(body).toContain(".eq('status', 'open')")
  })

  it('moveStage passes the expected version', () => {
    // Optimistic locking: a person dragging the card at the same moment must
    // not be silently overwritten.
    const body = handler(CRM, 'moveStageAction')
    expect(body).toContain('opportunity.version')
  })

  it('a blank deal value means unknown, never zero', () => {
    // CLAUDE.md rule 4: a deal worth nothing and a deal nobody has valued are
    // different, and a forecast summing them under-reports.
    const body = handler(CRM, 'createOpportunityAction')
    expect(body).toContain("rawValue === '' ? null")
  })

  it('a flow-created deal has no owner', () => {
    /*
     * A flow runs unattended, so there is no current user to inherit from —
     * and defaulting to the publisher would quietly hand them every deal the
     * automation creates.
     */
    const body = handler(CRM, 'createOpportunityAction')
    expect(body).toContain('ownerUserId: null')
  })
})

describe('the webhook action does not open an SSRF hole', () => {
  it('screens the URL through the DNS-resolving guard', () => {
    /*
     * ⚠️ `screenUrl` ALONE IS NOT ENOUGH, and picking the wrong one is the
     * easy mistake: a hostname the author controls can resolve to 127.0.0.1
     * while the URL looks entirely public. `assertFetchable` resolves and
     * requires every returned address to be public.
     */
    expect(WEBHOOK).toContain('assertFetchable')
    expect(code(WEBHOOK)).not.toMatch(/\bscreenUrl\b/)
  })

  it('fetches the guard’s URL, not the raw one', () => {
    // Using `url` here would re-introduce whatever the guard normalised away.
    expect(WEBHOOK).toContain('fetch(verdict.url')
  })

  it('never follows redirects', () => {
    /*
     * A 302 to http://169.254.169.254 walks straight past a check performed
     * only on the original URL.
     */
    expect(WEBHOOK).toContain("redirect: 'manual'")
    expect(WEBHOOK).toContain('REDIRECTED')
  })

  it('refuses a blocked URL permanently, not retryably', () => {
    /*
     * A private address does not become public on the next tick. Retrying
     * would park the run forever on something that can never succeed.
     */
    const refusal = WEBHOOK.slice(WEBHOOK.indexOf('URL_NOT_ALLOWED') - 200, WEBHOOK.indexOf('URL_NOT_ALLOWED') + 120)
    expect(refusal).toContain('URL_NOT_ALLOWED')
    // Two-argument `fail` defaults `retryable` to false.
    expect(refusal).not.toMatch(/URL_NOT_ALLOWED[^)]*true/)
  })

  it('times out', () => {
    // A flow run holds a tick open; a slow consumer would stall every other
    // run queued behind it.
    expect(WEBHOOK).toContain('AbortController')
    expect(WEBHOOK).toContain('TIMEOUT_MS')
    expect(WEBHOOK).toContain('clearTimeout')
  })

  it('retries a 5xx and gives up on a 4xx', () => {
    /*
     * Retrying a 400 forever parks a run on a payload the receiver will never
     * accept; retrying a 503 is exactly right.
     */
    expect(WEBHOOK).toContain('response.status >= 500')
  })

  it('posts ids rather than the contact record', () => {
    /*
     * ⚠️ A WEBHOOK BODY IS A LOG ON SOMEBODY ELSE'S SERVER. CLAUDE.md forbids
     * logging full lead records; a name and address posted to a URL cannot be
     * taken back, whereas an id read through the API uses credentials we can
     * revoke.
     */
    expect(WEBHOOK).toContain('contactId: ctx.contactId')
    expect(code(WEBHOOK)).not.toMatch(/full_name|primaryEmail|fullName/)
  })

  it('is registered', () => {
    const index = read('lib/flows/actions/index.ts')
    expect(index).toContain('registerWebhookAction')
    expect(WEBHOOK).toContain("registerAction('WEBHOOK', webhook)")
  })
})
