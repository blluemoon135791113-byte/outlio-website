/**
 * The first-run checklist — M9, acceptance criterion 3:
 * "Every module reachable via first-run flow."
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  PROGRESS IS DERIVED, SO THESE TESTS CHANGE THE DATA AND RE-READ.        ║
 * ║                                                                           ║
 * ║  That is the whole claim being made: a step is done because the thing it  ║
 * ║  describes exists, not because someone clicked something. The test that   ║
 * ║  matters most is the reverse direction -- delete the contacts and the     ║
 * ║  step must go back to "not done", which a stored flag could never do.     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadFirstRun, shouldShowFirstRun } from '@/lib/onboarding/steps'
import type { Module, PolicyInput } from '@/lib/workspaces/permissions'
import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv } from './helpers'

const RUN = Date.now().toString(36)

const MODULES: ReadonlySet<Module> = new Set<Module>([
  'crm', 'email', 'flows', 'reports', 'integrations', 'hubble',
])
const ownerPolicy: PolicyInput = { role: 'owner', modules: MODULES }
const setterPolicy: PolicyInput = { role: 'setter', modules: MODULES }

let user: Awaited<ReturnType<typeof createAuthUser>> | null = null
let workspaceId = ''

beforeAll(async () => {
  if (!hasSupabaseEnv) return
  user = await createAuthUser(`onboard-${RUN}`)
  const { data } = await adminClient()
    .from('workspace_memberships').select('workspace_id').eq('user_id', user.id).single()
  workspaceId = data!.workspace_id
}, 60_000)

afterAll(async () => {
  if (!user) return
  await adminClient().from('workspaces').delete().eq('id', workspaceId)
  await deleteTestUser(user.id)
})

const step = (run: Awaited<ReturnType<typeof loadFirstRun>>, id: string) =>
  run.steps.find((s) => s.id === id)

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('every module is reachable from the checklist', () => {
  it('offers a step for CRM, email and team, each with a working destination', async () => {
    const run = await loadFirstRun(workspaceId, ownerPolicy)
    const ids = run.steps.map((s) => s.id)

    expect(ids).toContain('contacts')
    expect(ids).toContain('pipeline')
    expect(ids).toContain('mailbox')
    expect(ids).toContain('readiness')
    expect(ids).toContain('campaign')
    expect(ids).toContain('team')

    // Every step goes somewhere in the product, and says what it gets you.
    for (const s of run.steps) {
      expect(s.href.startsWith('/')).toBe(true)
      expect(s.cta.length).toBeGreaterThan(0)
      expect(s.body.length).toBeGreaterThan(20)
    }
  }, 60_000)

  it('starts with everything undone on a brand-new workspace', async () => {
    const run = await loadFirstRun(workspaceId, ownerPolicy)
    expect(run.completed).toBe(0)
    expect(shouldShowFirstRun(run)).toBe(true)
  }, 60_000)
})

describeIf('steps are gated by the SAME policy layer as everything else', () => {
  it('never tells a setter to do something they are not allowed to do', async () => {
    /*
     * ⚠️ A CHECKLIST THAT HANDS SOMEONE A TASK THEY CANNOT FINISH is worse
     * than no checklist — they click, get refused, and learn the product is
     * broken. A setter cannot invite the team, manage a pipeline or create a
     * campaign, so none of those are offered.
     */
    const run = await loadFirstRun(workspaceId, setterPolicy)
    const ids = run.steps.map((s) => s.id)

    expect(ids).not.toContain('team')
    expect(ids).not.toContain('pipeline')
    expect(ids).not.toContain('campaign')

    // They can still see contacts and connect their own mailbox.
    expect(ids).toContain('contacts')
    expect(ids).toContain('mailbox')
  }, 60_000)

  it('drops every module-gated step when the plan excludes the modules', async () => {
    const run = await loadFirstRun(workspaceId, { role: 'owner', modules: new Set<Module>() })
    const ids = run.steps.map((s) => s.id)

    expect(ids).not.toContain('contacts')
    expect(ids).not.toContain('pipeline')
    expect(ids).not.toContain('mailbox')
    expect(ids).not.toContain('campaign')

    /*
     * ⚠️ "INVITE YOUR TEAM" SURVIVES, and should. `workspace.member.manage` is
     * declared `module: null` deliberately: adding people to a workspace is not
     * a CRM or email feature, so a plan that includes neither still has a
     * workspace worth inviting people to. An earlier version of this test
     * asserted an empty list, which would have been an argument for breaking
     * that distinction to satisfy the test.
     */
    expect(ids).toEqual(['team'])
  }, 60_000)

  it('does not render a stuck "0 of 0" when there is nothing to do', async () => {
    // A checklist with no steps must not show as permanently unfinished.
    const empty = { steps: [], completed: 0, total: 0, dismissed: false }
    expect(shouldShowFirstRun(empty)).toBe(false)
  })
})

describeIf('progress is DERIVED, not remembered', () => {
  it('marks contacts done when a contact exists, and UNDONE again when it goes', async () => {
    const db = adminClient()

    const { data: contact } = await db
      .from('crm_contacts')
      .insert({ workspace_id: workspaceId, full_name: `Derived ${RUN}` })
      .select('id').single()

    let run = await loadFirstRun(workspaceId, ownerPolicy)
    expect(step(run, 'contacts')!.done).toBe(true)

    /*
     * ⚠️ THE TEST A STORED FLAG COULD NEVER PASS. Deleting the contacts has to
     * take the tick with it, or the checklist tells someone they have finished
     * something they demonstrably have not.
     */
    await db.from('crm_contacts').delete().eq('id', contact!.id)

    run = await loadFirstRun(workspaceId, ownerPolicy)
    expect(step(run, 'contacts')!.done).toBe(false)
  }, 60_000)

  it('marks the pipeline done once one exists', async () => {
    const db = adminClient()
    const { error } = await db
      .from('crm_pipelines')
      .insert({ workspace_id: workspaceId, name: `Pipeline ${RUN}`, is_default: true })
    expect(error).toBeNull()

    const run = await loadFirstRun(workspaceId, ownerPolicy)
    expect(step(run, 'pipeline')!.done).toBe(true)
    expect(run.completed).toBeGreaterThan(0)
  }, 60_000)
})

describeIf('a step that cannot be done yet says why', () => {
  it('LOCKS the campaign and readiness steps until a mailbox exists', async () => {
    const run = await loadFirstRun(workspaceId, ownerPolicy)

    /*
     * Shown, not hidden. Hiding "create a campaign" until a mailbox exists
     * leaves someone wondering whether the product can send mail at all;
     * showing it locked, naming the prerequisite, answers that.
     */
    expect(step(run, 'campaign')!.lockedBy).toBe('mailbox')
    expect(step(run, 'readiness')!.lockedBy).toBe('mailbox')

    // And the blocker it names is a real step in the same list.
    const ids = run.steps.map((s) => s.id)
    expect(ids).toContain(step(run, 'campaign')!.lockedBy!)
  }, 60_000)

  it('unlocks them once a mailbox is connected', async () => {
    const db = adminClient()
    const { error } = await db.from('email_accounts').insert({
      workspace_id: workspaceId, provider: 'smtp', scope: 'workspace',
      owner_user_id: user!.id, display_name: 'Onboarding mailbox',
      from_email: 'sender@acme.example', from_domain: 'acme.example',
      status: 'not_configured', configuration: { smtpHost: 'localhost', smtpPort: 2525 },
    })
    expect(error).toBeNull()

    const run = await loadFirstRun(workspaceId, ownerPolicy)

    expect(step(run, 'mailbox')!.done).toBe(true)
    expect(step(run, 'campaign')!.lockedBy).toBeNull()
    expect(step(run, 'readiness')!.lockedBy).toBeNull()

    /*
     * ⚠️ CONNECTED IS NOT READY. A mailbox that has not passed its SPF/DKIM/
     * DMARC checks must not tick the readiness step — that is the difference
     * between landing in an inbox and landing in spam.
     */
    expect(step(run, 'readiness')!.done).toBe(false)
  }, 60_000)

  it('ticks readiness only once the mailbox is actually ramping', async () => {
    await adminClient()
      .from('email_accounts')
      .update({ status: 'ramping' })
      .eq('workspace_id', workspaceId)

    const run = await loadFirstRun(workspaceId, ownerPolicy)
    expect(step(run, 'readiness')!.done).toBe(true)
  }, 60_000)
})

describeIf('dismissal', () => {
  it('hides the checklist without claiming the steps were done', async () => {
    await adminClient().from('workspace_onboarding_state').upsert({
      workspace_id: workspaceId,
      dismissed_at: new Date().toISOString(),
      dismissed_by: user!.id,
    })

    const run = await loadFirstRun(workspaceId, ownerPolicy)

    expect(run.dismissed).toBe(true)
    expect(shouldShowFirstRun(run)).toBe(false)
    // The steps still report the truth underneath — dismissal is not completion.
    expect(run.completed).toBeLessThan(run.total)
  }, 60_000)
})
