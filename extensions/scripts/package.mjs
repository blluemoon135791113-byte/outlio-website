/**
 * Store package builder.
 *
 * Produces the ZIP the Chrome Web Store expects, and refuses to do so if the
 * build has a problem review would reject anyway. Finding out at submission
 * costs days of review turnaround; finding out here costs seconds.
 *
 * Usage:
 *   node extensions/scripts/package.mjs                # chrome
 *   node extensions/scripts/package.mjs --target=firefox
 */
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const args = process.argv.slice(2)
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'chrome'

const distDir = join(root, 'dist', target)
const outDir = join(root, 'packages')

if (!existsSync(join(distDir, 'manifest.json'))) {
  console.error(`No build for "${target}". Run: npm run ext:${target}`)
  process.exit(1)
}

const manifest = JSON.parse(await readFile(join(distDir, 'manifest.json'), 'utf8'))
const problems = []
const warnings = []

/* -------------------------------------------------------------------------
 * Pre-flight — the things review actually rejects for
 * ---------------------------------------------------------------------- */

// 1. Icons must be their declared size. A 1080x1080 file labelled 16x16 is a
//    visible defect in the toolbar and gets flagged.
let sipsAvailable = true
try {
  execFileSync('sips', ['--version'], { stdio: 'ignore' })
} catch {
  sipsAvailable = false
  warnings.push('sips unavailable — icon dimensions were not verified')
}

if (sipsAvailable) {
  for (const size of [16, 32, 48, 128]) {
    const file = join(distDir, 'icons', `icon-${size}.png`)
    if (!existsSync(file)) {
      problems.push(`icons/icon-${size}.png is missing`)
      continue
    }

    const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], {
      encoding: 'utf8',
    })
    const width = Number(/pixelWidth:\s*(\d+)/.exec(out)?.[1])
    const height = Number(/pixelHeight:\s*(\d+)/.exec(out)?.[1])

    if (width !== size || height !== size) {
      problems.push(`icons/icon-${size}.png is ${width}x${height}, expected ${size}x${size}`)
    }
  }
}

// 2. A dev build must never reach a store: it points at localhost and grants
//    host permissions for it.
const serialised = JSON.stringify(manifest)
if (serialised.includes('localhost') || manifest.name.includes('(dev)')) {
  problems.push('this is a DEV build (localhost origins) — run the production build first')
}

// 3. Bundled secrets. The extension is public; anything here is disclosed.
for (const file of await readdir(distDir)) {
  if (!file.endsWith('.js')) continue
  const source = await readFile(join(distDir, file), 'utf8')
  for (const marker of ['service_role', 'SUPABASE_SERVICE', 'sk_live', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (source.includes(marker)) problems.push(`${file} contains "${marker}"`)
  }
}

// 4. Broad host permissions draw the most review scrutiny.
for (const permission of manifest.host_permissions ?? []) {
  if (permission.includes('<all_urls>') || /^\*:\/\/\*\//.test(permission)) {
    problems.push(`host permission "${permission}" is too broad`)
  }
}

if (problems.length > 0) {
  console.error('Not packaged. Fix these first:\n')
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  process.exit(1)
}

/* -------------------------------------------------------------------------
 * Zip
 *
 * `zip -r` from INSIDE dist so manifest.json sits at the archive root, which
 * is what the store requires. -X drops macOS resource forks that otherwise
 * appear as junk files in the uploaded package.
 * ---------------------------------------------------------------------- */

await mkdir(outDir, { recursive: true })

// AMO accepts both ZIP and XPI; XPI is just the conventional Firefox suffix.
// Changing the suffix does NOT fix an incorrectly nested or missing manifest.
// Build from inside dist and verify the actual archive, not only the sources.
const archiveExtension = target === 'firefox' ? 'xpi' : 'zip'
const archiveName = `outlio-lead-capture-${target}-v${manifest.version}.${archiveExtension}`
const archivePath = join(outDir, archiveName)

// -FS removes stale entries from a previous build of this version.
execFileSync('zip', ['-r', '-FS', '-X', '-q', archivePath, '.', '-x', '.*', '__MACOSX/*'], {
  cwd: distDir,
})

execFileSync('unzip', ['-tq', archivePath], { stdio: 'pipe' })
const entries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' }).trim().split('\n')
if (entries.filter((name) => name === 'manifest.json').length !== 1) {
  throw new Error('Package must contain exactly one manifest.json at archive root')
}
const archivedManifest = JSON.parse(execFileSync('unzip', ['-p', archivePath, 'manifest.json'], { encoding: 'utf8' }))
if (JSON.stringify(archivedManifest) !== JSON.stringify(manifest)) {
  throw new Error('Packaged manifest does not match the build')
}

const sizeKb = Math.round(statSync(archivePath).size / 1024)

console.log(`Packaged ${manifest.name} v${manifest.version}`)
console.log(`  ${archivePath.replace(`${resolve(root, '..')}/`, '')}  (${sizeKb} KB)`)
for (const warning of warnings) console.log(`  ! ${warning}`)
console.log('')
console.log('Verified: archive integrity and manifest.json at root.')
console.log(target === 'firefox'
  ? 'Upload this XPI at https://addons.mozilla.org/developers/ — select the archive, not an enclosing folder.'
  : 'Upload at https://chrome.google.com/webstore/devconsole → New item.')
console.log('Listing copy and permission justifications: docs/EXTENSION_STORE.md')
