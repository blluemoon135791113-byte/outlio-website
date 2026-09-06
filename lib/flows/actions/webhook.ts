import 'server-only'

/**
 * Calling an outbound webhook from a flow.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS IS NOT `publishEvent`, AND THE DIFFERENCE MATTERS.              ║
 * ║                                                                           ║
 * ║  `lib/api/webhooks.ts` fans a fixed DOMAIN EVENT out to endpoints the     ║
 * ║  workspace registered and we already trust. This action posts an          ║
 * ║  ARBITRARY payload to a URL typed into a flow step, which is a different  ║
 * ║  trust model entirely: the URL is attacker-controlled the moment anyone   ║
 * ║  who can edit a flow decides to point it somewhere.                       ║
 * ║                                                                           ║
 * ║  ⚠️ SO EVERY REQUEST GOES THROUGH `assertFetchable` FIRST. Screening the  ║
 * ║  string is not enough — a hostname the author controls can resolve to     ║
 * ║  127.0.0.1 and the URL still looks public. The guard resolves DNS and     ║
 * ║  requires every returned address to be public, which is what stops a      ║
 * ║  flow reading our own metadata service or an internal admin port.         ║
 * ║                                                                           ║
 * ║  ⚠️ AND IT DOES NOT FOLLOW REDIRECTS. A 302 to `http://169.254.169.254`   ║
 * ║  would walk straight past a check performed only on the original URL.     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { assertFetchable } from '@/lib/hubble/net/guard'
import { registerAction, type ActionHandler, type ActionResult } from '@/lib/flows/engine'

const ok = (output: Record<string, string | number | boolean | null> = {}): ActionResult => ({
  ok: true,
  output,
})

const fail = (code: string, message: string, retryable = false): ActionResult => ({
  ok: false,
  code,
  message,
  retryable,
})

function str(config: Record<string, unknown>, key: string): string | null {
  const value = config[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * ⚠️ SHORT, BECAUSE A FLOW RUN HOLDS A TICK OPEN. A consumer that takes ten
 * seconds would stall every other run waiting behind it, and the tick has a
 * platform timeout of its own. Ten seconds is generous for an acknowledgement.
 */
const TIMEOUT_MS = 10_000

/** Enough of a response body to diagnose a failure, and no more. */
const MAX_CAPTURED_BODY = 500

const webhook: ActionHandler = async (ctx, config) => {
  const url = str(config, 'url')
  if (!url) return fail('NO_URL', 'This step has no URL configured.')

  const verdict = await assertFetchable(url)
  if (!verdict.allowed) {
    /*
     * NOT retryable. A private address does not become public on the next
     * tick, and retrying would park the run forever on something that can
     * never succeed.
     */
    return fail('URL_NOT_ALLOWED', `That URL cannot be called: ${verdict.reason}.`)
  }

  /*
   * ⚠️ THE PAYLOAD NAMES THE CONTACT BY ID, NOT BY RECORD. CLAUDE.md forbids
   * logging full lead records, and a webhook body is a log kept on somebody
   * else's server. The receiver can read the contact back through the API with
   * credentials we can revoke; a name and address posted to a URL cannot be
   * taken back.
   */
  const body = JSON.stringify({
    workspaceId: ctx.workspaceId,
    contactId: ctx.contactId,
    flowRunId: ctx.runId,
    // Author-supplied, so it travels verbatim — but it is theirs, not ours.
    data: typeof config.payload === 'object' && config.payload !== null ? config.payload : {},
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(verdict.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      // See the header note: a redirect defeats the guard entirely.
      redirect: 'manual',
      signal: controller.signal,
    })

    if (response.status >= 300 && response.status < 400) {
      return fail('REDIRECTED', 'That URL redirected, which is not followed for safety.')
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, MAX_CAPTURED_BODY)
      /*
       * ⚠️ 4xx IS PERMANENT, 5xx IS NOT. Retrying a 400 forever is how a run
       * parks itself on a payload the receiver will never accept; retrying a
       * 503 is exactly right, because the consumer is briefly down.
       */
      return fail(
        `HTTP_${response.status}`,
        `The webhook returned ${response.status}. ${detail}`.trim(),
        response.status >= 500,
      )
    }

    return ok({ status: response.status, url: verdict.host })
  } catch (error) {
    // A timeout or a dropped connection is worth another attempt.
    const aborted = error instanceof Error && error.name === 'AbortError'
    return fail(
      aborted ? 'TIMEOUT' : 'REQUEST_FAILED',
      aborted ? 'The webhook did not answer in time.' : 'The webhook could not be reached.',
      true,
    )
  } finally {
    clearTimeout(timer)
  }
}

export function registerWebhookAction(): void {
  registerAction('WEBHOOK', webhook)
}
