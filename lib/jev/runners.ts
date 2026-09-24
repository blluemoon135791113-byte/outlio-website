import 'server-only'

/**
 * Jev-backed runners for the Hubble flow actions.
 *
 * ⚠️ ONE ACTION SO FAR, AND ON PURPOSE. `HUBBLE_CLASSIFY_REPLY` was priced,
 * offered in the builder and publishable, with no runner behind it — every run
 * failed and was refunded. It is the first decision wired because it is fully
 * bounded (eight labels), its input already exists (`email_inbound_messages`),
 * and a wrong answer can be caught: every uncertain or consequential label is
 * returned as `needs_review`.
 *
 * ⚠️ THE STEP DECIDES; IT DOES NOT ACT. The value lands in `vars.<storeAs>`
 * and a later BRANCH chooses what happens — create a task, assign an owner,
 * notify. Nothing here sends, suppresses or replies.
 */
import { registerHubbleRunner, type HubbleRunnerResult } from '@/lib/flows/actions/hubble'
import { classifyReply, type ReplyDecision } from '@/lib/jev/reply'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The value a branch reads. A reviewable decision reads `needs_review` rather
 * than its label, so a flow written as "if interested → create a deal task"
 * cannot act on a label nobody has confirmed.
 */
export function branchValue(decision: ReplyDecision): string {
  return decision.needsReview ? 'needs_review' : decision.intent
}

/**
 * The step's result — or a throw, when no decision was actually made.
 *
 * ⚠️ A FALLBACK IS THROWN, NOT RETURNED. `classifyReply` answers a Jev failure
 * (off, timed out, rate limited, invalid) with "unclear, needs review", which is
 * right for a caller that must show something. As a flow step's RESULT it would
 * be a success the customer is charged a credit for, with no decision behind
 * it. Throwing makes `hubbleExecute` refund the credit and records the failure
 * with its code; the run trace shows the step failed, so a person looks.
 */
export function replyResult(decision: ReplyDecision, messageId: string): HubbleRunnerResult {
  if (decision.decidedBy === 'fallback') {
    throw new Error(
      `Jev could not classify this reply (${decision.errorCode ?? 'JEV_UNAVAILABLE'}). No credit was charged; review the reply manually.`,
    )
  }
  return {
    value: branchValue(decision),
    detail: {
      intent: decision.intent,
      needs_review: decision.needsReview,
      decided_by: decision.decidedBy,
      rule: decision.rule,
      model_confidence: decision.confidence,
      question_version: decision.questionVersion,
      model: decision.model,
      input_tokens: decision.inputTokens,
      error_code: decision.errorCode,
      inbound_message_id: messageId,
    },
  }
}

/**
 * The contact's most recent inbound message.
 *
 * ⚠️ SCOPED BY `workspace_id` ON BOTH TABLES. This is the service-role client,
 * which bypasses RLS; the filter is the tenant boundary (CLAUDE.md).
 */
async function latestInbound(workspaceId: string, contactId: string) {
  const db = createAdminClient()
  const { data: threads, error: threadError } = await db
    .from('email_threads')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
  if (threadError) throw new Error('Could not read this contact’s email threads.')
  if (!threads || threads.length === 0) return null

  const { data: message, error } = await db
    .from('email_inbound_messages')
    .select('id, subject, body_text, classification')
    .eq('workspace_id', workspaceId)
    .in('thread_id', threads.map((t) => t.id))
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error('Could not read this contact’s latest reply.')
  return message
}

export function registerJevRunners(): void {
  registerHubbleRunner('hubble.response_classification', async (input, tools) => {
    if (!input.contactId) {
      // Thrown so `hubbleExecute` refunds: nothing was classified.
      throw new Error('This step needs a contact, and the run has none.')
    }

    const message = await latestInbound(input.workspaceId, input.contactId)
    if (!message) {
      throw new Error('This contact has no reply to classify.')
    }

    const decision = await classifyReply(
      {
        subject: message.subject,
        body: message.body_text ?? '',
        storedKind: message.classification,
      },
      (set, state) => tools.jev.ask(set, state),
    )

    return replyResult(decision, message.id)
  })
}
