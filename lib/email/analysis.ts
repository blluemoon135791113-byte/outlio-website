import 'server-only'

/**
 * "Which sequence is working" — the email counterpart of
 * `lib/linkedin/analysis.ts`.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE COPY BEING ANALYSED IS THE COPY THAT WAS ACTUALLY SENT.          ║
 * ║                                                                           ║
 * ║  The LinkedIn analysis reads `linkedin_prospect_messages` — what an       ║
 * ║  operator SAYS they would write — because nothing on LinkedIn passes      ║
 * ║  through Outlio. Email is the opposite: `email_sequence_steps` holds the  ║
 * ║  subject and body that the sender actually put on the wire.               ║
 * ║                                                                           ║
 * ║  So there is no "record your email pitch" box here, deliberately. A typed ║
 * ║  recollection would be a second, weaker account of something already      ║
 * ║  recorded exactly — and when the two disagreed, the analysis would be     ║
 * ║  reading the wrong one with no way to tell.                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THE ARITHMETIC IS HERE, NOT IN THE MODEL — the same rule the LinkedIn
 * analysis states at length, and email is where its example came from:
 * `email_events` still holds 254 false `replied` rows from before the
 * 2026-09-07 reply-classification fix. A model handed a 12,700% reply rate
 * writes a confident report about a sequence that is doing brilliantly, and
 * nobody reading it can tell.
 */
import {
  bounds,
  isFiltered,
  WHOLE_HISTORY,
  within,
  type AnalysisWindow,
} from '@/lib/analysis/window'
import { hubbleExecute, type HubbleTools } from '@/lib/hubble/execute'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * ⚠️ THE SAME FLOOR THE LINKEDIN ANALYSIS AND THE READINESS CHECK USE.
 * Two sends and one reply is not a 50% reply rate. The threshold is a judgement
 * about evidence and it is made once, not re-argued per screen.
 */
export const RATE_FLOOR = 20

/**
 * ⚠️ THE DATE THE REPLY CLASSIFIER WAS FIXED. Before it, every message in a
 * connected mailbox was counted as a prospect reply — production held 254 such
 * rows against two messages ever sent. Those rows are still in `email_events`,
 * so a window reaching back past this date is reading some of them.
 *
 * It is surfaced as a caveat rather than silently excluded: deleting or
 * filtering real events on a date guess would discard genuine replies too, and
 * this is the owner's data to decide about.
 */
export const REPLY_FIX_DATE = '2026-09-07'

export type SequenceStats = {
  campaignId: string
  name: string
  /** `sales_sequence`, `broadcast`, … — the two behave differently. */
  type: string
  status: string
  /** Distinct people the sequence sent at least one message to. */
  contacted: number
  /** Messages sent. Always ≥ `contacted` for a multi-step sequence. */
  sent: number
  delivered: number
  /** Distinct people who replied. Never the event count — see `replyRate`. */
  replied: number
  /** Recorded, never counted as a reply. */
  autoReplied: number
  bounced: number
  unsubscribed: number
  /**
   * Replies per PERSON contacted, `null` below `RATE_FLOOR`.
   *
   * ╔═══════════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ PER PERSON, NOT PER MESSAGE, AND THE CHOICE IS THE WHOLE POINT OF    ║
   * ║  THIS SCREEN.                                                             ║
   * ║                                                                           ║
   * ║  `/email/analytics` measures replies per MESSAGE, which is right for      ║
   * ║  mailbox health — "what does this mailbox get back per message it sends". ║
   * ║  Ranking SEQUENCES by that number punishes following up: a four-step      ║
   * ║  sequence that reaches the same people four times quarters its own rate   ║
   * ║  against a one-step blast, so the blast wins a comparison it should lose. ║
   * ║                                                                           ║
   * ║  `lib/crm/metrics.ts` already made this call for the reports page and     ║
   * ║  says so outright: using the event count "would punish doing the job      ║
   * ║  properly". Same question, same answer, stated again because the two      ║
   * ║  figures sit two clicks apart and look interchangeable.                   ║
   * ╚═══════════════════════════════════════════════════════════════════════════╝
   */
  replyRate: number | null
  /** Bounces per message sent, `null` below the floor. */
  bounceRate: number | null
}

export type EmailAnalysisFinding = {
  kind: 'working' | 'not_working' | 'do_this'
  headline: string
  detail: string
}

export type EmailAnalysisReport = {
  sequences: SequenceStats[]
  overall: SequenceStats
  findings: EmailAnalysisFinding[]
  caveat: string | null
  generatedAt: string
  window: AnalysisWindow
}

export type EmailAnalysisResult =
  | { ok: true; report: EmailAnalysisReport }
  | { ok: false; reason: 'no_data' | 'unusable' | 'no_credits'; message: string }

/**
 * ⚠️ `null` BELOW THE FLOOR, NEVER 0, AND NEVER ABOVE 100.
 *
 * Zero is "we contacted thirty people and nobody answered", which is a finding.
 * `null` is "we have not contacted enough to say", which is not. Above 100 is
 * the false-reply shape — replies counted against outreach that was never
 * recorded — and the honest answer is to refuse the number rather than print an
 * impossible one.
 */
export function rateOf(numerator: number, denominator: number): number | null {
  if (denominator < RATE_FLOOR) return null
  const rate = Math.round((numerator / denominator) * 100)
  return rate > 100 ? null : rate
}

/**
 * Counts what each sequence actually did, from rows.
 *
 * ⚠️ NO MODEL IS INVOLVED IN THIS FUNCTION.
 */
export async function gatherSequenceStats(
  workspaceId: string,
  window: AnalysisWindow = WHOLE_HISTORY,
): Promise<SequenceStats[]> {
  const db = createAdminClient()
  const { fromIso, toIso } = bounds(window)

  const { data: campaigns, error } = await db
    .from('email_campaigns')
    .select('id, name, type, status')
    // Scoped by workspace in code — the service role bypasses RLS.
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)

  if (error) throw new Error(`gatherSequenceStats failed: ${error.message}`)
  if ((campaigns ?? []).length === 0) return []

  /*
   * ⚠️ ONE READ OF THE EVENT STREAM, FILTERED IN SQL. Unlike the LinkedIn
   * analysis — where the same rows carry attribution that must ignore the
   * window — nothing here needs an out-of-window event: a campaign event
   * already names its own campaign, so there is no map to build.
   */
  let query = db
    .from('email_events')
    .select('campaign_id, contact_id, type, occurred_at')
    .eq('workspace_id', workspaceId)
    .not('campaign_id', 'is', null)

  if (fromIso) query = query.gte('occurred_at', fromIso)
  if (toIso) query = query.lte('occurred_at', toIso)

  const { data: events, error: eventError } = await query
  if (eventError) throw new Error(`gatherSequenceStats failed: ${eventError.message}`)

  /*
   * ⚠️ DISTINCT PEOPLE, TRACKED AS SETS. The denominator is people contacted
   * and the numerator is people who replied — counting events for either would
   * make a four-step sequence look worse than a one-step blast. A contact with
   * no id (an event that outlived its contact row) cannot be de-duplicated, so
   * it is counted once by a synthetic key rather than dropped: losing it would
   * understate a real send.
   */
  type Tally = {
    contacted: Set<string>
    replied: Set<string>
    sent: number
    delivered: number
    autoReplied: number
    bounced: number
    unsubscribed: number
  }

  const tallies = new Map<string, Tally>()
  const tally = (campaignId: string): Tally => {
    let found = tallies.get(campaignId)
    if (!found) {
      found = {
        contacted: new Set(),
        replied: new Set(),
        sent: 0,
        delivered: 0,
        autoReplied: 0,
        bounced: 0,
        unsubscribed: 0,
      }
      tallies.set(campaignId, found)
    }
    return found
  }

  let orphan = 0
  for (const event of events ?? []) {
    if (!event.campaign_id) continue
    // The SQL filter already applied the window; this is the belt for a row
    // with a null timestamp, which `within` treats as outside.
    if ((fromIso || toIso) && !within(event.occurred_at, fromIso, toIso)) continue

    const t = tally(event.campaign_id)
    const person = event.contact_id ?? `orphan:${(orphan += 1)}`

    switch (event.type) {
      case 'sent':
        t.sent += 1
        t.contacted.add(person)
        break
      case 'delivered':
        t.delivered += 1
        break
      case 'replied':
        t.replied.add(person)
        break
      /*
       * ⚠️ RECORDED, NEVER A REPLY. 0090 keeps `auto_replied` as its own type
       * precisely so an out-of-office does not inflate the rate a manager
       * compares sequences on.
       */
      case 'auto_replied':
        t.autoReplied += 1
        break
      case 'bounced':
        t.bounced += 1
        break
      case 'unsubscribed':
        t.unsubscribed += 1
        break
      default:
        // `queued`, `failed`, `complaint`, `opened`, `clicked`. Opens and
        // clicks are deliberately not ranked on: Apple Mail Privacy Protection
        // pre-fetches every image, so an open means a machine loaded a pixel.
        break
    }
  }

  return (campaigns ?? [])
    .map((campaign) => {
      const t = tallies.get(campaign.id)
      const contacted = t?.contacted.size ?? 0
      const replied = t?.replied.size ?? 0
      const sent = t?.sent ?? 0

      return {
        campaignId: campaign.id,
        name: campaign.name,
        type: campaign.type,
        status: campaign.status,
        contacted,
        sent,
        delivered: t?.delivered ?? 0,
        replied,
        autoReplied: t?.autoReplied ?? 0,
        bounced: t?.bounced ?? 0,
        unsubscribed: t?.unsubscribed ?? 0,
        replyRate: rateOf(replied, contacted),
        bounceRate: rateOf(t?.bounced ?? 0, sent),
      }
    })
    /*
     * ⚠️ SEQUENCES WITH NOTHING IN THE WINDOW ARE DROPPED. A campaign that did
     * not run in March is not a campaign with a 0% reply rate in March, and
     * listing it as one puts a row of zeroes next to real results where it
     * reads as a failure.
     */
    .filter((row) => row.sent > 0 || row.contacted > 0)
    .sort((a, b) => b.contacted - a.contacted)
}

/** The totals across every sequence in the window. */
export function totalsOf(sequences: SequenceStats[]): SequenceStats {
  const sum = (pick: (s: SequenceStats) => number) =>
    sequences.reduce((n, s) => n + pick(s), 0)

  const contacted = sum((s) => s.contacted)
  const replied = sum((s) => s.replied)
  const sent = sum((s) => s.sent)
  const bounced = sum((s) => s.bounced)

  return {
    campaignId: 'overall',
    name: 'Everything',
    type: '—',
    status: '—',
    contacted,
    sent,
    delivered: sum((s) => s.delivered),
    replied,
    autoReplied: sum((s) => s.autoReplied),
    bounced,
    unsubscribed: sum((s) => s.unsubscribed),
    /*
     * ⚠️ RECOMPUTED FROM THE TOTALS, NOT AVERAGED FROM THE ROWS. Averaging
     * per-sequence rates weights a 5-person test the same as a 5,000-person
     * campaign, and a `null` rate has no value to average at all.
     */
    replyRate: rateOf(replied, contacted),
    bounceRate: rateOf(bounced, sent),
  }
}

/**
 * ⚠️ COMPUTED, NOT ASKED OF THE MODEL. A model told "add a caveat if the data
 * is thin" adds one when it feels uncertain, which is not the same thing and is
 * not checkable.
 */
export function caveatFor(overall: SequenceStats, window: AnalysisWindow): string | null {
  if (overall.contacted === 0) {
    return 'No email was sent in this period, so there is nothing here to compare.'
  }

  /*
   * ⚠️ THE FALSE-REPLY WARNING COMES FIRST, because it is the one that makes
   * every other number on the screen untrustworthy rather than merely thin.
   */
  if (!window.from || window.from < REPLY_FIX_DATE) {
    return (
      `This period reaches back before ${REPLY_FIX_DATE}, when every message in a connected ` +
      'mailbox was being counted as a prospect reply. Reply figures that include earlier ' +
      'dates are overstated — narrow the start date to compare sequences fairly.'
    )
  }

  if (overall.contacted < RATE_FLOOR) {
    return (
      `Only ${overall.contacted} ${overall.contacted === 1 ? 'person was' : 'people were'} ` +
      'contacted in this period. That is too few to compute a reply rate, so the findings ' +
      'below are about the writing rather than about results.'
    )
  }

  return null
}

/**
 * Builds the report.
 *
 * ⚠️ THE MODEL IS GIVEN COUNTS IT CANNOT RECOMPUTE AND COPY IT CAN READ. It is
 * asked for qualitative findings about the WRITING; every number a reader acts
 * on came from `gatherSequenceStats`.
 */
export async function analyseEmailStrategy(input: {
  workspaceId: string
  userId: string
  window?: AnalysisWindow
}): Promise<EmailAnalysisResult> {
  const window = input.window ?? WHOLE_HISTORY

  const sequences = await gatherSequenceStats(input.workspaceId, window)
  const overall = totalsOf(sequences)
  const steps = await sequenceCopy(
    input.workspaceId,
    sequences.map((s) => s.campaignId),
  )

  /*
   * ⚠️ REFUSED WHEN THERE IS NOTHING TO READ, rather than asking a model to
   * write a report about nothing. It will happily produce one, and it will be
   * entirely invented.
   */
  if (sequences.length === 0 && steps.length === 0) {
    return {
      ok: false,
      reason: 'no_data',
      message: isFiltered(window)
        ? 'No sequence sent anything in that period. Try a wider range.'
        : 'There is nothing to analyse yet — no sequence has sent an email.',
    }
  }

  const metered = await hubbleExecute(
    'email.analysis',
    { workspaceId: input.workspaceId, userId: input.userId, source: 'http:email-analysis' },
    async (tools: HubbleTools) => {
      const result = await tools.llm.generateJson({
        system: systemPrompt(),
        user: promptFor(sequences, overall, steps, window),
        schema: findingsSchema() as unknown as Record<string, unknown>,
        // Judgement about prose, not structure.
        temperature: 0.4,
        maxOutputTokens: 1_500,
      })

      if (!result.ok) return { findings: null as EmailAnalysisFinding[] | null }

      const json = result.json as { findings?: unknown }
      const raw = Array.isArray(json?.findings) ? json.findings : []

      const findings: EmailAnalysisFinding[] = []
      for (const item of raw) {
        const f = item as { kind?: unknown; headline?: unknown; detail?: unknown }
        // The enum is advisory unless strict mode applies, so an
        // out-of-vocabulary kind is coerced rather than rendered as unknown.
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
      sequences,
      overall,
      findings,
      caveat: caveatFor(overall, window),
      generatedAt: new Date().toISOString(),
      window,
    },
  }
}

type StepCopy = { campaignId: string; stepIndex: number; subject: string; bodyText: string }

/** The copy each sequence actually sends. */
async function sequenceCopy(
  workspaceId: string,
  campaignIds: string[],
): Promise<StepCopy[]> {
  if (campaignIds.length === 0) return []

  const { data } = await createAdminClient()
    .from('email_sequence_steps')
    .select('campaign_id, step_index, subject, body_text, email_campaigns!inner(workspace_id)')
    // ⚠️ SCOPED THROUGH THE JOIN. `email_sequence_steps` hangs off the campaign,
    // and the service role bypasses RLS — an unscoped read here would put
    // another tenant's email copy into a prompt.
    .eq('email_campaigns.workspace_id', workspaceId)
    .in('campaign_id', campaignIds)
    .order('step_index', { ascending: true })
    .limit(200)

  return (data ?? []).map((row) => ({
    campaignId: row.campaign_id,
    stepIndex: row.step_index,
    subject: row.subject,
    bodyText: row.body_text,
  }))
}

function systemPrompt(): string {
  return [
    'You are a cold-email reviewer. You are given counts that have ALREADY been',
    'computed from the customer\'s own records, and the copy of each sequence.',
    '',
    'Rules:',
    '- NEVER recompute, restate differently, or estimate any number. Use the',
    '  figures exactly as given, or refer to them qualitatively.',
    '- A reply rate given as "not enough data" means exactly that. Do not call',
    '  it zero, low, or poor.',
    '- Comment on the WRITING: subject lines, opening lines, length, specificity,',
    '  the ask. That is what you can actually see.',
    '- Do not speculate about deliverability, sending infrastructure or spam',
    '  filters. You cannot observe them here.',
    '- Be specific and short. Quote the copy you are talking about.',
    '',
    'Return 3 to 6 findings.',
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
            kind: { type: 'string', enum: ['working', 'not_working', 'do_this'] },
            headline: { type: 'string' },
            detail: { type: 'string' },
          },
          required: ['kind', 'headline', 'detail'],
          additionalProperties: false,
        },
      },
    },
    required: ['findings'],
    additionalProperties: false,
  }
}

function promptFor(
  sequences: SequenceStats[],
  overall: SequenceStats,
  steps: StepCopy[],
  window: AnalysisWindow,
): string {
  const lines: string[] = []

  if (window.from || window.to) {
    lines.push(
      `PERIOD: ${window.from ?? 'the beginning'} to ${window.to ?? 'today'} (inclusive, UTC). ` +
        'Everything below is from this period only — do not describe it as a complete history.',
      '',
    )
  }

  const rate = (value: number | null) => (value === null ? 'not enough data' : `${value}%`)

  lines.push('COUNTS (already computed — do not recompute):')
  lines.push(
    `  Overall: ${overall.contacted} people contacted, ${overall.sent} messages sent, ` +
      `${overall.replied} replied, reply rate ${rate(overall.replyRate)}, ` +
      `${overall.bounced} bounced, ${overall.unsubscribed} unsubscribed.`,
  )

  /*
   * ⚠️ SEQUENCES ARE NUMBERED, NOT NAMED, IN THE PROMPT — matching the LinkedIn
   * analysis, which numbers reps for the same reason. A campaign name is often
   * a customer or segment name, and a name in a prompt is a name in somebody's
   * logs. The report shows the real names; the vendor does not need them to
   * judge prose.
   */
  const index = new Map(sequences.map((s, i) => [s.campaignId, i + 1]))

  sequences.forEach((s, i) => {
    lines.push(
      `  Sequence ${i + 1} (${s.type}): ${s.contacted} contacted, ${s.replied} replied, ` +
        `reply rate ${rate(s.replyRate)}, ${s.bounced} bounced.`,
    )
  })

  lines.push('', 'THE COPY:')
  for (const step of steps) {
    const which = index.get(step.campaignId)
    if (!which) continue
    lines.push(
      `  [Sequence ${which} · step ${step.stepIndex + 1}] SUBJECT: ${step.subject.replace(/\s+/g, ' ').slice(0, 200)}`,
      `      BODY: ${step.bodyText.replace(/\s+/g, ' ').slice(0, 800)}`,
    )
  }

  return lines.join('\n')
}
