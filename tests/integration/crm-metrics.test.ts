/**
 * Reporting foundation — M4 Phase 9.
 *
 * M4 ACCEPTANCE CRITERION 1: "dashboard numbers == raw activity counts for a
 * seeded scenario."
 * M4 ACCEPTANCE CRITERION 2: "activities performed before reassignment still
 * credit the original actor."
 *
 * Criterion 2 is the one the whole design exists for. Everything else in the
 * reporting layer is an optimisation; frozen attribution is the correctness
 * claim.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { assignContact, recordActivity } from '@/lib/crm/activities'
import {
  getMetricTotals,
  getSetterDashboard,
  getLastRollupRun,
  reconcileReporting,
  replyRate,
  rollupWorkspace,
} from '@/lib/crm/metrics'
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

/** A fixed past window, so the scenario cannot drift across midnight. */
const DAY = '2026-08-20'
const FROM = '2026-08-19'
const TO = '2026-08-21'

async function workspaceOf(userId: string): Promise<string> {
  const { data, error } = await adminClient()
    .from('workspace_memberships')
    .select('workspace_id')
    .eq('user_id', userId)
    .single()
  if (error) throw new Error(`workspaceOf failed: ${error.message}`)
  return data.workspace_id
}

describeIf('reporting foundation', () => {
  let owner: TestAuthUser
  let setter: TestAuthUser
  let ws: string
  let contactA: string
  let contactB: string

  beforeAll(async () => {
    owner = await createAuthUser('rep-owner')
    setter = await createAuthUser('rep-setter')
    ws = await workspaceOf(owner.id)

    contactA = (
      await upsertContact(ws, {
        fullName: 'Metric A',
        emails: [`metric.a-${RUN}@example.com`],
        ownerUserId: setter.id,
      })
    ).id
    contactB = (
      await upsertContact(ws, {
        fullName: 'Metric B',
        emails: [`metric.b-${RUN}@example.com`],
        ownerUserId: setter.id,
      })
    ).id

    // FOUR emails to TWO people. The distinction the Ledger turns on:
    // emails_sent = 4, contacts_emailed = 2.
    const at = (hour: number) => new Date(`${DAY}T${String(hour).padStart(2, '0')}:00:00Z`)

    for (const [contactId, hour] of [
      [contactA, 10],
      [contactA, 11],
      [contactA, 12],
      [contactB, 13],
    ] as const) {
      await recordActivity(ws, {
        contactId,
        activityType: 'EMAIL_SENT',
        channel: 'email',
        actorUserId: setter.id,
        occurredAt: at(hour),
      })
    }

    await recordActivity(ws, {
      contactId: contactA,
      activityType: 'EMAIL_REPLIED',
      channel: 'email',
      actorUserId: setter.id,
      occurredAt: at(14),
    })
    await recordActivity(ws, {
      contactId: contactB,
      activityType: 'OPENER_SENT',
      channel: 'linkedin',
      actorUserId: setter.id,
      occurredAt: at(15),
    })
  })

  afterAll(async () => {
    if (owner) await deleteTestUser(owner.id)
    if (setter) await deleteTestUser(setter.id)
  })

  // -------------------------------------------------------------------------
  // Acceptance criterion 1
  // -------------------------------------------------------------------------

  describe('the aggregate matches the event stream', () => {
    it('rolls up and records the run', async () => {
      const result = await rollupWorkspace(ws, { fromDay: FROM, toDay: TO })
      expect(result.rowsWritten).toBeGreaterThan(0)

      const run = await getLastRollupRun(ws)
      // A run row with no finished_at is how a stalled rollup stays visible.
      expect(run?.finishedAt).not.toBeNull()
      expect(run?.error).toBeNull()
    })

    it('counts EVENTS and PEOPLE differently', async () => {
      const totals = await getMetricTotals(ws, {
        fromDay: FROM,
        toDay: TO,
        basis: 'actor',
        userId: setter.id,
      })

      // Four emails to two people.
      expect(totals.emails_sent?.count).toBe(4)
      expect(totals.contacts_emailed?.count).toBe(2)
      expect(totals.replies?.count).toBe(1)
      // ENGAGEMENT + OPENER_SENT + PERSONALIZED_DM + FOLLOW_UP: only the opener.
      expect(totals.engagements?.count).toBe(1)
    })

    it('RECONCILES — no discrepancies', async () => {
      const discrepancies = await reconcileReporting(ws, FROM, TO)
      expect(discrepancies).toEqual([])
    })

    it('computes reply rate over contacts emailed, not emails sent', async () => {
      const totals = await getMetricTotals(ws, {
        fromDay: FROM,
        toDay: TO,
        basis: 'actor',
        userId: setter.id,
      })

      // 1 reply / 2 contacts emailed. Over emails SENT it would read 0.25 and
      // punish a team for following up.
      expect(replyRate(totals)).toBe(0.5)
    })

    it('has no reply rate at all when nobody was emailed', async () => {
      // Not 0%: a team that has sent nothing has no rate, and 0% reads as
      // failure rather than absence.
      expect(replyRate({})).toBeNull()
    })

    it('stores workspace totals as rows rather than summing on read', async () => {
      const totals = await getMetricTotals(ws, {
        fromDay: FROM,
        toDay: TO,
        basis: 'workspace',
      })
      expect(totals.emails_sent?.count).toBe(4)
      expect(totals.contacts_emailed?.count).toBe(2)
    })
  })

  // -------------------------------------------------------------------------
  // Late arrivals
  // -------------------------------------------------------------------------

  describe('late-arriving events', () => {
    it('are picked up on the next rollup, without double counting', async () => {
      await recordActivity(ws, {
        contactId: contactB,
        activityType: 'EMAIL_SENT',
        channel: 'email',
        actorUserId: setter.id,
        occurredAt: new Date(`${DAY}T16:00:00Z`),
      })

      await rollupWorkspace(ws, { fromDay: FROM, toDay: TO })

      const totals = await getMetricTotals(ws, {
        fromDay: FROM,
        toDay: TO,
        basis: 'actor',
        userId: setter.id,
      })

      // Five events, still two people. Delete-then-insert per range is what
      // makes a recompute idempotent.
      expect(totals.emails_sent?.count).toBe(5)
      expect(totals.contacts_emailed?.count).toBe(2)
      expect(await reconcileReporting(ws, FROM, TO)).toEqual([])
    })

    it('buckets by occurred_at, not by when we recorded it', async () => {
      // The event above was written today and occurred on 2026-08-20. If the
      // rollup bucketed by created_at, a year of ingested history would land
      // in the week of the import.
      const onTheDay = await getMetricTotals(ws, {
        fromDay: DAY,
        toDay: DAY,
        basis: 'actor',
        userId: setter.id,
      })
      expect(onTheDay.emails_sent?.count).toBe(5)

      const today = new Date().toISOString().slice(0, 10)
      const now = await getMetricTotals(ws, {
        fromDay: today,
        toDay: today,
        basis: 'actor',
        userId: setter.id,
      })
      expect(now.emails_sent?.count ?? 0).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Acceptance criterion 2 — the whole point
  // -------------------------------------------------------------------------

  describe('attribution survives reassignment', () => {
    it('STILL CREDITS THE ORIGINAL ACTOR AFTER THE BOOK MOVES', async () => {
      const before = await getSetterDashboard(ws, setter.id, FROM, TO)
      expect(before.emailsSent).toBe(5)
      expect(before.replies).toBe(1)

      // Hand both contacts to someone else, then recompute from scratch.
      await assignContact(ws, contactA, owner.id, owner.id)
      await assignContact(ws, contactB, owner.id, owner.id)
      await rollupWorkspace(ws, { fromDay: FROM, toDay: TO })

      const after = await getSetterDashboard(ws, setter.id, FROM, TO)

      // Reassigning a book must not move last quarter's numbers.
      expect(after.emailsSent).toBe(before.emailsSent)
      expect(after.contactsEmailed).toBe(before.contactsEmailed)
      expect(after.replies).toBe(before.replies)
      expect(after.replyRate).toBe(before.replyRate)
    })

    it('does not credit the new owner with work they did not do', async () => {
      const newOwner = await getSetterDashboard(ws, owner.id, FROM, TO)
      expect(newOwner.emailsSent).toBe(0)
      expect(newOwner.replies).toBe(0)
      // The handover itself is theirs; the work before it is not.
      expect(newOwner.replyRate).toBeNull()
    })

    it('still reconciles after the reassignment', async () => {
      expect(await reconcileReporting(ws, FROM, TO)).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // Drift detection
  // -------------------------------------------------------------------------

  describe('drift is reported, not repaired', () => {
    it('detects a tampered aggregate and records the count on the run', async () => {
      await adminClient()
        .from('crm_reporting_daily')
        .delete()
        .eq('workspace_id', ws)
        .eq('basis', 'actor')
        .eq('metric', 'emails_sent')

      const run = await rollupRunId(ws)
      const discrepancies = await reconcileReporting(ws, FROM, TO, { runId: run })

      expect(discrepancies.length).toBeGreaterThan(0)
      const emails = discrepancies.find((d) => d.metric === 'emails_sent')
      expect(emails?.aggregateValue).toBe(0)
      expect(emails?.rawValue).toBe(5)

      const recorded = await getLastRollupRun(ws)
      expect(recorded?.discrepancies).toBe(discrepancies.length)
    })

    it('does NOT quietly fix it — the aggregate is still wrong', async () => {
      // A reconciliation that repaired itself would hide the bug that caused
      // the drift, and the drift is that bug's only symptom.
      const totals = await getMetricTotals(ws, {
        fromDay: FROM,
        toDay: TO,
        basis: 'actor',
        userId: setter.id,
      })
      expect(totals.emails_sent?.count ?? 0).toBe(0)
    })

    it('a fresh rollup repairs it, and reconciles again', async () => {
      await rollupWorkspace(ws, { fromDay: FROM, toDay: TO })
      expect(await reconcileReporting(ws, FROM, TO)).toEqual([])
    })
  })

  async function rollupRunId(workspaceId: string): Promise<string> {
    const { data } = await adminClient()
      .from('crm_reporting_runs')
      .select('id')
      .eq('workspace_id', workspaceId)
      .order('started_at', { ascending: false })
      .limit(1)
      .single()
    return data!.id
  }
})
