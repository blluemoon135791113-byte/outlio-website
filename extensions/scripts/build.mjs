/**
 * Extension build.
 *
 * Bundles the three entry points, copies the static assets, and generates
 * placeholder icons if none exist yet.
 *
 * Content scripts cannot use ES module imports, so bundling is a requirement
 * rather than a convenience — this is why esbuild is here at all.
 *
 * Usage:
 *   node extensions/scripts/build.mjs                 production build
 *   node extensions/scripts/build.mjs --dev           point at localhost:3000
 *   node extensions/scripts/build.mjs --target=chrome
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as esbuild from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const repoRoot = resolve(root, '..')

const args = process.argv.slice(2)
const dev = args.includes('--dev')
const target = (args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'chrome')

const API_BASE = dev ? 'http://localhost:3000' : 'https://outlio.io'

const srcDir = join(root, target)
const outDir = join(root, 'dist', target)

if (!existsSync(join(srcDir, 'manifest.json'))) {
  console.error(`No manifest for target "${target}" (looked in ${srcDir}).`)
  process.exit(1)
}

await rm(outDir, { recursive: true, force: true })
await mkdir(join(outDir, 'icons'), { recursive: true })

/* -------------------------------------------------------------------------
 * Bundle
 * ---------------------------------------------------------------------- */

/*
 * Every entry point is SHARED. Only the manifest differs per browser, which is
 * the whole point of the layout: Chrome and Firefox both expose the `chrome.*`
 * namespace under MV3, so the logic needs no per-browser branching. Safari's
 * converter consumes the same output.
 */
const shared = join(root, 'shared')

const entries = {
  background: join(shared, 'background.ts'),
  content: join(shared, 'content.ts'),
  connect: join(shared, 'connect.ts'),
  popup: join(root, 'ui', 'popup', 'popup.ts'),
}

for (const [name, entry] of Object.entries(entries)) {
  await esbuild.build({
    entryPoints: [entry],
    outfile: join(outDir, `${name}.js`),
    bundle: true,
    format: 'esm',
    target: ['chrome116', 'firefox121', 'safari16'],
    platform: 'browser',
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    legalComments: 'none',
    define: {
      // The only build-time value. Everything else is fetched at runtime so a
      // rebuild is never needed to change behaviour.
      'process.env.OUTLIO_API_BASE': JSON.stringify(API_BASE),
    },
  })
}

/* -------------------------------------------------------------------------
 * Static assets
 * ---------------------------------------------------------------------- */

await cp(join(root, 'ui', 'popup', 'popup.html'), join(outDir, 'popup.html'))
await cp(join(root, 'ui', 'popup', 'popup.css'), join(outDir, 'popup.css'))

// Manifest, with the dev API origin injected so a local build can talk to a
// local server without hand-editing permissions.
const manifest = JSON.parse(await readFile(join(srcDir, 'manifest.json'), 'utf8'))

if (dev) {
  manifest.name = `${manifest.name} (dev)`
  manifest.host_permissions = manifest.host_permissions.map((p) =>
    p.startsWith('https://outlio.io') ? p.replace('https://outlio.io', API_BASE) : p,
  )
  manifest.content_scripts = manifest.content_scripts.map((script) => ({
    ...script,
    matches: script.matches.map((m) =>
      m.startsWith('https://outlio.io') ? m.replace('https://outlio.io', API_BASE) : m,
    ),
  }))
}

await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

/* -------------------------------------------------------------------------
 * Icons
 *
 * Uses the repo's own icon if present. Store submission needs real artwork at
 * every size; this only guarantees the extension LOADS, which is what an
 * unpacked developer build needs.
 * ---------------------------------------------------------------------- */

const sourceIcon = join(repoRoot, 'app', 'icon.png')
const sizes = [16, 32, 48, 128]
let iconNote = 'MISSING — add app/icon.png'

/**
 * Resized properly, not just copied.
 *
 * A 1080x1080 file declared as a 16x16 icon renders soft in the toolbar and
 * gets flagged in Chrome Web Store review. `sips` ships with macOS; elsewhere
 * we fall back to copying and say so loudly, because shipping unresized icons
 * to a store is a rejection waiting to happen.
 */
if (existsSync(sourceIcon)) {
  let resized = false

  try {
    const { execFileSync } = await import('node:child_process')
    execFileSync('sips', ['--version'], { stdio: 'ignore' })

    for (const size of sizes) {
      execFileSync(
        'sips',
        ['-z', String(size), String(size), sourceIcon, '--out', join(outDir, 'icons', `icon-${size}.png`)],
        { stdio: 'ignore' },
      )
    }
    resized = true
  } catch {
    for (const size of sizes) {
      await cp(sourceIcon, join(outDir, 'icons', `icon-${size}.png`))
    }
  }

  iconNote = resized
    ? 'resized from app/icon.png'
    : 'COPIED UNRESIZED — sips unavailable; resize before submitting to a store'
}

console.log(`Built ${target} → extensions/dist/${target}`)
console.log(`  API base   ${API_BASE}`)
console.log(`  Icons      ${iconNote}`)
console.log('')
console.log('Load it: chrome://extensions → Developer mode → Load unpacked → select the folder above.')
