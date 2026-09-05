/**
 * Integration-test setup — decides which database the suite writes to.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  UNTIL PHASE 1 THIS LOADED `.env.local`, WHICH POINTS AT PRODUCTION.     ║
 * ║                                                                           ║
 * ║  So `npm test` wrote to the database serving real customers. A census on  ║
 * ║  2026-09-04 found 43 `outlio-test-*@example.com` accounts left there by   ║
 * ║  ordinary runs, and the tenant-isolation suite Phase 1 needs could not be ║
 * ║  written at all — proving tenants are isolated would have meant           ║
 * ║  manufacturing tenants in production.                                    ║
 * ║                                                                           ║
 * ║  ⚠️ `.env.staging` WINS WHEN IT EXISTS. That is the safe default: someone  ║
 * ║  who has not set staging up still runs against `.env.local` and nothing   ║
 * ║  breaks, while anyone who has gets the isolated database without          ║
 * ║  remembering a flag. `OUTLIO_TEST_TARGET=production` overrides.           ║
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
 * exactly how 43 accounts accumulated there unnoticed.
 */
if (envFile === '.env.local') {
  console.warn(
    `\n⚠️  Integration tests are writing to PRODUCTION (.env.local).` +
      `${stagingExists ? ' OUTLIO_TEST_TARGET=production is set.' : ' Create .env.staging to isolate them.'}\n`,
  )
}
