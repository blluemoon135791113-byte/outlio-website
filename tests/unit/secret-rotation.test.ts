/**
 * §5.12 — "never returned by any API, rotatable". The audit, and the half that
 * was missing.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  WHAT HELD: nothing leaks a secret to a client. The developers page reads  ║
 * ║  `key_prefix` and never `key_hash`; it reads a webhook's url and events    ║
 * ║  and never `signing_secret`; the delivery log it renders carries no        ║
 * ║  `payload`. An API key is hashed at rest and its plaintext leaves the      ║
 * ║  server exactly once, at creation.                                        ║
 * ║                                                                           ║
 * ║  WHAT DID NOT: "rotatable". A customer whose webhook signing secret leaked ║
 * ║  could only DELETE the subscription and create another — losing its id,    ║
 * ║  its event selection and its failure history, and reconfiguring their      ║
 * ║  endpoint from scratch. The cheap response to a leak was expensive, which  ║
 * ║  is how a leaked secret ends up living in production.                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(join(ROOT, p), 'utf8'))

const ACTIONS = read('app/(product)/dashboard/settings/developers/actions.ts')
const PAGE = read('app/(product)/dashboard/settings/developers/page.tsx')
const UI = read('components/settings/DeveloperSettings.tsx')

describe('no secret reaches the client', () => {
  it('the page never selects a key hash or a signing secret', () => {
    /*
     * ⚠️ THE SELECT LIST IS THE CONTROL. These rows are read with the service
     * role, which bypasses RLS, and handed to a Client Component — so whatever
     * is named here crosses into the browser in the RSC payload, whether or not
     * anything renders it.
     */
    expect(PAGE).toContain('key_prefix')
    expect(PAGE, 'the page selects key_hash').not.toContain('key_hash')
    expect(PAGE, 'the page selects signing_secret').not.toContain('signing_secret')
  })

  it('the delivery log it renders carries no payload', () => {
    // Payloads hold contact ids and, for reply and bounce events, an email
    // address. The log is a status list, not a copy of the data.
    expect(PAGE).toContain('event_type')
    expect(PAGE, 'the delivery log selects payload').not.toMatch(/select\([^)]*payload/)
  })

  it('an API key is hashed at rest and returned exactly once', () => {
    expect(ACTIONS).toContain('key_hash: generated.hash')
    expect(ACTIONS).toContain('secret: generated.key')
    // The plaintext is never stored.
    expect(ACTIONS, 'a plaintext key column is being written').not.toMatch(/key:\s*generated\.key,/)
  })
})

describe('a webhook secret is rotatable', () => {
  it('an action exists and is permission-gated', () => {
    expect(ACTIONS).toContain('export async function rotateWebhookSecret')
    expect(ACTIONS).toMatch(
      /rotateWebhookSecret[\s\S]{0,400}assertWorkspacePermission\(PERMISSION\)/,
    )
  })

  it('scopes by workspace as well as id', () => {
    /*
     * The service role bypasses RLS, so an id from another workspace must match
     * nothing rather than re-key someone else's webhook — and `.select()` is
     * what makes "matched nothing" distinguishable from "worked".
     */
    expect(ACTIONS).toMatch(
      /rotateWebhookSecret[\s\S]{0,900}\.eq\('workspace_id', ctx\.workspace\.id\)[\s\S]{0,200}\.eq\('id', id\)/,
    )
    expect(ACTIONS).toMatch(/rotateWebhookSecret[\s\S]{0,1100}data\.length === 0/)
  })

  it('changes only the secret — not the url, events, or failure state', () => {
    /*
     * ⚠️ THE IMPORTANT ONE. Rotating does not fix a broken endpoint, and
     * silently clearing `failure_count` or flipping `is_active` would resume
     * hammering a URL the circuit breaker had already given up on.
     */
    const body = ACTIONS.slice(ACTIONS.indexOf('rotateWebhookSecret'))
    const update = body.slice(body.indexOf('.update('), body.indexOf('.select('))
    expect(update).toContain('signing_secret')
    for (const untouched of ['failure_count', 'is_active', 'url', 'events', 'disabled_reason']) {
      expect(update, `rotation also writes ${untouched}`).not.toContain(untouched)
    }
  })

  it('returns the new secret once, through the same panel as a new one', () => {
    /*
     * A rotated secret has the same "you will not see this again" property as a
     * created one, so it must not get a quieter treatment in the UI.
     */
    expect(ACTIONS).toMatch(/rotateWebhookSecret[\s\S]{0,1400}secret,/)
    expect(UI).toContain('rotateWebhookSecret')
    expect(UI).toMatch(/rotateState\?\.ok && rotateState\.secret/)
  })

  it('a human can reach it', () => {
    // The defect class: a correct action nothing renders.
    expect(UI).toContain('action={rotate}')
    expect(UI).toContain('New secret')
  })
})
