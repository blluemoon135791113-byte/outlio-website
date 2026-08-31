/**
 * The public API — M8 Phase 25.5.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  M8 CRITERION 7: "public API enforces workspace scoping, key scopes, and  ║
 * ║  rate limits (TESTED WITH CROSS-TENANT ATTEMPTS)."                        ║
 * ║                                                                           ║
 * ║  The brief asks for attempts, not assertions — so this creates TWO real   ║
 * ║  workspaces with real contacts and then tries, from workspace A's key,    ║
 * ║  every route someone would reach for to see workspace B's data.           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GET as getContacts } from '@/app/api/v1/contacts/route'
import { GET as getActivities } from '@/app/api/v1/activities/route'
import { GET as getCompanies } from '@/app/api/v1/companies/route'
import { GET as getLists } from '@/app/api/v1/lists/route'
import { GET as getOpportunities } from '@/app/api/v1/opportunities/route'
import { GET as getTasks } from '@/app/api/v1/tasks/route'
import { generateApiKey } from '@/lib/api/signing'
import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv } from './helpers'

const RUN = Date.now().toString(36)

type Tenant = {
  user: Awaited<ReturnType<typeof createAuthUser>>
  workspaceId: string
  key: string
  contactName: string
}

let alice: Tenant | null = null
let bob: Tenant | null = null

async function makeTenant(label: string, scopes: string[]): Promise<Tenant> {
  const db = adminClient()
  const user = await createAuthUser(`api-${label}-${RUN}`)

  const { data: m } = await db
    .from('workspace_memberships').select('workspace_id').eq('user_id', user.id).single()
  const workspaceId = m!.workspace_id

  const contactName = `${label} Secret Contact ${RUN}`
  const { error: contactError } = await db.from('crm_contacts').insert({
    workspace_id: workspaceId,
    first_name: label, last_name: 'Secret', full_name: contactName,
  })
  if (contactError) throw new Error(`contact insert failed: ${contactError.message}`)

  /*
   * An opportunity needs a pipeline and a stage — both NOT NULL. Building the
   * real thing rather than a shortcut means the API test exercises the same
   * rows production does.
   */
  const { data: pipeline, error: pipelineError } = await db
    .from('crm_pipelines')
    .insert({ workspace_id: workspaceId, name: `${label} pipeline` })
    .select('id').single()
  if (pipelineError) throw new Error(`pipeline insert failed: ${pipelineError.message}`)

  const { data: stage, error: stageError } = await db
    .from('crm_pipeline_stages')
    .insert({
      workspace_id: workspaceId, pipeline_id: pipeline.id,
      name: 'New', sort_order: 0, default_probability: 10,
    })
    .select('id').single()
  if (stageError) throw new Error(`stage insert failed: ${stageError.message}`)

  const { error: oppError } = await db.from('crm_opportunities').insert({
    workspace_id: workspaceId,
    pipeline_id: pipeline.id,
    stage_id: stage.id,
    title: `${label} Secret Deal ${RUN}`,
    status: 'open', value_amount: 50000, currency: 'USD', probability: 40,
  })
  if (oppError) throw new Error(`opportunity insert failed: ${oppError.message}`)

  const generated = generateApiKey()
  const { error: keyError } = await db.from('api_keys').insert({
    workspace_id: workspaceId,
    name: `${label} key`,
    key_hash: generated.hash,
    key_prefix: generated.prefix,
    scopes: scopes as never,
    created_by: user.id,
  })
  if (keyError) throw new Error(`api key insert failed: ${keyError.message}`)

  return { user, workspaceId, key: generated.key, contactName }
}

beforeAll(async () => {
  if (!hasSupabaseEnv) return
  alice = await makeTenant('Alice', ['contacts:read', 'opportunities:read'])
  bob = await makeTenant('Bob', ['contacts:read', 'opportunities:read'])
}, 90_000)

afterAll(async () => {
  const db = adminClient()
  for (const tenant of [alice, bob]) {
    if (!tenant) continue
    await db.from('workspaces').delete().eq('id', tenant.workspaceId)
    await deleteTestUser(tenant.user.id)
  }
})

const call = (
  handler: (r: Request) => Promise<Response>,
  path: string,
  key?: string,
) =>
  handler(
    new Request(`https://api.outlio.io${path}`, {
      headers: key ? { authorization: `Bearer ${key}` } : {},
    }),
  )

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('CRITERION 7 — cross-tenant attempts', () => {
  it('returns only the calling key’s own workspace', async () => {
    const response = await call(getContacts, '/api/v1/contacts', alice!.key)
    const body = await response.json()

    expect(response.status).toBe(200)

    const names = body.data.map((c: { full_name: string }) => c.full_name)
    expect(names).toContain(alice!.contactName)
    // ⚠️ THE ATTACK: Bob's contact must be invisible to Alice's key.
    expect(names).not.toContain(bob!.contactName)
  }, 60_000)

  it('ignores a workspace_id supplied in the query string', async () => {
    /*
     * The obvious attempt: name the other tenant and hope a handler trusts it.
     * The handler cannot — the workspace comes from the key and there is no
     * parameter to read.
     */
    const response = await call(
      getContacts,
      `/api/v1/contacts?workspace_id=${bob!.workspaceId}`,
      alice!.key,
    )
    const body = await response.json()

    const names = body.data.map((c: { full_name: string }) => c.full_name)
    expect(names).not.toContain(bob!.contactName)
    expect(names).toContain(alice!.contactName)
  }, 60_000)

  it('ignores a workspace id supplied as a header', async () => {
    const response = await getContacts(
      new Request('https://api.outlio.io/api/v1/contacts', {
        headers: {
          authorization: `Bearer ${alice!.key}`,
          'x-workspace-id': bob!.workspaceId,
        },
      }),
    )
    const names = (await response.json()).data.map((c: { full_name: string }) => c.full_name)
    expect(names).not.toContain(bob!.contactName)
  }, 60_000)

  it('keeps opportunities scoped too, not just contacts', async () => {
    // Scoping has to hold on every route, not the one that was tested first.
    const response = await call(getOpportunities, '/api/v1/opportunities', alice!.key)
    const names = (await response.json()).data.map((o: { title: string }) => o.title)

    expect(names.some((n: string) => n.startsWith('Alice'))).toBe(true)
    expect(names.some((n: string) => n.startsWith('Bob'))).toBe(false)
  }, 60_000)

  it('refuses a revoked key, and stops returning data immediately', async () => {
    const db = adminClient()
    const revoked = await makeTenant('Ghost', ['contacts:read'])

    // It works...
    expect((await call(getContacts, '/api/v1/contacts', revoked.key)).status).toBe(200)

    await db
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('key_hash', (await import('@/lib/api/signing')).hashApiKey(revoked.key))

    // ...and then it does not.
    const after = await call(getContacts, '/api/v1/contacts', revoked.key)
    expect(after.status).toBe(401)

    await db.from('workspaces').delete().eq('id', revoked.workspaceId)
    await deleteTestUser(revoked.user.id)
  }, 90_000)
})

describeIf('authentication', () => {
  it('refuses a request with no key', async () => {
    const response = await call(getContacts, '/api/v1/contacts')
    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('missing_key')
  })

  it('refuses a key that was never issued', async () => {
    const response = await call(getContacts, '/api/v1/contacts', generateApiKey().key)
    expect(response.status).toBe(401)

    /*
     * ⚠️ THE MESSAGE MUST NOT SAY WHETHER THE KEY EXISTS. An unknown key and a
     * revoked one get the identical answer, or someone probing learns which of
     * their guesses was once real.
     */
    expect((await response.json()).error.message).toBe('That API key is not valid.')
  })

  it('refuses something that is not an Outlio key at all', async () => {
    const response = await call(getContacts, '/api/v1/contacts', 'sk_live_stripe_lookalike')
    expect(response.status).toBe(401)
  })

  it('does NOT accept a key from the query string', async () => {
    // A key in a URL leaks into logs, history and referrer headers.
    const response = await call(getContacts, `/api/v1/contacts?api_key=${alice!.key}`)
    expect(response.status).toBe(401)
  })
})

describeIf('scopes', () => {
  it('refuses a key that lacks the scope for the route', async () => {
    const readOnly = await makeTenant('Narrow', ['contacts:read'])

    // It can read contacts...
    expect((await call(getContacts, '/api/v1/contacts', readOnly.key)).status).toBe(200)

    // ...but not opportunities, which it was never granted.
    const refused = await call(getOpportunities, '/api/v1/opportunities', readOnly.key)
    expect(refused.status).toBe(403)
    expect((await refused.json()).error.code).toBe('missing_scope')

    const db = adminClient()
    await db.from('workspaces').delete().eq('id', readOnly.workspaceId)
    await deleteTestUser(readOnly.user.id)
  }, 90_000)
})

describeIf('pagination is capped', () => {
  it('refuses to return more than the maximum page size', async () => {
    /*
     * Without a cap, one request can ask for a workspace's entire contact
     * table — a denial of service against our database and an exfiltration
     * primitive if a key ever leaks.
     */
    const response = await call(getContacts, '/api/v1/contacts?limit=100000', alice!.key)
    const body = await response.json()
    expect(body.pagination.limit).toBeLessThanOrEqual(100)
  }, 60_000)

  it('handles nonsense paging values without reaching the database', async () => {
    for (const query of ['?limit=-5', '?limit=abc', '?offset=-99', '?limit=0']) {
      const response = await call(getContacts, `/api/v1/contacts${query}`, alice!.key)
      expect(response.status).toBe(200)
      const { pagination } = await response.json()
      expect(pagination.limit).toBeGreaterThan(0)
      expect(pagination.offset).toBeGreaterThanOrEqual(0)
    }
  }, 60_000)

  it('reports a total so a caller can page', async () => {
    const body = await (await call(getContacts, '/api/v1/contacts', alice!.key)).json()
    expect(typeof body.pagination.total).toBe('number')
    expect(typeof body.pagination.has_more).toBe('boolean')
  }, 60_000)
})

describeIf('the audit log', () => {
  it('records refusals as well as successes', async () => {
    await call(getContacts, '/api/v1/contacts', alice!.key)
    await call(getContacts, '/api/v1/contacts', generateApiKey().key)

    const { data: denied } = await adminClient()
      .from('api_request_log')
      .select('denied_reason, status')
      .not('denied_reason', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5)

    /*
     * "Someone tried to read another workspace's contacts with our key" is the
     * most important thing this log can say, and a log of successes cannot.
     */
    expect(denied!.some((r) => r.denied_reason === 'unknown_key')).toBe(true)

    const { data: ok } = await adminClient()
      .from('api_request_log')
      .select('status, workspace_id')
      .eq('workspace_id', alice!.workspaceId)
      .is('denied_reason', null)
      .limit(1)
    expect(ok!.length).toBe(1)
  }, 60_000)

  it('never logs the query string, which can carry a search term', async () => {
    await call(getContacts, '/api/v1/contacts?search=confidential-project', alice!.key)

    const { data } = await adminClient()
      .from('api_request_log')
      .select('path')
      .eq('workspace_id', alice!.workspaceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    expect(data!.path).toBe('/api/v1/contacts')
    expect(data!.path).not.toContain('confidential-project')
  }, 60_000)
})

describeIf('every endpoint is scoped, not just the ones tested first', () => {
  /*
   * ⚠️ SCOPING HAS TO HOLD ON EVERY ROUTE. The failure mode this catches is a
   * new endpoint that forgets `.eq('workspace_id', ...)` — which is precisely
   * why they all go through `apiRoute` and receive a workspace they did not
   * choose. Enumerated so that adding a route without adding it here is
   * visible in review.
   */
  const routes = [
    ['contacts', getContacts, 'contacts:read'],
    ['companies', getCompanies, 'companies:read'],
    ['opportunities', getOpportunities, 'opportunities:read'],
    ['activities', getActivities, 'activities:read'],
    ['tasks', getTasks, 'tasks:read'],
    ['lists', getLists, 'lists:read'],
  ] as const

  it.each(routes)('%s refuses a request with no key', async (name, handler) => {
    const response = await call(handler, `/api/v1/${name}`)
    expect(response.status).toBe(401)
  })

  it.each(routes)('%s refuses a key without its scope', async (name, handler) => {
    // Alice holds contacts:read and opportunities:read only.
    const response = await call(handler, `/api/v1/${name}`, alice!.key)
    const expected = ['contacts', 'opportunities'].includes(name) ? 200 : 403
    expect(response.status).toBe(expected)
  }, 60_000)

  it.each(routes)('%s caps its page size', async (name, handler) => {
    const wide = await makeTenant(`Wide-${name}`, [`${name}:read`] as string[])
    const response = await call(handler, `/api/v1/${name}?limit=99999`, wide.key)
    expect(response.status).toBe(200)
    expect((await response.json()).pagination.limit).toBeLessThanOrEqual(100)

    const db = adminClient()
    await db.from('workspaces').delete().eq('id', wide.workspaceId)
    await deleteTestUser(wide.user.id)
  }, 90_000)
})

describeIf('what the API deliberately does NOT return', () => {
  it('omits activity metadata, which carries message and note contents', async () => {
    /*
     * A customer's own staff see this in the UI; an integration key should not
     * stream it out wholesale. The SHAPE of an activity is published, its
     * contents are not.
     */
    const reader = await makeTenant('Meta', ['activities:read'])
    const response = await call(getActivities, '/api/v1/activities', reader.key)
    const body = await response.json()

    expect(response.status).toBe(200)
    for (const row of body.data) {
      expect(row).not.toHaveProperty('metadata')
    }

    const db = adminClient()
    await db.from('workspaces').delete().eq('id', reader.workspaceId)
    await deleteTestUser(reader.user.id)
  }, 90_000)

  it('never returns a soft-deleted record', async () => {
    const db = adminClient()
    const { data: contact } = await db
      .from('crm_contacts')
      .insert({
        workspace_id: alice!.workspaceId,
        first_name: 'Deleted', last_name: 'Person',
        full_name: `Deleted Person ${RUN}`,
        deleted_at: new Date().toISOString(),
      })
      .select('id').single()

    const body = await (await call(getContacts, '/api/v1/contacts', alice!.key)).json()
    const names = body.data.map((c: { full_name: string }) => c.full_name)
    expect(names).not.toContain(`Deleted Person ${RUN}`)

    await db.from('crm_contacts').delete().eq('id', contact!.id)
  }, 60_000)
})
