# Chrome Web Store submission

Everything the listing form asks for, plus the answers to the questions
reviewers actually ask. Build the package with:

```bash
npm run ext:package
# → extensions/packages/outlio-lead-capture-chrome-v0.2.0.zip
# Firefox/AMO → extensions/packages/outlio-lead-capture-firefox-v0.2.0.xpi
```

The packager refuses to build if icons are the wrong size, a dev build slipped
through, host permissions are too broad, or a secret is bundled. Those are the
things review rejects for, and catching them here costs seconds instead of a
review cycle.

---

## 1. Before you upload

| Item | Status |
|---|---|
| Developer account ($5, one-off) | you have it |
| ZIP/XPI, manifest at archive root | `npm run ext:package` / `npm run ext:package:firefox` |
| Icons at true 16/32/48/128 | done — verified by the packager |
| Privacy policy URL | `https://app.outlio.io/privacy-policy` |
| Store icon 128×128 | reuse `extensions/dist/chrome/icons/icon-128.png` |
| Screenshots 1280×800 or 640×400 | **you must make these** — at least one |
| Justification for every permission | §4 below |
| Single purpose statement | §3 below |

Screenshots are the only genuinely manual item. Suggested set:

1. The native side panel on a list page, "List ready to capture"
2. The side panel mid-session showing Pages / Records / Skipped
3. The dashboard with the Live capture widget running
4. Settings → Browser extension, showing a connected browser

---

## 2. Listing copy

**Name** — Outlio Capture

**Summary** (132 char max)

> Capture Sales Navigator lead and account lists you open yourself, with a persistent Outlio sidebar. No manual HTML uploads.

**Description**

> Outlio Capture removes the save-and-upload step from your prospecting.
>
> Open the Outlio side panel, start a capture session, and browse normally. Loaded Lead Lists, Account Lists and search results you open are sent to your Outlio account for processing into lead or company records. Identical page snapshots are skipped, and lead duplicate handling follows your selected mode. No automatic navigation.
>
> HOW IT WORKS
> 1. Install the extension and connect your Outlio account
> 2. Open a saved Lead List, Account List or search-results page
> 3. Click Start capture in the sidebar
> 4. Move between pages yourself — loaded rows are captured as you arrive
> 5. Click Finish capture, then review the processed records in the dashboard
> 6. Add reviewed records to CRM using the dashboard's import action
>
> WHAT IT DOES NOT DO
> • It does not navigate for you. No automatic paging, clicking, messaging or connection requests. You browse; it reads the page you chose to capture.
> • It captures nothing outside a session you started. A toolbar badge shows whenever one is active.
> • It never asks for your LinkedIn password, and never reads cookies, saved logins or session tokens.
> • Content scripts run only on Sales Navigator pages and Outlio's connection page. Requests to Outlio's product API authenticate and process captures.
> • Closing the sidebar does not stop an active session. Choose Finish capture to stop.
>
> An Outlio account with an active subscription is required. Installing the extension alone does not grant access.
>
> Privacy policy: https://app.outlio.io/privacy-policy

**Category** — Workflow & Planning

---

## 3. Single purpose

Chrome requires one narrow purpose. Ours:

> Capture Sales Navigator lead/account list and search pages the user has opened
> themselves and send them to their authenticated Outlio account for processing
> into structured lead or company records.

Everything in the extension serves that: the sidebar starts and stops a session,
the content script reads the page, the background worker authenticates and
transmits. Nothing does anything else — which is the argument to make if a
reviewer questions scope.

---

## 4. Permission justifications

Copy these into the form. Each is narrow on purpose; the manifest asks for the
minimum that works.

**`storage`**

> Stores the user's short-lived access token, rotating refresh token, and the
> id of the active capture session. Required so the user does not have to
> reconnect their account on every page, and so a session survives the popup
> closing. No page content or personal data is stored locally.

**`activeTab`**

> Lets the toolbar/sidebar address the active tab without requesting the broad
> tabs permission. The declared content scripts observe supported Sales Navigator
> documents only while a user-started local capture session is active.

**`sidePanel`** (Chrome only)

> Displays persistent capture controls, status and totals beside the page while
> the user navigates manually. The toolbar icon opens the panel. Firefox uses
> sidebar_action instead; no sidePanel permission is requested there.

**Host permission — `https://www.linkedin.com/sales/*`**

> Reads supported lead/account lists the user opens during an explicit session.
> Content-script matches are restricted to /sales/*, not the feed or other
> LinkedIn pages. Browser host permissions themselves are origin-level (their
> path component is not a security boundary); the content matches and session
> gates enforce the narrower reading behavior.

**Host permission — `https://app.outlio.io/*`**

> Used by the worker for authenticated pairing, token refresh and capture API
> requests to the product host. The Outlio content script is separately limited
> to /extension/connect*, where it exchanges a single-use pairing code. It does
> not inspect other Outlio application pages.

**Remote code** — answer **No**. Everything is bundled; nothing is fetched and
executed at runtime, and the CSP is `script-src 'self'`.

---

## 5. Data safety disclosures

Declare honestly. Under-declaring is a far worse outcome than declaring.

| Question | Answer |
|---|---|
| Personally identifiable information | **Yes** — page content includes names, job titles and employers of the professionals listed on the page the user captured |
| Health or financial info | No |
| Authentication info | **Yes, Outlio device tokens only** — not LinkedIn credentials or cookies |
| Personal communications | No |
| Location | **Yes, if shown in captured professional/company records** — no device location access |
| Web history | No — only pages captured during an explicit session |
| User activity | No — no analytics or tracking in the extension |
| Website content | **Yes** — the results list, sent to our API for processing |

Then tick all three certifications: data is not sold to third parties, is used
only for the disclosed single purpose, and is not used for creditworthiness or
lending.

---

## 6. Realistic review risk

Worth going in with eyes open.

**Extensions that read data from a site the user does not own get more
scrutiny than average, and LinkedIn-adjacent extensions have been removed
before** — sometimes after a complaint from the platform rather than a policy
finding. Publishing puts the extension on a public listing with your developer
account attached, which is a more visible posture than the file-upload product.

Points in your favour, and the ones to lead with in any appeal:

- No automated navigation, no clicking, no messaging, no connection requests
- No CAPTCHA handling, stealth, fingerprint manipulation or timing evasion
- Reads only a page the user opened themselves, only during a session they
  started, only on one URL path
- Requests no credentials and touches no cookies or tokens
- Genuinely useless without a paid account on our own service

The likeliest rejection reasons are procedural rather than substantive: missing
screenshots, a weak single-purpose statement, or permission justifications that
do not match the manifest. §3 and §4 exist to remove those.

If it is rejected, the appeal form wants specifics — quote the single purpose
statement and the permission scoping, and point out there is no automation.

---

## Firefox upload note

For Mozilla Add-ons, upload the generated `.xpi` directly:
`extensions/packages/outlio-lead-capture-firefox-v0.2.0.xpi`. Do not zip the
repository or the `extensions/dist` parent directory. Firefox requires
`manifest.json` at the archive root; the package script creates the archive from
inside `extensions/dist/firefox` and verifies that layout.

## 7. After it is published

Set the listing URL so the dashboard links out instead of showing
"coming soon":

```
NEXT_PUBLIC_EXT_STORE_CHROME=https://chrome.google.com/webstore/detail/<id>
```

Add it for **Production and Preview** in Vercel — the Supabase variables were
Production-only and that broke every preview build until it was fixed.

Then bump `version` in `extensions/chrome/manifest.json` for each subsequent
submission; the store rejects a re-upload of an existing version number.
