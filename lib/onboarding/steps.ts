import 'server-only'

/**
 * The first-run checklist — M9, acceptance criterion 3:
 * "Every module reachable via first-run flow; empty states verified."
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  PROGRESS IS DERIVED, NEVER STORED.                                      ║
 * ║                                                                           ║
 * ║  The obvious design writes `completed_steps` as someone clicks through.   ║
 * ║  It rots on contact: a workspace that imported contacts and then deleted  ║
 * ║  them still reads "contacts: done", and nothing can say whether the flag  ║
 * ║  or the data is right. Deriving each step from the thing it is about is   ║
 * ║  true by construction — and it means a step can be reworded, reordered or ║
 * ║  removed without a backfill.                                              ║
 * ║                                                                           ║
 * ║  The one thing that cannot be derived is "I do not want this", so         ║
 * ║  dismissal is the only stored state (migration 0102).                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { can, type PolicyInput } from '@/lib/workspaces/permissions'

export type FirstRunStep = {
  id: string
  title: string
  /** What this gets them — not what the button does. */
  body: string
  href: string
  cta: string
  done: boolean
  /**
   * Blocked by an earlier step.
   *
   * ⚠️ A LOCKED STEP IS SHOWN, NOT HIDDEN. Hiding "create a campaign" until a
   * mailbox exists leaves someone wondering whether the product can send mail
   * at all. Showing it greyed out with the reason answers that and tells them
   * what to do first.
   */
  lockedBy: string | null
}

export type FirstRun = {
  steps: FirstRunStep[]
  /** Steps done / steps shown. */
  completed: number
  total: number
  dismissed: boolean
}

/**
 * Builds the checklist for a workspace.
 *
 * ⚠️ EVERY STEP IS GATED THROUGH `can()`, the same policy layer everything
 * else uses. A setter is never told to invite the team or connect a workspace
 * mailbox, because they cannot — a checklist that hands someone a task they
 * are not allowed to finish is worse than no checklist.
 */
export async function loadFirstRun(
  workspaceId: string,
  policy: PolicyInput,
): Promise<FirstRun> {
  const db = createAdminClient()

  const count = async (
    table: 'crm_contacts' | 'crm_pipelines' | 'workspace_memberships' | 'email_accounts' | 'email_campaigns',
  ) => {
    // Scoped by workspace in code — the service role bypasses RLS.
    const { count: n } = await db
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .limit(1)
    return n ?? 0
  }

  const [contacts, pipelines, members, mailboxes, campaigns, readyMailbox, state] =
    await Promise.all([
      count('crm_contacts'),
      count('crm_pipelines'),
      count('workspace_memberships'),
      count('email_accounts'),
      count('email_campaigns'),
      db
        .from('email_accounts')
        .select('id')
        .eq('workspace_id', workspaceId)
        .in('status', ['ready', 'ramping'])
        .limit(1)
        .maybeSingle(),
      db
        .from('workspace_onboarding_state')
        .select('dismissed_at')
        .eq('workspace_id', workspaceId)
        .maybeSingle(),
    ])

  const hasMailbox = mailboxes > 0
  const steps: FirstRunStep[] = []

  if (can(policy, 'crm.contact.view')) {
    steps.push({
      id: 'contacts',
      title: 'Bring in your first contacts',
      body:
        'Upload a saved Sales Navigator page, import a CSV, or add someone by hand. ' +
        'Everything else in Outlio hangs off having people in the CRM.',
      href: '/dashboard/extract/new',
      cta: 'Add contacts',
      done: contacts > 0,
      lockedBy: null,
    })
  }

  if (can(policy, 'crm.pipeline.manage')) {
    steps.push({
      id: 'pipeline',
      title: 'Set up your pipeline',
      body:
        'Name the stages a deal moves through. The board, the forecast and the ' +
        'win-rate reports all read from this.',
      href: '/crm/pipeline',
      cta: 'Create a pipeline',
      done: pipelines > 0,
      lockedBy: null,
    })
  }

  if (can(policy, 'email.account.connect')) {
    steps.push({
      id: 'mailbox',
      title: 'Connect a mailbox',
      body:
        'Outlio sends through your own mail server, so your replies land in your ' +
        'own inbox and your domain keeps its reputation.',
      href: '/email',
      cta: 'Connect a mailbox',
      done: hasMailbox,
      lockedBy: null,
    })

    steps.push({
      id: 'readiness',
      title: 'Check you are ready to send',
      body:
        'SPF, DKIM, DMARC and a gradual ramp. This is the difference between ' +
        'landing in an inbox and landing in spam.',
      href: '/email',
      cta: 'Run the checks',
      done: Boolean(readyMailbox.data),
      lockedBy: hasMailbox ? null : 'mailbox',
    })
  }

  if (can(policy, 'email.campaign.create')) {
    steps.push({
      id: 'campaign',
      title: 'Build your first campaign',
      body:
        'A sequence of steps with waits and reply-stop branches. Nothing sends ' +
        'until you launch it, and a reply stops the follow-ups.',
      href: '/email/campaigns',
      cta: 'Create a campaign',
      done: campaigns > 0,
      lockedBy: hasMailbox ? null : 'mailbox',
    })
  }

  if (can(policy, 'workspace.member.manage')) {
    steps.push({
      id: 'team',
      title: 'Invite your team',
      body:
        'Everyone gets their own login. Setters see the contacts assigned to ' +
        'them; managers see the workspace.',
      href: '/dashboard/settings/team',
      cta: 'Invite someone',
      done: members > 1,
      lockedBy: null,
    })
  }

  return {
    steps,
    completed: steps.filter((s) => s.done).length,
    total: steps.length,
    dismissed: Boolean(state.data?.dismissed_at),
  }
}

/**
 * Whether to show the checklist at all.
 *
 * ⚠️ IT DISAPPEARS ON ITS OWN once every step is done. A checklist that stays
 * after it is finished becomes furniture people stop reading, and the next
 * genuinely useful thing it says gets ignored with it.
 */
export function shouldShowFirstRun(run: FirstRun): boolean {
  return !run.dismissed && run.total > 0 && run.completed < run.total
}
