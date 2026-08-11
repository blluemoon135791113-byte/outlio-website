# Browser extension — build and install

Companion to `docs/ARCHITECTURE.md`. Covers only the extension; the capture
API it talks to is described in migration `0032_browser_extension.sql`.

---

## 1. Layout

```
extensions/
  core/        types, storage, API client        — no browser APIs beyond chrome.storage
  shared/      background, content, connect      — the actual logic, ONE copy
  adapters/    salesnav.ts                       — the only DOM-aware file
  ui/popup/    popup.html/.css/.ts               — shared UI
  chrome/      manifest.json only
  firefox/     manifest.json only
  safari/      see §5
  scripts/     build.mjs
```

**Only the manifests differ per browser.** Chrome and Firefox both expose the
`chrome.*` namespace under MV3, so the logic needs no branching. If you find
yourself adding a `if (isFirefox)` to `shared/`, look for another way first.

---

## 2. Build

```bash
npm run ext:build      # chrome + firefox → extensions/dist/
npm run ext:chrome
npm run ext:firefox
npm run ext:dev        # chrome, pointed at http://localhost:3000
```

Output is gitignored and regenerated; never commit `extensions/dist/`.

The **only** build-time value is the API origin. Everything else — entitlement,
plan, session state — is fetched at runtime, so changing behaviour never
requires a rebuild.

---

## 3. Install a developer build

**Chrome** — `chrome://extensions` → enable *Developer mode* → *Load unpacked*
→ select `extensions/dist/chrome`.

**Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on*
→ select `extensions/dist/firefox/manifest.json`. Temporary add-ons are removed
when Firefox restarts; that is a Firefox rule, not a bug here.

For a local backend, run `npm run ext:dev`, which rewrites the host permissions
and the API origin to `http://localhost:3000`.

---

## 4. Connecting an account

1. Click the extension → **Connect Account**.
2. A tab opens at `/extension/connect?state=…`. Sign in if needed.
3. **Connect this browser** issues a one-time code, valid 60 seconds.
4. The code is rendered into a DOM attribute — never a URL — and the
   `connect.js` content script, which has host access to our domain only,
   hands it to the background worker.
5. The worker exchanges it at `POST /api/extension/pair` for a 15-minute access
   token and a rotating refresh token.

Disconnect from **Settings → Browser extension**. Revocation is immediate: the
access-token id is nulled, so a token already in flight dies on its next
request rather than lasting out its 15 minutes.

---

## 5. Safari

**Safari cannot ship without a paid Apple Developer Program membership
($99/yr).** No workaround exists — Safari refuses unsigned extensions outside a
short-lived developer session.

Once an account is available:

```bash
npm run ext:chrome
xcrun safari-web-extension-converter extensions/dist/chrome \
  --project-location extensions/safari \
  --app-name "Outlio Lead Capture" \
  --bundle-identifier io.outlio.leadcapture
```

Then open the generated Xcode project, set the signing team, and submit. The
converter consumes the Chrome build unchanged, which is why the shared layout
matters.

`extensions/safari/` holds this note only. Nothing is pre-generated, because a
committed Xcode project that has never been opened or signed would look
finished while being unusable.

---

## 6. Publishing

| Store | Account | Notes |
|---|---|---|
| Chrome Web Store | $5 one-off | Justify each permission; review is usually days |
| Firefox Add-ons | free | Source upload required since the build is minified |
| Safari | $99/yr | App Store submission, see §5 |

Before submitting, replace the placeholder icons. `build.mjs` copies
`app/icon.png` at every size **without resizing** so a developer build loads;
stores require real artwork at 16/32/48/128.

Set the listing URLs so the dashboard links out instead of showing
"coming soon":

```
NEXT_PUBLIC_EXT_STORE_CHROME
NEXT_PUBLIC_EXT_STORE_FIREFOX
NEXT_PUBLIC_EXT_STORE_SAFARI
```

---

## 7. When the page structure changes

It will — `docs/SELECTOR_MAP.md` records that it already has once.

Everything DOM-aware lives in `extensions/adapters/salesnav.ts` behind the
`PageAdapter` interface. A layout change is a change to that one file;
authentication, the capture loop, the popup and the backend are unaffected.

Symptoms and where to look:

| Symptom | Cause |
|---|---|
| "No supported page detected" on a valid page | `supports()` — URL pattern moved |
| Popup ready, capture says no results container | `resultsContainer()` — container selector |
| Captures succeed but find 0 leads | Backend selectors, not the adapter — see `SELECTOR_MAP.md` |
| Same page captured twice | Hash instability — something volatile survived `sanitize()` |

That last one matters most. Ember rewrites `id` attributes on every render, so
`sanitize()` strips them; if a new volatile attribute appears, the same page
will hash differently each redraw and users will be **billed twice for one
page**. Add it to the strip list.

---

## 8. What is deliberately absent

No automated navigation of any kind: no clicking Next, no opening profiles, no
messaging, connecting or filter changes. No CAPTCHA handling, no stealth, no
fingerprint manipulation, no timing randomisation designed to look human.

The user navigates. The extension observes the page they landed on, and only
while a session they started is running. Outside a session it reads nothing.

This is a product constraint, not an oversight — see `CLAUDE.md` rule 1.
