/**
 * Loads the environment the copilot eval needs.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ WITHOUT THIS THE EVAL COULD NEVER RUN, AND SAID NOTHING ABOUT IT.     ║
 * ║                                                                           ║
 * ║  Vitest does not read `.env` files. The integration project has always     ║
 * ║  had `tests/setup.integration.ts` doing it; the eval project shipped with  ║
 * ║  no setup file at all, so every key was absent no matter what was in       ║
 * ║  `.env.local`.                                                            ║
 * ║                                                                           ║
 * ║  ⚠️ AND THE SKIP LOGIC HID IT. "Nothing configured" was treated as a       ║
 * ║  deliberate opt-out and skipped quietly — correct on a fresh checkout, and ║
 * ║  exactly wrong here, because nothing was configured for the one reason     ║
 * ║  that is a defect. Five model keys were set and the run still reported     ║
 * ║  "41 skipped".                                                            ║
 * ║                                                                           ║
 * ║  The eval file now tells the two apart by asking whether an env file       ║
 * ║  EXISTS on disk, which is the difference between "nobody set this up" and  ║
 * ║  "it was set up and I failed to read it".                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ `.env.local`, NOT `.env.staging`, UNLIKE THE INTEGRATION SUITE. The eval
 * attributes its calls to a real workspace and user, and those exist in the
 * project the app actually runs against. Its `hubble_calls` rows are tagged
 * `eval:flow-copilot` so they can be excluded from the spend the pricing
 * decision reads.
 */
import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })
