/**
 * Which extracted batch produced the revenue — R16.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE CENTRAL CLAIM OF THE WHOLE PRODUCT, NEVER ACTUALLY TESTED.          ║
 * ║                                                                           ║
 * ║  `crm_batch_funnel` (0083) is headed "ties a source batch to revenue end  ║
 * ║  to end" and the reports page renders `wonRevenue`. Both were built and   ║
 * ║  neither was ever exercised against a batch that really produced a deal.  ║
 * ║  The only test touching `wonRevenue` formats it into a CSV.               ║
 * ║                                                                           ║
 * ║  So the sentence Outlio exists to answer — "which list made us money" —   ║
 * ║  rested on a comment.                                                     ║
 * ║                                                                           ║
 * ║  ⚠️ THE CHAIN IS FIVE LINKS: batch → member → contact → opportunity →     ║
 * ║  won. A break anywhere returns a plausible number, because every link     ║
 * ║  degrades to zero rather than to an error.                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv } from './helpers'

const RUN = Date.now().toString(36)

let user: Awaited<ReturnType<typeof createAuthUser>> | null = null
let workspaceId = ''
let batchId = ''
let otherBatchId = ''
let wonContactId = ''
let stageWon = ''
let stageOpen = ''

const DEAL_VALUE = 4200

type Funnel = {
  extracted: number
  canonical: number
  opportunities: number
  won_deals: number
  won_revenue: string | number | null
}

async function funnel(batch: string): Promise<Funnel> {
  const { data, error } = await adminClient().rpc('crm_batch_funnel', {
    p_workspace_id: workspaceId,
    p_batch_id: batch,
  })

  // ⚠️ The error is asserted, not ignored: a bad argument name would otherwise
  // return null and every assertion below would read as a zero.
  expect(error).toBeNull()
  return (Array.isArray(data) ? data[0] : data) as Funnel
}

beforeAll(async () => {
  if (!hasSupabaseEnv) return
  const db = adminClient()

  user = await createAuthUser(`attrib-${RUN}`)
  const { data: membership } = await db
    .from('workspace_memberships')
    .select('workspace_id')
    .eq('user_id', user.id)
    .single()
  workspaceId = membership!.workspace_id

  /*
   * ⚠️ EVERY SEED INSERT ASSERTS ITS ERROR.
   *
   * The first version of this file did not, and a `status: 'won'` row silently
   * violated `crm_opportunities_closed_consistent` — which requires a
   * `closed_at` — so the deal was never created and the funnel correctly
   * reported zero revenue. Four tests failed pointing at the FUNCTION when the
   * fault was in the seed. An unchecked insert in a fixture makes every
   * assertion downstream a guess.
   */
  /*
   * Checks only the ERROR and leaves the value to the caller. A generic that
   * also narrowed `data` collapses to `never` against Supabase's result union,
   * and fighting that adds nothing: the bug being prevented is a swallowed
   * error, not an unchecked null.
   */
  const must = (result: { error: unknown }, what: string): void => {
    if (result.error) {
      throw new Error(`seed failed (${what}): ${JSON.stringify(result.error)}`)
    }
  }

  const makeBatch = async (name: string, rowsSeen: number) => {
    /*
     * `rows_seen` is what `extracted` reports: rows in the SOURCE FILE, which
     * is deliberately not the number of contacts — de-duplication collapses
     * them, and the gap between the two is the thing worth seeing.
     */
    const result = await db
      .from('crm_lead_batches')
      .insert({
        workspace_id: workspaceId,
        name,
        source: 'manual',
        created_by: user!.id,
        rows_seen: rowsSeen,
      })
      .select('id')
      .single()

    must(result, `batch ${name}`)
    return result.data!.id
  }

  // Three rows in the file, two survivors after dedup.
  batchId = await makeBatch(`Winning batch ${RUN}`, 3)
  /*
   * ⚠️ A SECOND BATCH IS THE POINT. Without one, "the funnel reports the
   * revenue" is indistinguishable from "the funnel reports ALL revenue" — and
   * a query missing its batch filter would pass every assertion.
   */
  otherBatchId = await makeBatch(`Other batch ${RUN}`, 1)

  const makeContact = async (name: string, batch: string) => {
    const contact = await db
      .from('crm_contacts')
      .insert({ workspace_id: workspaceId, full_name: name, owner_user_id: user!.id })
      .select('id')
      .single()

    must(contact, `contact ${name}`)

    must(
      await db.from('crm_batch_members').insert({
        workspace_id: workspaceId,
        batch_id: batch,
        contact_id: contact.data!.id,
      }),
      `member ${name}`,
    )
    return contact.data!.id
  }

  wonContactId = await makeContact(`Won ${RUN}`, batchId)
  const openContactId = await makeContact(`Open ${RUN}`, batchId)
  const otherContactId = await makeContact(`Other ${RUN}`, otherBatchId)

  const pipelineResult = await db
    .from('crm_pipelines')
    .insert({ workspace_id: workspaceId, name: `Attrib ${RUN}`, is_default: true })
    .select('id')
    .single()

  must(pipelineResult, 'pipeline')
  const pipeline = pipelineResult.data!

  const makeStage = async (name: string, kind: 'open' | 'won', order: number) => {
    const result = await db
      .from('crm_pipeline_stages')
      .insert({
        workspace_id: workspaceId,
        pipeline_id: pipeline.id,
        name,
        kind,
        sort_order: order,
        default_probability: kind === 'won' ? 100 : 25,
      })
      .select('id')
      .single()

    must(result, `stage ${name}`)
    return result.data!.id
  }

  stageOpen = await makeStage('Open', 'open', 1)
  stageWon = await makeStage('Won', 'won', 2)

  const makeDeal = async (
    contactId: string,
    stageId: string,
    status: 'open' | 'won',
    value: number,
  ) => {
    const result = await db.from('crm_opportunities').insert({
      workspace_id: workspaceId,
      title: `Deal for ${contactId.slice(0, 8)}`,
      pipeline_id: pipeline.id,
      stage_id: stageId,
      contact_id: contactId,
      status,
      /*
       * ⚠️ `crm_opportunities_closed_consistent` REQUIRES THIS. A won deal
       * with no close date is nonsense — "we won it, at no point in time" —
       * and the constraint says so. Omitting it is what silently broke the
       * first version of this fixture.
       */
      closed_at: status === 'won' ? new Date().toISOString() : null,
      value_amount: value,
      currency: 'USD',
    })

    must(result, `deal ${status}`)
  }

  // Batch one: a won deal and an open one, so "won" is narrower than "all".
  await makeDeal(wonContactId, stageWon, 'won', DEAL_VALUE)
  await makeDeal(openContactId, stageOpen, 'open', 999)
  // Batch two: revenue that must NOT be attributed to batch one.
  await makeDeal(otherContactId, stageWon, 'won', 50_000)
}, 180_000)

afterAll(async () => {
  if (!user) return
  await adminClient().from('workspaces').delete().eq('id', workspaceId)
  await deleteTestUser(user.id)
})

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('a batch is tied to the revenue it produced', () => {
  it('counts the contacts that came from the batch', async () => {
    const result = await funnel(batchId)

    /*
     * ⚠️ THESE ARE DIFFERENT NUMBERS ON PURPOSE. `extracted` is rows in the
     * source file; `canonical` is contacts after de-duplication. A funnel that
     * reported them as equal would hide the thing a customer most wants to see
     * — how much of a list was already in their CRM.
     */
    expect(Number(result.extracted)).toBe(3)
    expect(Number(result.canonical)).toBe(2)
  }, 60_000)

  it('counts the opportunities those contacts generated', async () => {
    const result = await funnel(batchId)
    expect(Number(result.opportunities)).toBe(2)
  }, 60_000)

  it('reports the WON deal and its revenue, not every deal', async () => {
    const result = await funnel(batchId)

    /*
     * ⚠️ TWO DEALS, ONE WON. If `won_deals` counted every opportunity this
     * would read 2, and the revenue would include the 999 from a deal nobody
     * has closed — a forecast reported as income.
     */
    expect(Number(result.won_deals)).toBe(1)
    expect(Number(result.won_revenue)).toBe(DEAL_VALUE)
  }, 60_000)
})

describeIf('revenue is attributed to the RIGHT batch', () => {
  it('does not credit batch one with batch two’s revenue', async () => {
    /*
     * ⚠️ THE ASSERTION THAT MAKES THE OTHERS MEAN SOMETHING. A funnel query
     * that forgot its batch filter would return every won deal in the
     * workspace and still satisfy "reports the revenue" — it would just be
     * reporting somebody else's.
     */
    const one = await funnel(batchId)
    const two = await funnel(otherBatchId)

    expect(Number(one.won_revenue)).toBe(DEAL_VALUE)
    expect(Number(two.won_revenue)).toBe(50_000)

    // And neither is the total, which is what an unfiltered query would give.
    expect(Number(one.won_revenue)).not.toBe(DEAL_VALUE + 50_000)
  }, 60_000)

  it('reports nothing for a batch that produced nothing', async () => {
    const db = adminClient()
    const { data: empty } = await db
      .from('crm_lead_batches')
      .insert({
        workspace_id: workspaceId,
        name: `Empty ${RUN}`,
        source: 'manual',
        created_by: user!.id,
      })
      .select('id')
      .single()

    const result = await funnel(empty!.id)

    expect(Number(result.extracted)).toBe(0)
    expect(Number(result.won_deals)).toBe(0)
    // Zero revenue from zero contacts is genuinely zero, not unknown — the
    // batch exists and demonstrably produced nothing.
    expect(Number(result.won_revenue ?? 0)).toBe(0)
  }, 60_000)
})

describeIf('the chain survives a contact being reassigned', () => {
  it('still credits the batch after the contact changes owner', async () => {
    /*
     * ⚠️ ATTRIBUTION IS TO THE BATCH, NOT THE OWNER. Reassigning a contact —
     * which R2 and R3 both make easy — must not move the revenue to a
     * different source, or every handover would silently rewrite history.
     */
    await adminClient()
      .from('crm_contacts')
      .update({ owner_user_id: null })
      .eq('workspace_id', workspaceId)
      .eq('id', wonContactId)

    const result = await funnel(batchId)
    expect(Number(result.won_revenue)).toBe(DEAL_VALUE)
  }, 60_000)
})
