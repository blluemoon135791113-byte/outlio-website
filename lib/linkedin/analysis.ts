import 'server-only'

/**
 * "What is working and what is not" — Phase 20, premium only.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  Owner, 2026-09-15: "ai can analyze and when the user hit dm or strategy  ║
 * ║  analysis it can get back with whats working and whats not and what to go ║
 * ║  with (thats the most smartest feature we can build)… For the analysis it ║
 * ║  will analyze the dms opener dms and follow ups and get back with a       ║
 * ║  report for each assigned users and overall as well".                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THE DANGEROUS PART OF THIS FEATURE IS NOT THE MODEL. IT IS THE ARITHMETIC
 * UNDERNEATH IT.
 *
 * `email_events` still holds 254 false `replied` rows — an entire mailbox
 * counted as prospect replies against two messages ever sent, which renders a
 * reply rate of 12,700%. A model handed numbers like those will write a
 * confident, well-argued report about a rep who is doing brilliantly, and
 * nobody reading it can tell.
 *
 * So the counting happens HERE, in code that can be tested, and the model is
 * given only the arithmetic's output. Three rules the counting obeys:
 *
 *   1. A reply counts only where Outlio has evidence it contacted them first —
 *      `linkedin_observations` already enforces that at write time (Phase 19).
 *   2. An unconfirmed send (`OUTCOME_UNKNOWN`) is reported SEPARATELY and is
 *      never folded into either numerator or denominator silently.
 *   3. A rate is not computed at all below a floor. Two sends and one reply is
 *      not a 50% reply rate, and presenting it as one is how a team reorganises
 *      itself around noise.
 *
 * ⚠️ AND THE MODEL NEVER SEES A PROSPECT'S NAME. It reads message TEXT and
 * aggregate counts. Naming individuals would put a third party's personal data
 * into a vendor prompt for a report about a rep's writing.
 */
import { hubbleExecute, type HubbleTools } from '@/lib/hubble/execute'
import { allProspectMessages, type ProspectMessageKind } from '@/lib/linkedin/prospect-messages'
import {
  bounds,
  isFiltered,
  WHOLE_HISTORY,
  within,
  type AnalysisWindow,
} from '@/lib/analysis/window'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * ⚠️ BELOW THIS, NO RATE IS SHOWN — ONLY COUNTS.
 *
 * Twenty is not a statistical claim; it is the point where a single reply stops
 * moving the number by more than five points. The floor exists because the
 * alternative is a report that says one rep converts at 50% and another at 20%
 * when the difference is two replies and four sends.
 */
export const RATE_FLOOR = 20

export type RepStats = {
  userId: string | null
  name: string | null
  /** Tasks marked sent — requests and messages both. */
  sent: number
  /** Of those, how many nobody could confirm (§4.17). */
  unconfirmed: number
  replies: number
  meetings: number
  /** `null` below `RATE_FLOOR`, deliberately. */
  replyRate: number | null
  openers: number
  pitches: number
}

export type AnalysisFinding = {
  /** `working`, `not_working`, or `do_this`. */
  kind: 'working' | 'not_working' | 'do_this'
  headline: string
  detail: string
}

export type AnalysisReport = {
  overall: RepStats
  perRep: RepStats[]
  findings: AnalysisFinding[]
  /** Said out loud whenever the evidence is too thin to support the findings. */
  caveat: string | null
  generatedAt: string
  /**
   * The period and people this report covers.
   *
   * ⚠️ RETURNED WITH THE REPORT, NOT LEFT TO THE FORM. The form's inputs can be
   * changed after a run, so a report headed by whatever the boxes currently say
   * would relabel itself — the numbers from March sitting under a heading that
   * now reads April. A report states its own scope.
   */
  window: AnalysisWindow
}

export type AnalysisResult =
  | { ok: true; report: AnalysisReport }
  | { ok: false; reason: 'not_entitled' | 'no_data' | 'unusable' | 'no_credits'; message: string }

/*
 * ⚠️ RE-EXPORTED, NOT REDEFINED. The window moved to `lib/analysis/window.ts`
 * when the email analysis started asking the same question — the two must
 * agree on where a day begins and ends, and on an empty selection meaning
 * everyone. Existing importers keep working through this line.
 */
export type { AnalysisWindow }
export { WHOLE_HISTORY }

const SENT_OUTCOMES = ['REQUEST_MARKED_SENT', 'MESSAGE_MARKED_SENT'] as const

/**
 * Counts what actually happened, from rows.
 *
 * ⚠️ NO MODEL IS INVOLVED IN THIS FUNCTION, AND THAT IS THE DESIGN. Everything
 * a reader will act on numerically is computed here; the model's job is to read
 * the message TEXT and say something useful about the writing.
 */
export async function gatherStats(
  workspaceId: string,
  window: AnalysisWindow = WHOLE_HISTORY,
): Promise<{
  overall: RepStats
  perRep: RepStats[]
}> {
  const db = createAdminClient()
  const { fromIso, toIso } = bounds(window)
  const selected = new Set(window.userIds)
  // Empty means the whole team. See the note on `AnalysisWindow`.
  const includes = (userId: string | null): boolean =>
    selected.size === 0 || (userId !== null && selected.has(userId))

  const { data: tasks, error } = await db
    .from('linkedin_tasks')
    .select('id, outcome, completed_by, contact_id, completed_at')
    .eq('workspace_id', workspaceId)
    .not('outcome', 'is', null)

  if (error) throw new Error(`gatherStats failed: ${error.message}`)

  const { data: observations, error: obsError } = await db
    .from('linkedin_observations')
    .select('kind, contact_id, evidence_was_unconfirmed, observed_at')
    .eq('workspace_id', workspaceId)

  if (obsError) throw new Error(`gatherStats failed: ${obsError.message}`)

  /*
   * ⚠️ THE MESSAGES ARE FILTERED, THE TWO READS ABOVE ARE NOT — AND THAT IS
   * DELIBERATE, NOT AN OVERSIGHT.
   *
   * Both reads feed TWO different things: the counters, which must respect the
   * window, and `repOfContact`, which must not. Attribution answers "whose
   * outreach was this", and that fact does not change because a manager picked
   * a narrower month — an observation in March belongs to whoever did the
   * outreach, even if that outreach was in February.
   *
   * Pushing the date filter into these queries would build the attribution map
   * from in-window tasks only, so every reply to earlier outreach would fall
   * through to the `null` rep and be reported as "Unattributed". A plausible
   * number, silently wrong, and worse the narrower the window — which is
   * exactly when somebody is looking closely.
   *
   * So the window is applied per row below, at the point of COUNTING.
   * ⚠️ These reads were already unbounded before this filter existed; the cost
   * is unchanged, and it is the first thing to fix if this page ever feels
   * slow.
   */
  const messages = await allProspectMessages(workspaceId, 400, window)

  /*
   * ⚠️ ATTRIBUTED TO WHO COMPLETED THE TASK, NOT WHO OWNS THE CONTACT. The
   * question is whose OUTREACH worked, and reassigning a book of leads must not
   * move last month's results onto their new owner. `completed_by` is stamped
   * when the outcome is recorded and never moves.
   */
  const byRep = new Map<string | null, RepStats>()
  const rep = (userId: string | null): RepStats => {
    let found = byRep.get(userId)
    if (!found) {
      found = {
        userId,
        name: null,
        sent: 0,
        unconfirmed: 0,
        replies: 0,
        meetings: 0,
        replyRate: null,
        openers: 0,
        pitches: 0,
      }
      byRep.set(userId, found)
    }
    return found
  }

  /*
   * ⚠️ A CONTACT → REP MAP BUILT FROM TASKS, so an observation can be credited
   * to whoever did the outreach. An observation records what a prospect did; it
   * carries no rep of its own, and crediting it to the contact's current owner
   * would be the reassignment bug again.
   */
  const repOfContact = new Map<string, string | null>()

  /*
   * ⚠️ ATTRIBUTION IS BUILT FROM EVERY TASK, BEFORE ANY FILTERING. See the long
   * note above the reads: who did the outreach is a fixed fact, and rebuilding
   * this map from a filtered set turns replies to earlier work into
   * "Unattributed".
   */
  for (const task of tasks ?? []) {
    if (!task.outcome) continue
    if (!repOfContact.has(task.contact_id)) repOfContact.set(task.contact_id, task.completed_by)
  }

  for (const task of tasks ?? []) {
    if (!task.outcome) continue
    if (!includes(task.completed_by)) continue
    if (!within(task.completed_at, fromIso, toIso)) continue

    if ((SENT_OUTCOMES as readonly string[]).includes(task.outcome)) {
      const r = rep(task.completed_by)
      r.sent += 1
    } else if (task.outcome === 'OUTCOME_UNKNOWN') {
      /*
       * ⚠️ COUNTED, AND COUNTED SEPARATELY. §4.17 treats an unknown outcome as
       * possibly delivered, so excluding it from `sent` would understate the
       * denominator and inflate every rate built on it. Adding it silently
       * would assert something nobody can support. So: both numbers, reported.
       */
      const r = rep(task.completed_by)
      r.sent += 1
      r.unconfirmed += 1
    }
  }

  for (const observation of observations ?? []) {
    if (!within(observation.observed_at, fromIso, toIso)) continue

    const owner = repOfContact.get(observation.contact_id) ?? null
    /*
     * ⚠️ DROPPED, NOT RE-CREDITED TO "Unattributed". When a manager picks three
     * people, a reply to a fourth person's prospect is not part of the answer —
     * and folding it into the unattributed row would add replies with no sends
     * behind them, which is the shape that produces an impossible reply rate.
     */
    if (!includes(owner)) continue

    const r = rep(owner)
    if (observation.kind === 'REPLY_RECORDED') r.replies += 1
    if (observation.kind === 'MEETING_BOOKED_RECORDED' || observation.kind === 'MEETING_HELD_RECORDED') {
      r.meetings += 1
    }
  }

  // Already filtered by `allProspectMessages`, which applies the same window.
  for (const message of messages) {
    const r = rep(message.authoredBy)
    if (message.kind === 'OPENER') r.openers += 1
    else r.pitches += 1
  }

  // ---- names, resolved once -----------------------------------------------
  const ids = [...byRep.keys()].filter((id): id is string => Boolean(id))
  if (ids.length > 0) {
    const { data: profiles } = await db
      .from('profiles')
      .select('id, full_name, email')
      .in('id', ids)
    for (const profile of profiles ?? []) {
      const r = byRep.get(profile.id)
      if (r) r.name = profile.full_name?.trim() || profile.email || null
    }
  }

  const perRep = [...byRep.values()].map((r) => ({ ...r, replyRate: rateOf(r.replies, r.sent) }))

  const overall: RepStats = {
    userId: null,
    name: 'Everyone',
    sent: perRep.reduce((n, r) => n + r.sent, 0),
    unconfirmed: perRep.reduce((n, r) => n + r.unconfirmed, 0),
    replies: perRep.reduce((n, r) => n + r.replies, 0),
    meetings: perRep.reduce((n, r) => n + r.meetings, 0),
    replyRate: null,
    openers: perRep.reduce((n, r) => n + r.openers, 0),
    pitches: perRep.reduce((n, r) => n + r.pitches, 0),
  }
  overall.replyRate = rateOf(overall.replies, overall.sent)

  return { overall, perRep: perRep.sort((a, b) => b.sent - a.sent) }
}

/**
 * ⚠️ `null` BELOW THE FLOOR, AND NEVER 0 — THEY MEAN DIFFERENT THINGS.
 *
 * Zero is "we sent thirty and nobody answered", which is a finding. `null` is
 * "we have not sent enough to say", which is not. Rendering the second as the
 * first tells a rep their approach failed when it has not been tried.
 *
 * ⚠️ AND IT CANNOT EXCEED 100. A rate above that is the 12,700% shape — it means
 * replies are being counted against outreach that was never recorded, and the
 * honest answer is to refuse the number rather than print an impossible one.
 */
export function rateOf(replies: number, sent: number): number | null {
  if (sent < RATE_FLOOR) return null
  const rate = Math.round((replies / sent) * 100)
  return rate > 100 ? null : rate
}

/**
 * The premium + role gate.
 *
 * ⚠️ TWO DIFFERENT QUESTIONS, AND BOTH ARE ASKED. `report.team.view` on the
 * capability is a ROLE check — may this person see a colleague's numbers. This
 * is the PLAN check — did this workspace pay for the feature. Neither implies
 * the other: an owner on a starter plan has every role permission there is.
 */
export async function analysisEntitled(workspaceId: string): Promise<boolean> {
  const db = createAdminClient()

  const { data: workspace } = await db
    .from('workspaces')
    .select('owner_user_id')
    .eq('id', workspaceId)
    .maybeSingle()

  if (!workspace?.owner_user_id) return false

  const { data: profile } = await db
    .from('profiles')
    .select('plan_id, role')
    .eq('id', workspace.owner_user_id)
    .maybeSingle()

  /*
   * ╔═══════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ PLATFORM ADMIN BYPASSES THE PLAN, AND LEAVING THIS OUT WAS A REAL  ║
   * ║  DEFECT RATHER THAN A CONSERVATIVE CHOICE.                             ║
   * ║                                                                       ║
   * ║  The owner's words were "for premium users only AND ADMIN". Without    ║
   * ║  this clause the second half was simply not built — and the symptom    ║
   * ║  was immediate: 27 of 33 workspace owners in production carry no       ║
   * ║  `plan_id` at all, so `resolveModules` grants them every module        ║
   * ║  through its own admin bypass while this function refused them the     ║
   * ║  analysis. A workspace with the LinkedIn module and no way to analyse  ║
   * ║  it, for no stated reason.                                            ║
   * ║                                                                       ║
   * ║  `profiles.role = 'admin'` is Outlio staff, not a workspace role. The   ║
   * ║  same bypass already exists in `decideAccess` for scraper limits, in    ║
   * ║  `hasHubbleEntitlement`, and in `resolveModules` — whose comment says   ║
   * ║  extending it "keeps one rule rather than three". A fourth place that   ║
   * ║  answers the same question differently is the defect this codebase      ║
   * ║  pays for most often.                                                  ║
   * ╚═══════════════════════════════════════════════════════════════════════╝
   */
  if (profile?.role === 'admin') return true

  if (!profile?.plan_id) return false

  const { data: plan } = await db
    .from('plans')
    .select('limits')
    .eq('id', profile.plan_id)
    .maybeSingle()

  const limits = (plan?.limits ?? null) as Record<string, unknown> | null
  /*
   * ⚠️ READ FROM `plans.limits` AT RUNTIME, NEVER HARDCODED BY PLAN NAME
   * (CLAUDE.md). A list of "premium plan keys" in code is a second source of
   * truth that drifts the first time a plan is renamed or added, and it drifts
   * in the direction of giving the feature away.
   */
  return limits?.linkedin_analysis_enabled === true
}

/**
 * Builds the report.
 *
 * ⚠️ THE MODEL IS GIVEN COUNTS IT CANNOT RECOMPUTE AND TEXT IT CAN READ. It is
 * asked for qualitative findings about the WRITING; every number a reader acts
 * on came from `gatherStats`.
 */
export async function analyseStrategy(input: {
  workspaceId: string
  userId: string
  window?: AnalysisWindow
}): Promise<AnalysisResult> {
  if (!(await analysisEntitled(input.workspaceId))) {
    return {
      ok: false,
      reason: 'not_entitled',
      message: 'Strategy analysis is not included in your plan.',
    }
  }

  const window = input.window ?? WHOLE_HISTORY

  const { overall, perRep } = await gatherStats(input.workspaceId, window)
  const messages = await allProspectMessages(input.workspaceId, 200, window)

  /*
   * ⚠️ REFUSED WHEN THERE IS NOTHING TO READ, rather than asking a model to
   * write a report about nothing. It will happily produce one, and it will be
   * entirely invented — which is the failure this whole module is arranged
   * against.
   *
   * ⚠️ AND THE REFUSAL NAMES THE FILTER WHEN ONE IS SET. "Nothing to analyse
   * yet" is a statement about the whole workspace; said to somebody who just
   * picked one week and one person, it reads as "this product has no data"
   * rather than "try a wider period", and the difference is whether they know
   * what to do next.
   */
  if (messages.length === 0 && overall.sent === 0) {
    return {
      ok: false,
      reason: 'no_data',
      message: isFiltered(window)
        ? 'Nothing was recorded in that period for the people selected. Try a wider range, or select everyone.'
        : 'There is nothing to analyse yet — no messages written and no outreach recorded.',
    }
  }

  const metered = await hubbleExecute(
    'linkedin.analysis',
    { workspaceId: input.workspaceId, userId: input.userId, source: 'http:linkedin-analysis' },
    async (tools: HubbleTools) => {
      const result = await tools.llm.generateJson({
        system: systemPrompt(),
        user: promptFor(overall, perRep, messages, window),
        schema: findingsSchema() as unknown as Record<string, unknown>,
        // Judgement about prose, not structure. See `draft.ts` for the contrast.
        temperature: 0.4,
        maxOutputTokens: 1_500,
      })

      if (!result.ok) return { findings: null as AnalysisFinding[] | null }

      const json = result.json as { findings?: unknown }
      const raw = Array.isArray(json?.findings) ? json.findings : []

      const findings: AnalysisFinding[] = []
      for (const item of raw) {
        const f = item as { kind?: unknown; headline?: unknown; detail?: unknown }
        /*
         * ⚠️ THE `kind` ENUM IS ADVISORY WITH THESE PROVIDERS unless strict mode
         * applies, and strict mode needs every property in `required`. So an
         * out-of-vocabulary kind is coerced to the neutral one rather than
         * rendered as an unknown badge.
         */
        const kind =
          f.kind === 'working' || f.kind === 'not_working' || f.kind === 'do_this'
            ? f.kind
            : 'do_this'
        if (typeof f.headline !== 'string' || !f.headline.trim()) continue
        findings.push({
          kind,
          headline: f.headline.trim().slice(0, 200),
          detail: typeof f.detail === 'string' ? f.detail.trim().slice(0, 1_000) : '',
        })
      }

      return { findings }
    },
  )

  if (!metered.ok) {
    return {
      ok: false,
      reason: metered.reason === 'no_credits' ? 'no_credits' : 'unusable',
      message:
        metered.reason === 'no_credits'
          ? 'Your workspace is out of AI credits.'
          : 'The model was unavailable. Try again shortly.',
    }
  }

  const findings = metered.result.findings
  if (!findings || findings.length === 0) {
    return { ok: false, reason: 'unusable', message: 'The analysis came back empty.' }
  }

  return {
    ok: true,
    report: {
      overall,
      perRep,
      findings,
      caveat: caveatFor(overall),
      generatedAt: new Date().toISOString(),
      window,
    },
  }
}

/**
 * ⚠️ THE CAVEAT IS COMPUTED, NOT ASKED FOR. A model told "add a caveat if the
 * data is thin" will add one when it feels uncertain, which is not the same
 * thing and is not checkable. This is the same threshold `rateOf` uses, so the
 * sentence and the missing percentage can never disagree.
 */
export function caveatFor(overall: RepStats): string | null {
  if (overall.sent === 0) {
    return 'No outreach has been recorded yet, so this reads the messages only — nothing here is evidence that any of it works.'
  }
  if (overall.sent < RATE_FLOOR) {
    return `Only ${overall.sent} ${overall.sent === 1 ? 'action has' : 'actions have'} been recorded. That is too few to compute a reply rate, so the findings below are about the writing rather than about results.`
  }
  if (overall.unconfirmed > 0) {
    const share = Math.round((overall.unconfirmed / overall.sent) * 100)
    return `${overall.unconfirmed} of ${overall.sent} recorded actions (${share}%) were marked "not sure whether it went". They are counted as sent, so the reply rate may be understated.`
  }
  return null
}

function systemPrompt(): string {
  return [
    'You are a B2B sales coach reviewing a team\'s LinkedIn outreach copy.',
    '',
    'You are given: aggregate counts that have ALREADY been computed, and the',
    'message text reps wrote. Your job is to judge the WRITING.',
    '',
    /*
     * ⚠️ THE MODEL IS FORBIDDEN FROM DOING ARITHMETIC, and the reason is that it
     * is bad at it and the reader cannot tell. Every number that matters was
     * computed in `gatherStats` against rules about what counts as a reply.
     */
    'NEVER compute, restate, or estimate a rate, percentage or ratio. The counts',
    'you are given are the only numbers that exist. If a reply rate is absent it',
    'is because there is not enough data to support one — do not supply it.',
    '',
    'NEVER claim a specific message caused a specific outcome. You cannot see',
    'which message went to whom. Talk about patterns across the copy.',
    '',
    'Be specific and blunt. "The openers all lead with the sender rather than the',
    'recipient" is useful. "Consider personalising more" is not.',
    '',
    'Give between 3 and 6 findings. At least one must be something to change.',
  ].join('\n')
}

function findingsSchema() {
  return {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['working', 'not_working', 'do_this'],
              description: 'working, not_working, or do_this',
            },
            headline: { type: 'string', description: 'One sentence, specific.' },
            detail: { type: 'string', description: 'Two or three sentences of evidence from the copy.' },
          },
          // Every property declared AND required — Phase 13's lesson.
          required: ['kind', 'headline', 'detail'],
        },
      },
    },
    required: ['findings'],
  }
}

function promptFor(
  overall: RepStats,
  perRep: RepStats[],
  messages: { kind: ProspectMessageKind; body: string; authoredBy: string }[],
  window: AnalysisWindow,
): string {
  const lines: string[] = []

  /*
   * ⚠️ THE MODEL IS TOLD THE PERIOD, so it does not write "activity has dropped
   * off recently" about a deliberately narrow slice. It is given the dates
   * only — never the names of the people selected, matching the rule below
   * that reps are numbered rather than named in a prompt.
   */
  if (window.from || window.to) {
    lines.push(
      `PERIOD: ${window.from ?? 'the beginning'} to ${window.to ?? 'today'} (inclusive, UTC). ` +
        'Everything below is from this period only — do not describe it as a complete history.',
      '',
    )
  }
  if (window.userIds.length > 0) {
    lines.push(
      `SELECTION: ${window.userIds.length} of the team were selected. Do not comment on team size or on who is missing.`,
      '',
    )
  }

  lines.push('COUNTS (already computed — do not recompute):')
  lines.push(
    `  Overall: ${overall.sent} actions recorded, ${overall.unconfirmed} unconfirmed, ` +
      `${overall.replies} replies, ${overall.meetings} meetings, ` +
      `reply rate ${overall.replyRate === null ? 'not enough data' : `${overall.replyRate}%`}.`,
  )

  /*
   * ⚠️ REPS ARE NUMBERED, NOT NAMED, IN THE PROMPT. The report shows real names
   * — they are the customer's own staff and the whole point is per-rep feedback
   * — but the vendor does not need them to judge prose, and a name in a prompt
   * is a name in somebody's logs.
   */
  perRep.forEach((r, i) => {
    lines.push(
      `  Rep ${i + 1}: ${r.sent} actions, ${r.replies} replies, ` +
        `reply rate ${r.replyRate === null ? 'not enough data' : `${r.replyRate}%`}, ` +
        `${r.openers} openers and ${r.pitches} pitches written.`,
    )
  })

  const index = new Map(perRep.map((r, i) => [r.userId, i + 1]))

  lines.push('', 'THE MESSAGES:')
  for (const message of messages) {
    lines.push(
      `  [Rep ${index.get(message.authoredBy) ?? '?'} · ${message.kind}] ${message.body.replace(/\s+/g, ' ').slice(0, 600)}`,
    )
  }

  return lines.join('\n')
}
