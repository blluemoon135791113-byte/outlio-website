#!/usr/bin/env node
/*
 * Regenerate the generated half of types/database.ts, in place.
 *
 * `supabase gen types typescript > types/database.ts` replaces the WHOLE file,
 * which silently deletes the hand-written block above the banner — roughly two
 * dozen aliases the app imports directly (`ProfileRow`, `PlanLimits`,
 * `JobStatus`, …). The banner in types/database.ts records that this has
 * already cost the project once: forty type errors, none naming the cause.
 *
 * So: generate to a temp file, keep everything up to and including the banner,
 * splice the fresh output below it, and only then replace the file. Any
 * failure — no login, an empty response, a truncated body, a missing banner —
 * leaves types/database.ts exactly as it was.
 */
import { execFile } from 'node:child_process'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const PROJECT_ID = 'ptewhpmxzenbmxlizxhu'
const TARGET = new URL('../types/database.ts', import.meta.url)
const TEMP = new URL('../types/database.tmp.ts', import.meta.url)
const BANNER = '// ⚠️ HAND-WRITTEN ABOVE THE GENERATED TYPES. DO NOT OVERWRITE THIS FILE.'

const run = promisify(execFile)

function fail(message) {
  console.error(`db:types failed — types/database.ts left untouched.\n  ${message}`)
  process.exit(1)
}

const current = await readFile(TARGET, 'utf8')
const lines = current.split('\n')

const bannerAt = lines.findIndex((line) => line.includes(BANNER))
if (bannerAt === -1) fail('The hand-written banner is missing. Refusing to guess where to splice.')

// The banner block closes with the next full-width `// ===` rule after it.
const closeAt = lines.findIndex(
  (line, index) => index > bannerAt && /^\/\/ ={10,}$/.test(line.trim()),
)
if (closeAt === -1) fail('Could not find the end of the banner block.')

let generated
try {
  const { stdout } = await run(
    'supabase',
    ['gen', 'types', 'typescript', '--project-id', PROJECT_ID, '--schema', 'public'],
    { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 },
  )
  generated = stdout
} catch (error) {
  await unlink(TEMP).catch(() => {})
  fail(
    error?.killed
      ? 'supabase gen types timed out. Run `supabase login` first — without a token it hangs rather than erroring.'
      : (error?.stderr?.trim() || error?.message || 'supabase gen types failed.'),
  )
}

// Sanity-check the payload before it is allowed near the real file.
if (!generated?.trim()) fail('supabase gen types returned nothing.')
if (!generated.includes('export type Database')) {
  fail('Output does not contain `export type Database`; it is not a types file.')
}
if (!generated.includes('fastspring_subscriptions')) {
  fail('Output is missing the FastSpring tables. Are the migrations applied to this project?')
}

// `Json` is declared in the hand-written block, so drop the generated copy.
const body = generated
  .replace(/^export type Json =[\s\S]*?\| Json\[\]\n/m, '')
  .trimStart()

const preserved = lines.slice(0, closeAt + 1).join('\n')
const next = `${preserved}\n\n${body}`

await writeFile(TEMP, next, 'utf8')
await rename(TEMP, TARGET)

const kept = closeAt + 1
console.log(
  `types/database.ts regenerated: kept ${kept} hand-written lines, spliced ${body.split('\n').length} generated lines below the banner.`,
)
