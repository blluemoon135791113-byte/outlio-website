/**
 * Outreach collision guard — M3 Phase 8.
 *
 * M3 ACCEPTANCE CRITERION 3: "Collision warning fires at contact AND company
 * level per workspace config; overrides are auditable."
 *
 * The assertions that matter most are the NEGATIVES. A guard that fires on
 * ownership alone would warn on every row of the first import, and a guard
 * people ignore is worse than none.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { recordActivity } from '@/lib/crm/activities'
import {
  checkCollision,
  DEFAULT_COLLISION_SETTINGS,
  DuplicateRequestError,
  getCollisionSettings,
  recordCollisionOverride,
  requestReassignment,
  resolveReassignment,
  type CollisionMode,
} from '@/lib/crm/collision'
import { linkContactToCompany, upsertContact, upsertCrmCompany } from '@/lib/crm/repository'
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

async function setMode(
  ws: string,
  patch: { contact_mode?: CollisionMode; company_mode?: CollisionMode },
): Promise<void> {
  const { error } = await adminClient()
    .from('crm_collision_settings')
    .upsert({ workspace_id: ws, ...patch }, { onConflict: 'workspace_id' })
  if (error) throw new Error(`setMode failed: ${error.message}`)
}

describeIf('outreach collision guard', () => {
  let owner: TestAuthUser
  let colleague: TestAuthUser
  let ws: string
  let acmeId: string

  // Owned by `colleague`, worked recently — the sharp case.
  let contested: string
  // Owned by `colleague` but never touched — filing, not a collision.
  let dormant: string
  // A different person at the same company, worked by `colleague`.
  let sibling: string
  // Owned by `owner` themselves.
  let mine: string

  beforeAll(async () => {
    owner = await createAuthUser('col-owner')
    colleague = await createAuthUser('col-mate')
    ws = await workspaceOf(owner.id)

    acmeId = (
      await upsertCrmCompany(ws, { name: 'Acme', websiteUrl: `acme-${RUN}.example.com` })
    ).id

    const make = async (name: string, ownerUserId: string) =>
      (
        await upsertContact(ws, {
          fullName: name,
          emails: [`${name.toLowerCase().replace(/\W+/g, '.')}-${RUN}@example.com`],
          ownerUserId,
        })
      ).id

    contested = await make('Contested Prospect', colleague.id)
    dormant = await make('Dormant Prospect', colleague.id)
    sibling = await make('Sibling Prospect', colleague.id)
    mine = await make('My Prospect', owner.id)

    for (const id of [contested, dormant, sibling, mine]) {
      await linkContactToCompany(ws, id, acmeId)
    }

    // Recent work by the colleague on two of them. `dormant` gets nothing.
    for (const id of [contested, sibling]) {
      await recordActivity(ws, {
        contactId: id,
        activityType: 'OPENER_SENT',
        channel: 'linkedin',
        actorUserId: colleague.id,
      })
    }
  })

  afterAll(async () => {
    if (owner) await deleteTestUser(owner.id)
    if (colleague) await deleteTestUser(colleague.id)
  })

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  describe('settings', () => {
    it('guards a workspace that has never opened the settings page', async () => {
      const settings = await getCollisionSettings(ws)
      expect(settings).toEqual(DEFAULT_COLLISION_SETTINGS)
      // Absence must not mean "off".
      expect(settings.contactMode).toBe('warn')
      // Company-level starts off: in a large account two setters in two
      // departments is normal, and warning on it trains people to ignore it.
      expect(settings.companyMode).toBe('off')
    })
  })

  // -------------------------------------------------------------------------
  // Contact level
  // -------------------------------------------------------------------------

  describe('contact-level collision', () => {
    it('fires when a teammate owns the person AND has worked them', async () => {
      const report = await checkCollision(ws, contested, owner.id)

      expect(report.hasCollision).toBe(true)
      expect(report.contact?.ownerUserId).toBe(colleague.id)
      // "Someone is working this" is useless without saying who.
      expect(report.contact?.ownerName).toBeTruthy()
      expect(report.contact?.lastActivityType).toBe('OPENER_SENT')
      expect(report.contact?.lastActivityAt).toBeTruthy()
    })

    it('does NOT fire on ownership alone', async () => {
      // Half a CRM is assigned to people who have never touched it. Warning on
      // that means warning on every row of the first import.
      const report = await checkCollision(ws, dormant, owner.id)
      expect(report.contact).toBeNull()
      expect(report.hasCollision).toBe(false)
    })

    it('does not fire on your own contact', async () => {
      const report = await checkCollision(ws, mine, owner.id)
      expect(report.hasCollision).toBe(false)
    })

    it('does not fire when the mode is off', async () => {
      await setMode(ws, { contact_mode: 'off' })
      const report = await checkCollision(ws, contested, owner.id)
      expect(report.contact).toBeNull()
      await setMode(ws, { contact_mode: 'warn' })
    })

    it('warns without blocking by default', async () => {
      const report = await checkCollision(ws, contested, owner.id)
      expect(report.hasCollision).toBe(true)
      // A guard that stops work by default is switched off in week one.
      expect(report.blocked).toBe(false)
    })

    it('blocks when the workspace requires approval', async () => {
      await setMode(ws, { contact_mode: 'require_approval' })
      const report = await checkCollision(ws, contested, owner.id)
      expect(report.blocked).toBe(true)
      await setMode(ws, { contact_mode: 'warn' })
    })

    it('stops counting a contact as worked once activity ages out', async () => {
      await adminClient()
        .from('crm_collision_settings')
        .upsert({ workspace_id: ws, active_within_days: 1 }, { onConflict: 'workspace_id' })

      // Backdated well beyond the window: dormant, not owned.
      const stale = await upsertContact(ws, {
        fullName: 'Long Ago Prospect',
        emails: [`longago-${RUN}@example.com`],
        ownerUserId: colleague.id,
      })
      await recordActivity(ws, {
        contactId: stale.id,
        activityType: 'OPENER_SENT',
        channel: 'linkedin',
        actorUserId: colleague.id,
        occurredAt: new Date(Date.now() - 40 * 86_400_000),
      })

      const report = await checkCollision(ws, stale.id, owner.id)
      expect(report.contact).toBeNull()

      await adminClient()
        .from('crm_collision_settings')
        .upsert({ workspace_id: ws, active_within_days: 30 }, { onConflict: 'workspace_id' })
    })
  })

  // -------------------------------------------------------------------------
  // Company level
  // -------------------------------------------------------------------------

  describe('company-level collision', () => {
    it('says nothing while the mode is off, even with colleagues on the account', async () => {
      const report = await checkCollision(ws, mine, owner.id)
      expect(report.company).toBeNull()
    })

    it('fires once the workspace turns it on', async () => {
      await setMode(ws, { company_mode: 'warn' })

      const report = await checkCollision(ws, mine, owner.id)

      expect(report.company).not.toBeNull()
      expect(report.company?.companyId).toBe(acmeId)
      expect(report.company?.parties.length).toBeGreaterThan(0)
      // Other PEOPLE at the same company, not the contact itself.
      expect(report.company?.parties.map((p) => p.contactId)).not.toContain(mine)
      expect(report.company?.parties.every((p) => p.ownerUserId === colleague.id)).toBe(true)
    })

    it('lists only colleagues who have actually worked someone there', async () => {
      const report = await checkCollision(ws, mine, owner.id)
      // `dormant` is owned by the colleague at the same company but untouched.
      expect(report.company?.parties.map((p) => p.contactId)).not.toContain(dormant)
    })

    it('caps how many colleagues it names', async () => {
      // A 5,000-person account must not be scanned to render a banner.
      const report = await checkCollision(ws, mine, owner.id)
      expect(report.company!.parties.length).toBeLessThanOrEqual(3)
      await setMode(ws, { company_mode: 'off' })
    })
  })

  // -------------------------------------------------------------------------
  // Overrides — the audit half of criterion 3
  // -------------------------------------------------------------------------

  describe('overrides are auditable', () => {
    it('writes an activity AND an audit row', async () => {
      const activityId = await recordCollisionOverride(
        ws,
        contested,
        owner.id,
        'Existing relationship',
      )

      const { data: activity } = await adminClient()
        .from('crm_activities')
        .select('activity_type, actor_user_id, owner_user_id_at_event, metadata')
        .eq('id', activityId)
        .single()

      expect(activity?.activity_type).toBe('COLLISION_OVERRIDE')
      expect(activity?.actor_user_id).toBe(owner.id)
      // The owner who was stepped OVER — the whole point of keeping it.
      expect(activity?.owner_user_id_at_event).toBe(colleague.id)
      expect(activity?.metadata).toMatchObject({ overridden_owner_user_id: colleague.id })

      const { data: audit } = await adminClient()
        .from('crm_audit_logs')
        .select('action, target_id, reason')
        .eq('workspace_id', ws)
        .eq('action', 'crm.collision.override')
        .single()

      expect(audit?.target_id).toBe(contested)
      expect(audit?.reason).toBe('Existing relationship')
    })

    it('shows the override on the contact timeline', async () => {
      // A manager reviewing the timeline must see the override without going
      // to a separate log to find it.
      const { count } = await adminClient()
        .from('crm_activities')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws)
        .eq('contact_id', contested)
        .eq('activity_type', 'COLLISION_OVERRIDE')

      expect(count).toBe(1)
    })

    it('refuses to override a contact in another workspace', async () => {
      await expect(
        recordCollisionOverride(
          '00000000-0000-4000-8000-000000000000',
          contested,
          owner.id,
        ),
      ).rejects.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // Reassignment
  // -------------------------------------------------------------------------

  describe('requesting reassignment', () => {
    it('records a request against the owner at the time', async () => {
      const id = await requestReassignment(ws, contested, owner.id, 'I know their CTO')

      const { data } = await adminClient()
        .from('crm_reassignment_requests')
        .select('status, current_owner_user_id, note')
        .eq('id', id)
        .single()

      expect(data?.status).toBe('pending')
      expect(data?.current_owner_user_id).toBe(colleague.id)
      expect(data?.note).toBe('I know their CTO')
    })

    it('refuses a second open request from the same person', async () => {
      // Asking twice is not a second request, and a queue of duplicates is how
      // an owner starts ignoring them.
      await expect(requestReassignment(ws, contested, owner.id)).rejects.toBeInstanceOf(
        DuplicateRequestError,
      )
    })

    it('declining leaves ownership alone and frees the slot', async () => {
      const { data: pending } = await adminClient()
        .from('crm_reassignment_requests')
        .select('id')
        .eq('workspace_id', ws)
        .eq('contact_id', contested)
        .eq('status', 'pending')
        .single()

      await resolveReassignment(ws, pending!.id, 'declined', colleague.id)

      const { data: contact } = await adminClient()
        .from('crm_contacts')
        .select('owner_user_id')
        .eq('id', contested)
        .single()
      expect(contact?.owner_user_id).toBe(colleague.id)

      // The slot is free, so they can ask again later.
      const again = await requestReassignment(ws, contested, owner.id)
      expect(again).toBeTruthy()
    })

    it('approving reassigns, and the handover lands on the timeline', async () => {
      const { data: pending } = await adminClient()
        .from('crm_reassignment_requests')
        .select('id')
        .eq('workspace_id', ws)
        .eq('contact_id', contested)
        .eq('status', 'pending')
        .single()

      await resolveReassignment(ws, pending!.id, 'approved', colleague.id)

      const { data: contact } = await adminClient()
        .from('crm_contacts')
        .select('owner_user_id')
        .eq('id', contested)
        .single()
      expect(contact?.owner_user_id).toBe(owner.id)

      // A reassignment nobody can see in the timeline is one nobody can report
      // on, so it goes through assignContact like any other handover.
      const { data: handover } = await adminClient()
        .from('crm_activities')
        .select('owner_user_id_at_event, metadata')
        .eq('workspace_id', ws)
        .eq('contact_id', contested)
        .eq('activity_type', 'OWNER_ASSIGNED')
        .single()

      expect(handover?.owner_user_id_at_event).toBe(colleague.id)
      expect(handover?.metadata).toMatchObject({ from: colleague.id, to: owner.id })
    })

    it('is a no-op when the request was already resolved', async () => {
      const { data: resolved } = await adminClient()
        .from('crm_reassignment_requests')
        .select('id')
        .eq('workspace_id', ws)
        .eq('status', 'approved')
        .limit(1)
        .single()

      await expect(
        resolveReassignment(ws, resolved!.id, 'declined', colleague.id),
      ).resolves.toBeUndefined()
    })

    it('no longer collides once the contact is yours', async () => {
      const report = await checkCollision(ws, contested, owner.id)
      expect(report.contact).toBeNull()
    })
  })
})
