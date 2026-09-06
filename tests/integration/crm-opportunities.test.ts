/**
 * Opportunities, pipelines and stage moves — M3 Phase 6.
 *
 * M3 ACCEPTANCE CRITERION 1: "Two simultaneous drags of the same card resolve
 * deterministically (no lost updates)."
 * M3 ACCEPTANCE CRITERION 2: "A stage change emits exactly one activity and
 * one domain event, verified under retry."
 *
 * Criterion 1 is tested with a REAL race — two moves fired without awaiting
 * the first — not with a sequential stand-in, because a sequential test passes
 * whether or not the row is locked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createOpportunity,
  createPipeline,
  getBoard,
  getOpportunity,
  getPipeline,
  getStageHistory,
  moveStage,
  StaleOpportunityError,
} from '@/lib/crm/opportunities'
import { upsertContact } from '@/lib/crm/repository'
import {
  adminClient,
  createAuthUser,
  deleteTestUser,
  hasSupabaseEnv,
  type TestAuthUser,
} from './helpers'

const describeIf = hasSupabaseEnv ? describe : describe.skip

const RUN = Date.now().toString(36)

async function workspaceOf(userId: string): Promise<string> {
  const { data, error } = await adminClient()
    .from('workspace_memberships')
    .select('workspace_id')
    .eq('user_id', userId)
    .single()
  if (error) throw new Error(`workspaceOf failed: ${error.message}`)
  return data.workspace_id
}

describeIf('opportunities and pipelines', () => {
  let owner: TestAuthUser
  let setter: TestAuthUser
  let ws: string
  let pipelineId: string
  let contactId: string
  let stages: { id: string; name: string }[]

  const stageNamed = (name: string) => stages.find((s) => s.name === name)!.id

  beforeAll(async () => {
    owner = await createAuthUser('opp-owner')
    setter = await createAuthUser('opp-setter')
    ws = await workspaceOf(owner.id)

    pipelineId = await createPipeline(
      ws,
      {
        name: `Sales ${RUN}`,
        isDefault: true,
        stages: [
          { name: 'New', defaultProbability: 10, staleAfterDays: 14 },
          { name: 'Demo', defaultProbability: 50 },
          { name: 'Won', kind: 'won', defaultProbability: 100 },
          { name: 'Lost', kind: 'lost' },
        ],
      },
      owner.id,
    )

    const pipeline = await getPipeline(ws, pipelineId)
    stages = pipeline!.stages.map((s) => ({ id: s.id, name: s.name }))

    contactId = (
      await upsertContact(ws, {
        fullName: 'Deal Contact',
        emails: [`deal-${RUN}@example.com`],
        ownerUserId: setter.id,
      })
    ).id
  })

  afterAll(async () => {
    if (owner) await deleteTestUser(owner.id)
    if (setter) await deleteTestUser(setter.id)
  })

  // -------------------------------------------------------------------------
  // Pipelines
  // -------------------------------------------------------------------------

  describe('pipelines', () => {
    it('creates stages in the order they were given', async () => {
      const pipeline = await getPipeline(ws, pipelineId)
      expect(pipeline?.stages.map((s) => s.name)).toEqual(['New', 'Demo', 'Won', 'Lost'])
      expect(pipeline?.stages.map((s) => s.sortOrder)).toEqual([1, 2, 3, 4])
    })

    it('refuses a pipeline with no stages', async () => {
      await expect(createPipeline(ws, { name: 'Empty', stages: [] })).rejects.toThrow(
        /at least one stage/i,
      )
    })

    it('allows only one default pipeline per workspace', async () => {
      await expect(
        createPipeline(ws, {
          name: 'Second default',
          isDefault: true,
          stages: [{ name: 'Only' }],
        }),
      ).rejects.toThrow(/already has a default/i)
    })
  })

  // -------------------------------------------------------------------------
  // Opportunities
  // -------------------------------------------------------------------------

  describe('creating a deal', () => {
    it('lands in the first stage and inherits its probability', async () => {
      const id = await createOpportunity(
        ws,
        {
          title: 'Acme renewal',
          pipelineId,
          contactId,
          ownerUserId: setter.id,
          valueAmount: 12500.5,
          currency: 'usd',
        },
        owner.id,
      )

      const opp = await getOpportunity(ws, id)
      expect(opp?.stageId).toBe(stageNamed('New'))
      expect(opp?.probability).toBe(10)
      expect(opp?.status).toBe('open')
      expect(opp?.version).toBe(1)
      expect(opp?.valueAmount).toBe(12500.5)
      // Normalised, so a filter on currency does not have to know about case.
      expect(opp?.currency).toBe('USD')
    })

    it('lets one contact have several deals', async () => {
      // The whole reason an opportunity is a record and not a field: a
      // renewal, a second department, a new role at a new company.
      const second = await createOpportunity(ws, {
        title: 'Acme expansion',
        pipelineId,
        contactId,
        ownerUserId: setter.id,
      })

      const { count } = await adminClient()
        .from('crm_opportunities')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws)
        .eq('contact_id', contactId)

      expect(count).toBeGreaterThanOrEqual(2)
      expect(second).not.toBe('')
    })
  })

  // -------------------------------------------------------------------------
  // Acceptance criterion 2
  // -------------------------------------------------------------------------

  describe('moving a stage', () => {
    let oppId: string

    beforeAll(async () => {
      oppId = await createOpportunity(ws, {
        title: `Move subject ${RUN}`,
        pipelineId,
        contactId,
        ownerUserId: setter.id,
        valueAmount: 1000,
      })
    })

    it('moves the deal, bumps the version and applies the stage probability', async () => {
      const result = await moveStage(ws, oppId, stageNamed('Demo'), 1, {
        actorUserId: owner.id,
      })

      expect(result.version).toBe(2)
      expect(result.status).toBe('open')

      const opp = await getOpportunity(ws, oppId)
      expect(opp?.stageId).toBe(stageNamed('Demo'))
      expect(opp?.probability).toBe(50)
    })

    it('emits EXACTLY ONE activity', async () => {
      expect(await activityCount(oppId)).toBe(1)

      const { data } = await adminClient()
        .from('crm_activities')
        .select('activity_type, channel, owner_user_id_at_event, actor_user_id, metadata')
        .eq('workspace_id', ws)
        .eq('refs->>opportunity_id', oppId)
        .single()

      expect(data?.activity_type).toBe('STAGE_CHANGED')
      expect(data?.channel).toBe('system')
      // Frozen attribution: the deal's owner, not the person who dragged it.
      expect(data?.owner_user_id_at_event).toBe(setter.id)
      expect(data?.actor_user_id).toBe(owner.id)
      expect(data?.metadata).toMatchObject({ to_stage_id: stageNamed('Demo') })
    })

    it('WRITES NOTHING WHEN THE MOVE IS RETRIED', async () => {
      // The version check is the idempotency key: a retry carries the OLD
      // version and is refused, so it cannot write a second activity.
      await expect(moveStage(ws, oppId, stageNamed('Demo'), 1)).rejects.toBeInstanceOf(
        StaleOpportunityError,
      )
      expect(await activityCount(oppId)).toBe(1)
    })

    it('records stage history with time in the previous stage', async () => {
      const history = await getStageHistory(ws, oppId)
      expect(history).toHaveLength(1)
      expect(history[0]?.toStageId).toBe(stageNamed('Demo'))
      expect(history[0]?.secondsInPreviousStage).toBeGreaterThanOrEqual(0)
      expect(history[0]?.ownerUserIdAtEvent).toBe(setter.id)
    })

    it('refuses a move to the stage it is already in', async () => {
      // A card dropped back where it started is not a stage change, and
      // counting it corrupts velocity.
      await expect(moveStage(ws, oppId, stageNamed('Demo'), 2)).rejects.toThrow(
        /already in that stage/i,
      )
      expect(await activityCount(oppId)).toBe(1)
    })

    it('refuses a move into another pipeline', async () => {
      const otherId = await createPipeline(ws, {
        name: `Other ${RUN}`,
        stages: [{ name: 'Elsewhere' }],
      })
      const other = await getPipeline(ws, otherId)

      await expect(moveStage(ws, oppId, other!.stages[0]!.id, 2)).rejects.toThrow(
        /different pipeline/i,
      )
    })

    it('refuses to lose a deal without a reason', async () => {
      // Asked for at the moment of losing, because it is never filled in
      // retrospectively.
      await expect(moveStage(ws, oppId, stageNamed('Lost'), 2)).rejects.toThrow(/needs a reason/i)
    })

    it('closes a won deal at 100% with its own activity type', async () => {
      const result = await moveStage(ws, oppId, stageNamed('Won'), 2, {
        actorUserId: owner.id,
      })
      expect(result.status).toBe('won')

      const opp = await getOpportunity(ws, oppId)
      expect(opp?.probability).toBe(100)
      expect(opp?.valueAmount).toBe(1000)

      const { data } = await adminClient()
        .from('crm_activities')
        .select('activity_type')
        .eq('workspace_id', ws)
        .eq('refs->>opportunity_id', oppId)
        .eq('activity_type', 'OPPORTUNITY_WON')

      expect(data).toHaveLength(1)
      expect(await activityCount(oppId)).toBe(2)
    })
  })

  // -------------------------------------------------------------------------
  // Acceptance criterion 1
  // -------------------------------------------------------------------------

  describe('two people drag the same card', () => {
    it('RESOLVES DETERMINISTICALLY — one wins, one is told', async () => {
      const oppId = await createOpportunity(ws, {
        title: `Race ${RUN}`,
        pipelineId,
        contactId,
        ownerUserId: setter.id,
      })

      // A REAL race: both fired from the same version without awaiting the
      // first. A sequential test would pass whether or not the row is locked.
      const results = await Promise.allSettled([
        moveStage(ws, oppId, stageNamed('Demo'), 1, { actorUserId: owner.id }),
        moveStage(ws, oppId, stageNamed('Won'), 1, { actorUserId: setter.id }),
      ])

      const won = results.filter((r) => r.status === 'fulfilled')
      const lost = results.filter((r) => r.status === 'rejected')

      expect(won).toHaveLength(1)
      expect(lost).toHaveLength(1)

      // The loser is TOLD, not silently discarded.
      const rejection = (lost[0] as PromiseRejectedResult).reason
      expect(rejection).toBeInstanceOf(StaleOpportunityError)
      expect(String(rejection.message)).toMatch(/someone else moved this deal/i)

      // And the board reflects exactly one of the two moves — never a blend.
      const opp = await getOpportunity(ws, oppId)
      expect(opp?.version).toBe(2)
      expect([stageNamed('Demo'), stageNamed('Won')]).toContain(opp?.stageId)

      // One move, one activity, one history row. No lost update, no double.
      expect(await activityCount(oppId)).toBe(1)
      expect(await getStageHistory(ws, oppId)).toHaveLength(1)
    })
  })

  // -------------------------------------------------------------------------
  // The board
  // -------------------------------------------------------------------------

  describe('the board', () => {
    it('returns a column per stage with a true total', async () => {
      const board = await getBoard(ws, pipelineId)

      expect(board.map((c) => c.stageName)).toEqual(['New', 'Demo', 'Won', 'Lost'])
      for (const column of board) {
        // A page of cards plus the real count, so the UI can show "142" and
        // load more on scroll rather than shipping the whole pipeline.
        expect(column.cards.length).toBeLessThanOrEqual(column.totalCards)
      }
    })

    it('shows only open deals — a won card leaves the board', async () => {
      const board = await getBoard(ws, pipelineId)
      const wonColumn = board.find((c) => c.kind === 'won')
      expect(wonColumn?.totalCards).toBe(0)
    })

    it('narrows to one owner when scoped, which is how a setter sees it', async () => {
      const mine = await getBoard(ws, pipelineId, { ownerUserId: setter.id })
      const nobodys = await getBoard(ws, pipelineId, {
        ownerUserId: '00000000-0000-4000-8000-000000000000',
      })

      expect(mine.reduce((n, c) => n + c.totalCards, 0)).toBeGreaterThan(0)
      expect(nobodys.reduce((n, c) => n + c.totalCards, 0)).toBe(0)
    })

    it('caps how many cards a column returns', async () => {
      const board = await getBoard(ws, pipelineId, {}, { cardsPerColumn: 1 })
      for (const column of board) {
        expect(column.cards.length).toBeLessThanOrEqual(1)
      }
    })
  })

  // -------------------------------------------------------------------------
  // Tenancy
  // -------------------------------------------------------------------------

  describe('tenancy', () => {
    it('will not move a deal from another workspace', async () => {
      const stranger = await createAuthUser('opp-stranger')
      try {
        const strangerWs = await workspaceOf(stranger.id)
        const oppId = await createOpportunity(ws, {
          title: 'Not yours',
          pipelineId,
          ownerUserId: owner.id,
        })

        await expect(
          moveStage(strangerWs, oppId, stageNamed('Demo'), 1),
        ).rejects.toThrow()
      } finally {
        await deleteTestUser(stranger.id)
      }
    })
  })

  async function activityCount(opportunityId: string): Promise<number> {
    const { count, error } = await adminClient()
      .from('crm_activities')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', ws)
      .eq('refs->>opportunity_id', opportunityId)

    if (error) throw new Error(`activityCount failed: ${error.message}`)
    return count ?? 0
  }
})
