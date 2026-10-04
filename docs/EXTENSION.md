# Browser extension — build and install

Companion to `docs/ARCHITECTURE.md`. The capture API uses the existing upload /
worker pipeline and migration `0032_browser_extension.sql`.

## 1. Version 0.2.0: leads, accounts and a persistent sidebar

Supported pages the user opens in Sales Navigator:
- Saved **Lead Lists** (`/sales/lists/people/…`) and lead search results.
- Saved **Account Lists / Account Hub** (`/sales/lists/company/…`,
  `/sales/accounts`, `/sales/account-hub`).
- **Account search results** (`/sales/search/company`).

Only loaded rows are captured. Outlio never scrolls, turns pages, opens profiles,
or fetches LinkedIn. Browse to subsequent pages yourself while capture is active.
An empty/loading list cannot start capture. Optional company details come only
from already-visible, identity-matched cards; no synthetic hover is performed.

The toolbar icon opens Chrome's native side panel or Firefox's native sidebar.
It stays beside the page instead of disappearing like a toolbar popup. A popup
fallback remains for environments where the native sidebar API is unavailable.

**Right-side placement is a browser preference, not something an extension can
force.** In Chrome, choose the right-side panel position in Settings → Appearance
(the exact label varies by Chrome version). In Firefox, use the browser sidebar
menu/settings to move the sidebar to the right. Outlio does not change global
browser preferences or inject an overlay into LinkedIn.

## 2. Build

```bash
npm run ext:build             # Chrome + Firefox → extensions/dist/
npm run ext:chrome
npm run ext:firefox
npm run ext:dev               # Chrome → http://localhost:3000
npm run ext:package           # production Chrome ZIP
npm run ext:package:firefox   # production Firefox XPI (AMO upload)
```

Production builds connect directly to **`https://app.outlio.io`**, where product
authentication lives. They do not rely on cross-origin marketing redirects.
`extensions/dist/` and `extensions/packages/` are generated and gitignored.
A code or manifest change requires rebuilding **and reloading the extension**;
changing server entitlement does not.

## 3. Install or update

**Chrome 116+**
1. Open `chrome://extensions`, enable **Developer mode**.
2. Choose **Load unpacked**, select `extensions/dist/chrome`.
   For an existing unpacked install pointing to this folder, click its **Reload**
   button instead. Confirm version **0.2.0** and accept the side-panel permission
   if Chrome prompts.
3. Pin Outlio in the toolbar, then **refresh existing Sales Navigator tabs once**.
   Updating a manifest does not inject the new content script into old documents.
4. Click Outlio to open its panel. Set the browser panel position to the right if
   it currently opens on the left.

**Firefox 121+** — `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on**
→ `extensions/dist/firefox/manifest.json`. Reload it and refresh existing tabs
when updating. Temporary add-ons are removed when Firefox restarts. A permanent
release requires Mozilla signing. For an AMO upload, use:
`extensions/packages/outlio-lead-capture-firefox-v0.2.0.xpi`.

A ZIP/XPI is a store/distribution artifact, not a Chrome installation URL: unpack
it first if loading via Developer mode. For Mozilla Add-ons, upload the generated
`.xpi` file, not a manually zipped parent directory. The package has
`manifest.json` at archive root. Publishing a site deployment does **not** update
already-installed extension code or publish a browser-store release.

## 4. Connect and capture

1. Choose **Connect account** in the panel. A tab opens on
   `app.outlio.io/extension/connect?state=…`; sign in if needed.
2. Choose **Connect this browser**. A single-use, 60-second pairing code travels
   via a DOM attribute, not browser history or a URL. The worker exchanges it for
   device-bound access/refresh tokens. The panel can stay open during pairing.
3. Open a supported saved list/search and wait for **List ready to capture**.
4. Choose duplicate handling, then **Start capture**. The current page is sent;
   later loaded pages are captured only as you browse manually.
5. **Capture this page** retries the current snapshot explicitly. Identical
   sanitized pages are deduplicated server-side.
6. Choose **Finish capture** to stop. **Closing the panel does not stop capture.**
   The toolbar's ON badge indicates an active local session.
7. **View captures in Outlio** opens extraction jobs. Records may still be
   processing. Review/export them there, or choose the job's add-to-CRM action;
   capture alone does not mean the records have been added to CRM.

The panel calls totals **Records**, covering accounts and people. Historical
server columns remain `leads_*`. Account job processing must call
`settleCaptureJob` before its early return to update these totals. That server
fix needs a website/worker deployment independently of installing the extension.
No new database migration is required by 0.2.0.

Disconnect/revoke a browser from Outlio's Browser extension settings. The worker
shares one token refresh across simultaneous panel/capture requests, and retains
credentials on transient outages. Merely opening the panel does not adopt an
active capture session from another browser: local capture requires Start.

## 5. Implementation and verification

```
extensions/
  core/        API client, contracts, storage, snapshot sanitizer
  shared/      background, passive content observer, pairing, panel setup
  adapters/    lead lists, account lists/search, company-page observations
  ui/popup/    one responsive UI shared by panel.html and popup.html
  chrome/      Chrome manifest (sidePanel)
  firefox/     Firefox manifest (sidebar_action)
  scripts/     build and package
```

Native panel setup is the small feature-detected browser difference. Credentials
and network requests stay in the background worker. Session consent persists in
`chrome.storage.local` so MV3 worker suspension does not end an explicit session.

```bash
npm test -- --maxWorkers=2
npm run typecheck -- --incremental false
npm run lint
npm run ext:build
E2E_BROWSER_CHANNEL=chrome npx playwright test -c tests/browser/playwright.config.ts extension-panel.spec.ts
```

`extension-capture-adapters.test.ts` round-trips sanitized fabricated lead and
account pages through the real backend parsers. `extension-content-session`
covers consent, stopping/restarting, container replacement and SPA navigation.
Client/background/panel/totals tests cover refresh races, tab attribution,
queued changes, browser APIs and account progress. Browser panel tests intercept
all requests and use synthetic account state; none visits LinkedIn.

## 6. Troubleshooting

| Symptom | Check |
|---|---|
| Old popup or old version | Rebuild, reload the extension, refresh the LinkedIn tab |
| No supported list | URL support and loaded row selectors in `extensions/adapters/`; see `docs/SELECTOR_MAP.md` |
| Capture failed on first lead-list page | 0.2.0 supplies page identifier `1` when there is no paginator |
| API connection/sign-in trouble | Confirm build points to `app.outlio.io`; reconnect if the device was revoked |
| Accounts appear in jobs but totals stay zero | Server account-progress fix may not be deployed yet |
| Zero extracted records | Check job error and backend selectors; empty results are not success |
| Same content billed again | Check sanitizer/hash stability; do not include Ember IDs, tracking query strings or session state |

Snapshots contain only result markup, with an attribute allowlist. Scripts,
forms/controls, embedded content, credentials, tracking URLs and volatile IDs are
removed. Backend selector attributes and account-description `title` survive.
Outside an active session the observer does not read person/company fields.
Panel readiness checks only whether supported row elements are present.

## 7. Publishing and Safari

See `docs/EXTENSION_STORE.md` for permission justifications and submission copy.
Store publication is a separate, deliberate action; building a ZIP does not
publish it. Set `NEXT_PUBLIC_EXT_STORE_CHROME` / `FIREFOX` / `SAFARI` only to real
published listing URLs. The packager checks icons, dev origins and secret markers.

Safari is **not a tested or signed target**. It needs Apple's paid developer
membership and an Xcode conversion/signing review. Do not submit the Chrome
manifest unchanged: its `sidePanel` permission/manifest key is Chrome-specific.
The shared popup can serve as a fallback after a Safari-compatible manifest is
prepared and verified. No Safari compatibility is claimed for this release.
