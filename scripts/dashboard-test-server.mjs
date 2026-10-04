/** Isolated HTTPS/production runtime for dashboard staging tests, never a deploy. */
import { spawn, execFileSync } from 'node:child_process'
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'dotenv'
import next from 'next'

const script = fileURLToPath(import.meta.url)
const root = dirname(dirname(script))
const origin = 'https://127.0.0.1:3107'
const stagingOrigin = 'https://ahfyvhibzgxrhfjobbqn.supabase.co'

if (process.argv[2] === '--serve') {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== stagingOrigin) throw new Error('Not staging')
  const snapshot = process.argv[3]
  const app = next({ dev: false, dir: snapshot, hostname: '127.0.0.1', port: 3107 })
  await app.prepare()
  const server = createServer({
    key: readFileSync(join(snapshot, 'test-key.pem')),
    cert: readFileSync(join(snapshot, 'test-cert.pem')),
  }, app.getRequestHandler())
  server.listen(3107, '127.0.0.1')
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    server.closeAllConnections()
    server.close(async () => { await app.close(); process.exit(0) })
  })
} else {
  const staging = parse(readFileSync(join(root, '.env.staging')))
  if (staging.NEXT_PUBLIC_SUPABASE_URL !== stagingOrigin || !staging.SUPABASE_SERVICE_ROLE_KEY || !staging.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Dashboard tests require the complete ADR-005 staging configuration')
  }
  // Never copy .env.local, private inputs, or the running developer's .next.
  const snapshot = await mkdtemp(join(tmpdir(), 'outlio-dashboard-e2e-'))
  let child
  let stopping = false
  const stop = () => { stopping = true; child?.kill('SIGTERM') }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  const run = (args, env) => new Promise((resolve, reject) => {
    if (stopping) return resolve()
    const running = spawn(process.execPath, args, { cwd: snapshot, env, stdio: 'inherit' })
    child = running
    running.on('error', reject)
    running.on('exit', (code, signal) => {
      child = undefined
      if (stopping || code === 0) resolve()
      else reject(new Error(`Dashboard test runtime exited (${signal ?? code})`))
    })
  })
  try {
    for (const path of ['app', 'components', 'lib', 'types', 'plans', 'public', 'package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'next-env.d.ts', 'postcss.config.mjs', 'proxy.ts', 'instrumentation-client.ts']) {
      await cp(join(root, path), join(snapshot, path), { recursive: true })
    }
    await symlink(join(root, 'node_modules'), join(snapshot, 'node_modules'), 'junction')
    // A one-run local certificate, not installed into the OS/global trust store.
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(snapshot, 'test-key.pem'), '-out', join(snapshot, 'test-cert.pem'),
      '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore' })
    const env = {
      ...process.env, ...staging, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_APP_URL: origin, NEXT_PUBLIC_SITE_URL: origin,
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: '', NEXT_PUBLIC_POSTHOG_SYNTHETIC: 'true',
      // Trust only this test certificate for Next's internal redirect fetches.
      NODE_EXTRA_CA_CERTS: join(snapshot, 'test-cert.pem'),
    }
    console.log('Building isolated dashboard test runtime (staging only).')
    await run([join(root, 'node_modules/next/dist/bin/next'), 'build', snapshot, '--webpack'], env)
    if (!stopping) await run([script, '--serve', snapshot], env)
  } finally {
    await rm(snapshot, { recursive: true, force: true })
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}
