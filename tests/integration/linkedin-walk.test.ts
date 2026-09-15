/**
 * One person walked through a real workflow, end to end — Phase 20.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS CLOSES A LINE THAT HAS STOOD SINCE PHASE 10:                     ║
 * ║                                                                           ║
 * ║    "Nothing in the LinkedIn channel has been exercised against a real     ║
 * ║     contact. Every guard is unit-level or mutation-proved; no enrolment,  ║
 * ║     release or outcome has run end to end with live data."                ║
 * ║                                                                           ║
 * ║  Unit tests feed `compileWorkflow` hand-written objects — the one input    ║
 * ║  the database never sees. That is the exact shape of the Phase 13 defect:  ║
 * ║  the copilot's schema was broken in production while every unit test       ║
 * ║  passed, because they all supplied the JSON the schema would have          ║
 * ║  produced. A walker proved only against literals is the same bet.         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ IT STILL SENDS NOTHING. Walking creates CARDS. Rule 1 is unchanged: no
 * request reaches linkedin.com from here or from anything this calls, and the
 * "contact" below is a fabricated row this test creates and deletes.
 *
 * ⚠️ TARGETS STAGING. `tests/setup.integration.ts` picks `.env.staging` whenever
 * it exists and warns loudly when it does not. Every row created here is torn
 * down in `afterAll`, in dependency order.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { adminClient, createAuthUser, deleteTestUser } from './helpers'
import { enrollInCampaign, advanceAfterTask, releaseDue } from '@/lib/linkedin/walk'
import { getWorkflow, saveWorkflow } from '@/lib/linkedin/workflow-store'

const admin = adminClient()

let userId = ''
let workspaceId = ''
let contactId = ''
let senderId = ''
let campaignId = ''
let enrollmentId = ''

async function workspaceOf(id: string): Promise<string> {
  const { data, error } = await admin
    .from('workspace_memberships')
    .select('workspace_id')
    .eq('user_id', id)
    .single()
  if (error) throw new Error(`workspaceOf failed: ${error.message}`)
  return data.workspace_id
}

/** The steps currently in the workflow, ordered. */
async function steps() {
  return getWorkflow(workspaceId, campaignId)
}

/** The enrolment row, read fresh. */
async function enrollment() {
  const { data, error } = await admin
    .from('linkedin_enrollments')
    .select('id, state, terminal_reason, current_step_id, entry_step_id, next_step_due_at')
    .eq('id', enrollmentId)
    .single()
  if (error) throw new Error(`enrollment read failed: ${error.message}`)
  return data
}

/** Tasks for the enrolment, oldest first. */
async function tasks() {
  const { data, error } = await admin
    .from('linkedin_tasks')
    .select('id, kind, state, outcome, body, step_id')
    .eq('enrollment_id', enrollmentId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`tasks read failed: ${error.message}`)
  return data ?? []
}

/**
 * Completes a task the way `recordOutcome` would, then advances.
 *
 * ⚠️ IT DOES NOT CALL `recordOutcome` ITSELF, and the reason is worth stating:
 * that path runs `preflight` and reserves sender budget, which needs a warmed
 * sender and a released card. Those are §4.10's concern and are covered by
 * `linkedin-senders` — what THIS test is for is whether the sequence moves. So
 * it writes the outcome directly and calls the advance, which is the seam being
 * proved.
 */
async function completeAndAdvance(taskId: string, outcome: string) {
  const { error } = await admin
    .from('linkedin_tasks')
    .update({ state: 'COMPLETED', outcome: outcome as never, completed_at: new Date().toISOString() })
    .eq('id', taskId)
  if (error) throw new Error(`complete failed: ${error.message}`)
  return advanceAfterTask({ workspaceId, enrollmentId })
}

beforeAll(async () => {
  const user = await createAuthUser('li-walk')
  userId = user.id
  workspaceId = await workspaceOf(userId)

  const contact = await admin
    .from('crm_contacts')
    .insert({
      workspace_id: workspaceId,
      /*
       * ⚠️ FABRICATED, AND `first_name` IS SET DELIBERATELY. The walker will not
       * split one out of `full_name` — that is the inference that produces "Hi
       * Van" for "Van der Berg" — so a contact without this column would render
       * a null body and the placeholder assertion below would pass for the wrong
       * reason.
       */
      full_name: 'Fabricated Person',
      first_name: 'Fabricated',
      location: 'Testville',
      source: 'manual',
    })
    .select('id')
    .single()
  if (contact.error) throw new Error(`contact seed failed: ${contact.error.message}`)
  contactId = contact.data.id

  /*
   * ⚠️ A SENDER IS NOT WORKSPACE-SCOPED; IT IS *LINKED* TO ONE. `linkedin_senders`
   * holds the account and `linkedin_sender_links` grants a workspace the right to
   * spend its budget — which is why `enroll.ts` checks the LINK rather than the
   * sender before touching anybody. Seeding only the sender would have produced a
   * row the product would correctly refuse to use.
   */
  const sender = await admin
    .from('linkedin_senders')
    .insert({
      display_label: 'Walk test sender',
      identity_key: `walk-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      owner_user_id: userId,
      // Stage 1 so the account is past the zero-cap starter stage.
      stage: 1,
    })
    .select('id')
    .single()
  if (sender.error) throw new Error(`sender seed failed: ${sender.error.message}`)
  senderId = sender.data.id

  const link = await admin.from('linkedin_sender_links').insert({
    workspace_id: workspaceId,
    sender_id: senderId,
    linked_by_user_id: userId,
  })
  if (link.error) throw new Error(`sender link failed: ${link.error.message}`)

  const campaign = await admin
    .from('linkedin_campaigns')
    .insert({ workspace_id: workspaceId, name: 'Walk test', created_by: userId })
    .select('id')
    .single()
  if (campaign.error) throw new Error(`campaign seed failed: ${campaign.error.message}`)
  campaignId = campaign.data.id
}, 60_000)

afterAll(async () => {
  /*
   * ⚠️ DEPENDENCY ORDER, AND THE STEPS COME LAST. 0130's `on delete restrict`
   * refuses to delete a step an enrolment points at — which is the safety
   * property this very suite asserts, so the teardown has to respect it rather
   * than work around it. Enrolments first, then steps.
   */
  if (enrollmentId) {
    await admin.from('linkedin_tasks').delete().eq('enrollment_id', enrollmentId)
    await admin.from('linkedin_enrollments').delete().eq('id', enrollmentId)
  }
  if (campaignId) {
    await admin.from('linkedin_workflow_steps').delete().eq('campaign_id', campaignId)
    await admin.from('linkedin_campaigns').delete().eq('id', campaignId)
  }
  if (senderId) {
    await admin.from('linkedin_sender_actions').delete().eq('sender_id', senderId)
    await admin.from('linkedin_sender_links').delete().eq('sender_id', senderId)
    await admin.from('linkedin_senders').delete().eq('id', senderId)
  }
  if (contactId) {
    await admin.from('crm_contact_tags').delete().eq('contact_id', contactId)
    await admin.from('crm_contacts').delete().eq('id', contactId)
  }
  if (userId) await deleteTestUser(userId)
}, 60_000)

describe('a workflow the database actually stored', () => {
  it('saves the shape the builder sends, through every CHECK', async () => {
    /*
     * ⚠️ THE SAVE PATH, NOT A HAND-BUILT ROW. The unit tests hand
     * `compileWorkflow` objects it would never receive from Postgres; this is
     * the first time the constraints, the jsonb coercion and the validator run
     * against each other.
     */
    const saved = await saveWorkflow({
      workspaceId,
      campaignId,
      steps: [
        { action: 'VISIT_PROFILE', body: null, waitDays: null, config: {} },
        {
          action: 'DIRECT_MESSAGE',
          body: 'Hi {{first_name}} — noticed you are in {{location}}.',
          waitDays: null,
          config: {},
        },
        { action: 'WAIT', body: null, waitDays: 1, config: {} },
        { action: 'ADD_TAG', body: null, waitDays: null, config: { tag: 'Walked' } },
        { action: 'CONNECTION_REQUEST', body: 'Following up, {{first_name}}.', waitDays: null, config: {} },
      ],
    })

    expect(saved.ok, JSON.stringify(saved)).toBe(true)

    const stored = await steps()
    expect(stored.map((s) => s.action)).toEqual([
      'VISIT_PROFILE',
      'DIRECT_MESSAGE',
      'WAIT',
      'ADD_TAG',
      'CONNECTION_REQUEST',
    ])
    // The jsonb round-trip, which no unit test can prove.
    expect(stored[3]!.config).toEqual({ tag: 'Walked' })
    expect(stored[0]!.config).toEqual({})
    expect(stored[2]!.waitDays).toBe(1)
  }, 60_000)

  it('refuses a tagless ADD_TAG at the database, not only at the validator', async () => {
    /*
     * ⚠️ BYPASSES `saveWorkflow` ON PURPOSE. The validator already refuses this
     * and a unit test already proves that. What is unproven is 0132's CHECK —
     * the wall that holds when a row is written some other way: a backfill, a
     * support script, a future importer.
     */
    const { error } = await admin.from('linkedin_workflow_steps').insert({
      workspace_id: workspaceId,
      campaign_id: campaignId,
      position: 99,
      action: 'ADD_TAG',
    })
    expect(error, 'a tagless ADD_TAG was stored').toBeTruthy()
    expect(error!.message).toMatch(/tag_configured|violates check/i)
  }, 60_000)
})

describe('walking one person through it', () => {
  it('enrols at the first step and produces exactly one card', async () => {
    const stored = await steps()
    const result = await enrollInCampaign({
      workspaceId,
      campaignId,
      contactId,
      senderId,
    })

    expect(result.kind, JSON.stringify(result)).toBe('task_created')
    expect(result.enrollmentId).toBeTruthy()
    enrollmentId = result.enrollmentId!

    const open = await tasks()
    /*
     * ⚠️ EXACTLY ONE. The pre-Phase-20 defect was the opposite — `enrollContact`
     * created one task and NOTHING ever created a second. The failure to guard
     * against here is a walk that runs ahead and queues the whole sequence at
     * once, which would hand an operator five cards for a person they have not
     * spoken to.
     */
    expect(open).toHaveLength(1)
    expect(open[0]!.kind).toBe('REVIEW_PROFILE')
    expect(open[0]!.step_id).toBe(stored[0]!.id)

    const row = await enrollment()
    expect(row.current_step_id).toBe(stored[0]!.id)
    expect(row.entry_step_id).toBe(stored[0]!.id)
    expect(row.next_step_due_at, 'a task step must not carry a due date').toBeNull()
  }, 60_000)

  it('resolves placeholders from the contact on the next card', async () => {
    const stored = await steps()
    const open = await tasks()

    const result = await completeAndAdvance(open[0]!.id, 'PROFILE_REVIEW_RECORDED')
    expect(result.kind, JSON.stringify(result)).toBe('task_created')

    const after = await tasks()
    expect(after).toHaveLength(2)

    const dm = after.find((t) => t.step_id === stored[1]!.id)
    expect(dm).toBeTruthy()
    /*
     * ⚠️ THE WHOLE PLACEHOLDER CONTRACT, PROVED AGAINST A REAL ROW. Both values
     * exist on the contact, so both resolve and the body is complete — no
     * braces survive into what an operator would paste.
     */
    expect(dm!.body).toBe('Hi Fabricated — noticed you are in Testville.')
    expect(dm!.body).not.toMatch(/\{\{/)
  }, 60_000)

  it('parks on a wait with a due date rather than racing ahead', async () => {
    const stored = await steps()
    const open = await tasks()
    const dm = open.find((t) => t.step_id === stored[1]!.id)!

    const result = await completeAndAdvance(dm.id, 'MESSAGE_MARKED_SENT')
    expect(result.kind, JSON.stringify(result)).toBe('waiting')

    const row = await enrollment()
    expect(row.current_step_id).toBe(stored[2]!.id)
    expect(row.next_step_due_at).toBeTruthy()

    /*
     * ⚠️ AND NO NEW CARD WAS MADE. A walk that queued the next action while the
     * customer asked for a day's gap would make the wait decorative.
     */
    expect(await tasks()).toHaveLength(2)
  }, 60_000)

  it('does not release a wait before it is due', async () => {
    /*
     * ⚠️ THE ASSERTION THAT PROVES THE CLOCK IS READ. Without it, a walker that
     * released everything unconditionally would pass every other test here.
     */
    const before = await tasks()
    await releaseDue(20)
    expect(await tasks(), 'a wait released a day early').toHaveLength(before.length)

    const row = await enrollment()
    expect(row.next_step_due_at, 'the due date was cleared without advancing').toBeTruthy()
  }, 60_000)

  it('releases it once due, runs the internal step, and lands on the next card', async () => {
    const stored = await steps()

    // Bring the deadline forward rather than waiting a day.
    const { error } = await admin
      .from('linkedin_enrollments')
      .update({ next_step_due_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', enrollmentId)
    if (error) throw new Error(`could not age the wait: ${error.message}`)

    const outcome = await releaseDue(20)
    expect(outcome.advanced).toBeGreaterThanOrEqual(1)
    expect(outcome.failed).toBe(0)

    /*
     * ⚠️ `ADD_TAG` RAN AND THE WALK CONTINUED PAST IT. An internal step that
     * stopped the walk would leave the enrolment standing on a finished step
     * forever — and the tag itself must actually exist, which is the part no
     * unit test can prove.
     */
    const { data: tagged } = await admin
      .from('crm_contact_tags')
      .select('tag_id, crm_tags!inner(name)')
      .eq('contact_id', contactId)
    expect(tagged ?? []).toHaveLength(1)
    expect((tagged![0] as unknown as { crm_tags: { name: string } }).crm_tags.name).toBe('Walked')

    const after = await tasks()
    expect(after).toHaveLength(3)
    const invite = after.find((t) => t.step_id === stored[4]!.id)
    expect(invite, 'the walk did not reach the connection request').toBeTruthy()
    expect(invite!.kind).toBe('CONNECTION_REQUEST')
    expect(invite!.body).toBe('Following up, Fabricated.')

    const row = await enrollment()
    expect(row.current_step_id).toBe(stored[4]!.id)
    expect(row.next_step_due_at, 'the due date survived the walk').toBeNull()
  }, 60_000)

  it('finishes as NO_REPLY, not as the goal being met', async () => {
    const stored = await steps()
    const open = await tasks()
    const invite = open.find((t) => t.step_id === stored[4]!.id)!

    const result = await completeAndAdvance(invite.id, 'REQUEST_MARKED_SENT')
    expect(result.kind, JSON.stringify(result)).toBe('finished')

    const row = await enrollment()
    expect(row.state).toBe('COMPLETED')
    /*
     * ⚠️ EVERY STEP PERFORMED WITH NOTHING COMING BACK IS NOT SUCCESS.
     * `reasonMeansSuccess` treats only GOAL_MET as success, and §4.18 keeps
     * these denominators apart so a wall of completed sequences cannot be read
     * as things working.
     */
    expect(row.terminal_reason).toBe('NO_REPLY')
    expect(row.current_step_id, 'a finished enrolment still points at a step').toBeNull()
    expect(row.next_step_due_at).toBeNull()
  }, 60_000)

  it('will not walk a finished enrolment again', async () => {
    /*
     * Advancing a terminal enrolment restarts outreach at somebody who replied,
     * was marked not-interested, or asked not to be contacted.
     */
    const before = await tasks()
    const again = await advanceAfterTask({ workspaceId, enrollmentId })
    expect(again.kind).toBe('finished')
    expect(await tasks(), 'a finished enrolment produced another card').toHaveLength(before.length)
  }, 60_000)
})

describe('the step somebody is standing on', () => {
  it('cannot be deleted while a live enrolment points at it', async () => {
    /*
     * ⚠️ PROVED AGAINST POSTGRES, NOT AGAINST A MOCK. `canRemoveStep` returns a
     * sentence; `on delete restrict` is what actually prevents the orphan, and
     * only the database can demonstrate that.
     *
     * The enrolment above is COMPLETED and its pointer is null, so this creates
     * a second, live one — which is also the only way to prove `restrict` is
     * scoped to LIVE pointers rather than refusing every delete.
     */
    const stored = await steps()
    const second = await admin
      .from('linkedin_enrollments')
      .insert({
        workspace_id: workspaceId,
        campaign_id: campaignId,
        contact_id: contactId,
        sender_id: senderId,
        state: 'RUNNING',
        current_step_id: stored[0]!.id,
      })
      .select('id')
      .single()

    /*
     * ⚠️ NO ESCAPE HATCH HERE, AND REMOVING IT WAS A DELIBERATE CORRECTION.
     *
     * My first version returned early if this insert was refused, "because
     * 0125's unique index might reject a second enrolment". That would have let
     * the whole `restrict` assertion below be skipped silently — a test that
     * reports green while proving nothing, which is this project's most
     * expensive recurring failure.
     *
     * It cannot be refused: `linkedin_enrollments_one_live_idx` is PARTIAL —
     * `where state not in ('COMPLETED','CANCELLED','FAILED')` — and the
     * enrolment above finished as COMPLETED. So a second live one for the same
     * contact is legal, and if that ever stops being true this line says so
     * instead of quietly stepping aside.
     */
    expect(second.error, 'the second enrolment was refused, so the restrict test below never ran')
      .toBeNull()

    const blocked = await admin
      .from('linkedin_workflow_steps')
      .delete()
      .eq('id', stored[0]!.id)
    expect(blocked.error, 'a step with somebody standing on it was deleted').toBeTruthy()
    expect(blocked.error!.code).toBe('23503')

    // A step nobody is on still deletes, so `restrict` is not simply refusing all.
    const free = await admin
      .from('linkedin_workflow_steps')
      .delete()
      .eq('id', stored[3]!.id)
    expect(free.error, 'an unoccupied step could not be deleted').toBeNull()

    await admin.from('linkedin_enrollments').delete().eq('id', second.data!.id)
  }, 60_000)
})
