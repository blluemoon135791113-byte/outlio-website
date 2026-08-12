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

/* -------------------------------------------------------------------------
 * Promo tiles
 *
 * Different job from the screenshots. A tile is browsed at thumbnail size in a
 * grid, so it carries brand and ONE idea — no popup, no UI, no paragraph. The
 * small tile in particular is 440x280 and sits next to a dozen others.
 *
 * Palette is the site's own ivory-and-charcoal with the accent purple, so the
 * listing looks like the product it links to.
 * ---------------------------------------------------------------------- */

const logoPath = join(resolve(root, '..'), 'public', 'outlio logo.png')
const logoUrl = `file://${logoPath}`

const tileShell = (inner, extraCss = '') => `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root{--ink:#1a1a1a;--muted:#6b6b6b;--accent:#6b4eff;--cream:#f5f2e8}
*{box-sizing:border-box}
/* height:100% on BOTH, or .stage resolves against an auto-height body and the
   content sits at the top with the rest of the tile empty. */
html,body{margin:0;padding:0;height:100%;overflow:hidden}
body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  color:var(--ink);
  background:
    radial-gradient(110% 130% at 100% 0%, rgba(107,78,255,.14) 0%, transparent 60%),
    linear-gradient(140deg,#faf9fc 0%,#f1eefb 100%);
  position:relative;
}
/* The dot grid from the site hero, so the tile reads as the same brand.
   The mask fades to nothing well inside the edges — an ellipse that ends
   abruptly leaves a visible seam across the artwork. */
body::before{
  content:"";position:absolute;inset:0;
  background-image:radial-gradient(circle, rgba(26,26,26,.09) 1.1px, transparent 1.1px);
  background-size:24px 24px;
  -webkit-mask-image:radial-gradient(ellipse 90% 90% at 25% 50%, #000 0%, transparent 100%);
  mask-image:radial-gradient(ellipse 90% 90% at 25% 50%, #000 0%, transparent 100%);
}
.stage{position:relative;height:100%;display:flex;align-items:center}
.logo{border-radius:22%;display:block}
.accent{color:var(--accent)}
${extraCss}
</style></head><body><div class="stage">${inner}</div></body></html>`

const TILES = [
  {
    name: 'promo-small-440x280',
    width: 440,
    height: 280,
    /*
     * At 440x280 anything subtle disappears. One mark, one name, one line —
     * the value proposition has to survive being 200px wide in a grid.
     */
    html: tileShell(
      `<div class="pad">
         <img class="logo" src="${logoUrl}" width="56" height="56" alt="">
         <p class="name">Lead&nbsp;Capture</p>
         <p class="line">Sales Navigator results<br><span class="accent">into a clean CSV.</span></p>
       </div>`,
      `.pad{padding:34px 36px}
       .name{margin:18px 0 0;font-size:20px;font-weight:700;letter-spacing:-.01em}
       .line{margin:10px 0 0;font-size:25px;line-height:1.2;font-weight:700;letter-spacing:-.02em}`,
    ),
  },
  {
    name: 'promo-marquee-1400x560',
    width: 1400,
    height: 560,
    /*
     * The marquee runs across the top of a category page, so it can carry a
     * headline plus one supporting line. Still no UI — that is what the
     * screenshots are for.
     */
    html: tileShell(
      `<div class="pad">
         <div class="row">
           <img class="logo" src="${logoUrl}" width="86" height="86" alt="">
           <div>
             <p class="eyebrow">Outlio</p>
             <p class="name">Lead Capture</p>
           </div>
         </div>
         <h1 class="headline">Sales Navigator results,<br><span class="accent">straight into your dashboard.</span></h1>
         <p class="sub">No saving pages. No downloading files. No uploading. Start a capture, browse the results yourself, and your leads are waiting.</p>
       </div>`,
      `.pad{padding:0 88px}
       .row{display:flex;align-items:center;gap:22px}
       .eyebrow{margin:0;font-size:14px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--muted)}
       .name{margin:4px 0 0;font-size:30px;font-weight:700;letter-spacing:-.015em}
       .headline{margin:34px 0 0;font-size:60px;line-height:1.08;letter-spacing:-.028em;font-weight:800}
       .sub{margin:24px 0 0;max-width:800px;font-size:21px;line-height:1.5;color:var(--muted)}`,
    ),
  },
]

await rm(tmpDir, { recursive: true, force: true })
await rm(outDir, { recursive: true, force: true })
await mkdir(tmpDir, { recursive: true })
await mkdir(outDir, { recursive: true })

/** Renders one HTML string at an exact size and strips the alpha channel. */
async function render(name, html, width, height) {
  const htmlPath = join(tmpDir, `${name}.html`)
  const pngPath = join(outDir, `${name}.png`)

  await writeFile(htmlPath, html)

  execFileSync(
    CHROME,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${width},${height}`,
      `--screenshot=${pngPath}`,
      `file://${htmlPath}`,
    ],
    { stdio: 'ignore' },
  )

  // Chrome writes RGBA. The store rejects an alpha channel on upload, so every
  // asset is flattened here rather than discovered at submission time.
  execFileSync(
    'sips',
    ['-s', 'format', 'png', '--matchTo', '/System/Library/ColorSync/Profiles/sRGB Profile.icc', pngPath],
    { stdio: 'ignore' },
  )

  const info = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', pngPath], {
    encoding: 'utf8',
  })
  const w = /pixelWidth:\s*(\d+)/.exec(info)?.[1]
  const h = /pixelHeight:\s*(\d+)/.exec(info)?.[1]
  const alpha = /hasAlpha:\s*(\w+)/.exec(info)?.[1]
  const ok = w === String(width) && h === String(height) && alpha === 'no'

  console.log(`  ${ok ? ' ' : '!'} ${name}.png  ${w}x${h}  alpha=${alpha}`)
}

for (const frame of FRAMES) {
  await render(frame.name, shell(frame), 1280, 800)
}

for (const tile of TILES) {
  await render(tile.name, tile.html, tile.width, tile.height)
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
