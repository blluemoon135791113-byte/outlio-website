/**
 * Store screenshot generator.
 *
 * Renders 1280x800 promo frames with headless Chrome and flattens them to
 * 24-bit PNG without an alpha channel, which is what the Chrome Web Store
 * requires — an RGBA screenshot is rejected on upload.
 *
 * Each frame shows the REAL popup markup and the real stylesheet, so the
 * listing cannot drift from the product. A hand-drawn mockup would look right
 * today and be a lie after the first UI change.
 *
 * Usage:
 *   node extensions/scripts/screenshots.mjs
 *   → extensions/store-assets/screenshot-1.png … screenshot-4.png
 */
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const outDir = join(root, 'store-assets')
const tmpDir = join(root, '.screenshot-tmp')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

if (!existsSync(CHROME)) {
  console.error('Google Chrome not found. Install it, or produce screenshots by hand.')
  process.exit(1)
}

const popupCss = await readFile(join(root, 'ui', 'popup', 'popup.css'), 'utf8')

/** Popup body markup for each state, mirroring what popup.ts builds. */
function popup(pill, pillTone, inner) {
  return `
    <div class="popup">
      <header class="header">
        <span class="logo-dot"></span>
        <span class="wordmark">Lead Capture</span>
        <span class="pill pill--${pillTone}">${pill}</span>
      </header>
      <main class="body">${inner}</main>
    </div>`
}

function statBlock(items) {
  return `<div class="stats">${items
    .map(
      ([value, label]) =>
        `<div class="stat"><div class="stat__value">${value}</div><div class="stat__label">${label}</div></div>`,
    )
    .join('')}</div>`
}

const account = `
  <div class="account">
    <div class="account__email">jane@example.com</div>
    <div class="account__plan">Pro plan</div>
  </div>`

const FRAMES = [
  {
    name: 'screenshot-1',
    headline: 'Start a capture, then browse normally',
    sub: 'No saving pages. No downloading files. No uploading.',
    body: popup(
      'Connected',
      'ok',
      `${account}
       <p class="section-label">Current page</p>
       <p class="status"><span class="dot dot--ok"></span><span>Supported page detected</span></p>
       <button class="btn btn--primary">Start Capture</button>`,
    ),
  },
  {
    name: 'screenshot-2',
    headline: 'Every page you open is captured',
    sub: 'You move between pages yourself. Nothing is automated.',
    body: popup(
      'Capturing',
      'ok',
      `${account}
       <p class="section-label">Capture session active</p>
       ${statBlock([
         [14, 'Pages'],
         [331, 'Leads'],
         [16, 'Duplicates'],
       ])}
       <p class="hint">Navigate manually to the next page. Each page is captured as you arrive.</p>
       <button class="btn btn--primary">Finish Capture</button>
       <button class="btn btn--secondary">Open Dashboard</button>`,
    ),
  },
  {
    name: 'screenshot-3',
    headline: 'Duplicates removed automatically',
    sub: 'Across every page, every session, and everything captured before.',
    body: popup(
      'Capturing',
      'ok',
      `${account}
       <p class="section-label">Capture session active</p>
       ${statBlock([
         [22, 'Pages'],
         [518, 'Leads'],
         [37, 'Duplicates'],
       ])}
       <p class="hint">Already-seen prospects are skipped, so you never contact anyone twice.</p>
       <button class="btn btn--primary">Finish Capture</button>`,
    ),
  },
  {
    name: 'screenshot-4',
    headline: 'Your account stays private',
    sub: 'No password. No cookies. No access to any other site.',
    body: popup(
      'Not connected',
      'muted',
      `<p class="note">Connect your Outlio account to start capturing leads from search results.</p>
       <button class="btn btn--primary">Connect Account</button>
       <p class="note" style="margin-top:14px">The extension never asks for your LinkedIn password and captures nothing outside a session you start.</p>`,
    ),
  },
]

const shell = (frame) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
${popupCss}
html,body{margin:0;padding:0;width:1280px;height:800px;overflow:hidden}
body{
  display:flex;align-items:center;justify-content:center;gap:72px;
  background:linear-gradient(135deg,#f7f6fb 0%,#efecfd 100%);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
}
.copy{max-width:470px}
.eyebrow{
  font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;
  color:var(--accent);margin:0 0 14px;
}
.headline{font-size:40px;line-height:1.12;letter-spacing:-.02em;margin:0;color:var(--ink);font-weight:700}
.sub{font-size:17px;line-height:1.5;color:var(--muted);margin:16px 0 0}
.popup{
  width:320px;background:var(--panel);border-radius:14px;
  box-shadow:0 24px 60px rgba(26,26,26,.16),0 2px 8px rgba(26,26,26,.06);
  overflow:hidden;flex:none;
}
.logo-dot{
  width:20px;height:20px;border-radius:5px;flex:none;
  background:linear-gradient(135deg,var(--ink) 0%,var(--ink) 50%,#f5f2e8 50%,#f5f2e8 100%);
}
.btn{cursor:default}
</style></head>
<body>
  <div class="copy">
    <p class="eyebrow">Outlio Lead Capture</p>
    <h1 class="headline">${frame.headline}</h1>
    <p class="sub">${frame.sub}</p>
  </div>
  ${frame.body}
</body></html>`

await rm(tmpDir, { recursive: true, force: true })
await rm(outDir, { recursive: true, force: true })
await mkdir(tmpDir, { recursive: true })
await mkdir(outDir, { recursive: true })

for (const frame of FRAMES) {
  const htmlPath = join(tmpDir, `${frame.name}.html`)
  const pngPath = join(outDir, `${frame.name}.png`)

  await writeFile(htmlPath, shell(frame))

  execFileSync(
    CHROME,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--window-size=1280,800',
      `--screenshot=${pngPath}`,
      `file://${htmlPath}`,
    ],
    { stdio: 'ignore' },
  )

  // Chrome writes RGBA. The store rejects an alpha channel, so flatten it.
  execFileSync('sips', ['-s', 'format', 'png', '--matchTo', '/System/Library/ColorSync/Profiles/sRGB Profile.icc', pngPath], { stdio: 'ignore' })

  const info = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', pngPath], {
    encoding: 'utf8',
  })
  const width = /pixelWidth:\s*(\d+)/.exec(info)?.[1]
  const height = /pixelHeight:\s*(\d+)/.exec(info)?.[1]
  const alpha = /hasAlpha:\s*(\w+)/.exec(info)?.[1]

  console.log(`  ${frame.name}.png  ${width}x${height}  alpha=${alpha}`)
}

await rm(tmpDir, { recursive: true, force: true })

// The store icon is already produced at the right size by the build.
const iconSrc = join(root, 'dist', 'chrome', 'icons', 'icon-128.png')
if (existsSync(iconSrc)) {
  await writeFile(join(outDir, 'store-icon-128.png'), await readFile(iconSrc))
  console.log('  store-icon-128.png  128x128')
}

console.log('')
console.log(`Assets in extensions/store-assets/`)
