/**
 * Test setup — decides which database the integration suite talks to.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  UNTIL PHASE 1 THIS LOADED `.env.local`, WHICH POINTS AT PRODUCTION.     ║
 * ║                                                                           ║
 * ║  So `npm test` wrote to the database serving real customers. A census on  ║
 * ║  2026-09-04 found 43 `outlio-test-*@example.com` accounts left there by   ║
 * ║  ordinary test runs — and the tenant-isolation suite Phase 1 needs could  ║
 * ║  not be written at all, because proving tenants are isolated would have   ║
 * ║  meant manufacturing tenants in production (ADR-004).                     ║
 * ║                                                                           ║
 * ║  ⚠️ `.env.staging` NOW WINS WHEN IT EXISTS. That is the safe default: a    ║
 * ║  developer who has not set staging up still runs against `.env.local` and ║
 * ║  nothing breaks, while anyone who has gets the isolated database without  ║
 * ║  remembering a flag. Set `OUTLIO_TEST_TARGET=production` to override,     ║
 * ║  which you should need approximately never.                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { existsSync } from 'node:fs'

import { config } from 'dotenv'

const wantsProduction = process.env.OUTLIO_TEST_TARGET === 'production'
const stagingExists = existsSync('.env.staging')

const envFile = !wantsProduction && stagingExists ? '.env.staging' : '.env.local'

config({ path: envFile, quiet: true })

/*
 * ⚠️ SAID OUT LOUD, EVERY RUN. A suite that silently writes to production is
 * exactly how 43 accounts accumulated there unnoticed. If this line ever reads
 * "production" when you did not intend it to, stop.
 */
if (envFile === '.env.local' && !stagingExists) {
  console.warn(
    '\n⚠️  Tests are running against .env.local (PRODUCTION). ' +
      'Create .env.staging to use the isolated database.\n',
  )
} else if (wantsProduction) {
  console.warn('\n⚠️  OUTLIO_TEST_TARGET=production — writing to the live database.\n')
}
