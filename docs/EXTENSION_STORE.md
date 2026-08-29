# Chrome Web Store submission

Everything the listing form asks for, plus the answers to the questions
reviewers actually ask. Build the package with:

```bash
npm run ext:package
# → extensions/packages/outlio-lead-capture-chrome-v0.1.0.zip
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
| ZIP, manifest at archive root | `npm run ext:package` |
| Icons at true 16/32/48/128 | done — verified by the packager |
| Privacy policy URL | `https://app.outlio.io/privacy-policy` |
| Store icon 128×128 | reuse `extensions/dist/chrome/icons/icon-128.png` |
| Screenshots 1280×800 or 640×400 | **you must make these** — at least one |
| Justification for every permission | §4 below |
| Single purpose statement | §3 below |

Screenshots are the only genuinely manual item. Suggested set:

1. The popup on a results page, "Supported page detected"
2. The popup mid-session showing Pages / Leads / Duplicates
3. The dashboard with the Live capture widget running
4. Settings → Browser extension, showing a connected browser

---

## 2. Listing copy

**Name** — Outlio Lead Capture

**Summary** (132 char max)

> Send lead search-results pages you open yourself straight into your Outlio dashboard. No HTML downloads, no manual uploads.

**Description**

> Outlio Lead Capture removes the save-and-upload step from your prospecting.
>
> Instead of saving each results page as an HTML file and uploading it, start a capture session and browse normally. Each page you open is sent to your Outlio account and turned into structured leads, with duplicates removed against everything you have captured before.
>
> HOW IT WORKS
> 1. Install the extension and connect your Outlio account
> 2. Open a lead search-results page
> 3. Click Start Capture
> 4. Move between pages yourself — each one is captured as you arrive
> 5. Click Finish, and your leads are in the dashboard
>
> WHAT IT DOES NOT DO
> • It does not navigate for you. No automatic paging, clicking, messaging or connection requests. You browse; it reads the page you chose to capture.
> • It captures nothing outside a session you started. A toolbar badge shows whenever one is active.
> • It never asks for your LinkedIn password, and never reads cookies, saved logins or session tokens.
> • It has no access to any site other than lead search-results pages and the Outlio connect page.
>
> An Outlio account with an active subscription is required. Installing the extension alone does not grant access.
>
> Privacy policy: https://app.outlio.io/privacy-policy

**Category** — Workflow & Planning

---

## 3. Single purpose

Chrome requires one narrow purpose. Ours:

> Capture lead search-results pages the user has opened themselves and send
> them to their authenticated Outlio account for processing into structured
> lead records.

Everything in the extension serves that: the popup starts and stops a session,
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

> Lets the extension read the results page in the tab the user is currently
> viewing, and only when they have started a capture session. Used instead of
> broad tab access so the extension can never see tabs the user is not
> actively capturing from.

**Host permission — `https://www.linkedin.com/sales/*`**

> The extension's entire function is to read lead search-results pages so the
> user can import them into their own account. Scoped to the `/sales/` path
> rather than the whole domain so it has no access to the user's feed,
> messages, profile or any other part of the site.

**Host permission — `https://outlio.io/extension/connect*`**

> Used once, during account connection. The connect page issues a single-use
> pairing code which the extension exchanges for an access token. Scoped to
> that one page so the extension cannot read any other part of our own site.

**Remote code** — answer **No**. Everything is bundled; nothing is fetched and
executed at runtime, and the CSP is `script-src 'self'`.

---

## 5. Data safety disclosures

Declare honestly. Under-declaring is a far worse outcome than declaring.

| Question | Answer |
|---|---|
| Personally identifiable information | **Yes** — page content includes names, job titles and employers of the professionals listed on the page the user captured |
| Health, financial, authentication info | No |
| Personal communications, location | No |
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
