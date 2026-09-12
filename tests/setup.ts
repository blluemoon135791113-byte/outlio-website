/**
 * Unit-test setup. Loads `.env.local`, deliberately.
 *
 * ⚠️ UNIT TESTS STAY ON `.env.local` AND THAT IS NOT AN OVERSIGHT.
 *
 * The staging redirect exists to stop tests WRITING to production. Unit tests
 * open no sockets, so pointing them elsewhere buys no safety — and it broke
 * `provider-registry.test.ts`, which reads provider API keys from the
 * environment to decide the live waterfall. `.env.staging` deliberately has no
 * third-party keys, so the registry came out shorter and the test failed for a
 * reason that had nothing to do with the code under test.
 *
 * The integration suite uses `tests/setup.integration.ts` instead.
 */
import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

/*
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ "UNIT TESTS OPEN NO SOCKETS" IS NOW ENFORCED, NOT ASSERTED.           ║
 * ║                                                                           ║
 * ║  The comment above made that claim for months and it quietly stopped       ║
 * ║  being true. `ai-route-metering.test.ts` drove the real `askHubble`        ║
 * ║  pipeline with search and fetch unmocked, and because this file loads      ║
 * ║  `.env.local` — live Tavily / Serper / Google CSE / Firecrawl / Gemini     ║
 * ║  keys — every `npm test` made real, paid third-party calls.                ║
 * ║                                                                           ║
 * ║  Measured before the fix: that one file took 32s wall at 2.3s CPU (9%      ║
 * ║  utilisation) and timed out at 30s whenever the network was slow, so the   ║
 * ║  suite was intermittently red for reasons unrelated to the code.          ║
 * ║                                                                           ║
 * ║  Loading `.env.local` is still correct (see above): some tests read        ║
 * ║  provider keys to decide a waterfall. What must not happen is a socket.    ║
 * ║  So the keys stay and the socket goes.                                     ║
 * ║                                                                           ║
 * ║  A test that legitimately needs HTTP should mock the module that makes     ║
 * ║  the call — the edge, not the door. The integration suite has its own      ║
 * ║  setup and is unaffected.                                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

  /*
   * Loopback stays open. A test that spins up a local server is exercising its
   * own process, not a third party, and blocking it would buy nothing.
   */
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url)) {
    return realFetch(input, init)
  }

  throw new Error(
    `Unit tests must not open sockets. Blocked: ${url}\n` +
      `Mock the module that makes this call (the network edge), not the code under test. ` +
      `If this genuinely needs the network, it belongs in the integration suite. ` +
      `See the banner in tests/setup.ts.`,
  )
}) as typeof fetch
