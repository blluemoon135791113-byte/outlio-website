/**
 * The send step: the one that cannot be taken back.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  NOTHING WROTE `actorAuthorized`, SO NO FLOW COULD EVER SEND MAIL.       ║
 * ║                                                                           ║
 * ║  `sendEmail` reads `config.actorAuthorized === true`; `checkSendGate`     ║
 * ║  refuses at condition one when it is false. The key was READ in one       ║
 * ║  place, TYPED in another, and WRITTEN NOWHERE — so every SEND_EMAIL step  ║
 * ║  failed with "this flow runs as someone who is not allowed to send        ║
 * ║  email", regardless of who built it.                                      ║
 * ║                                                                           ║
 * ║  ⚠️ THE FIX MUST NOT BE A CHECKBOX. A field reading "I am allowed to      ║
 * ║  send" is self-certification: anyone who can open the builder could tick  ║
 * ║  it, which is exactly what the gate exists to prevent. It is stamped      ║
 * ║  server-side from the publisher's own permission.                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  definitionSendsEmail,
  definitionSpendsCredits,
  stampBillingUser,
  stampSendAuthority,
  validateFlowDefinition,
} from '@/lib/flows/definition'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const BUILDER = read('components/flows/FlowBuilder.tsx')
const PUBLISH = read('app/(product)/flows/actions.ts')

/** Strips comments, so an absence assertion cannot be satisfied by prose. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function definitionWithSend() {
  return validateFlowDefinition({
    trigger: { type: 'contact_created' },
    entryStepId: 'send',
    steps: [
      {
        id: 'send',
        type: 'ACTION',
        action: 'SEND_EMAIL',
        config: { accountId: 'acc-1', subject: 'Hi', body: 'Hello' },
        next: null,
      },
    ],
  })
}

describe('send authority is stamped, never self-declared', () => {
  it('writes the publisher’s permission onto every send step', () => {
    const stamped = stampSendAuthority(definitionWithSend(), true)
    const step = stamped.steps[0]!
    expect(step.type === 'ACTION' && step.config.actorAuthorized).toBe(true)
  })

  it('stamps false when the publisher may not send', () => {
    // Fails closed, matching the gate.
    const stamped = stampSendAuthority(definitionWithSend(), false)
    const step = stamped.steps[0]!
    expect(step.type === 'ACTION' && step.config.actorAuthorized).toBe(false)
  })

  it('overwrites a value the browser supplied', () => {
    /*
     * ⚠️ THE ATTACK THIS CLOSES. A hand-edited definition — the JSON editor is
     * right there — can set `actorAuthorized: true`. The stamp must REPLACE
     * it, not defer to it, or the gate is bypassed by typing.
     */
    const forged = validateFlowDefinition({
      trigger: { type: 'contact_created' },
      entryStepId: 'send',
      steps: [
        {
          id: 'send',
          type: 'ACTION',
          action: 'SEND_EMAIL',
          config: { accountId: 'a', subject: 's', body: 'b', actorAuthorized: true },
          next: null,
        },
      ],
    })

    const stamped = stampSendAuthority(forged, false)
    const step = stamped.steps[0]!
    expect(step.type === 'ACTION' && step.config.actorAuthorized).toBe(false)
  })

  it('leaves other steps and other config untouched', () => {
    const mixed = validateFlowDefinition({
      trigger: { type: 'contact_created' },
      entryStepId: 'assign',
      steps: [
        { id: 'assign', type: 'ACTION', action: 'ASSIGN_OWNER', config: { userId: 'u' }, next: 'send' },
        {
          id: 'send',
          type: 'ACTION',
          action: 'SEND_EMAIL',
          config: { accountId: 'a', subject: 's', body: 'b' },
          next: null,
        },
      ],
    })

    const stamped = stampSendAuthority(mixed, true)
    const assign = stamped.steps[0]!
    const send = stamped.steps[1]!
    // The assign step must not acquire a send flag, and must keep its own key.
    expect(assign.type === 'ACTION' && assign.config.actorAuthorized).toBeUndefined()
    expect(assign.type === 'ACTION' && assign.config.userId).toBe('u')
    expect(send.type === 'ACTION' && send.config.subject).toBe('s')
  })

  it('detects whether a definition sends at all', () => {
    expect(definitionSendsEmail(definitionWithSend())).toBe(true)
    const noSend = validateFlowDefinition({
      trigger: { type: 'contact_created' },
      entryStepId: 'a',
      steps: [{ id: 'a', type: 'ACTION', action: 'ADD_TAG', config: { tag: 'x' }, next: null }],
    })
    expect(definitionSendsEmail(noSend)).toBe(false)
  })
})

describe('publish applies the stamp', () => {
  it('reads the permission from the catalogue, not the request', () => {
    expect(PUBLISH).toContain("'email.campaign.launch'")
    expect(PUBLISH).toContain('can(')
    expect(PUBLISH).toContain('stampSendAuthority(definition, publisherMaySend)')
  })

  it('stores the stamped definition, not the raw one', () => {
    /*
     * ⚠️ VERIFIED NON-VACUOUS: reverting `p_definition` to `parsed` fails this
     * and silently restores the original bug — the stamp would be computed and
     * then thrown away.
     */
    expect(PUBLISH).toContain('p_definition: authorized as never')
    expect(code(PUBLISH)).not.toContain('p_definition: parsed as never')
  })

  it('refuses to publish a sending flow for someone who may not send', () => {
    // Publishing it would stamp `false` and the flow would fail on every
    // contact — the same "publishable but can only fail" shape as a blank
    // assignee.
    expect(PUBLISH).toContain('definitionSendsEmail(definition) && !publisherMaySend')
    expect(PUBLISH).toContain('do not have permission to launch email')
  })
})

describe('the editor', () => {
  it('never exposes the authority flag as a field', () => {
    /*
     * ⚠️ THE WHOLE POINT. A checkbox here would let anyone who can open the
     * builder authorise their own sends.
     */
    expect(code(BUILDER)).not.toContain('actorAuthorized')
  })

  it('offers a mailbox, a subject and a body', () => {
    expect(BUILDER).toContain("step.action === 'SEND_EMAIL'")
    expect(BUILDER).toContain('<SendEmailEditor')
    for (const id of ['send-mailbox', 'send-subject', 'send-body']) {
      expect(BUILDER, `${id} missing`).toContain(id)
    }
  })

  it('is fed real mailboxes by the page', () => {
    const page = read('app/(product)/flows/[id]/page.tsx')
    expect(page).toContain('listEmailAccounts(ctx.workspace.id)')
    expect(page).toContain('mailboxes={')
    expect(BUILDER).toContain('mailboxes: FlowMailbox[]')
  })

  it('teaches the fallback syntax, because a missing variable refuses the send', () => {
    /*
     * `renderTemplate` returns MISSING_VARIABLES rather than mailing "Hi ,".
     * That makes `{{first_name|there}}` the single most useful thing an author
     * can know, so it sits beside the field rather than in documentation.
     */
    expect(BUILDER).toContain('{{first_name|there}}')
    expect(BUILDER).toContain('the send is refused')

    // And the offered variables are the ones the renderer actually knows.
    const template = read('lib/email/template.ts')
    for (const name of ['first_name', 'company_name', 'owner_name']) {
      expect(template, `${name} is not a real merge field`).toContain(name)
      expect(BUILDER).toContain(name)
    }
  })

  it('requires the mailbox as well as the content', () => {
    /*
     * `enqueueEmail` is called with `accountId!` — a non-null assertion. A step
     * published without one would reach that line with undefined.
     */
    const definition = read('lib/flows/definition.ts')
    expect(definition).toContain("SEND_EMAIL: ['accountId', 'subject', 'body']")
  })
})

/**
 * The AI steps: whose money, and what happens when it runs out.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  NOTHING SET `userId`, SO EVERY HUBBLE STEP REFUSED.                     ║
 * ║                                                                           ║
 * ║  `hubbleHandler` reads `config.userId` and fails with NO_BILLING_USER —   ║
 * ║  "this AI step has nobody to bill". Nothing in the product wrote it.      ║
 * ║  Third instance of the same shape as `actorAuthorized` and the flow-run   ║
 * ║  claim: a required key read in one place and written in none, so the      ║
 * ║  feature refused politely and nobody could tell why.                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
describe('the AI steps get a billing user', () => {
  const definitionWithAi = () =>
    validateFlowDefinition({
      trigger: { type: 'contact_created' },
      entryStepId: 'score',
      steps: [
        { id: 'score', type: 'ACTION', action: 'HUBBLE_ICP_SCORE', config: {}, next: null },
      ],
    })

  it('stamps the publisher onto every credit-bearing step', () => {
    const stamped = stampBillingUser(definitionWithAi(), 'user-1')
    const step = stamped.steps[0]!
    expect(step.type === 'ACTION' && step.config.userId).toBe('user-1')
  })

  it('leaves free steps alone', () => {
    /*
     * ⚠️ KEYED ON `costsCredits`, NOT A HUBBLE_ NAME PREFIX. `ASSIGN_OWNER`
     * also has a `userId` — the person a contact is assigned to — and
     * overwriting that with the publisher would silently reassign every
     * contact the flow touches to whoever last pressed Publish.
     */
    const mixed = validateFlowDefinition({
      trigger: { type: 'contact_created' },
      entryStepId: 'assign',
      steps: [
        { id: 'assign', type: 'ACTION', action: 'ASSIGN_OWNER', config: { userId: 'someone-else' }, next: 'score' },
        { id: 'score', type: 'ACTION', action: 'HUBBLE_RESEARCH', config: {}, next: null },
      ],
    })

    const stamped = stampBillingUser(mixed, 'publisher')
    const assign = stamped.steps[0]!
    const score = stamped.steps[1]!
    expect(assign.type === 'ACTION' && assign.config.userId).toBe('someone-else')
    expect(score.type === 'ACTION' && score.config.userId).toBe('publisher')
  })

  it('overwrites a value the browser supplied', () => {
    // The JSON editor is right there; billing someone else must not be
    // achievable by typing.
    const forged = validateFlowDefinition({
      trigger: { type: 'contact_created' },
      entryStepId: 'score',
      steps: [
        { id: 'score', type: 'ACTION', action: 'HUBBLE_ICP_SCORE', config: { userId: 'victim' }, next: null },
      ],
    })
    const stamped = stampBillingUser(forged, 'publisher')
    const step = stamped.steps[0]!
    expect(step.type === 'ACTION' && step.config.userId).toBe('publisher')
  })

  it('detects whether a definition spends credits', () => {
    expect(definitionSpendsCredits(definitionWithAi())).toBe(true)
    const free = validateFlowDefinition({
      trigger: { type: 'contact_created' },
      entryStepId: 'a',
      steps: [{ id: 'a', type: 'ACTION', action: 'ADD_TAG', config: { tag: 'x' }, next: null }],
    })
    expect(definitionSpendsCredits(free)).toBe(false)
  })

  it('publish stamps it, and stamps before checking', () => {
    expect(PUBLISH).toContain('stampBillingUser(')
    expect(PUBLISH).toContain('ctx.userId')
    const stampAt = PUBLISH.indexOf('const authorized = stampBillingUser')
    const checkAt = PUBLISH.indexOf('publishProblems(authorized)')
    expect(stampAt).toBeLessThan(checkAt)
  })

  it('requires the billing user on every AI action', () => {
    const definition = readFileSync(join(ROOT, 'lib', 'flows', 'definition.ts'), 'utf8')
    for (const action of [
      'HUBBLE_ICP_SCORE', 'HUBBLE_RESEARCH', 'HUBBLE_CLASSIFY', 'HUBBLE_PERSONALIZE',
      'HUBBLE_REPLY_DRAFT', 'HUBBLE_CLASSIFY_REPLY', 'HUBBLE_ACCOUNT_SUMMARY',
    ]) {
      expect(definition, `${action} does not require a billing user`).toContain(
        `${action}: ['userId']`,
      )
    }
  })
})

describe('the AI step editor', () => {
  it('shows the billed user rather than offering a choice', () => {
    /*
     * ⚠️ A DROPDOWN WOULD BE A SPENDING HOLE. Credits are user-scoped, so one
     * member could point a 10,000-contact flow at a colleague's allowance and
     * spend it without their knowledge.
     */
    expect(BUILDER).toContain('charged to')
    expect(BUILDER).toContain('whoever publishes this flow')
    const editor = BUILDER.slice(
      BUILDER.indexOf('function HubbleStepEditor'),
      BUILDER.indexOf('/** Per-step settings'),
    )
    // No control that writes userId.
    expect(editor).not.toMatch(/userId:/)
  })

  it('is chosen by cost, not by name', () => {
    /*
     * A paid action added later gets this editor automatically, and a free one
     * can never pick up a credit warning.
     */
    expect(BUILDER).toContain('if (ACTION_TYPES[step.action].costsCredits)')
    expect(BUILDER).toContain('<HubbleStepEditor')
  })

  it('offers both credit-exhaustion behaviours and defaults to continuing', () => {
    /*
     * ⚠️ THE DEFAULT IS LOAD-BEARING. `onNoCredits` is 'continue' unless it is
     * exactly 'fail', so running dry records the step as
     * succeeded-without-result and the deterministic steps the customer is
     * still paying for carry on rather than stranding a contact halfway.
     */
    const hubble = readFileSync(join(ROOT, 'lib', 'flows', 'actions', 'hubble.ts'), 'utf8')
    expect(hubble).toContain("config.onNoCredits === 'fail' ? 'fail' : 'continue'")
    expect(BUILDER).toContain("onNoCredits: 'continue'")
    expect(BUILDER).toContain("onNoCredits: 'fail'")
    expect(BUILDER).toContain('Carry on without the answer')
    expect(BUILDER).toContain('Stop the run')
  })

  it('states the price per contact', () => {
    expect(BUILDER).toContain('per contact')
    expect(BUILDER).toContain('quoteCredits(task)')
  })

  it('says that storeAs is optional and what blank means', () => {
    // The handler only writes an activity row when it is set; the step still
    // runs and still charges without it.
    expect(BUILDER).toContain('hubble-store-as')
    expect(BUILDER).toContain('still runs and still charges')
  })
})
