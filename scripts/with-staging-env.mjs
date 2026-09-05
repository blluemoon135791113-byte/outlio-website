/**
 * Run a command with `.env.staging` loaded, overriding `.env.local`.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ NEXT LOADS `.env.local` ITSELF AND WILL NOT OVERWRITE A VARIABLE THAT ║
 * ║  IS ALREADY IN `process.env`. That is the whole mechanism here: setting   ║
 * ║  the staging values BEFORE spawning `next` makes them win.                ║
 * ║                                                                           ║
 * ║  Used by the E2E tenant-isolation journey, which has to drive a real      ║
 * ║  browser against a real server — and must not drive it against the        ║
 * ║  database serving customers.                                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

if (!existsSync('.env.staging')) {
  console.error('.env.staging is missing. See ADR-005.')
  process.exit(1)
}

const env = { ...process.env }
for (const line of readFileSync('.env.staging', 'utf8').split('\n')) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (match) env[match[1]] = match[2].trim()
}

/*
 * ⚠️ SAID OUT LOUD. A dev server silently pointed at the wrong database is how
 * a "test" ends up mutating production.
 */
console.log(`\n▶ staging: ${env.NEXT_PUBLIC_SUPABASE_URL}\n`)

const [command, ...args] = process.argv.slice(2)
const child = spawn(command, args, { env, stdio: 'inherit', shell: process.platform === 'win32' })
child.on('exit', (code) => process.exit(code ?? 0))
