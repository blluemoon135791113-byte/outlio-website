import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

/**
 * Two projects, because they have opposite constraints.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE SUITE USED TO BE ONE PROJECT WITH `fileParallelism: false`, AND      ║
 * ║  THAT COST ELEVEN DAYS OF A BROKEN SECURITY CONTROL.                     ║
 * ║                                                                           ║
 * ║  Integration tests hit a real Supabase project and must not race each     ║
 * ║  other while creating and deleting users — so parallelism was disabled    ║
 * ║  globally. Correct for them. Catastrophic for the unit tests, which touch ║
 * ║  no network at all and were dragged to the same serial pace: 44 files at  ║
 * ║  ~39s each is a 25-minute `npm test`.                                     ║
 * ║                                                                           ║
 * ║  Nobody runs a 25-minute check before a commit. So when                    ║
 * ║  `signup-ip-gate.test.ts` began failing on 2026-08-24 — correctly         ║
 * ║  reporting that migration 0070 had deleted the signup gate — it reported  ║
 * ║  it to an empty room until Phase 0 ran the suite on 2026-09-04.           ║
 * ║                                                                           ║
 * ║  ⚠️ THE DETECTION EXISTED. THE FEEDBACK LOOP DID NOT, WHICH MADE THE      ║
 * ║  DETECTION WORTHLESS. Keeping `npm test` fast is a correctness property   ║
 * ║  of this repo, not a convenience.                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(rootDir, '.'),
      // `server-only` throws outside a React Server Component. That guard is
      // correct in the app — it breaks the build if the service-role client
      // ever becomes client-reachable — but fires spuriously under plain Node.
      // Stubbing it HERE only affects tests; the real guard still applies to
      // `npm run build`.
      'server-only': resolve(rootDir, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    projects: [
      {
        resolve: { alias: { '@': resolve(rootDir, '.'), 'server-only': resolve(rootDir, 'tests/stubs/server-only.ts') } },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          setupFiles: ['tests/setup.ts'],
          /*
           * Parallel, deliberately. Nothing here opens a socket: these are pure
           * functions, SQL-text scanners and structural guards. This is what
           * makes `npm test` a gate somebody will actually run.
           */
          testTimeout: 30_000,
        },
      },
      {
        resolve: { alias: { '@': resolve(rootDir, '.'), 'server-only': resolve(rootDir, 'tests/stubs/server-only.ts') } },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/setup.integration.ts'],
          /*
           * ⚠️ SERIAL, AND IT MUST STAY SERIAL. These create and delete real
           * users in a real Supabase project. Two files racing on the same
           * device or identity hash produce failures that look like the gate
           * misbehaving when in fact the tests are fighting each other.
           */
          fileParallelism: false,
          testTimeout: 30_000,
          // Cleanup hooks delete every user and code a suite created. Vitest's
          // 10s default is not enough against a remote project, and a timed-out
          // afterAll leaves orphaned rows behind.
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
