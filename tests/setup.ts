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
