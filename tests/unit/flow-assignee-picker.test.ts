/**
 * The assignee picker, and the two ways it could quietly not work.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE FIELD ASKED FOR A UUID AND NOBODY HAS ONE TO HAND.                  ║
 * ║                                                                           ║
 * ║  `ASSIGN_OWNER` was configured through a raw JSON textarea, so filling it ║
 * ║  in correctly meant already knowing an `auth.users.id`. Observed in       ║
 * ║  production: a published flow with `userId: ""` — blank not through       ║
 * ║  carelessness but because there was no way to answer the question.        ║
 * ║                                                                           ║
 * ║  Publishing now refuses a blank one, but refusing an input nobody can     ║
 * ║  satisfy is only half a fix. These guard the other half.                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const BUILDER = read('components/flows/FlowBuilder.tsx')
const PAGE = read('app/(product)/flows/[id]/page.tsx')

describe('the picker is reachable', () => {
  it('replaces the JSON box for the person-shaped actions', () => {
    /*
     * ⚠️ VERIFIED NON-VACUOUS: removing the ASSIGN_OWNER branch drops the step
     * back to the raw JSON editor, which is the state that produced the bug.
     */
    expect(BUILDER).toContain("if (step.action === 'ASSIGN_OWNER')")
    expect(BUILDER).toContain("if (step.action === 'ROUND_ROBIN')")
    expect(BUILDER).toContain('<AssigneePicker')
    expect(BUILDER).toContain('<AssigneePoolPicker')
  })

  it('is actually fed a member list by the page', () => {
    /*
     * ⚠️ THE FAILURE THIS CATCHES IS THIS CODEBASE'S SIGNATURE ONE: a correct
     * component with nothing supplying it. A picker rendered with `members: []`
     * offers only "Nobody yet", which is exactly as unusable as the JSON box.
     */
    expect(PAGE).toContain('listAssignableMembers(ctx.workspace.id)')
    expect(PAGE).toContain('members={')
    expect(BUILDER).toContain('members: FlowMember[]')
    expect(BUILDER).toContain('members={members}')
  })

  it('resolves the roster on the server', () => {
    // A client-reachable "who is in this workspace" route is a question no
    // browser should be able to ask directly.
    expect(PAGE).toContain("import { listAssignableMembers } from '@/lib/crm/contacts-list'")
    expect(BUILDER).not.toContain('listAssignableMembers')
    expect(BUILDER).not.toMatch(/fetch\(['"`]\/api/)
  })
})

describe('the picker cannot corrupt the step', () => {
  it('patches only its own key, never the whole config', () => {
    /*
     * ⚠️ `config: { ...step.config, userId }`, NOT `config: { userId }`.
     * Replacing the object wholesale drops every other setting the step holds
     * — silently, and only for the person who edited it.
     */
    expect(BUILDER).toContain('onChange({ config: { ...step.config, userId } })')
    expect(BUILDER).toContain('onChange({ config: { ...step.config, userIds } })')
  })

  it('keeps a saved id that is no longer a member', () => {
    /*
     * A `userId` for someone who has left would otherwise vanish from the
     * select, and the select would report whatever it fell back to — rewriting
     * an automation nobody touched. It stays, labelled.
     */
    expect(BUILDER).toContain('const known = members.some((m) => m.userId === value)')
    expect(BUILDER).toContain('Someone no longer in this workspace')
  })

  it('reads the same config keys the handlers do', () => {
    // `ASSIGN_OWNER` reads `config.userId`; `ROUND_ROBIN` reads `config.userIds`.
    // A picker writing the wrong key would look correct and never take effect.
    const crm = read('lib/flows/actions/crm.ts')
    expect(crm).toContain("str(config, 'userId')")
    expect(crm).toContain('config.userIds')
    expect(BUILDER).toContain('step.config.userId')
    expect(BUILDER).toContain('step.config.userIds')
  })
})

describe('the campaign picker', () => {
  it('replaces the JSON box for all four sequence controls', () => {
    // All four read `config.campaignId`; missing one leaves that step as raw
    // JSON while its neighbours are pickers, which is worse than uniform JSON.
    for (const action of [
      'ENROLL_SEQUENCE',
      'REMOVE_SEQUENCE',
      'PAUSE_SEQUENCE',
      'RESUME_SEQUENCE',
    ]) {
      expect(BUILDER, `${action} has no picker`).toContain(`step.action === '${action}'`)
    }
    expect(BUILDER).toContain('<CampaignPicker')
  })

  it('is fed by the page, server-side', () => {
    expect(PAGE).toContain('listSelectableCampaigns(ctx.workspace.id)')
    expect(PAGE).toContain('campaigns={')
    expect(BUILDER).toContain('campaigns: FlowCampaign[]')
  })

  it('offers drafts rather than only live campaigns', () => {
    /*
     * ⚠️ A FLOW IS BUILT BEFORE ITS CAMPAIGN LAUNCHES. Filtering to `active`
     * would empty the picker at precisely the moment it is needed, and look
     * like the feature is broken.
     */
    const lister = read('lib/email/campaign-list.ts')
    expect(lister).not.toMatch(/\.eq\('status'/)
    expect(lister).toContain(".is('deleted_at', null)")
    // The status travels with the name so the choice is informed, not blind.
    expect(BUILDER).toContain('{campaign.name} — {campaign.status}')
  })

  it('scopes the query by workspace', () => {
    // The service role bypasses RLS; a campaign list maps a customer's whole
    // outbound programme.
    const lister = read('lib/email/campaign-list.ts')
    expect(lister).toContain("import 'server-only'")
    expect(lister).toContain(".eq('workspace_id', workspaceId)")
  })

  it('patches only its own key', () => {
    expect(BUILDER).toContain('onChange({ config: { ...step.config, campaignId } })')
  })
})

describe('the task editor', () => {
  it('replaces the JSON box for both task actions', () => {
    expect(BUILDER).toContain("step.action === 'CREATE_TASK'")
    expect(BUILDER).toContain("step.action === 'CREATE_EMAIL_TASK'")
    expect(BUILDER).toContain('<TaskEditor')
  })

  it('reads the keys the handler reads', () => {
    const crm = read('lib/flows/actions/crm.ts')
    expect(crm).toContain("str(config, 'title')")
    expect(crm).toContain("str(config, 'assignTo')")
    expect(crm).toContain('config.dueInHours')
    for (const key of ['config.title', 'config.assignTo', 'config.dueInHours']) {
      expect(BUILDER, `${key} not read by the editor`).toContain(key)
    }
  })

  it('treats only the title as required, matching the handler', () => {
    /*
     * ⚠️ `dueInHours` DEFAULTS TO 24 IN THE HANDLER AND `assignTo` IS
     * GENUINELY OPTIONAL — an unassigned task is a real thing. Marking either
     * as required here would block a publish the engine would have run
     * perfectly well.
     */
    expect(BUILDER).toContain('titleRequired')
    expect(BUILDER).toContain("titleRequired={step.action === 'CREATE_TASK'}")
    expect(BUILDER).toContain('Nobody in particular')

    const definition = read('lib/flows/definition.ts')
    const table = definition.slice(
      definition.indexOf('const REQUIRED_ACTION_CONFIG'),
      definition.indexOf('}', definition.indexOf('const REQUIRED_ACTION_CONFIG')),
    )
    expect(table).toContain("CREATE_TASK: ['title']")
    expect(table).not.toContain('dueInHours')
    expect(table).not.toContain('assignTo')
    // CREATE_EMAIL_TASK defaults its title, so it must not be required.
    expect(table).not.toContain('CREATE_EMAIL_TASK')
  })
})

describe('the empty case says so', () => {
  it('names the unset option instead of leaving it blank', () => {
    // An empty option reads as "not loaded yet". This reads as the choice it
    // is — and it is the one the publish check refuses.
    expect(BUILDER).toContain('Nobody yet — this step cannot run')
  })

  it('warns when there is nobody to pick', () => {
    expect(BUILDER).toContain('no members to assign to yet')
    expect(BUILDER).toContain('no members to share between yet')
  })
})
