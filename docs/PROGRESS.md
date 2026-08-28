# Progress

Append-only log. Read this before writing any code.

---

## 2026-08-28 — `upsert_companies` verified against the live database

The last untested piece is closed. No database password was needed: the app
calls this RPC through PostgREST with the service-role key, so the same path
the worker uses is the one that was exercised.

**Empty-payload smoke test** — `HTTP 200 []`. Proves the function exists and
the argument shape matches, and writes nothing.

**Round trip with a fabricated company** (CLAUDE.md: fixtures are fabricated):

| call | result |
|---|---|
| 1st | `created: true`, `match_strategy: "linkedin"` |
| 2nd | `created: false`, **same `company_id`** |

That is exactly the contract the ingestion depends on:

- **Precedence is right.** No domain was supplied, so it resolved by LinkedIn
  URL rather than falling through to the name strategy.
- **⚠️ Idempotency holds.** The second call returned the SAME id and
  `created: false`. This is what stops an `after()` retry or a re-run by the
  stale-claim reaper from duplicating an entire list — the case the counters
  exist to report as "0 new, 25 already known".
- **Industry seeded** on insert, and the normalized LinkedIn URL stored in the
  form the lead pipeline dedupes against.

**Cleanup verified**: row deleted (HTTP 204), and a follow-up query confirms
zero fixture rows remain in `companies`.

### The chain is now verified end to end

parse (tests) → detect (tests) → map (tests, including the real Account Hub
fixture) → **upsert (live)** → job reporting (tests).

⚠️ Still not done: a real Account Hub page through the actual upload UI. Every
layer is now proven, but nothing has driven them together from a file on disk.

---

## 2026-08-28 — Migrations applied; recovered the types file after regeneration

### 0065 and 0066 are live

Confirmed against the regenerated types: `upsert_companies` and the
`extraction_jobs` account columns are present. **The account list path is now
unblocked end to end.**

⚠️ The hand-written RPC signature matched the applied SQL exactly —
`Args: { p_companies: Json; p_user_id: string }`,
`Returns: { company_id, created, match_strategy }[]`. The guess was right, and
the generated file is now the source of truth for it.

### The regeneration deleted 969 lines and broke the build

`supabase gen types typescript --linked > types/database.ts` replaces the
**whole file**. That file was not purely generated: lines 1–977 were
hand-written aliases — `ProfileRow`, `ExtractionJobRow`, `PlanLimits`,
`JobStatus`, `DedupeMode` and about twenty more — imported directly across the
app. The redirect silently discarded all of them.

Result: **40 type errors**, none of which name the real cause. They read as
"has no exported member 'ProfileRow'" scattered across unrelated files, which
looks like twenty separate breakages rather than one deleted block.

Restored from `HEAD` and spliced above the generated `Database` type. A banner
now sits at the seam explaining that this file is not safe to overwrite and how
to regenerate without losing the block — the failure is silent and expensive
enough to be worth the eleven lines.

### Also added

An end-to-end test over the REAL Account Hub fixture: detect → parse → map.
The existing mapping tests used synthetic rows, and the bugs that survive unit
tests are the ones between two components that each pass their own. It asserts
nothing is lost between parsing and payload, that every payload row satisfies
`companies_has_identity` (0043) — a row failing it would be skipped by the RPC
and silently vanish — and that no Sales Navigator URL survives as an identity.

### Verification

- Typecheck, ESLint (0 errors) and production build clean. **1,234 tests.**
- ⚠️ Not yet exercised: a real account-list upload against the live schema.
  The SQL is applied and the types match, but no run has been performed.

---

## 2026-08-28 — Google CSE retired; search runs through the MCP

### It cannot be enabled, so it is disabled

Google no longer grants access to the Custom Search JSON API. The 403 was not
a misconfiguration to fix — the product is closed to new customers, so no
console change on this account can activate it.

⚠️ **Left configured it was worse than useless.** `hasGoogleCseCredentials()`
returned true, so the provider claimed a waterfall slot **above Mojeek**, the
keyless free index that does work. Every call returned `403`, which the
provider swallows into an empty result, so the symptom was silence rather than
an error.

`GOOGLE_CSE_ID` is now blank. ⚠️ Blanking the ID rather than the key is
deliberate: `hasGoogleCseCredentials()` falls back to `GOOGLE_MAPS_API_KEY`
when the CSE key is absent, so the engine id is the only field that reliably
disables the provider. Verified: the check now returns false.

~~**Production needs the same change**~~ — ⚠️ **CORRECTED 2026-08-28.** Checked
via `vercel env ls`: `GOOGLE_CSE_ID`, `GOOGLE_CSE_API_KEY` and
`GOOGLE_MAPS_API_KEY` are set in **none** of production, preview or
development. `hasGoogleCseCredentials()` has therefore always returned false on
the deployed app — the wasted waterfall slot was a LOCAL-ONLY problem, already
fixed. No Vercel change was needed, and advising one was wrong.

Production does carry `SEARXNG_URL` and `SEARXNG_AUTH_TOKEN`, so the
web-research MCP path is configured there as intended.

The provider code stays. An account with existing access still works, and
deleting a provider is not how you record that an upstream closed; its header
now says so.

### The search path that IS working

`defaultSearchEngines()` order: Solr, **web-research MCP**, Google CSE, Brave,
Mojeek, Tavily. The MCP sits above CSE, so it was already handling searches.

Confirmed reachable: `{"status":"ok","storage":"postgres","worker_mode":
"background"}` on 127.0.0.1:8787, in Docker, with SearXNG plus a DuckDuckGo
fallback inside the compose stack.

⚠️ An earlier reading of mine was wrong: I reported the MCP unreachable after a
404. I had appended `/health` to the configured URL, which already ends in
`/mcp`, and requested `/mcp/health`. The service was healthy the whole time.

---

## 2026-08-28 — Google CSE: diagnosed to the console, cannot be finished in code

### The blocker is a KEY RESTRICTION, not just API enablement

Probing the same key against two other Google APIs returns:

    403 — Requests to this API translate method ... are blocked.
    403 — Requests to this API books method ... are blocked.

That wording is Google's **API-key restriction** message, not the
project-level "has not been used in project N before" one. So the key is locked
to an allow-list of APIs and Custom Search is not on it. The Custom Search 403
carries no project number and no activation link, so the owning project cannot
be identified programmatically — I probed for one and Google does not return it
for this API.

⚠️ **This cannot be finished from the repo.** It needs the Google Cloud console
on the account owning the key: enable **Custom Search API**, and add it to the
key's API restrictions. Claude in Chrome is not connected, and the in-app
browser has no Google session — entering credentials is not something I do.

### The env fix did NOT create a regression

Worth checking rather than assuming: `isConfigured()` is now true, so the
provider occupies a waterfall slot and every call returns `[]` via its catch.
`serp.ts` treats zero hits as a failure, sidelines the engine for a cooldown,
and falls through to the next one. Tavily and Serper are both configured, so
live search still works; the cost is one wasted request per cooldown window,
not degraded results.

### Still to do on the Google side

After enabling, the `cx` must be set to search **the entire web**. A `cx`
scoped to specific sites returns almost nothing and looks exactly like a broken
key — `google-cse.ts` warns about this in its own header, and it cannot be
tested until the API responds.

---

## 2026-08-28 — Google CSE: credentials were fine, the API is not enabled

### Correcting an earlier claim

I reported that `GOOGLE_CSE_ID` and `GOOGLE_CSE_API_KEY` were unset. **That was
wrong** — both are present in `.env.local` (39 and 17 characters). The earlier
grep read only the first 20 lines and the variables sit at 60 and 61.

### What was actually broken

Those two lines sit **after** the malformed HTML at lines 32-34, so the pasted
Google CSE `<script>` block stopped env parsing before reaching them. Fixing
the syntax restored both variables — verified loading cleanly via
`node --env-file`.

### What is still blocking, and it is not in this repo

A live query returns:

    403 — This project does not have the access to Custom Search JSON API.

Both keys were tested (`GOOGLE_CSE_API_KEY` and the `GOOGLE_MAPS_API_KEY`
fallback the provider also accepts); they belong to different projects and
**neither project has the Custom Search JSON API enabled**.

⚠️ This cannot be fixed from the codebase. It is a Google Cloud console setting
on the account that owns the key, exactly as `google-cse.ts` warns in its own
header: "Two settings, both free: enable the Custom Search API on a Google
project, and create a search engine set to search THE ENTIRE WEB."

Cost is not the obstacle — the tier is 100 queries/day, free, no card.

### Still unverified after enabling

The `cx` must be configured to search the entire web. A `cx` scoped to specific
sites returns almost nothing and looks like a broken key. That cannot be tested
until the API is enabled.

---

## 2026-08-28 — An account run now reports companies, not "0 leads"

### The display bug this closes

`DashboardJob` selected only the lead counters, so the workspace read
`leads_kept` for every job. A run that successfully ingested 25 companies
would have rendered as **"0 leads kept"** — a run that worked, displayed as one
that produced nothing.

⚠️ That is worse than a blank cell: the number is **confidently wrong** rather
than absent, so nobody investigates. Same shape as the credits `?? 0` bug and
the empty lead list before it.

`jobYield()` now reports in the run's own units, and three related fixes
follow from it:

- "Duplicates removed" is a lead-dedupe concept. An account run shows
  **"already known"** instead — a different fact from a row removed from an
  export.
- Workspace totals no longer add companies into the lead count.
- In-progress runs say "companies found" rather than "leads found".

### Upload guidance

The dropzone said lead search-results pages only, so nothing told a user
account lists are accepted. It now names both, and states **one kind per run**
— the worker refuses a mixed batch, and discovering that from a failed upload
costs more than the line it takes to say it.

### Verification

- Typecheck, ESLint (0 errors) and production build clean. **1,231 tests.**
- ⚠️ Still unapplied: 0065 and 0066. `supabase/APPLY_PENDING.sql` holds both
  for the SQL editor, or `npx supabase db push` prompts for the password
  interactively.

### Fixed while unblocking the CLI

`.env.local` held a pasted Google CSE HTML snippet (`<script>`, `</script>`,
`<div>`) where env vars belong, plus a key with a space before `=`. Next.js
parses leniently and booted past it; the Supabase CLI refused the file
entirely. Syntax corrected, no values touched.

⚠️ That surfaced a live gap: `google-cse.ts` reads `GOOGLE_CSE_ID` and
`GOOGLE_CSE_API_KEY`, and **neither is set** — the cx value is stranded inside
the HTML paste, so Google CSE is silently disabled as a search provider.
Deliberately NOT wired up: enabling a provider starts real API spend.

---

## 2026-08-28 — Account lists ingest end to end

### The queue is shared; the output is not

`0066` adds `kind` plus four account counters to `extraction_jobs` rather than
creating an `account_jobs` table. The queue, `claim_next_job`,
`FOR UPDATE SKIP LOCKED`, attempt counts, backoff and the stale-claim reaper
are the hard parts of this pipeline and are already correct — a parallel table
would duplicate every one of them and drift.

What differs is only the OUTPUT. Reporting "25 leads kept" for a run that
produced 25 companies would be a lie in the one place a user checks what a run
did, so accounts get their own columns.

⚠️ **`kind` defaults to `lead_search`, which is correct for every existing
row** — account lists could not be ingested before this migration, so no
historical job can be one. A nullable column would have forced every reader to
handle an "unknown kind" that has never existed.

### The worker branches rather than threading

An account run leaves `processClaim` before the lead machinery. Everything
below that point — credit charging per block of leads, person dedupe, lead
inserts, the CSV export — is shaped around people. Threading companies through
would mean a charge computed from a lead count of zero, a dedupe keyed on a
person who does not exist, and an export with person headers.

⚠️ **MIXED UPLOADS ARE REFUSED, NOT SILENTLY HALVED.** A batch holding both
page types has no honest outcome: charging for the leads while quietly
ingesting the companies reports one number for two jobs. The run fails with a
message telling the user to split the upload.

`parseOne` now returns a tagged result, so per-file isolation still holds: one
unreadable file fails alone rather than failing the batch.

### Verification

- Typecheck, ESLint and production build clean. **1,229 tests**.
- ⚠️ **0065 and 0066 are NOT APPLIED.** No database was reachable this session,
  so `upsert_companies`, `kind` and the account counters are unverified against
  Postgres, and `types/database.ts` was hand-extended in the generator's shape
  to compile. **Apply both migrations and regenerate types before trusting an
  account run.** The parsing, routing and mapping are covered by tests; the SQL
  is not.

---

## 2026-08-28 — Account List ingestion: companies as a first-class feature

### It is a separate feature, and the schema says so

A lead page yields PEOPLE who happen to have employers; companies appear as a
side effect of linking. An account list yields COMPANIES directly, with no
person attached — so it does not belong in the lead pipeline, which dedupes by
person and exports person rows.

⚠️ **IT STILL WRITES TO THE SAME `companies` TABLE, ON PURPOSE.** A company
found through an account list and the same company found through a lead's
employer must be ONE row, or every later count is wrong — and the plan is for
macro analysis to move onto company accounts, which makes a split identity
space a future data corruption rather than a cosmetic issue.

### `0065_account_list_ingest.sql` — `upsert_companies`

`link_leads_to_companies` (0043) cannot serve this: it requires a `lead_id` and
skips any row without one. The new RPC does the same identity resolution with
no lead, and additionally reports whether the row was **created**, so ingestion
can say "18 new, 7 already known" rather than one meaningless total.

The resolution deliberately mirrors 0043 step for step — precedence, name-row
adoption, the contended-retry loop, the guarded weaker-identifier attachment.
⚠️ Divergence would mean the same company resolving differently depending on
which page it arrived on, which is exactly the duplicate the table's three
partial unique indexes exist to prevent.

⚠️ **Industry is filled in, never overwritten.** `companies.industry` is a
projection of `research_evidence`, which carries provenance and a TTL. A
captured page is weaker than researched evidence, so it may seed an empty cell
and must not replace a value a provider stood behind.

### `lib/companies/ingest-accounts.ts`

`toIngestPayload` is pure and exported precisely so identity mapping — the part
most likely to be wrong — is testable without a database.

⚠️ **THE SALES NAVIGATOR URL IS CONVERTED, NOT STORED AS-IS.**
`normalized_linkedin_url` is deduped against values written by the lead
pipeline, which stores the public `linkedin.com/company/<slug>` page. A
`/sales/company/` URL never matches one, so the same company would land twice —
once per page type. Uses `publicCompanyUrl`, the lead parser's own converter.

Unidentifiable rows are counted and returned, never silently dropped: "25 rows
in, 18 companies out" needs the missing seven accounted for.

### Verification

- Typecheck, ESLint and production build clean. **1,229 tests**, 5 new.
- ⚠️ **The migration has NOT been applied.** No database was reachable from
  this session, so `upsert_companies` exists as SQL only and its behaviour is
  unverified against Postgres. `types/database.ts` was hand-extended in the
  generator's own shape so the code compiles; regenerating types after applying
  0065 should produce an identical entry.

### Next

A job type that reports accounts rather than leads, and an upload path that
routes an account list to `ingestAccounts` instead of refusing it — the worker
currently refuses account lists with an accurate message.

---

## 2026-08-28 — Account List: unblocked the build, added page-type routing

### Two failures inherited from the in-flight Account List work

Both after the last unrelated edit, both blocking:

1. **`tsc` failed.** `parse-account-list.ts:118` used
   `cheerio.Cheerio<cheerio.Element>`, but cheerio 1.x no longer exports
   `Element` — that type moved to `domhandler`. Fixed by deriving the type
   from the API itself (`ReturnType<cheerio.CheerioAPI>`) rather than adding a
   dependency on cheerio's internal DOM package to spell one parameter.

2. **A test failed.** `hubble-summarize` required the exact words "with a
   public record"; `HubbleResultPanel` had been reworded to "with public
   evidence". ⚠️ The test's actual subject — coverage stated as a NUMBER
   rather than a wall of "Not found" — was never in question, and its own
   header comment says so. Rewritten to assert the shape (`{summary.withData}
   of` and the `withData + withoutData` denominator) instead of the sentence.
   A copy test that breaks on copy teaches people to edit tests without
   reading them.

### `lib/leads/page-type.ts` (PURE) — the missing router

The parser and its extension adapter existed with **no caller**. The worker had
exactly one parser, so an Account Hub upload reached `parseSearchResults`,
found zero leads and raised `ERR_FILE_FORMAT` — technically correct and the
wrong answer: the file was perfectly valid, we pointed the wrong reader at it.

⚠️ **ACCOUNT LIST IS TESTED FIRST, AND THE ORDER IS LOAD-BEARING.** An Account
Hub row can recommend a *person*, so the page may carry a `person-name` anchor;
a lead search page never carries the account-hub table hooks. The specific test
must precede the general one, or account pages route silently to the lead
parser — the exact bug the module prevents. Pinned by a test using a page with
both anchors.

⚠️ **`unknown` IS A REAL ANSWER.** Defaulting to the lead parser so something
always runs would convert "we cannot tell what this is" into "this is a broken
lead page" — the failure-looks-like-empty trap this codebase keeps re-learning.

Detection is substring-only on `data-*` hooks, never classes or ember ids, per
`SELECTOR_MAP.md`: a detector that drifts is worse than none, because it routes
a good file to the wrong reader.

### Wired into the worker, honestly

`process-job.ts` now routes before parsing. Account lists are **refused with a
message naming what they actually are** rather than called malformed — company
ingestion does not exist yet, so this pipeline still persists leads only. That
refusal is the honest state, and it is a smaller lie than "this page could not
be read".

### Verification

- Typecheck, ESLint and production build clean.
- **1,224 tests passing**, 5 new.

### Next for this feature

Company ingestion: a `companies`-shaped write path, dedupe by
`sales_navigator_url`, and a job type that reports accounts rather than leads.
Until that exists the parser is reachable only from the extension adapter.

---

## 2026-08-28 — Buttons lose the neumorphic halo

`--neo-shadow-chip` carries `-4px -4px 10px rgba(255, 255, 255, 0.72)` — the
upper-left highlight that makes a cream panel look extruded. Applied to a
FILLED control it is not a highlight, it is a halo: the button appears to glow,
and on the charcoal card the white bled around the label.

⚠️ **THE RULE, NOT JUST THE FIX.** A filled button is a solid object sitting ON
the surface, not a piece of the surface pushed up out of it, so it takes an
ordinary drop shadow. Panels keep the paired light. That distinction is what
makes the neumorphism read as *material* rather than as an effect sprayed over
everything — and it is why this was a new `--shadow-button` token rather than
deleting shadows.

Applied across seven files: the featured-card CTA, auth submit buttons, the MFA
challenge, the Lead Engine hero pair, the date-picker chips, and the Hubble
prompt and result controls.

### Verification

- Typecheck, ESLint (0 errors), production build clean, **1,215 tests**.
- Confirmed in-browser: every button resolves to
  `rgba(54, 57, 56, 0.24) 0 2px 6px -1px` or `none`, with **no white glow**;
  `.clay` panels still resolve to the paired
  `rgba(54,57,56,0.13) 9px 9px` / `rgba(255,255,255,0.74) -9px -9px`.

---

## 2026-08-28 — Flat colour by default; one gradient, one meaning

### Gradients were everywhere and all of them were violet

`--grad-band` ran `#34265f → #5e42ad → #8c6bea → #b9a6ff`; the hero aurora used
two violet radial pools; the team beam, the glass card's border and shadows all
carried `rgba(79, 75, 255, …)`. None of those hues exist in the brand.

⚠️ **A GRADIENT NOW MEANS EXACTLY ONE THING: SAGE MEETING BURNT CORAL.**
`--grad-band` is `sage-deep → sage → coral → coral-deep`, and the team beam and
hero aurora use the same two colours. Everywhere else colour is flat, because a
surface carrying data should be one colour and a gradient should carry meaning
rather than decoration.

### The featured card is a colour, not a ramp

`.product-gradient` was a jet ramp. A gradient behind a number makes the digits
sit on two different backgrounds and adds nothing. It is flat now.

⚠️ Worth recording: inside `.product-clay` the card is **coral, not jet** — the
scope override at `globals.css:409` wins. That is deliberate and now documented
in place: the featured card is a call to act on, and jet among cream panels
reads as a hole. Both are flat; neither is a gradient. Without the note, the
jet declaration looks like it applies in-product when it never does.

### Flattened, not recoloured

Three more ramps became single colours because they were shading for its own
sake: the glass surface, the explanatory sidebar wash, and the clay-surface
card.

### Verification

- Typecheck, ESLint (0 errors), production build clean, **1,219 tests**.
- Confirmed in-browser: featured card `backgroundImage: none`, flat
  `rgb(168, 61, 34)`; `--grad-band` resolves to
  `#4f6459 → #778f84 → #d95a3b → #a83d22`.
- `grep` for the violet hexes and `rgba(79, 75, 255` returns **0**.

---

## 2026-08-28 — The whole palette, each colour with a job

### Sage and Lilac finally do something

Coral was carrying the palette alone. Each colour now has one job:

- **Coral** — action: buttons, links, focus-free active states.
- **Sage** — positive: `--success` derives from it.
- **Lilac** — informational: `--info` now derives from it, retiring `#1f5fa8`,
  the last unbranded status colour.
- **Jet / Charcoal** — ink, depth, the darkest surfaces.

⚠️ `--lilac-deep` added for the same reason `--coral-deep` exists: the brand
lilac on cream is nowhere near AA, so the deep variant carries text while the
brand hex stays a surface colour.

`/leadengine` hero cards now take one colour per pipeline stage — Capture
lilac, Research coral, Ask sage — as a tinted ring and step number only. The
card stays clay; the colour is a label, not a fill. Section washes alternate
`lilac-soft` and `sage-soft` instead of two flat neutrals. Minimal clay applied
to the two callout panels.

### Hardcoded colours removed — and some deliberately kept

`DashboardPreview` carried a violet-white chrome bar, three generic macOS
traffic lights and a violet gradient. All now palette.

⚠️ **`HeroWidgets` hex values were left alone on purpose.** `#0066DA`,
`#00AC47`, `#EA4335`, `#FFBA00` and `#F06A6A` are the **Google Drive and Asana
brand marks**. Recolouring a third-party logo to fit our palette makes the logo
wrong. Hardcoded colour is the correct answer there.

### Two corrections

- **The hero widgets were never removed.** `<HeroWidgets />` is still at
  `app/page.tsx:237`; it is gated `hidden xl:block` and the screenshot that
  prompted the concern was taken at 800px. Confirmed present at 1440px:
  sticky note, reminder, pipeline, integrations.
- **`npx skills add Leonxlnx/taste-skill` was blocked** by the permission
  classifier and was not installed. Not worked around.

### Verification

- Typecheck, ESLint (0 errors), production build clean, **1,219 tests**.
- Palette confirmed in-browser: the three hero cards resolve to lilac-deep,
  coral-deep and sage-deep respectively.

---

## 2026-08-28 — Field focus by light; duplicate hero heading removed

### Fields signal focus by depth, not by a border colour

Inputs swapped their border colour on focus — the weakest possible cue on an
already-bordered control, since the only thing that changed was a hue, and it
read as the field having gone *wrong* rather than having been selected.

A shared `.field` surface now applies the same treatment as the micro-analysis
prompt: the surface deepens and lifts, so the field visibly becomes the active
thing. The global `:focus-visible` outline still applies on top, so nothing is
lost for keyboard users.

⚠️ **Two real bugs surfaced in the shared `inputClass` while doing this:**

- `focus:shadow-[0_0_0_3px_rgba(139,92,246,0.12)]` — a hardcoded **violet**
  left over from the retired accent, in three files. Both a wrong brand colour
  and a hardcoded colour CLAUDE.md forbids.
- `placeholder:text-muted/60/60` — a malformed doubled-opacity class that was
  never valid and therefore never applied at all.

Neither was visible from a screenshot; both were found by reading the class
string while migrating it.

### The dashboard badge: removed, not restyled

A decorative ↗ in a 24px circle became the word "Open" in the glyph purge,
which overflowed the circle. ⚠️ The deeper problem was that it **labelled a
control that does not exist** — the badge is `aria-hidden` and the card is not
a link. A card that looks clickable and is not is a worse defect than a symbol
nobody decodes, so the badge is gone rather than reworded.

### Landing hero

`app/page.tsx` carried an `<h1>` and a long paragraph directly above
`HeroHeadline`, which renders **its own `<h1>`** — two competing headings — and
the paragraph restated the concise one below it almost word for word. Removed;
`HeroHeadline` is the hero.

⚠️ **THIS EDITS `app/page.tsx`, WHICH CLAUDE.md RULE 5 MARKS READ-ONLY** and
which was explicitly kept out of scope during the Lead Engine rewrite. Changed
on the owner's direct instruction. **Rule 5 now contradicts the repository and
should either be amended or re-affirmed.**

### Verification

- Typecheck, ESLint (0 errors), production build clean.
- Field focus confirmed in-browser: inset shadow deepens and an outer glow
  appears; no colour swap.
- Hero confirmed: one heading, concise copy.

---

## 2026-08-28 — Chunk overlap fixed; settings split into pages

### The garbled citation

A saved answer read "…here is the evidence I retrieved: 1. gical Principles
Make Educational Content Effective?" — a passage starting mid-word.

The fallback wording itself is **not in the codebase**; that row is stored data
from an older run. But the cause was live: `chunkText` in
`lib/hubble/retrieve.ts` carried overlap between chunks with a bare
`slice(-OVERLAP_CHARS)`, which cuts wherever the character count lands —
usually mid-word. "Psychological" became "gical", and that fragment was quoted
back to the user as evidence.

⚠️ **A citation that begins mid-word reads as corruption and defeats the one
thing citations are for: being checkable.** Overlap now snaps forward to the
next word boundary, losing a few characters of context and nothing that
matters. A single unbroken token is kept whole rather than cut.

Pinned by a test asserting every chunk opens with a whole word from the source.
Folded into the existing `hubble-retrieve.test.ts` rather than adding a second
file for the same module.

### Settings: seven anchors → seven pages

`/dashboard/settings` was one route with seven `#anchor` links. Three problems:

1. The nav had **no affordance** — seven real links rendered as plain body
   text, so it did not read as navigation.
2. **Every visit ran all seven data loads** — MFA factors, subscription,
   devices and three integration lookups — even to change a display name.
3. Nothing was linkable; "open your billing settings" meant the page and a
   scroll.

Now a `layout.tsx` for the shared header, a client `SettingsShell` for the nav
(it needs `usePathname` for the active state, so the layout stays a Server
Component and adds no client JS of its own), and one page per section. Each
loads only its own data.

⚠️ **THE MFA GATE WOULD HAVE BROKEN SILENTLY.** `app/(auth)/mfa/page.tsx`
redirected to `/dashboard/settings?required_mfa=1#security`, and the notice
that reads that flag moved to the security page — so an admin forced to set up
MFA would have landed on Profile with no explanation. Redirect and notice moved
together. Six other stale `settings#…` links across `welcome`, the dashboard,
`ConnectPanel`, `LeadExportMenu`, `ClayLeadExport`, `RowActions` and
`google-repository` were migrated too; none remain.

### Verification

- Typecheck, ESLint (0 errors), production build clean — all seven settings
  routes compile.
- **1,219 tests**, 3 new.
- Confirmed live: the security page loads alone with its nav item marked
  active.

---

## 2026-08-28 — Focus recoloured, chevrons restored, one noun per thing

### The orange focus ring

`:focus-visible` used `outline: 2px solid var(--accent)`, so repointing the
accent to coral turned every focused control orange — a brand colour doing a
job that is not branding.

⚠️ **THE RING WAS RECOLOURED, NOT REMOVED.** Deleting focus indication breaks
keyboard navigation outright (WCAG 2.4.7) and is invisible to the person who
requested it, because a mouse user never sees the thing they would have lost.
Focus now has its own token, `--focus`, set to jet: it reads as system chrome
rather than as an action, and at roughly 14:1 on cream it is **more** visible
than the coral it replaces. Six components carrying `focus:border-accent` were
moved to a neutral border.

### Chevrons back where they belong

The disclosure toggles briefly read "Show" after the glyph purge. That went too
far: a chevron is a universal affordance, unlike `◍` for a website. All three
modal sections now use the same rotating `›`, matching "Saved research".
`Show less` / `Show full value` survive as screen-reader text, where the words
are the point.

### One noun for one thing

The same object was a **run**, an **extraction**, a **job** and a **batch**
depending on the sentence — "Completed runs", "Start another run", "Select a
run" on a page titled *Extraction workspace*. User-facing copy now says
extraction throughout; `job` and `batch` remain as internal identifiers.

### Spelling: checked, and largely a false alarm

A scan for common misspellings found none. The `licence` / `license` pair in
the Lead Engine terms is **correct British usage** — noun and verb respectively
— and consistent with the nine uses of "cancelled". `behavior` appears only as
the CSS property `scroll-behavior`, which must stay American. These were
verified rather than "fixed"; changing correct usage would have been a
regression dressed as a cleanup.

⚠️ One inconsistency is deliberate and left alone: the Hubble headline says
"prospects" while the rest of the product says "leads" (178 uses against 1).
That wording was specifically requested, so it stands — but it is the one place
the vocabulary splits.

### Verification

- Typecheck, ESLint (0 errors), production build clean, **1,216 tests**.
- Focus confirmed in-browser: 2px dark neutral, no accent class on the select.

---

## 2026-08-28 — The modal was hiding data the export already carried

### The LinkedIn bug, and its real cause

`extracted_leads` has **two** profile columns: `linkedin_url` (the public
`/in/` page) and `sales_navigator_url` (migration 0034). `publicProfileUrl()`
in `lib/leads/parse.ts:115` only fills the first when the captured anchor is a
`/in/` path — and a lead captured from Sales Navigator usually is not. So the
URL landed in `sales_navigator_url`, the CSV export carried it (it has columns
for both), and **the modal read only `linkedin_url` and reported "LinkedIn not
available"** for a lead whose link the product was holding all along.

Verified fixed on a real lead: Website, Company page and **Sales Navigator**
now render; LinkedIn profile is correctly absent because that column really is
null for that row.

### Every captured field now reaches the modal

The modal rendered a fixed four rows. Rows are now built from what exists, so
`sales_navigator_url`, `company_url`, `person_blurb`, `tenure_in_role` and
`tenure_in_company` — all captured by the parser, none previously shown —
appear when present and are omitted when not. Captured values live in a
separate "From the saved page" group: they are read off the page rather than
researched, so a missing one is simply absent and must never render as a
"not found".

### Plain text instead of glyphs

Rows carried `◍` for a website, `@` for email, `☎` for phone, `in` for
LinkedIn, `›` as a marker, `✕` for close, `↗` on every metric card. A symbol
earns its place only when its meaning is obvious to everyone; these were
guesses the reader had to decode. Replaced with words — Open, Show, Close,
View. `LinkRow` and `ContactRow` are retired in favour of one `DetailLink`.

### CSV

⚠️ `analysisCsvRows` emitted `min 10 · median 20 · max 300` into a cell. A
middle dot in a spreadsheet is not something anyone can sort, filter or split
on, and it renders differently across locales and fonts. Now comma-separated
words. `toCsv` already writes `N/A` rather than an ambiguous blank.

### Noticed, not fixed

Saved research on one lead contains answers reading "I could not reach the
language model to write this up, so here is the evidence I retrieved: 1. gical
Principles Make Educational Content Effective?" — a truncated fallback stored
as if it were an answer. Worth its own look.

### Verification

- Typecheck, ESLint (0 errors), production build clean, **1,216 tests**.
- Contact rows confirmed in-browser on a live lead.

---

## 2026-08-28 — Jet and ivory adopted; copy and widgets cut back

### The logo's own colours are now the product's

The mark is two colours and nothing else: an ivory disc on a jet field. Neither
existed properly in the CSS — ivory only incidentally as `--cream`, jet not at
all — so the product sat on **pure white** (`--paper`, `--panel`: `#ffffff`)
beside a logo that never uses white. `--jet` and `--ivory` are now named
tokens, and `--cream` derives from ivory.

⚠️ **`.product-gradient` was still a hardcoded purple gradient**
(`#694bc9 → #aa95f5`) — simultaneously a leftover of the retired violet accent
and a hardcoded colour CLAUDE.md forbids. It is now the logo's jet, so the
product's darkest surface is the same dark the mark is drawn on.

### Direct communication, fewer widgets

⚠️ **"Latest run: 25 leads from 1 files."** Counts were always plural. Fixed in
both places (`ExtractionDashboard.tsx:466` and `:560`).

Subtitles that restated their own heading were cut or shortened — a label, not
a sentence:

- Overview: "Your usage, account, and next extraction in one place." → "Usage
  this billing period."
- Workspace: "Follow every file, review the leads kept, and download clean CSV
  files." → "Every run, its files, and the leads kept."
- New extraction: "Upload saved lead-search pages. Processing happens securely
  on Outlio's servers." → "Upload the pages you saved."
- Settings: subtitle removed; the section list beneath it says the same thing.

**The upload page had three sidebar widgets and now has one.** A "before you
upload" guide, a credits explainer and a privacy card sat beside a form whose
dropzone already states the file type, the limit and the credit cost, and whose
consent checkbox already states the privacy position. Three panels restating
the control next to them is noise, and they squeezed the actual form into a
narrow column. The steps survive because they are the one thing the form cannot
say: what to do **before** arriving. The credit rule folds into a single line.

### Cleanup

Removing those widgets left three dead references — a `CreditsSummary` import,
a `hubbleModelStatus` import, and a `planName` prop threaded from the jobs page.
All removed rather than left dangling; the prop removal required updating its
caller.

### Verification

- Typecheck, ESLint (**0 errors, 0 warnings** in the touched paths), production
  build clean.
- No purple remains: `grep 694bc9|8669e7|aa95f5` returns only the comment
  recording its removal.

---

## 2026-08-28 — Brand palette adopted; five materials given one job each

### The palette is now the product's

`--accent` was `#7c5ce7`, a violet absent from the brand palette, consumed by
65 files — and the product scope overrode it to warm graphite, so one class
name meant two colours and the brand stopped at the sign-in door.

Coral, Sage, Lilac and Charcoal are now root tokens. Because those 65 files use
`text-accent` / `bg-accent` rather than raw hex, repointing the token moved
almost all of them with no file edits.

⚠️ **THE BRAND CORAL IS NOT AA FOR BODY TEXT, AND THIS WAS MEASURED, NOT
ASSUMED.** `#D95A3B` renders at **3.8:1**; `--coral-deep` at **6.3:1**. Sage is
the same story: 3.5 vs 6.4. `--accent` therefore points at the DEEP variants,
since it is consumed as prose-link colour across the app. The vivid brand hex
stays reachable as `bg-coral` for buttons, bars and chips, where it sits under
white text rather than under body copy. Pointing `--accent` at the raw brand
hex would have shipped an accessibility regression across 65 files.

`--success` now derives from sage, retiring the unrelated `#16794a`.

### Five materials, one job each

Five visual languages is normally a warning sign. It holds only if each has
exactly one job, so the material becomes a signal rather than decoration:

- **Minimalism** — the default and the majority of every screen.
- **Neumorphism** — panels and cards. Surfaces that HOLD things.
- **Skeuomorphism** — controls. Things you PRESS.
- **Glass** — overlay layers only. Things that float ABOVE content.
- **Maximalism** (`.brand-wash`) — one moment per screen, in empty states and
  heroes, where no data is competing.

⚠️ **Material follows FUNCTION, never importance.** A thing is glass because it
overlays, not because it matters.

⚠️ **Glass is confined to overlays because CLAUDE.md forbids `backdrop-filter`
on dashboard surfaces** — blurring the layer being read costs legibility for
decoration. A scrim is the one case where the blur does the job it exists for.
Flagged to the user rather than silently overridden. There is an opaque
`@supports` fallback so a floating layer never becomes transparent over live
text.

### Applied

- Dashboard and workspace metric cards: flat bordered panels → `.clay`.
- Lead modal scrim → `.glass-overlay`.
- All six `text-muted/NN` modifiers removed from `ExtractionDashboard`; stacked
  opacity had them near 3:1.

### ⚠️ A correction to the audit

The audit called "Credits remaining 0" a live instance of the `?? 0` bug. It is
not. With the fix in place the card still reads 0/0, which means a balance row
**does** exist carrying zero allowance — the displayed number is real data.

The `?? 0` conflation was still a genuine latent bug and is fixed: a missing
balance now renders "—" with "Balance unavailable", not a hard zero. But it
does not explain this screen, and **why the account holds a 0 allowance while
running research successfully is a separate, still-open question.**

### Still outstanding

Native `<select>` / checkbox / file inputs; settings-nav affordance;
neumorphic pass over upload, settings, access and qualification;
`.glass-popover` not yet applied to dropdowns; `.brand-wash` not yet applied to
empty states; the 5-card orphan grid; the duplicated credits card.

### Verification

- Typecheck, ESLint (0 errors), production build clean, **1,216 tests**.
- Contrast measured in-browser for coral, coral-deep, sage, sage-deep.

---

## 2026-08-28 — Correcting the neumorphism, and unhiding saved research

### The surfaces were not neumorphic

Two concrete defects, both measured:

1. **The controls did not share the page's colour.** `.hubble-filter-control`
   carried `--clay-surface` (#fff8ea) on a `--clay-bg` (#fffaf0) page. That
   single fact makes an object sitting ON a background — the one thing
   neumorphism is not. The shadow pair only reads as material pushed UP OUT OF
   a surface when the surface is the same colour.
2. **The light source was incoherent.** Shadows were `9px 10px` dark against
   `-8px -8px` light, blurs 22 and 20. Unequal offsets describe two different
   lamps, so the eye cannot locate the light and the result reads as a soft
   card. Every pair is now an exact mirror.

⚠️ **`.hubble-filter-scope` and `.hubble-filter-date` were silently undoing the
fix.** They re-declared `--clay-surface` later in the file and won on source
order — the first attempt appeared to change nothing, and only a computed-style
check caught it. Verified after: control and page both `rgb(255, 250, 240)`.

**User-optimised, not purist.** Neumorphism is fairly criticised for hiding
affordance — borderless, low contrast, nothing announcing "control". The answer
here is not to add a border back but to make the material behave: pressed and
open states sink into the page via `--neo-shadow-inset`, which is the one
motion a raised surface can make. The focus ring stays.

### Saved research was unreadable

The section cut values off with **no way to see the rest** — facts `truncate`,
answers `line-clamp-3`, no control and no indication more existed. A value the
user paid to research was silently unreachable.

Long values now expand behind a rotating chevron. The toggle appears only when
the text is actually long enough to clip, so short facts do not carry a control
that does nothing. Length-based rather than measured, so it cannot disagree
with itself between renders.

Confirmed live: `aria-expanded` and the clamp class toggle together; short
values (`HQ`, `Employees`) render in full with no chevron.

### Wording

- Headline → "Data analysis at the micro and macro scale, across all
  prospects." `analyses` is the plural of a countable analysis; the mass noun
  is what was meant, and mid-sentence Capitals were inconsistent.
- "Saved details" → **"Saved research"**, matching what the section holds, with
  "nothing saved yet" as its empty state.
- `columnLabel` fallback is now capitalised. Mapped labels read "Website" and
  "Employees" while unmapped ones fell through as "tech stack" — one list
  mixing two capitalisation styles looked unfinished.

### Verification

- Typecheck, ESLint (0 errors), production build clean, **1,216 tests**.
- Computed-style checks for the surface match and the mirrored shadows.
- ⚠️ Two earlier readings of mine were wrong and the code was right: a contrast
  script mis-parsed `color(srgb …)` (channels are 0–1, not 0–255), and a toggle
  check read the DOM before React re-rendered. Both re-measured.

---

## 2026-08-28 — Intelligence page: minimalist analytics surface

### Legibility

`--muted` was `#696962` on ivory — roughly **5:1**, technically AA but thin at
the 11–12px this page runs on. Worse, `HubbleLeadList` layered opacity on top
(`text-muted/75`, `/70`, `/60`), dropping four strings to roughly **3–3.5:1**,
below AA at any size.

Fixed at the **scope, not the page**: `--muted: #55554d` (~7:1) inside
`.app-shell`, so every authenticated surface moves together and this screen
cannot drift into its own grey. All four opacity modifiers removed — darkening
a token achieves nothing if an opacity is layered over it.

Confirmed live: a muted label computes to `rgb(85, 85, 77)`.

### Chips

Now `.skeuo-key` + `.skeuo-key-interactive`, the same material as the micro
modal's starters, so both prompt surfaces read as one product.

⚠️ **One line is enforced structurally**, not by hoping the copy stays short:
`flex-nowrap` + `whitespace-nowrap`, with `overflow-x-auto` as the containment
if it ever overflows. Copy can no longer reflow the row and shift the page.
Suggestions shortened to `Recent Series A` / `Who uses HubSpot?` /
`SaaS hiring SDRs`. Verified at 1280 and 768: **one row, no scroll**.

### Text compacted

Labels, not sentences: "Not researched yet — open this lead to ask Hubble" →
"Not researched"; "Research saved · details need confirmation" → "Saved ·
unconfirmed"; three empty hints cut to one clause each; busy states to
"Planning…" / "Searching sources…".

⚠️ **Distinctions preserved.** `unknown`, `unconfirmed` and `not researched`
stay three different words. Collapsing them is exactly how "failure looks like
empty" returns, which this codebase has hit repeatedly.

### Analytics features

- **Drill-down** — distribution bars are buttons; clicking one filters the lead
  list, with a dismissible chip showing `n of total`. Required carrying
  `field` on `HubbleSavedDetail`, which `savedDetailsFor` already had and
  discarded. It filters the VIEW only: no re-query, no re-research.
- **Data completeness** — `coverageOf`, ranked **thinnest first**. Best-first
  would be a reassurance exercise; the useful question is what the analysis is
  weakest on, because that is what a reader over-trusts.
- **Analysis CSV** — reuses `toCsv`/`sanitizeCell` from `lib/export/sanitize.ts`,
  the shared formula-injection defence. No second CSV writer.
- ⚠️ **Compare two batches: NOT DONE.** `compareAnalyses` is written and tested,
  including the coverage guard, but the UI is not wired. It needs the page's
  main lead loader (~130 lines carrying caching, request-race guards and an
  enrichment-column fallback) extracted into a reusable fetcher, and that
  refactor touches the most critical query on the page. Left unstarted rather
  than half-built.

⚠️ **The comparison suppresses its own deltas.** If a field is known for 90% of
one list and 20% of the other, "B is 30% less software" describes what we
failed to find, not the companies. On screen that is indistinguishable from a
real difference, so the subtraction is withheld rather than annotated — a
caveat under a big number does not stop anyone believing the number. Shares are
still shown; only the delta is withheld.

### Follow-ups closed

- **`IntelligenceConsole.tsx` deleted** — 909 lines imported by nothing.
  Re-checked for references immediately before removing.
- **Selected-option colour** was solid `--hubble-coral` (#D95A3B) behind text:
  the heaviest element on an otherwise cream page, and ink on it measured about
  4.7:1 — legal and muddy. Now a 16% tint of the same coral with the identity
  carried by a ring instead of the fill. Measured **14.3:1**.
  ⚠️ Scoped to `.hubble-selected-option` only; `.hubble-send-action` and
  `.hubble-primary-action` keep full coral, because a deliberate action should
  still be the loudest thing on the page.
- **`ContactResults` deliberately kept.** It now fires only for runs created
  before the macro/micro boundary. Hiding contact data a user already paid for
  would be retroactively destructive.

### Verification

- Typecheck, ESLint (0 errors), production build clean.
- **1,216 unit tests**, 6 new: coverage ranking, the half-coverage boundary,
  share deltas, delta suppression, field intersection, CSV shape.
- Live: chips one row at two widths, `--muted` confirmed at `#55554d`.
- ⚠️ Drill-down and the CSV button are **not click-verified**. Both need a
  completed macro run on screen, and re-running would spend another credit
  beyond the one already authorised.

---

## 2026-08-28 — Macro and micro are now different products

### The distinction

**Micro** answers "who is this person and how do I reach them?" — one lead,
opened deliberately. It is the ONLY place individual access details are ever
researched or shown.

**Macro** answers "what is true of this set?" — distributions, concentration,
coverage. ⚠️ **Its answer is the analysis.** A macro run that hands back a pile
of individual leads has not answered a macro question; it has done micro many
times and left the synthesis to the reader.

### `lib/intelligence/analysis-scope.ts` (PURE) — the boundary

Five fields are micro-only: `work_email`, `email_status`, `mobile_phone`,
`phone_status`, `person_social_profiles`.

⚠️ **`person_seniority` and `person_department` are deliberately NOT blocked.**
They describe a role, not a way to reach somebody, and "what is the seniority
mix of this set?" is one of the most useful macro questions available. Blocking
every person field would have weakened macro while protecting nothing.

The gate **refuses rather than silently dropping**. A run that returns 59
columns when 60 were asked for teaches the user the product drops things at
random; a refusal naming the column, and where to get it, teaches them how the
product works. A MIXED request is refused whole for the same reason.

### Where it is enforced

Not in the UI — the plan is built server-side, so hiding a button would stop
nothing. `planQuery` is now unconditionally macro (its only caller is the
set-wide query route; the micro path is `lib/hubble/ask.ts`).

`deterministicEmailPlan` and `deterministicPhonePlan` are no longer plan
producers. They are the most precise contact-request detectors in the codebase,
so they now **power the refusal** — which is why the message names the exact
field asked for. Gating only the LLM path would have left the two fastest
routes to bulk contact harvesting open; the model's own plan is gated too,
because a model asked to "profile these accounts" can still put `work_email` in
`requiredFields`.

A `scope` parameter was written and then removed: no caller would have passed
`micro`, making it a speculative option CLAUDE.md forbids.

### `lib/intelligence/aggregate.ts` (PURE) — the macro answer

`analyseRun` turns rows into distributions, numeric summaries and headlines,
ranked so the most concentrated finding leads.

⚠️ **Coverage is reported as loudly as the finding.** "68% are software" means
something different over 900 of 1,000 leads than over 40, and the two render
identically unless something says so — every breakdown carries its base, and a
field known for under half the set is called out as thin evidence in warning
tone.

⚠️ **No headline is model-written.** Every sentence is a restatement of a count
computed here. A claim about a customer's data that cannot be traced to a
number is the fabrication rule 4 forbids.

The module is structurally typed rather than importing `ResultRow`: the server
row and client row are different shapes, and a pure aggregator should need only
what it reads.

### UI

The analysis panel leads; the per-lead table stays beneath it because export
and merge-to-lead read from those rows. They are evidence for the answer, not
the answer.

### Verification

- Typecheck, ESLint (0 errors) and production build clean.
- **1,210 unit tests passing**, 18 new.
- Five existing planner tests asserted the OLD contract — that a set-wide
  question could plan contact discovery. Rewritten as refusals rather than
  deleted, preserving their original intent, plus a new test that macro can
  still research `person_seniority`, so the boundary cannot silently become
  "macro cannot research people at all".
- Gate confirmed live: `POST /api/intelligence/query` with a set-wide phone
  request returns **422 refused**, before anything is spent.
- **Confirmed on a real run** (25 leads, 1 credit, authorised): the panel
  rendered "industry is spread across 10 values, the largest being Software
  Development at 20% (15 of 25 known)" with the base shown beside the
  breakdown. The model-written summary independently said "9 of the 15
  companies" — the prose and the arithmetic agreed on the same denominator.

### ⚠️ A mistake caught before it shipped

`components/intelligence/IntelligenceConsole.tsx` (854 lines) is **imported by
nothing**. The macro surface is `HubbleConsole` → `HubbleResultPanel`.

Both the macro analysis panel AND the confidence/corroboration indicator from
the earlier phase had been added to that unmounted file, so neither had ever
rendered and the "verified by build and types" claim covered code no user could
reach. Both are now in `HubbleResultPanel`, removed from the dead file, and the
analysis has been seen working. **The dead file itself is left in place — a
854-line deletion is a separate decision.**

---

## 2026-08-28 — Phase 6: confidence and corroboration reach the screen

### Computed, then thrown away

Phase 4 built an engine that scores agreement and dissent. `results.ts` then
dropped both at the boundary: `ResultCell` carried `value`, `sourceUrl` and
`sourceProvider` and nothing else. So a cell backed by **three independent
providers rendered identically to one scraped from a single weak page**, and
every cell implicitly claimed equal footing. The same was true of the
`identityConfidence` Phase 2 writes onto evidence — computed, stored, never
shown. Verified before starting: a grep for `corroborating` and
`identityConfidence` outside the two modules that produce them returned
nothing.

### Carried through

`ResultCell.known` now also carries `confidence`, `corroboratingProviders` and
`conflictingProviders`. The provider lists are **deduplicated by name**, which
is the same rule the confidence engine scores by — one provider is one source
however many rows it filed. The arrays are `readonly`: they are projections for
display, and nothing downstream should be editing them.

`app/api/intelligence/runs/[id]/route.ts` returns the results object wholesale,
so no serialization change was needed — checked rather than assumed.

### The indicator is silent on the ordinary case

Most cells come from one provider. Stamping "1 source" on every one of them is
noise that trains people to stop reading, so the indicator speaks only for the
two states that change a decision: independent agreement, and disagreement.

**Disagreement is deliberately louder than agreement** — warning-toned, and
checked first. A seller who emails a contested address wastes the lead; one who
skips a corroborated address loses nothing. Confidence and the contributing
provider names sit in the `title`, so the detail is available without putting a
percentage on every cell.

Colours come from the existing `--success` / `--warning` theme tokens. No
hardcoded colour, no entrance animation on the table.

### Verification

- TypeScript clean; production build clean; **1,186 unit tests passing**.
- ESLint `lib app components tests`: **0 errors**, 7 warnings, all in files this
  phase did not touch (`VideoShowcase`, `layout`, `Avatar`, `evidence-store`).
  The earlier "5 warnings" figure covered a narrower path list, not a
  regression.
- One test assertion of mine was wrong and the code was right: it expected
  corroboration to raise the score while ignoring a dissenter deliberately
  placed in the same fixture. Rewritten to compare against the identical set
  with the dissenter removed, so it cannot pass by accident.
- ⚠️ **NOT visually verified.** The results table sits behind authentication and
  needs a completed run carrying corroborated evidence; there is no React
  component test setup in this repo (`jsdom` is present but the vitest
  environment is `node` and there is no `@testing-library/react`). The data
  path is covered by type checking, the production build, and a boundary test
  asserting the exact shape the table consumes — but nobody has seen it render.

---

## 2026-08-28 — Phone-only Intelligence requests no longer depend on an LLM

The macro Intelligence query shown in the UI — `give me phone numbers of all`
— failed before any search ran because the planner had deterministic rules for
funding and work-email questions but none for phone retrieval. A hosted planner
outage therefore turned an unambiguous one-field request into `The planner was
unavailable.`

An explicit phone-retrieval rule now produces a people-scoped plan containing
only `mobile_phone`. It adds `phone_status` only when the user explicitly asks
for verification, and mixed questions such as phone plus industry still go to
the model rather than being partially interpreted. The rule runs before the LLM
router, so the exact all-leads request queues contact research even when every
model provider is offline.

Verification: all 26 planner tests pass, including offline phone-only,
verification-status, and mixed-research boundaries. Root TypeScript and
changed-file ESLint are clean. The local MCP remains healthy.

---

## 2026-08-28 — Public phone retrieval: provider diagnosis and SearXNG coverage

A live Google CSE request returned HTTP 403 with `PERMISSION_DENIED`: the new
project does not have access to Custom Search JSON API. Google now documents
that API as closed to new customers, so possessing a key and search-engine ID
does not make the adapter usable. The email observed in Hubble was therefore
coming from another provider or cache; Google contributed no results.

The local SearXNG service was healthy but its default general-engine selection
returned zero results because its upstreams were challenged or rate-limited.
An explicit zero-charge `yandex,bing,yep` selection returned a relevant public
directory result with person, employer, and phone signals. The MCP now sends a
configurable `SEARXNG_ENGINES` list on every request, and Docker defaults it to
that working set. Refusals still fail closed and no CAPTCHA bypass was added.

Both contact query generators now lead phone research with the successful
manual pattern — company domain, person name, `phone number` — before WhatsApp,
official-site, and contact-page variants. Fabricated regression cases prove a
public Mexican business number survives snippet attribution and is normalized
to E.164 in the main Intelligence provider.

Verification: the full application suite passes 1,250 tests with 24 live-only
tests skipped, and all 31 MCP tests pass. Both TypeScript projects are clean and
the MCP production build succeeds. The stateless MCP container was rebuilt in
place with its existing database and authentication preserved. A live
authenticated `research_lead` smoke returned six search results and one typed
`person.phones` fact with `publicly_found` status after a single query.

---

## 2026-08-28 — Paddle-free pricing no longer opens the Next.js error overlay

The pricing route already caught missing Paddle configuration and rendered its
safe sign-up fallback, but it passed the caught `Error` to `console.error`.
Next.js development mode promotes that call into the full-screen error overlay,
making the handled condition look like a route crash. The route now records the
non-secret configuration reason with `console.warn`, preserving the diagnostic
without obscuring the fallback pricing page. Paddle configuration remains strict
when checkout is actually enabled; no fake credentials or billing defaults were
introduced.

---

## 2026-08-28 — Phase 5: the location signal, made live

### A column that existed and was never read

`extracted_leads.location` has been in the schema since migration 0006, and
`lib/leads/parse.ts` has populated it from `span[data-anonymize="location"]`
since the first parser. But `PersonEntity` never carried it, so the field went
from the saved page into the database and stopped there. Phase 2 built a
resolver that scores a location signal; nothing could supply one.

### Wired end to end

- `PersonEntity` gains `location`, documented as an identity signal rather than
  display data.
- `run.ts` selects and populates it (the `select()` list was the reason it was
  missing — the column was simply never asked for).
- `identitySubject()` spends it, so **every** provider that resolves identity
  through the shared mapper gets it at once.
- Hubble's cited-contact path threads it too: the route already loaded
  `lead.location` for the model's context block, so `AskSubject` and
  `CitedContactSubject` now carry `personLocation` through to the resolver.
- `IdentitySubject.location` is no longer optional. The Phase 2 comment saying
  "PersonEntity does not carry one today" is obsolete and was removed rather
  than left to mislead.

### It changes outcomes, and that is what the test asserts

Plumbing a value through is not the same as it doing anything. A scattered name
plus an employer NAME scores just under the match threshold; the lead's captured
city is what settles it. The test asserts the same observation resolves `weak`
without the location and `match` with it — so the wiring cannot silently rot
into a no-op.

The invariant still holds: a location can never carry a match on its own,
because it is not a distinguishing signal. Separately test-pinned.

### The type system found the work

Making `location` required produced **ten** compile errors — every site that
constructs a `PersonEntity`. That is the intended behaviour of a required
field: it enumerated the call sites instead of letting a silent `undefined`
spread. Two of my first fixture edits landed on the wrong object (an
`McpResearchLead`, and an `IdentitySubject` that already declared a location);
`tsc` caught both.

### Verification

- TypeScript clean; production build clean.
- ESLint across `lib app tests`: **0 errors**, 5 warnings — all pre-existing
  (`app/layout.tsx` GTM hint, and an unused `Json` import in
  `evidence-store.ts` that belongs to uncommitted work predating this session).
- Unit suite: **83 files / 1,179 tests, 1,178 passing.** 2 new.
- ⚠️ Same pre-existing unrelated failure (`tests/unit/hubble-mcp-research.test.ts`).

---

## 2026-08-28 — Phase 4: the confidence engine

### What was being thrown away

`resolveConflict()` already picked a winner well — source tier, then
confidence, then recency — and already excluded agreeing records from
`conflicting`, so it was sounder than expected. But those agreeing records were
computed, filtered out, and then **discarded**. Nothing anywhere recorded that
three independent providers had reached the same value, and the winner's
confidence was identical whether one source said it or five.

Corroboration is the cheapest signal in the system and we were deleting it.

### Built — `scoreConfidence()` in `lib/intelligence/evidence.ts` (PURE)

`FieldKnowledge.known` gains two fields:

- `corroborating` — fresh records from OTHER providers that reached the same
  value, no longer discarded.
- `confidence` — the confidence of the **answer**, which is not the confidence
  of the winning record. Kept separate from `record.confidence` deliberately:
  that number is what the provider claimed, and rewriting it would misreport
  the provider.

Winner selection is untouched. This phase only changes how sure we say we are.

### ⚠️ Independence is by PROVIDER, not by record

The same provider returning the same value on two URLs is **one source
agreeing with itself**. A systematic error in that provider produces both rows,
so counting them twice manufactures confidence out of a single point of
failure. Only a provider the winner did not come from can corroborate it — and
the mirror case holds too: a "dissenter" that is the winner's own provider is
ignored rather than treated as doubt.

Three further rules, each test-pinned:

- **Diminishing returns.** Each independent corroborator closes 30% of the gap
  to the ceiling, so the second source is worth far more than the fifth.
- **Certainty is never reached** (ceiling 0.97). A cell reading 100% invites a
  trust that web research cannot support.
- **Dissent scales by the STRONGEST dissenter, not the count.** One
  authoritative source saying otherwise is the alarming case; five weak
  scrapers repeating each other are not five times the doubt. Floored at 0.05 —
  contested evidence is still evidence, and a haircut must never read as
  "nothing found".

### Verification

- TypeScript clean; ESLint clean; production build clean.
- Full suite incl. integration: **1,239 passing, 24 skipped, 1 failing.**
  13 new confidence tests.
- Three existing test helpers constructed `FieldKnowledge` literals and needed
  the two new fields — a compile error, caught by `tsc`, not a behaviour change.
- ⚠️ Same pre-existing unrelated failure (`tests/unit/hubble-mcp-research.test.ts`,
  "calls the stateless tool with hard no-charge limits"), re-confirmed
  unchanged after this phase.

---

## 2026-08-28 — Phase 3: Cloudflare email decoding

### The silent recall loss

Scout reads company `/contact` and `/about` pages — the pages most likely to
carry a real published address, and also the pages most likely to have
Cloudflare's "Email Address Obfuscation" switched on. Those addresses arrive as

    <a class="__cf_email__" data-cfemail="a1c4d9…">[email protected]</a>

and we returned **nothing**. Not an error — an empty result, which is the worse
failure, because nothing anywhere says a fact was lost.

### Why this is not a rule-1 or rule-4 problem

Recorded here because the feature sits next to two hard rules and the reasoning
should not have to be reconstructed later:

- **Not rule 1.** Cloudflare ships a script that decodes this in every
  visitor's browser automatically. The address is public, the scramble is a
  speed bump for naive harvesters, and the same bytes are served to every
  client. Rule 1 forbids evading systems that decide **whether to serve us** —
  CAPTCHAs, bot detection, anti-detection measures. This decodes what was
  **already served**. Nothing here disguises who is asking.
- **Not rule 4.** The address is deterministically recovered from bytes
  literally present in the response. Nothing is inferred, guessed, or assembled
  from a person's name.

### Built — `lib/hubble/extract/cfemail.ts` (PURE)

`decodeCfEmail()` (the `data-cfemail` payload) and `decodeCfEmailHref()`
(Cloudflare's rewritten `mailto:` link — the same fact in a second shape). The
scheme: hex, first byte is an XOR key, remaining bytes are the address.

**It refuses rather than salvages.** Every decoded byte must land in printable
ASCII and the result must have the shape of an address, or it returns `null`.
A wrong key produces control characters; decoding those into a "best effort"
address would manufacture a contact, which is exactly the rule-4 failure. Odd
lengths, non-hex, and absurdly long payloads are all refused too.

### ⚠️ The ordering is the entire point

The decode runs **before the strip pass**, for the same reason JSON-LD does. A
company contact address most often sits in the `<footer>` — and `<footer>` is
the third thing `STRIP` removes. Decoding afterwards would find nothing on
precisely the pages this exists to rescue.

That is pinned by a test, and the test was **mutation-checked**: moving the
decode after `STRIP` fails exactly that one test and no other. It has teeth.

The matched node's text is also replaced with the decoded address, so the
literal placeholder `[email protected]` never reaches the model as the page's
own words. Safe to mutate — the tree is read for text and discarded, never
rendered (rule 3).

### Verification

- TypeScript clean; ESLint clean on changed files; production build clean.
- Unit suite: **82 files / 1,164 tests, 1,163 passing.** 22 new.
- ⚠️ Same pre-existing unrelated failure (`tests/unit/hubble-mcp-research.test.ts`).

---

## 2026-08-28 — Phase 2: identity resolution, shared and scored

### The failure this closes

A search for `"James Smith" email` returns a real, published, correct address
belonging to a **different James Smith**. Filed against the lead it is
indistinguishable from a genuine find: it has a source URL, it passes every
format check, and it goes out to a CRM and gets emailed. A wrong contact is
worse than a missing one, because a missing one is visibly missing.

Before this phase, the only defence was `mentionsIdentity()` — a private
boolean inside `search-contact.ts`. **Exactly one provider in the product asked
whether a result was about the right person.** Every other one either
re-invented the check or skipped it.

### Built — `lib/intelligence/identity.ts` (PURE)

`resolveIdentity(subject, observation)` returns a verdict
(`match` / `weak` / `no_match`), a 0–1 score, and the named signals that
produced it. Signals: LinkedIn URL, exact name, name tokens, employer domain,
employer name, job title, location.

⚠️ **THE INVARIANT: a name alone can never produce a match.** A candidate must
carry at least one DISTINGUISHING signal — LinkedIn URL, employer domain, or
employer name. This is enforced as an explicit rule *after* the arithmetic, not
left to the weights, so tuning a weight upward can never quietly promote a
namesake. Asserted by test.

Two decisions worth recording:

- **A LinkedIn profile URL is decisive both ways.** Equality is an immediate
  match. Two DIFFERENT profile URLs are an immediate REFUSAL even when name and
  employer agree — it is the one case where we can be certain two records are
  different people, and saying so outweighs any amount of name agreement.
  Recorded and compared, never fetched (rules 1–2).
- **Job title and location can never carry a match on their own.** They are
  shared by thousands of people; piling them up must not substitute for knowing
  where someone works. Name + title + location scores `weak` and is refused.

`bestIdentityMatch` takes the strongest of several observations but cannot
launder two namesake pages into a match, because neither is distinguishing.

### Wired in

`search-contact.ts` now delegates to the resolver, and the identity score is
carried through to storage:

- **Confidence is capped by identity certainty** — a perfect address on the
  company's own site is only as trustworthy as our belief that the page is
  about this employee rather than their namesake.
- Stored evidence carries `identityConfidence`, so a wrong contact can be
  traced to the decision that accepted it rather than guessed about later.
- Hubble's cited-contact promotion (`lib/hubble/contact-evidence.ts`) inherits
  the gate for free, since it extracts through the same functions.

Every pre-existing contact test passed untouched, which is the behaviour
contract holding rather than a formality.

### One deliberate behaviour, recorded rather than left implicit

A name-only page carrying an address **at the employer's domain** is accepted:
the address itself names the employer, and that is what distinguishes her from
her namesakes. It is the one place identity is established partly from the value
being extracted. Bounded by the existing rules that the mailbox domain must be
the employer's and the local part must match the person's name. Test-asserted in
both directions — the same page with a third-party address is refused, and the
same page offering only a PHONE number (which carries no employer) is refused.

### Verification

- TypeScript clean; ESLint clean on changed files; Next.js 16 production build
  clean.
- Unit suite: **81 files / 1,142 tests, 1,141 passing.** 26 new identity tests.
- ⚠️ The one failure (`tests/unit/hubble-mcp-research.test.ts`) remains
  pre-existing and unrelated — untracked work in progress that imports nothing
  either phase touched.

---

## 2026-08-28 — Phase 1: one SERP service for the whole product

### Repositories analysed BEFORE any integration

The six proposed B2B enrichment repositories were assessed and written up in
`docs/ENRICHMENT_REPO_ASSESSMENT.md`. **Two techniques adopted, four
repositories rejected in full.** Three were rejected on licensing or substance
(no license at all, or a paid closed database behind a config file); one solves
lead discovery by geolocation, which this product does not do. The adopted
items are the Cloudflare `data-cfemail` decode (a real recall gap in Scout) and
a keyless uncapped SERP tier. No Playwright, no Python service, no new vendor.

⚠️ The brief asked for pattern-generated emails stored and "marked as
predicted". NOT IMPLEMENTED — hard rule 4 forbids fabricated lead data, and a
label does not make a guess an observation. Lifting that rule is a product
decision; it is recorded as open in the assessment.

### The gap this phase closed

Search was scattered across five call sites that each reached for an engine
directly: Hubble's answer path, funding, web research, company profiles, and
contact discovery. Nothing was shared — not ordering, not a cache, not the
quota. A single research run over 25 leads at 6 companies could spend a dozen
of the day's **100 free Google queries re-asking one company question**, and an
exhausted tier came back as an empty result set indistinguishable from a
company nobody has written about.

### Built — `lib/search/`

- **`query.ts` (pure)** — normalization, cache keying, phrasing deduplication,
  domain filtering, preferred-domain ranking, URL-keyed merging. Cache keys are
  case-insensitive but preserve `site:`/`filetype:` operators and include limit
  and time range, so a 10-result answer cannot serve a 20-result question.
- **`serp.ts`** — the service. Postgres result cache (`provider_cache`,
  7-day TTL for hits, **6-hour TTL for empty results** so one outage does not
  become a week of confident wrong answers), an in-flight map that collapses
  CONCURRENT identical queries into one request, the circuit breaker, and the
  waterfall. Never throws.
- **`budget.ts`** — per-engine daily budgets counted through the existing
  atomic `consume_rate_limit`, so exhaustion is a known state rather than a
  silent empty. ⚠️ Failure direction depends on cost: an unreachable counter
  DENIES a metered engine and ALLOWS a free one.
- **`engines.ts`** — Solr → web-research MCP → Google CSE → Brave → Mojeek →
  Tavily. The duplicate Google CSE implementation (one in Hubble, one in
  intelligence, with different caps) is gone; there is one.

Mojeek is the adopted keyless tier and is **off unless `SERP_KEYLESS_FALLBACK=true`**:
honest User-Agent, paced at 2s, and a block is recorded as zero results. It
sits above Tavily so an uncapped free index is exhausted before a metered
vendor is billed.

### 🔴 A vendor name was gating three whole categories

`google-funding`, `google-web` and `google-company-profile` gated on
`hasGoogleCseCredentials()`. A deployment with a Brave key and no Google key
therefore had **no funding research, no web research and no search-derived
company profiles** — three categories dark because of a check that named a
vendor, which `lib/intelligence/types.ts` rule 1 exists to forbid. Renamed to
`search-funding`, `search-web`, `search-company-profile`, all gating on
`hasWebSearch()`. Contact discovery's hand-rolled MCP-then-Google fallback loop
was deleted in favour of the shared service.

`lib/hubble/providers/search.ts` is now a re-export shim so existing imports
keep working.

### Verification

- TypeScript: clean. ESLint on every changed file: clean.
- Unit suite: **80 files / 1,116 tests, 1,115 passing**. 26 new SERP tests.
- ⚠️ One failure, `tests/unit/hubble-mcp-research.test.ts`, is **pre-existing
  and unrelated** — the file is untracked work in progress and imports nothing
  this phase touched.
- Next.js 16 production build: **clean**.
- Disk: **resolved 2026-08-28.** Space was reclaimed and a cold build now has
  room. Measured properly on a from-scratch build: it consumes **~2.5 GB of
  transient space**, not the ~1 GB first estimated here — that earlier figure
  was inferred from a partial build and understated the requirement. The
  finished `.next` is ~390 MB; the rest is build scratch that is released.

---

## 2026-08-28 — Contact Intelligence v2 and local no-charge semantics

Hubble's free contact path now uses a bounded query ladder instead of one
email/phone search. Contact tasks receive up to eight targeted searches and
four reserved first-party follow-ups; the MCP follows relevant team, about,
leadership, contact, and person-path links on the verified company domain. The
parser now extracts ordinary and obfuscated addresses, `mailto:`, `tel:`,
JSON-LD contacts, international phones, and public social-profile URLs before
any model call. Identity association tolerates omitted middle names and
captured surname initials while continuing to require employer evidence.
Independent hosts that publish the same contact increase its confidence and
their source inventory persists with the typed evidence.

Docker Compose now includes a private SearXNG service with JSON search enabled,
making the documented primary live-search provider part of the actual local
stack. DuckDuckGo HTML remains the lawful fail-closed fallback. The semantic
extractor is now a local-first waterfall: schema-constrained Ollama runs before
optional Gemini, and deterministic code-only extraction remains available when
neither model is configured. Contacts are still never invented by a model and
never upgraded from `publicly_found` to `verified` merely because they appear
in search results.

Verification: root TypeScript and changed-file ESLint are clean; the complete
application suite passes **90 files / 1,244 tests**, with 8 live-only files / 24
tests skipped. The standalone MCP passes **29 tests**, its TypeScript production
build is clean, and Docker Compose configuration validates with generated test
secrets. The local machine currently has neither an MCP `.env` file nor Ollama
installed, so the updated containers were not restarted over the user's
existing unhealthy MCP container; exact setup steps are documented in the MCP
README.

---

## 2026-08-27 — Hubble findings persist into compact lead cards

The Hubble lead modal now reads all three existing persistence layers rather
than treating an answer as temporary UI: core contact columns on the extracted
lead, current typed facts in `research_evidence`, and the five most recent
`hubble_answers`. Website, email, phone, and LinkedIn remain immediately visible.
Every other saved fact and answer sits behind one compact “More saved details”
native disclosure with an internal scroll ceiling, so the modal stays short
until the user asks for depth.

Ask Hubble now promotes literal emails and international phone numbers from its
exact cited passages into typed person evidence before returning the answer.
The model's prose is never parsed for persistence. Existing identity, employer,
generic-mailbox, phone-validity, provenance, TTL, and `publicly_found` gates all
run before a contact reaches the card. A forced card refresh after an answer
therefore shows a newly supported contact immediately while unsourced or
model-only text remains only in the saved answer history.

The earlier repository set remains an architecture input, not a replacement
search source: SearXNG stays primary, DuckDuckGo HTML stays the adaptive
fallback, Agent-Reach/MindSearch patterns inform routing and planning, and the
storage indexes remain downstream retrieval options. Focused Hubble/contact
suite: **13 files / 154 tests passing**. Full suite: **86 files / 1,152 tests passing**, with 8
live-only files / 24 tests skipped. TypeScript, changed-file ESLint, and the
Next.js 16 production build are clean.

---

## 2026-08-27 — RAG and contact-integrity audit

Hubble's RAG path is now explicitly connected to both evidence stores. Cleaned
MCP documents continue to persist as `hubble_pages`/`hubble_chunks`; sourced,
fresh typed facts from `research_evidence` now become citation-ready retrieval
chunks too. This lets an email, phone, social profile, funding fact, or other
provider result answer a later Hubble question without another web search.
Person-answer cache lookups are now scoped by lead as well as company, removing
the possibility of serving one employee's cached answer for another employee at
the same business.

The live corpus audit found **72 pages, 632 page chunks, 275 stored embeddings,
30 answers, and 1,760 typed evidence rows**. RAG remains operational in lexical
BM25 mode when vectors are unavailable. The configured Ollama endpoint was not
reachable from this environment, so current retrieval is not fully hybrid; this
is an explicit degraded mode rather than a hidden failure.

Contact correctness was tightened after the audit found that an on-domain
generic inbox could previously become a person's email. `sales@`, `info@`, and
other shared mailboxes now remain company/page evidence; only a public mailbox
whose local part matches the lead's name can be filed for the person. Published
contacts use `publicly_found`; only non-catch-all SMTP acceptance can use
`verified`. International public phone numbers are structurally validated and
stored in E.164 format. Focused RAG/contact tests: **90 passing**. Full suite:
**85 files / 1,150 tests passing**, with 8 live-only files / 24 tests skipped.
TypeScript, changed-file ESLint, and the Next.js 16 production build are clean.
Two malformed untracked Next files discovered by the build audit were
corrected: the 404 is now a valid App Router component, and the deprecated
duplicate `middleware.ts` was removed in favor of the existing Next 16
`proxy.ts`.

---

## 2026-08-27 — Public contact search now mirrors successful manual queries

Lead contact enrichment now searches the way a successful manual lookup does:
`person name + employer domain + email/phone` first, followed by a stricter
official-site query. The web-research MCP extracts emails and phones from both
search snippets and fetched public pages before any LLM call. Person attribution
requires matching identity/company context; generic company mailboxes are not
filed as a person's address. Search-derived contacts always retain their source
URL and the `publicly_found` status — never `verified`.

The local no-charge search path now prefers the existing operator-owned SearXNG
service and falls back to DuckDuckGo HTML. A challenge stops that provider; no
CAPTCHA bypass or social-site fetch is attempted. The intelligence waterfall
also gains public-search contact adapters after the two free website scouts and
before disabled paid providers; they use MCP/SearXNG first and Google only as an
optional fallback. Google currently fails closed with HTTP 403 because the
configured Cloud project does not have access to Custom Search JSON API; this
does not block the local MCP/SearXNG path and cannot incur a paid fallback.

Live redacted verification against the reported lead: **17 results, 2 relevant
pages, 1 public email fact, and 1 public phone fact**, both source-backed and
`publicly_found`. MCP: **22 tests passing** and TypeScript clean. Application:
**85 test files / 1,144 tests passing** with 8 files / 24 live tests skipped;
TypeScript clean; changed-file lint has zero errors (one pre-existing warning in
the already-modified Scout test). The contact waterfall uses MCP/SearXNG for
every remaining lead after its free website scouts, so the MCP acquisition
stage's separate per-run cap does not create a bulk-enrichment blind spot. The
MCP image was rebuilt and its health check is green.

---

## 2026-08-27 — Authentication journey adopts the Hubble material system

Sign in, sign up, email verification, password recovery/reset, and MFA now use
one shared cream-and-clay authentication shell. The previous glass/aurora card
was replaced with Hubble's raised surfaces, inset inputs, paired shadows, and
short interaction timing. A responsive value panel explains Capture →
Understand → Act on desktop; mobile keeps the same positioning and trust copy
without horizontal overflow. Form feedback, phone input, primary actions, and
MFA code entry use the same material and accessible focus treatment.

CRO/UX changes: “Welcome back” and “Create your workspace” clarify intent, the
Hubble value proposition appears before authentication, and the security footer
states the session/MFA/no-LinkedIn-credentials guarantees at the decision point.
The design-system pass reused the existing shared AuthShell/Field/Button
components, so every current and future auth route inherits the same behavior.

Verification: focused TypeScript and ESLint clean; visual QA at 1440px and
390px found no horizontal overflow; Next.js production build clean.

---

## 2026-08-27 — Product-wide Hubble material, durable sessions, shared-IP fix

The authenticated product now uses one scoped clay/neumorphic material system:
cream canvas, raised surfaces, inset controls, paired shadows, unified active
navigation, and the same responsive shell on Overview, Extractions, Settings,
Access, Admin, and Hubble. The public marketing site remains untouched. Overview
now exposes a direct “Research with Hubble” path alongside extraction.

Authentication and load behavior were tightened without lowering the MFA
boundary:

- the signed HttpOnly guard now stores a stable opaque session ID, upgrades old
  cookies in place, permits 30 days of inactivity, and requires re-verification
  after 90 days; Supabase continues rotating the underlying auth tokens;
- the former per-network signup claim is now a random, one-time attempt claim,
  so users on the same office, household, school, or VPN IP do not block one
  another; device and normalized identity anti-abuse claims remain enforced;
- `getAccessContext()` is request-deduplicated with React cache, dashboard and
  settings reads run concurrently, and Hubble lead views use a bounded,
  user-and-filter-keyed 60-second memory cache with forced refresh after writes.

Verification: TypeScript clean; changed-file ESLint clean; full lint has zero
errors (102 pre-existing warnings); **84 test files / 1,139 tests passing** with
8 files / 24 live tests skipped; Next.js production build clean.

---

## 2026-08-25 — SearXNG replaced by Google Custom Search

SearXNG (self-hosted, frequently down) is removed from every search path.
**Google CSE is now the live-search source** for the Hubble RAG pipeline AND
the intelligence waterfalls:

- Hubble waterfall: Solr cache → **Google CSE** → Brave → Tavily.
- Intelligence: `google-funding`, `google-web`, `google-company-profile`
  replace the three searxng adapters (same tasks, same evidence shapes);
  waterfall orders updated; the GDELT-decline guard now keys on Google CSE
  being configured; runner concurrency boost follows the same signal.
- New shared adapter `lib/intelligence/providers/google-cse.ts`
  (`googleCseSearch`, `hasGoogleCseCredentials`) — `dateRestrict` replaces
  SearXNG's `time_range`; the daily-quota 429 surfaces as an outage, never as
  "no results".
- SearXNG code deleted from search.ts (class, config, auth rules, shared
  primitive) along with its auth tests; env vars removed from `.env.local` and
  `.env.example`.

### ⚠️ Blocked on one value: GOOGLE_CSE_ID

The API key is configured (renamed from `GOOGLE_CUSTOMSEARCH_API_KEY`), but
the search-engine **`cx` is missing** — both are required, and a key without
an engine id would spend a waterfall slot on guaranteed 400s. Get it from
programmablesearchengine.google.com (engine set to search the ENTIRE WEB) and
set `GOOGLE_CSE_ID=` in `.env.local`. Until then Google CSE correctly declines
and the waterfalls degrade to GDELT.

### Verification

- `npm run typecheck`: clean. ESLint clean. 74 files / **1063 unit tests,
  0 failures** (registry orders, paid-gate census, and the waterfall-order
  source assertions all updated to the new contract).

---

## 2026-08-25 — Full per-run controls restored to history strips

Each Extraction history row now carries, right-aligned:

- **Export ▾** — Download CSV / Google Sheets / Drive / GoHighLevel / Clay
  (connection-gated, as before), restored after the previous strip-down.
- **Trash** (icon, two-step) — soft-delete: leaves history, parks in the Trash
  box, fully restorable.
- **✕ Delete** (icon, two-step, explicit "Erase everything?") — PERMANENT:
  purges lead data, deletes stored page files + CSV from storage, removes the
  run row itself. The run disappears from history AND the trash box — nothing
  lingers. New `deleteJobAction` (ownership re-verified per step; storage
  paths prefix-checked; storage removal batched).

Also fixed the frozen-history bug from the previous entry's root cause list:
`trashed_at` was missing from `DASHBOARD_JOB_SELECT`, so every run classified
as trashed and the list rendered empty on the server render — refresh included.

Verification: typecheck clean; changed-file ESLint clean; 74 files /
**1066 unit tests passing**; dev server serving.

---

## 2026-08-25 — Restorable trash; exports off history rows; extraction no longer blocks

### Trash is now SOFT — and restorable

The trash icon no longer purges. It sets `extraction_jobs.trashed_at`
(migration **0061**, applied; types regenerated): the run leaves history and
parks in the Trash box with **Restore**, **Download CSV**, and **Delete
permanently** (two-step; purges lead data, removes uploaded page files + CSV
from storage, deletes the run). Nothing is erased on trash — restore returns
it intact. The old destructive `purgeJobAction` is gone; `JobActions.tsx`
deleted with it, and the export dropdowns are removed from history rows
entirely (downloads live in the Trash box rows).

### Processing no longer blocks the workflow

`process-job.ts` finalises the extraction (status Completed, CSV written) the
moment parsing finishes; enrichment runs **off the critical path** and the CSV
is silently rebuilt when the waterfall settles. The user reads their leads
seconds after upload instead of waiting minutes at 96%.

### 🔴 Types regeneration exposed a hole in production — fixed

Regenerating `types/database.ts` (needed for `trashed_at`) revealed the
hand-maintained file was badly stale AND that migration **0049's contents
never reached production**: `provider_cache`, `provider_request_schedules`,
and `await_provider_request_slot` were missing — provider-state (SEC rate
limiting, provider cache) had been failing at runtime, failing closed.
Migration **0062** repairs it (idempotent copy of 0049's infrastructure
blocks). Several latent call-site mismatches (null-vs-optional RPC params in
extension refresh/capture/devices, Paddle webhook syncs, evidence inserts,
status unions) were fixed against the now-accurate generated types; the
hand-maintained helper-alias block was preserved.

### Verification

- `npm run typecheck`: clean. ESLint: clean. Unit suite: 74 files /
  **1066 tests, 0 failures**.
- Migrations 0061 + 0062 applied; types regenerated with the hand block
  restored.

---

## 2026-08-25 — Explicit company-URL labels; Added To List dropped

Two export changes per product request:

- **"Company LinkedIn URL" → "Company Sales Navigator URL"** — the column held
  the Sales Nav company page, and users kept reading it as the public
  LinkedIn one. The captured public page column is now labelled
  **"Company LinkedIn Profile (public)"**, and the discovered enrichment
  column remains **"Company LinkedIn"**. Three identifiers, three honest names.
- **"Added To List" removed from exports** (column order, always-exported
  spine, row mapping, and the worker's initial CSV) — it contributed nothing a
  filter or CRM could use. The raw field stays parsed in the database.

⚠️ Core-column renames are breaking for existing CRM column mappings built on
the old header text.

Verification: typecheck clean; export-leads suite updated and green; 74 files /
**1066 unit tests passing**.

---

## 2026-08-25 — Trash box: trashed extractions leave history

Purged runs no longer haunt the Extraction history list — they move to a
**Trash box** in the right column beneath File pipeline:

- Minimal, creamy styling from theme tokens only (`bg-paper/70`, `border/60`,
  muted small type) — zero hardcoded colors, per design rules.
- Each row: run label, date, leads-cleared count, and a small **Download CSV**
  affordance (a purge never destroys data the user paid for; signed-URL action
  reused).
- History filters and counts exclude trashed runs automatically; the box
  renders only when something is in it.

Verification: typecheck clean, ESLint clean, **74 files / 1066 unit tests
passing**, dev server hot-reloaded.

---

## 2026-08-25 — Live run: the employee-profile bug, and the cache that hid it

### Live verification passed, then caught a real bug

Free providers green live (GLEIF: Barclays/Wise LEIs; probe: vercel.com,
figma.com). Full enrichment on job 7269bed0: 13 leads / 58 cells merged.

Then the column census caught **Botify's "company LinkedIn" pointing at an
employee's personal profile** (`linkedin.com/in/…`). Their site features a team
member; the discovery matcher accepted `/in/` links as the company's page — a
wrong answer that looks right, filed against the company. Partly and SurrealDB
had the same defect.

**Fix:** `isCompanyLinkedInUrl` — only `/company/` (or Sales Nav company) forms
qualify for `company_linkedin`; `/in/` links found on a company site are
dropped from the company's social inventory entirely. Test-asserted.

### 🔴 The cache hid the fix on the first re-run

Re-running the pass produced the SAME wrong value — because the wrong answer
was cached as fresh evidence (TTL 180 days) and the cache is the first line of
the waterfall. The provider fix never executed for Botify; a cached pre-fix
answer did. Required: purge the bad EVIDENCE rows, not just the merged
enrichment. Lesson recorded: a correctness fix to a provider invalidates its
cached answers — purge evidence alongside code.

### Final state (both jobs, live)

Zero contaminated rows; **17 verified company LinkedIn pages**; per-platform
social columns live in both exports; all at $0.0000.

### Verification

- `npm run typecheck`: clean. Unit suite: 74 files / **1066 tests, 0 failures**
  (2 new person-vs-company LinkedIn tests).
- Live: free-provider smoke 4/4; two enrichment passes; production census
  clean.

---

## 2026-08-25 — Socials split into per-platform columns

A `{ x, instagram, youtube }` blob in one CSV cell is unreadable in a CRM and
unusable as a filter. `buildMergePlan` now expands `social_profiles` (and
`person_social_profiles`) into **one provenance-carrying cell per platform**
(`social_x`, `social_instagram`, `social_youtube`, `social_facebook`,
`social_tiktok`, `social_github`, `social_crunchbase`, `social_blog`,
`social_linkedin`; personal variants prefixed `personal_`). The bunched field
itself is never written. Headers read as platforms ("X (Twitter)", "Instagram",
"Personal LinkedIn"); empty or malformed maps are counted as unknown, never
written.

Repair on job `da9b9b69`: 11 bunched keys stripped, re-merged split (16 leads /
65 cells), export rebuilt. Live column census: company_domain 15,
company_linkedin 12, social_linkedin 7, social_x 6, social_instagram 6,
social_facebook 5, social_youtube 4, work_email 4, plus github/tiktok.

### Verification

- `npm run typecheck`: clean. Unit suite: 74 files / **1064 tests, 0 failures**
  (3 new split tests).

---

## 2026-08-25 — Company LinkedIn, first-class

### Why the CSV lacked it

The "Company LinkedIn URL" column held the SALES NAV company URL — all a
captured page provides. The PUBLIC page (`linkedin.com/company/slug`) is a
different identifier whose only free source is the company's own website —
which social-scout was already reading, but buried the LinkedIn link inside
the `social_profiles` blob instead of promoting it.

### Built

- New research field **`company_linkedin`** (company, company_profile):
  vocabulary, TTL (180d), planner description, column label, migration **0060**
  (applied), vocabulary-sync guard passing.
- New provider **`social-scout-company`** (free, company_profile category):
  resolves the company's site — probing by name with domain-probe's own
  content-verification when no domain exists yet, so it is self-sufficient in
  the company phase — then inventories the social accounts the company
  publishes. Emits `company_linkedin` (HIGH, stated by the company) plus
  `social_profiles` for the remaining handles. This also gives
  `social_profiles` its first direct source under the free-only gate.
- LinkedIn links are RECORDED, NEVER FETCHED (rules 1–2), asserted by test.
- Auto-enrichment plan and the maintenance harness both include the field.

### Live result (job da9b9b69 backfill)

Public company pages discovered and merged for Focusteck, Recharge,
CameraMatics, Nectar Social, SmartSuite, Software Finder — 16 leads / 46 cells
merged, export rebuilt, $0.0000.

### Verification

- `npm run typecheck`: clean. Unit suite: **74 files, 1061 tests, 0 failures**.
- Migration 0060 applied to production; vocabulary guard green.

---

## 2026-08-25 — The missing merge: auto-enrichment now reaches the CSV

### The bug the first real upload exposed

Auto-enrichment ran (96 provider calls on the first live job) — but the
downloaded CSV still showed only core columns. Cause: the pass wrote EVIDENCE,
and stopped there. The console's merge action (`mergeRunIntoLeads` →
`merge_lead_enrichment`) was the only thing that ever moved known values onto
`extracted_leads.enrichment` — and the export reads the LEAD ROWS. Evidence
without merge is invisible to every export.

**Fix:** the automatic pass now merges its run's known cells onto the leads
(`mergeRunIntoLeads` — known cells only, ownership re-scoped) inside
`enrichJobFree`, before the export rebuild. Outcome gained `leadsUpdated`;
the rebuild triggers on evidence OR merged leads.

### Repaired the affected job

Re-ran the pass on job `da9b9b69` (mostly cache hits — 40 external calls):
**14/25 leads enriched, 28 cells merged, 72 unknown honestly skipped, export
rebuilt.** Domains from probe/Wikidata (identifee.com, partly.com,
focusteck.com, alkami.com, recharge.com…) and a Scout-published email
(services@focusteck.com) now travel in the CSV.

The maintenance harness (`enrich-leads-live`) also merges + rebuilds now, so
manual passes behave identically to the automatic one.

### Verification

- `npm run typecheck`: clean. Unit suite: 74 files / **1058 tests, 0 failures**.
- Live: merge + rebuild verified against production job `da9b9b69`.

---

## 2026-08-25 — Extraction history moved into a modal; trash-bin delete

Dashboard changes per product request:

- **The inline Extraction history panel is gone from the page flow.** It was
  the long strip stretching the dashboard. In its place: a compact
  "Extraction history · Open history" toolbar; the list opens in a modal whose
  panel is height-capped (80vh) and whose LIST SCROLLS INSIDE — the page never
  grows with the history. Escape and backdrop-click close it.
- **Trash bin on the right end of every run's actions**: two-step confirm
  (trash → "Delete leads?" → confirm/cancel) wiring the EXISTING
  `purgeJobAction` — purges that run's lead rows to free workspace; the CSV
  export survives and dedupe keys remain, so future duplicate detection still
  works. The old text "Clear data" button was replaced by the icon; a purge
  refreshes the list live.
- File pipeline panel now stands alone at full width; run selection still
  drives it from the modal's rows.

Verification: typecheck clean; changed-file ESLint clean; 74 files / 1058 unit
tests passing; dev server hot-reloaded.

---

## 2026-08-25 — Auto-enrichment wired into extraction completion

The "enrich during extraction" requirement is now the default behaviour.

### What changed

`enrichJobFree` (lib/worker/enrich-free.ts) previously hand-rolled a
company-field loop and asserted it "CANNOT PRODUCE EMAIL" — true before Scout,
false since. It now delegates to the ORDINARY research pipeline:
`createResearchRun` (lead_ids scope, plan: company_domain, industry,
work_email, email_status, social_profiles) + `claimAndProcessResearchRun`, so
the two-phase runner, evidence, provenance, tool-call telemetry, cache and the
contact waterfall all apply with zero duplication.

Preserved invariants:

- **Free only, asserted**: the pass steps aside entirely when
  `OUTLIO_ALLOW_PAID_PROVIDERS=true` — a background job must never bill on
  upload.
- **Never throws**: an enrichment outage cannot make a completed extraction
  look failed (caller also wraps).
- **Bounded by time**: at most 60 leads per automatic pass; the rest stay
  available to the Intelligence console.
- **SMTP probing stays out**: `SCOUT_SMTP_VERIFY` is an explicit operator
  opt-in for port-25-capable runtimes, never a default of an automatic pass.
- Export rebuild triggers on `evidenceWritten > 0`, so the downloadable CSV
  includes what the pass found.

### Verification

- `npm run typecheck`: clean. Unit suite: **74 files, 1058 tests, 0 failures**.
- The pipeline this hook delegates to was verified live twice earlier today
  (11 domains + 7 published emails + 5 social inventories on a real 25-lead
  job). The first real upload through localhost is the end-to-end proof.

---

## 2026-08-25 — Two-phase runner, and a self-contamination bug found live

### Why extraction exports showed no enrichment (asked and answered)

Extraction exports carry the 8 core captured columns by contract. Enrichment
columns come from research runs, merged via the console. The free waterfall had
simply never been run against the new leads — so a maintenance pass
(`tests/integration/enrich-leads-live.test.ts`, gated by `ENRICH_JOB_ID`) now
runs the full pipeline over one job's leads.

### 🔴 Sequencing bug the first pass exposed

Pass 1 discovered 11 domains (10 probe + 1 Wikidata) but **zero contact
tasks ran**: `loadPeople` snapshots `companyDomain` BEFORE execution, and for
fresh extractions that domain only comes into existence during this very run's
company-profile phase. The runner discovered the domain and then routed contact
tasks against its absence.

**Fix — the runner is now two-phase:** company tasks route and execute first;
evidence persists and `persistDiscoveredDomains` lands the domain in the
companies table; THEN people reload with fresh domains and contact tasks route.
The persistence step is the handoff. All 1056 unit tests held through the
restructure.

### 🔴 Second live find: our own User-Agent came home as a lead's email

Pass 2 fired scout + social-scout for real — published emails found for SamCart,
Binti, Adfin, Hipp… — but stored `contact@outlio.io` for ThreatSpike, Native
Teams and Arty Traders. Provenance on all three: YouTube channel pages, whose
player config **echoes the request's User-Agent into the page body**. Our UA
carries our contact address; the extractor read the reflection back as a fact
about the company.

**Fix:** `extractEmails` strips the USER_AGENT string before matching, and
`outlio.io` is blacklisted as a lead-contact host. The three bogus evidence
rows were deleted from production (lead `enrichment` was untouched — the
console merge had not run). Regression tests assert both guards.

### Results on the first real job (25 leads, $0.0000)

11 company domains + 7 published work emails + 5 company social inventories,
all with provenance. Yield is honest about its limits: catch-all-free
published addresses only, and SearXNG still down.

### Verification

- `npm run typecheck`: clean.
- Unit suite: **74 files, 1058 tests, 0 failures**.
- Two live enrichment passes against production data through the ordinary
  pipeline (evidence, tool-calls, provenance all recorded).

---

## 2026-08-25 — Social Scout integrated; domain backfill complete

### Backfill — FINISHED

All passes complete: **483 company domains resolved, $0.0000 total cost**
(1,530 → 1,047 missing). The orphan pass alone recovered 336 domains for
companies no lead had ever pointed at, across 8 chunks over ~2¼ hours.
Remaining misses are genuine free-waterfall negatives (plus SearXNG still
down); they are resumable facts, not failures.

### Social Scout (`lib/intelligence/providers/social-scout.ts`)

Scout's platform scrapers were analysed and REJECTED as-is: the LinkedIn
scraper violates rules 1–2 outright, and the others depend on proxy/UA-rotation
evasion machinery this project will not carry. What WAS ported is the
enforcement-free chain underneath, rebuilt around Outlio's own disciplines:

```
company website → DISCOVER social links (10 platforms incl. bio-link trees)
                → ENRICH discovered public profiles (og:description etc.)
                → bio emails = PUBLISHED work_email (HIGH)
                → handle inventory = social_profiles evidence against the COMPANY
```

- LinkedIn links are DISCOVERED and stored as the company's stated address,
  but NO request ever touches linkedin.com — asserted by test
  (`isFetchableProfileUrl`).
- No evasion machinery: honest UA, pacing per platform host, a 429 is recorded
  as absent rather than retried through disguises.
- With paid providers gated off, `social-scout` + `scout` are the ONLY sources
  of contact emails AND social profiles — both fields were previously
  sourceless under the free-only decision. Waterfall:
  `scout → social-scout → prospeo-email → apollo-email`.
- Discovery fetches are injectable; no unit test touches the network.

### Verification

- `npm run typecheck`: clean. Changed-file ESLint: clean.
- Unit suite: **74 files, 1056 tests, 0 failures** (14 new Social Scout tests;
  three waterfall-order assertions updated to the new contract).
- Live behaviour unexercised by design here: real Instagram/TikTok fetches are
  network-dependent and rate-limited; first production research runs will show
  real yield. Watch tool_calls for `social-scout` statuses.

---

## 2026-08-25 — Scout enrichment engine ported to the free waterfall

The Scout repository (Python CLI) was analysed and its CONTACT ENGINE — not
its platform scrapers — was reimplemented as a TypeScript intelligence
provider. Scout's LinkedIn/Instagram/TikTok scrapers stay out permanently:
rules 1–2 exist precisely for them, and the worker-runtime decision already
forbids a Python service.

### What `scout` does (free, $0)

1. **Harvest** — reads the company's own `/`, `/contact`, `/contact-us`,
   `/about`, `/about-us` through the shared HTTP discipline (bounded, paced,
   truncating) and extracts addresses, filtered against scraper-noise hosts.
2. **Pattern inference** — a REAL mailbox found on the domain reveals the house
   style (`first.last`, `f.last`). Bare words are refused as ambiguous; the
   candidate generator probes every common shape anyway, so strictness here is
   free.
3. **SMTP verification** (opt-in via `SCOUT_SMTP_VERIFY=true` — needs outbound
   port 25, which Vercel blocks; self-hosted workers qualify): RCPT-probe with
   a guaranteed-fake control address. Catch-all servers downgrade every yes to
   meaningless.

**Storage gates (rule 4):** PUBLISHED on the company's own site → HIGH.
SMTP-confirmed with clean catch-all control → MEDIUM. Everything else —
unverified patterns, all accept-all answers — is never stored.

### Integration

- Registered first in `contact_email`: `scout → prospeo-email → apollo-email`.
  With paid providers gated off, scout is now the category's ONLY source — it
  fills the gap the free-only decision created.
- `loadPeople` now prefers the research-resolved `companies.normalized_domain`
  over the raw captured URL when the lead carries none — every contact
  provider benefits.
- A published address short-circuits: no mail-server questions are asked once
  an answer we can use is already in hand.
- Registry contract updated honestly: with paid off, `contact_email` is now
  `['scout']`, not `[]`.

### Verification

- `npm run typecheck`: clean. Changed-file ESLint: clean.
- Unit suite: **73 files, 1042 tests, 0 failures** (19 new Scout tests).
- SMTP transport is injectable; no test touches a real mail server. Live
  SMTP probing remains unexercised until `SCOUT_SMTP_VERIFY` is enabled on a
  runtime that allows port 25.

---

## 2026-08-25 — Environment hygiene, and orphan backfill in flight

### `.env.local` consolidated

Eleven duplicate keys with conflicting values collapsed, keeping the LAST
occurrence everywhere — that is what runtime already used, so behaviour is
preserved exactly. Notable resolutions: `GROQ_API_KEY` moved to the
qwen-modelled key, `GITHUB_TOKEN`/`PAGESPEED_API_KEY`/`APOLLO_API_KEY` each had
two different live candidates.

The stale `INTELLIGENCE_PROVIDER_ORDER` override was REMOVED rather than
migrated: it pinned a company_profile waterfall that predated `gleif` and
`domain-probe`, silently demoting both. Code defaults are canonical again.
File now parses clean: 34 unique keys, zero malformed lines.

### 🟡 SearXNG restart blocked at Docker

The compose file lives at `~/searxng/searxng/docker-compose.yml`. Docker
Desktop's engine refuses to boot (`_ping`: "Docker Desktop is unable to
start"; two clean restarts did not clear it). Needs GUI-level attention.
Impact is bounded: the waterfall's circuit breaker degrades search-based
discovery without erroring runs.

### GLEIF legal-form names — deferred with evidence

Verified against the live API: `/reference/legal-forms` and `/legal-forms` do
not exist (404); only registration-authorities is published. Mapping codes
(`B6ES`, `H0PO`) to readable names requires GLEIF's offline dataset download.
Deferred until that pipeline is worth building; records keep the official code
rather than a guessed name.

### Orphan backfill — running

Chunks 1–2 of 8 complete: **58 domains recovered** from companies no lead has
ever pointed at. Account-wide missing count: 1,530 → **1,325** and falling.
Results to be appended on completion.

---

## 2026-08-25 — Free domain backfill, and the orphan-company gap closed

### Lead-scoped resweep (free waterfall: wikidata → gleif → searxng* → probe)

*SearXNG down; degrades gracefully.

- Pilot on 30 companies: **9 resolved, $0.0000** — 30% incremental yield on
  companies the Tavily era had already missed.
- Full lead-scoped sweep: 1,530 companies, **111 resolved at $0.0000**
  (816 provider calls). Aggregate looks low only because of the finding below;
  yield on REACHABLE companies was ~26%, and tenant `7cac…`'s reachable
  companies resolved at **89%** (32/36).
- domain-probe did the heavy lifting; GLEIF and Companies House correctly
  decline — they answer registry fields, not domains.

### 🔴 The finding that mattered: 1,120 orphan companies

Tenant `7cacc86b` holds 1,156 domain-less companies of which **only 36 are
linked to a surviving lead**. Every lead-scoped scope — the entire product
surface for research — is structurally unable to reach the other 1,120. They
were invisible to every previous backfill, not merely unresolved by them.

### Built — `company_ids` research scope

- `researchScopeSchema` gains `{ type: 'company_ids', companyIds[] }`.
- `getCompaniesByIds()` in the company repository: same batching, same
  mandatory user scoping.
- The runner branches before the lead hop: company scopes skip people loading
  (already short-circuits on empty leads) and use bounded 25-task chunks like
  all-leads runs.
- `useResearchRun`'s hand-copied scope union replaced with an import of the
  canonical type — the second instance of the drift class that migration 0050
- No UI emits the scope yet; it is maintenance surface, validated server-side.

### Built — orphan backfill mode

`BACKFILL_ORPHANS=1` enumerates missing-domain companies NOT referenced by any
lead and runs them through the ordinary pipeline via `company_ids`, in
150-company chunks. Running against production as this entry is written;
results to be appended on completion.

### Verification

- `npm run typecheck`: clean. Changed-file ESLint: clean.
- Unit suite: 72 files, **1023 tests, 0 failures**.

---

## 2026-08-25 — Free providers verified LIVE, and a redirect trap found by it

### GLEIF — verified against the real registry

- **Barclays Bank UK PLC** → LEI `213800UUGANOMFJ9X769`, ACTIVE, GB, official
  registered office at 1 Churchill Place. ✅
- **Wise Payments Limited** → LEI `213800U4GNTXRFYZKG18`, ACTIVE, GB. ✅
- **Monzo Bank Limited** → refused (no exact normalized legal-name match in
  the registry under that form). Correct behaviour, not a failure.
- A fabricated name → refused. Legal-form codes (`B6ES`, `H0PO`) surface raw
  when GLEIF publishes no plain-language form — honest, but worth mapping to
  readable names later.

### domain-probe — one live failure that found a real design flaw

First live run returned null for BOTH Vercel and Figma despite both sites
answering. Diagnosis:

1. **Oversized pages killed every probe.** vercel.com serves ~213KB of HTML;
   the shared HTTP layer throws `ERR_RESPONSE_TOO_LARGE` past the cap, and a
   caught throw reads as "no candidate". Identity lives in the page head, so
   `truncateWhenTooLarge` was added to `requestTextWithMeta`: stop at the cap,
   cancel the body, return what arrived. Opt-in; every existing consumer keeps
   the strict behaviour.
2. **The deeper flaw — redirects manufactured false ambiguity.** After fixing
   (1), `vercel.co.uk` still "verified": it redirects to `vercel.com` and
   inherits its content, so two different hosts appeared to prove ownership of
   the same name and the ambiguity rule refused everything. Rule added
   (`servedDirectly`): a response counts for a host only if it landed there
   (www-variants count); a redirect to another site is no evidence about the
   redirecting domain.

After both fixes: **vercel.com ✅ and figma.com ✅ probed live**, MEDIUM
confidence, correct refusals for nonexistent hosts.

### New opt-in live smoke

`tests/integration/free-providers-live.test.ts` (gated by
`RUN_LIVE_PROVIDERS=1`, spends nothing) covers GLEIF identity binding/refusal
and probe verification/refusal against real hosts.

### Verification

- `npm run typecheck`: clean.
- Full unit suite: **72 files, 1023 tests, 0 failures** (4 new
  servedDirectly/redirect tests).
- Live free-provider smoke: **4 passed**.

---

## 2026-08-25 — Migrations applied to production, and free domain probing

### 🔴 Discovery: the remote database was 17 migrations ahead of its own bookkeeping

`supabase migration list` reported the remote at **0042**, but the live schema
and data told another story: `qualification_rules` already held rows using SEC,
USAspending, derived and harvested vocabularies; Hubble's tables were live.
Migrations 0043–0055 had been applied out-of-band (SQL editor) and never
recorded in `supabase_migrations.schema_migrations`.

Replaying them for real collided with that reality: 0048's re-ADD of the
qualification CHECK failed because live rows already carried later vocabulary.

**Resolution:** `migration repair --status applied` for 0043–0055 (bookkeeping
only), then a real push of everything genuinely missing.

### Fixed while applying

- **Duplicate migration number resolved.** `0056_paddle_billing.sql` renamed to
  `0059_paddle_billing.sql`; ordering is now total and deterministic.
- **Real bug in 0056, found by the first real application it ever had:**
  `(observed_at::date)` in an index expression is not IMMUTABLE for
  `timestamptz` (timezone-dependent). Now
  `(observed_at at time zone 'UTC')::date`.

### Applied

0056 typed company facts (`company_links`, `company_signals`) · 0057
specialties vocabulary · 0058 lei_number vocabulary · 0059 Paddle billing
mirror. Verified remotely afterwards: all new tables present, and the live
CHECK constraint contains both `specialties` and `lei_number`.

### Also fixed — `.env.local`

A malformed `$TOKENRA_API_KEY` line broke dotenv parsing for every tool that
reads the file, and `OUTLIO_ALLOW_PAID_PROVIDERS=true` had been set — directly
contradicting the free-only product decision. Reset to `false`. ⚠️ The file now
contains DUPLICATE keys with different values (GEMINI_API_KEY, LLM_PROVIDER,
SEARXNG_URL, TAVILY_API_KEY, GITHUB_TOKEN, PAGESPEED_API_KEY, PROSPEO_API_KEY,
APOLLO_API_KEY, HUNTER_API_KEY). Last assignment wins silently. Needs a
deliberate cleanup pass — not done here, because choosing between two live API
keys is an owner decision.

### Built — `domain-probe` provider (free, keyless)

The last line of the company-domain waterfall, answering the wall documented on
2026-08-15 (72% of companies had no domain; Tavily quota exhausted and now
gated off as paid).

- Builds candidate hosts from the normalized name (flat + hyphenated ×
  .com/.io/.co.uk, capped at four probes).
- Fetches each with bounded timeout and byte cap through the shared HTTP
  discipline, then VERIFIES BY CONTENT: the page must carry the company's full
  normalized name (≥5 chars — "Acme" alone matches too much unrelated text).
- Two different hosts verifying equally = ambiguity = refused. A wrong domain
  becomes identity precedence and can merge two companies; refusing beats
  guessing.
- Emits `company_domain` at MEDIUM confidence with the probed URL as
  provenance; loses the waterfall to every stated-fact source.

### Verification

- `npm run typecheck`: clean. Changed-file ESLint: clean.
- Unit suite: **72 files, 1019 tests, 0 failures** (14 new probe tests;
  registry relative-order assertions unchanged, correctly).

---

## 2026-08-24 — Free-data-only lead engine, and GLEIF global registry

Product decision: the engine runs on free sources only. Nothing may bill by
default, and free official coverage should reach the smallest jurisdiction.

### What was already true

The `PAID_PROVIDERS` gate (registry construction) already excluded
`prospeo-email`, `prospeo-phone`, `apollo-email` and all three Tavily adapters
unless an operator explicitly sets `OUTLIO_ALLOW_PAID_PROVIDERS=true`. A missing
variable can never enable spending. The paid adapters stay in the tree behind
that deliberate act rather than being deleted; their tests keep the masking,
locked-email and waterfall discipline alive for the day a BYO-key path exists.

### Built — GLEIF LEI provider (`lib/intelligence/providers/gleif.ts`)

Free, no key, official, and the only registry in the waterfall that reaches
every LEI-issuing jurisdiction — BVI, Jersey, Guernsey, Cayman, every US state
code, the whole EU list.

- Two-stage identity like Companies House: exact normalized legal-name search,
  ONE match accepted, two matches refused. Suffix-stripping normalization is
  shared with the rest of the product, so "Acme" matches "Acme Ltd" but never
  "Unrelated Fabrications".
- Feeds existing fields `company_status`, `company_type` (legal form),
  `jurisdiction`, `registered_office` at HIGH confidence, plus a new permanent
  identifier field **`lei_number`**.
- ⚠️ An LEI issuance date is NOT an incorporation date and is never mapped to
  `incorporation_date`.
- Paced at one request per second against the open API.
- Migration **0058** adds `lei_number` to the qualification CHECK constraint;
  the vocabulary-sync guard covers it.

### Contact fields after this decision

`work_email`, `email_status`, `mobile_phone`, `phone_status`,
`person_seniority`, `person_department`, `person_social_profiles` have NO free
source. They resolve to unknown at zero cost. The vocabulary keeps them:
historical evidence remains valid, and narrowing the compliance CHECK could
strand existing rules. Guessed email patterns remain forbidden (rule 4).
Documented in `.env.example`.

### Verification

- `npm run typecheck`: clean. Changed-file ESLint: clean.
- Full unit suite: **1018 passed across 72 files**, including 14 new GLEIF
  tests, the paid-providers default-off guard, and the relative-order registry
  assertions (which correctly did not need changing for a new provider).

---

## 2026-08-24 — Lead-engine field expansion, phase 1: specialties + investor windfall

The lead-engine archetype review mapped the user's proposed field list onto what
the system already holds. Most proposals were already shipped (`incorporation_date`,
`employee_growth`, `github_presence`, socials harvests, domain provenance) or
unobtainable without banned navigation (decision makers, posting volume,
mutual connections). The genuinely missing, verifiable additions came from data
Apollo already returns on a paid response and the adapter was discarding.

### Verified against Apollo's published people-enrichment schema

- `organization.keywords` — the company's own focus-area tags → **new
  `specialties` research field**.
- `organization.funding_events[].investors` — named investors per round → feeds
  the **existing** `funding_investors` field, which had no Apollo source before.
- `organization.blog_url` → added to the company `social_profiles` harvest.

Not integrated, deliberately: other locations and follower counts appear in no
configured provider's response; shipping them would be columns that are always
empty — the fabrication rule applied to schema design.

### Built

- `specialties` added to `RESEARCH_FIELDS`, `RESEARCH_FIELD_SPEC`, TTLs
  (180 days — self-description moves slowly), planner vocabulary, and column
  labels. Stored `{ value: string[] }` like every list-valued field.
- Apollo harvests specialties, newest-dated-round investors, and blog URL.
  Investors split on commas into the shared `{ investors: [...] }` shape;
  events without parseable dates or an "Unknown" string are refused.
- Migration **0057** widens the qualification CHECK constraint to include
  `specialties`.

### ⚠️ Operational finding — duplicate migration numbers

`0056_paddle_billing.sql` and `0056_typed_company_facts.sql` share a number.
Both exist in the repo; whichever ordering the migration tool applies may not
match authoring intent. Renumber one before the next baseline. 0057 skips past
the collision rather than becoming a third occupant.

### ⚠️ Migration 0057 not yet applied to the live project

Until it is, saving a qualification rule on `specialties` fails on the old
constraint. The unit vocabulary guard passes against the file, which is not the
same as applied.

### Verification

- `npm run typecheck`: clean.
- Changed-file ESLint: clean.
- Focused suites: apollo 34, evidence-ttl 25, qualification-vocabulary 4 —
  **63 passed**. The vocabulary test parses the newest migration's constraint,
  so it now guards 0057.

---

## 2026-08-22 — Hubble search answers instead of directories

Two post-fix runs exposed the remaining failure precisely. Search time had
dropped from 4m33s to 20–34s, but an investor query produced no evidence and a
Series A query stored 15 rounds without dates. The result panel then rendered
all 99 lead rows, including duplicates and unknowns, rather than the companies
that matched the question.

### Fixed

- With no batch/date filter, Hubble now researches the 25 leads visibly on
  screen instead of silently expanding the request to every lead in the account.
- Explicit criteria in the user's words are preserved deterministically after
  LLM planning: funding round, date window, and minimum investor count.
- Canonical filters travel with provider tasks, make SearXNG queries more
  precise, and constrain SearXNG's own time range.
- Funding extraction checks every returned document for the requested field
  instead of stopping at the first funding-adjacent headline. Search-result
  dates are recovered from absolute dates, relative dates, and dated URLs when
  SearXNG has no publication metadata.
- Filtered answers omit non-matches and company questions deduplicate several
  people at the same company.
- The result strip leads with match count and researched facts, and every known
  fact exposes its source link.
- Funding-only SearXNG work uses eight paced workers; other providers retain the
  conservative concurrency of four.
- Explicit funding/date/investor questions take a narrow deterministic planner
  path and skip the 11–15 second LLM planning call. Vague "recently" requests
  receive an immediate timeframe choice instead of silently inventing one.
- The filter bar now names its unfiltered state **All leads**. A selected list
  or date range sends at most the 25 IDs visibly shown; it cannot expand to
  hidden rows. Only explicit All leads resolves the account-wide scope, and its
  provider work is processed sequentially in groups of 25.

### Verification

- A 25-company, eight-way live benchmark against the Oracle SearXNG instance:
  25/25 successful in 6 seconds.
- Focused planner, routing, extraction, result-shaping, registry, and executor
  suites: 116 passed.
- Filter-boundary and All-leads chunking suites: 23 passed.
- Unit suite: 910 passed across 62 files.
- TypeScript and changed-file ESLint: clean.
- Production build: clean.
- The broad suite reached 966 passes, then the known external Supabase path
  stalled again: unrelated `companies-rls` cleanup and two invitation tests
  exceeded their timeouts. No changed module is on those paths.

---

## 2026-08-22 — Core Intelligence funding search unblocked

The first local run after moving search to Oracle completed only after 4m33s
and returned no evidence. Its stored tool-call ledger made the cause explicit:
all 71 company lookups were routed to `gdelt-funding`, and all 71 timed out at
roughly 15 seconds. The authenticated SearXNG service was healthy, but only the
Hubble answer path knew how to use it.

### Fixed

- SearXNG configuration and its throwing request primitive are now shared with
  core Intelligence, preserving the distinction between no matches and a dead
  provider.
- Added the free `searxng-funding` adapter and placed it first in the funding
  waterfall.
- When SearXNG is configured, the five-second-paced public GDELT fallback
  declines list-wide funding tasks instead of multiplying one outage across
  every company.
- Provider readiness and the free-provider guard now include SearXNG funding.

### Verification

- The hosted SearXNG endpoint returned 32 results in 1.62s for a funding query.
- Live authenticated provider smoke completed in 2.29s.
- Focused provider suites: 90 tests passed.
- Full suite: 959 passed, 11 skipped across 70 files.
- TypeScript and changed-file ESLint: clean.
- Production build: clean.

---

## 2026-08-21 — Hubble RAG and LLM router takeover

Claude's eleven local RAG/router commits were already present on
`nav-per-surface`; this phase integrated and hardened them rather than copying a
second implementation over the same files.

### Reproduced in the configured environment

- The Hubble migration is live: `hubble_pages`, `hubble_chunks`, and
  `hubble_answers` are queryable and contain 12, 99, and 6 rows respectively.
- Stored usage disproved the advertised 90-second wall-clock budget: one answer
  recorded **164,573 ms**.
- Cerebras was preferred but the pinned public model returned `model_not_found`.
  The current public model is `gpt-oss-120b`; this account presently returns
  `payment_required` for it, so Cerebras is capacity that is configured but not
  usable until billing is restored.
- Local Ollama is healthy and has `nomic-embed-text`; local LLM synthesis remains
  correctly opt-in because `OLLAMA_LLM_MODEL` is unset.
- Local SearXNG is configured but unreachable. The existing search circuit
  breaker moves to Tavily after the first failure.
- OpenRouter can return syntactically valid JSON that does not satisfy Hubble's
  plan schema. Before this phase that could pin both planner retries to the same
  engine.

### Fixed

- The HTTP, search, fetch, embedding, local-LLM, hosted-LLM, and failover layers
  now share one absolute deadline. Provider retries recompute remaining time,
  so individually bounded calls cannot add up past Hubble's request budget.
- The search-pass and logical LLM-call caps are now enforced; the default no
  longer claims a second refinement pass that the orchestrator never ran.
- LLM calls disable transport-level retries and let the vendor router fail over;
  a process-level circuit breaker prevents a dead preferred engine from being
  paid again during the answer call.
- The router accepts a domain validator with each request. Valid JSON with the
  wrong shape now falls through to the next engine, while the outer planner still
  performs its existing Zod validation and schema-feedback retry.
- OpenRouter and Cerebras use JSON Schema response formats. Strict constrained
  decoding is enabled only for schemas where making every property required and
  rejecting extras preserves meaning; free-form planner filters use best-effort
  schema mode and remain protected by runtime validation.
- Cerebras defaults to the current public `gpt-oss-120b` model instead of the
  retired `llama-3.3-70b` endpoint.
- Expired page chunks are excluded from RAG retrieval. Previously `knownUrls`
  respected page expiry while `loadCachedChunks` still admitted stale evidence.
- `.env.example` now documents every Hubble search, embedding, and local-model
  setting needed by a new deployment.

### Verification

- TypeScript: clean.
- Changed-file ESLint: clean.
- Unit suite: **895 passed across 60 files**.
- Focused Hubble/router tests: green, including deadline, cooldown, stale-cache,
  constrained-schema, and wrong-shape failover coverage.
- Live planner smoke: succeeds through the configured provider chain; malformed
  OpenRouter output falls through to Gemini and produces a validated plan.
- Production build: clean, including `/api/hubble/ask`.
- The full integration suite is not claimed green: the pre-existing
  `companies-rls` cross-tenant link test failed and then stalled in Supabase for
  roughly 18 minutes. A focused `research-run` integration also stalled on the
  same external database path. Both were stopped; neither touches the changed
  RAG/router modules.

---

## 2026-08-16 — Lead table paging, merging intelligence, date-range scope

Three requested changes to the product surfaces.

### 1. Paging on the extracted-leads table

25 rows by default, with 25 / 50 / 100 offered. Paging runs in **Postgres**
(`.range()` + `count: 'exact'`), not by slicing an array the browser downloaded.

The table previously read a flat `.limit(100)` and rendered every row in one
list, so an account with 2,088 leads could never see past the newest hundred —
and had to scroll the ones it could see.

Three consequences that were not obvious:

- **Search had to move to the server too.** Filtering the 25 rows the client
  holds would search one page and report "no matches" for a lead that exists.
  `leadSearchFilter()` builds the PostgREST `or=` filter, and
  `escapeSearchTerm()` strips the characters that are grammar in that syntax —
  a term like `a,id.gt.0` would otherwise append a condition nobody wrote. RLS
  still scopes every row to the user, so this cannot cross tenants, but a filter
  the user did not write returning rows they did not ask for is its own bug.
- **Selection had to stop being ids.** `selectedLeads` is now a
  `Map<string, DashboardLead>`. The old code intersected the selection with the
  rows currently loaded — correct when every lead was in the browser, but with
  paging it would silently drop a page-1 selection the moment the user reached
  page 2, and the export would go out short without saying so.
- **The page has to be clamped.** A deletion or a narrowed search can strand the
  user past the end, and PostgREST answers an out-of-range request with zero
  rows — an empty table on an account with thousands of leads.

### 2. Merging intelligence into the extraction

Migration **0051** adds an `enrichment` JSONB column plus
`merge_lead_enrichment(p_user_id, p_lead_ids, p_enrichment)`.

Chosen over a column per field (63 research fields, growing weekly) and over a
join table. The **eight core export columns are untouched and always present**,
so a CRM field mapping a customer already built keeps working; merged fields are
appended after them. `normalizeExportLead` omits the key entirely when there is
no enrichment, so an un-enriched lead produces exactly the object it did before —
`tests/unit/export-leads.test.ts` asserts the whole shape and still passes
untouched, which is the contract holding rather than a formality.

Two rules carried through the whole path:

- ⚠️ **Only `known` cells are merged.** An `unknown` written as an empty column
  becomes "they don't have one" the moment it reaches a CRM. Unknowns are
  counted and reported — "38 leads updated · 12 values not found" — never stored.
- ⚠️ **A CSV cell is a string.** Evidence values are objects whose shape differs
  per provider. `flattenEnrichmentValue` unwraps the single-meaningful-key case,
  drops metadata keys that qualify a value rather than being one, and never
  emits `[object Object]`. Columns are sorted, because a CSV whose columns
  reorder between two exports breaks whatever the customer built on it.

`merge_lead_enrichment` re-scopes by `user_id` in SQL. `getRunResults` already
returns `null` for someone else's run, but the service role bypasses RLS and one
check in TypeScript is not a boundary.

### 3. Date-range scope in the intelligence console

"All leads" / **"Select by date"** / "One extraction". Choosing by date opens a
two-month calendar above the control — above, because the scope row sits high in
the panel and a popover below it is clipped by the panel edge. No date-picker
dependency; the range logic is in `lib/intelligence/date-range.ts`, unit-tested.

⚠️ **The off-by-one-day trap.** A user picking "1 Aug to 14 Aug" means the whole
of the 14th. Filtering `created_at <= '2026-08-14'` compares against midnight at
the *start* of the 14th and silently drops a full day of leads. `dateRangeBounds`
returns a half-open interval whose upper bound is the next midnight.

Two more refusals, both about not spending money by accident:

- An **unparseable range resolves to nothing**, never to every lead the account
  owns, in both the resolver and the estimate.
- A **half-picked range disables Research** and shows "Pick a start and an end
  date" rather than an estimate over everything, which would describe a run the
  user is not about to start.
- A date range gets its **own company count** rather than the workspace-wide
  figure, which would price one day's leads as the whole account.

### Verification

- `npm run typecheck`, `npx eslint lib components app tests` (0 errors; 4
  pre-existing landing-page warnings), and `npm run build` all pass.
- Full suite: **809 passed, 11 skipped across 62 files.**
- 65 new unit tests across `lead-pagination`, `lead-merge` and `date-range`.
- ⚠️ **Not verified in a browser.** These screens need a signed-in session.
  Confirmed by test and by reading the query paths, not by screenshot.

### ⚠️ Migration 0051 is not yet applied

Until it is, merging fails and lead reads that select `enrichment` will error.

---

## 2026-08-16 — 🔴 Admins were locked out of the extension pairing screen

`/extension/connect` told an admin **"Active subscription required"** and hid
the button, while the server action behind it would have issued them a code.

### Root cause — a surface recomputing the decision

```ts
// app/(product)/extension/connect/page.tsx — WRONG
const eligible = decideLimits(ctx.plan?.limits ?? null, ctx.usage).canUseScraper
  && ctx.canUseScraper
```

`decideLimits` is the plan/usage **half** of the decision. Its own docstring
says it is "only meaningful after `precheckAccess` returns `NEEDS_LIMITS`", and
it denies with `payment_required` whenever limits are null.

An admin never reaches that point. `getAccessContext` short-circuits on the
pre-check — that is the admin bypass — and **never fetches a plan**, so
`ctx.plan` and `ctx.usage` are both null. The half-decision therefore denied
precisely the accounts the full decision allows.

Non-admins were unaffected: they go down the `NEEDS_LIMITS` path, so the plan is
populated and the second call merely repeats the first. That is why this
survived — it was a no-op for everyone except the one role it broke.

The fix is to read the decision instead of re-deriving it:

```ts
const eligible = ctx.canUseScraper
```

`actions.ts` was already correct — it calls `assertAccess()`. The authorization
boundary held; only the UI lied, which is the right way round, but it still
blocked the flow completely.

### Why it was possible

CLAUDE.md: *"All access decisions go through `lib/auth/access.ts`. Nothing else
decides access."* This was the only violation in the codebase, and it took the
form the rule anticipates — a surface deciding for itself and drifting from the
real decision.

Two guards added to `tests/unit/access-decision.test.ts`:

1. An admin with **no plan and no usage** is allowed; the same admin past every
   limit is allowed; `decideLimits(null, null)` denies — the trap asserted
   directly. And an admin is **still** suspended and **still** expired: admin
   bypasses limits, never the pre-checks.
2. A boundary test failing if anything under `app/` or `components/` imports
   from `lib/auth/decide` at all. It matches the **import**, not the words, so a
   comment explaining the bug does not trip it.

### Verification

- Typecheck clean; build passes; eslint reports 0 errors (4 pre-existing
  warnings, all in the landing page, which is read-only under rule 5).
- 33 tests in `access-decision.test.ts`, up from 27.
- ⚠️ **Not verified in a browser.** The pairing screen needs a signed-in admin
  session, and signing in is not something I do. Confirmed by test and by
  reading the decision path, not by screenshot.

---

## 2026-08-16 — `person_social_profiles`, and a constraint that had drifted

Prompted by a real query — **"Give me socials of individuals"** — which the
system could not answer correctly.

### The gap

`social_profiles` is a **company** field. The only person-scoped fields were
`work_email`, `email_status`, `person_seniority`, `person_department`,
`mobile_phone`, `phone_status`. So the planner's options were to return nothing,
or to hand back the employer's corporate X account in a column labelled as the
individual's. **The second is worse** — a wrong answer that looks right.

### Built

`person_social_profiles` (person entity, `contact_email` category), fed from the
person block of Apollo's `people/match` — `twitter_url`, `github_url`,
`facebook_url`, `linkedin_url`. Zero added cost: it rides the call that was
already paid for, the same windfall pattern as the company block.

Apollo is the **only** source. Prospeo's person block carries email, mobile and
job history and nothing else.

`social_profiles` is now labelled "Company socials" and `person_social_profiles`
"Personal socials". One label reading "Socials" on both columns would leave
nobody able to tell whose account they were looking at, which is the same defect
in the UI that the field split fixes in the data.

### 🔴 The cost bug this would have introduced

**The waterfall is per-field, and every attempt is billed.** `executeTasks`
calls each provider with only the fields still outstanding — so a socials-only
task would have bought a **Prospeo enrichment that could not possibly answer
it**, then fallen through to Apollo. Every socials query would have carried a
silent wasted charge.

`canHandle` on both contact providers is now field-aware: each declares the
fields it can answer and declines a task with none of them. Four tests cover the
routing.

### 🔴 The compliance constraint had drifted out of sync

Found while adding the field. `qualification_rules.field` is CHECK-constrained
in Postgres to the research vocabulary — that constraint **is** the spec §44
compliance boundary, making a rule on a protected characteristic impossible by
schema rather than merely discouraged.

It and `RESEARCH_FIELDS` are two hand-maintained lists in different languages.
**Eleven fields had shipped in TypeScript without reaching the constraint:**

- 4 USAspending fields (`federal_awards_total`, `federal_awards_count`,
  `federal_award_types`, `federal_recipient_name`)
- 4 derived trend fields (`employee_growth`, `tech_churn`, `company_age`,
  `funding_recency`)
- 3 harvested fields (`social_profiles`, `person_seniority`,
  `person_department`)

The drift pointed the wrong way and was invisible. `ProfileManager.tsx` offers
**every** research field in its dropdown, and `lib/qualification/actions.ts`
validates with `z.enum(RESEARCH_FIELDS)` — so choosing any of the eleven passed
validation and then died on a Postgres constraint violation the user could do
nothing about.

**Migration `0050_qualification_vocabulary_sync.sql`** restores the constraint to
the full vocabulary (the 11 plus `person_social_profiles`). Widening a CHECK
cannot invalidate an existing row, so no data migration is needed.

`tests/unit/qualification-vocabulary.test.ts` now parses the **last** constraint
definition across all migrations and asserts it matches `RESEARCH_FIELDS` in
both directions, with no duplicates — and asserts the parse found something, so
a regex that silently matched nothing cannot make the whole file vacuously pass.
Adding a research field without a migration now fails loudly, at the point the
field is added.

This is the fifth instance of the recurring **"failure looks like empty"**
pattern logged in this file, and the first found in a schema rather than in code.

### Verification

- `npm run typecheck`, `npx eslint lib/ tests/ components/`, `npm run build` pass.
- Full suite: **749 tests, 11 skipped.** Two live-Supabase integration tests
  (`invitations`, `research-run`) failed on the first full run with
  `upstream returned HTML` — the hosted project returning a gateway page under
  the suite's concurrency. Both pass on re-run; neither touches this change.
- 12 new unit tests: personal-vs-company separation, the empty-object refusal,
  waterfall routing, and the vocabulary drift guard.

### Migration 0050 applied and verified against the live project

`tests/integration/qualification.test.ts` now builds a profile carrying **one
rule per research field** and reads it back. It passes: the live constraint
accepts all 63, `person_social_profiles` included.

That test exists because the unit test is not enough on its own. The unit test
proves the migration **file** matches `RESEARCH_FIELDS`; only this one proves the
migration was **applied**. The drift 0050 repaired was invisible precisely
because nothing ever asked the database.

---

## 2026-08-16 — The zero-cost intelligence block

Three ways to get more out of the system without spending anything: compute what
is already implied, harvest what is already paid for, and add providers that are
free. **No new paid API calls. Total added marginal cost: $0.00.**

### 1. Derived fields — `lib/intelligence/derive.ts`

`research_evidence` is insert-only. That was done so two providers disagreeing
stays inspectable, but it also makes the table a **time series** — and a trend
falls out of data already bought. Four new fields, computed by pure arithmetic:

| Field | From | Answers |
|---|---|---|
| `employee_growth` | two `employee_count` observations | "are they hiring?" |
| `tech_churn` | two `tech_stack` observations | "did they just adopt HubSpot?" |
| `company_age` | `incorporation_date` | "startup or incumbent?" |
| `funding_recency` | `funding_date` | "raised in the last 3 months?" |

**The refusals matter more than the calculations.** A single observation is a
reading, not a trend — reporting it as 0% growth would invent a fact about a
company nobody has watched. And growth is only computed **within one provider**:
Apollo estimates headcount while Prospeo reports a figure, so a change between
them measures our choice of vendor, not the company's hiring. Same rule for tech
churn — DNS sees the sending stack, PageSpeed sees the CMS.

Derived evidence is attributed to `outlio-derived` with a null `source_url`, and
carries `basedOn` — the evidence IDs behind it, so the arithmetic can be
re-checked. `sourceConfidence` is never above `medium`: the arithmetic is exact,
its inputs are not.

⚠️ **Derived fields are never routed.** No provider answers them, so
`router.ts` strips them before planning (otherwise every query would produce a
task nothing can serve and a spurious `unknown`), and `run.ts` computes them as
step 6b — after the evidence write, before qualification, non-fatal.

### 2. Harvested fields — data we were paying for and throwing away

Three new fields (`social_profiles`, `person_seniority`, `person_department`)
now come off responses already billed:

- **Prospeo** — six social URLs, plus seniority and department from the
  **current** role only. A past role describes who they used to be.
- **Apollo** — socials, `annual_revenue`, `founded_year`, seniority,
  departments.

Users had been asking for "their Instagram and X" and getting a partial answer
for data already in hand.

⚠️ **A founding year is not an incorporation filing.** Apollo reports a year the
company says about itself; Companies House reports a registry date. They share a
field, but the Apollo value carries `precision: 'year'` at `low` confidence, and
`deriveCompanyAge` subtracts years rather than parsing `"2011"` into 1 January —
which would age a company founded that December by an extra year.

### 3. Two free providers

| Provider | Cost | Field | Signal |
|---|---|---|---|
| `github` | free (token raises 60/hr → 5,000/hr) | `github_presence` | do they build in the open, and how actively |
| `hackernews` | free, no key | `product_launches` | did they launch; are they discussed |

Both are **attribution problems, not parsing problems**, and that is where the
code and the tests concentrate:

- A GitHub org login is first-come-first-served. `github.com/acme` may be a
  hobby project. `orgBelongsToCompany()` requires corroboration from the org's
  own profile — a display name that normalizes to the company's, or a blog URL
  on the company's domain. A matching login alone is refused.
- Forks are excluded from the star count; they are somebody else's work.
- HN search is full-text. `attributableStories()` requires the company name as a
  **whole term**, so "Notional" is not attributed to Notion and "Stripe Press"
  is not attributed to Stripe. Show HN / Launch HN posts are separated from
  ordinary mentions — the two mean very different things to a seller.

The GitHub token needs **no scopes**: only public data is read.

### Verification

- `npm run typecheck`, `npx eslint lib/ tests/ components/`, and
  `npm run build` all pass.
- Full suite: **727 passed, 11 skipped across 58 files** (the skips are the
  live-tenant integration tests, correctly gated by `missingMigrations()`).
- 39 new unit tests: `tests/unit/derive.test.ts` (21),
  `tests/unit/free-providers.test.ts` (19, incl. the Notional/Notion and
  hobby-org refusals), plus new Apollo and Prospeo harvest tests.

---

## 2026-08-16 — Free DNS technology detection

**The best value-per-cost provider in the system.** No API, no key, no account,
no meaningful rate limit — Node's built-in resolver, ~50ms per company. It
answers the question spec §54 leads with, *"uses HubSpot and Intercom but not
Salesforce"*, better than the paid alternative.

Two records do the work:

- **MX** — who runs their mail: Google Workspace, Microsoft 365, Zoho, Proofpoint
- **SPF** — every service authorised to send mail AS them. A company cannot send
  through HubSpot, Mailchimp, Klaviyo or Salesforce without naming it there, so
  the record is a **published inventory of their sales and marketing stack**

Source confidence is HIGH and earned: these are published by the company in its
own DNS zone. Not a third party's opinion, not a scraped inference — the company
telling the internet which services act on its behalf. Spec §17's definition of
an official company source.

It runs **ahead of PageSpeed** in the `tech_stack` waterfall: free, faster, and
it sees the CRM and marketing tools an ICP question actually asks about, where
Lighthouse stack packs only name the CMS and framework.

### Measured on 40 real customer domains

| | |
|---|---|
| Stack detected | **17** |
| Genuinely no records | 6 |
| Lookup failed (reported as unknown) | 17 |
| **Hit rate on successful lookups** | **74%** |

Found: Google Workspace ×11, Microsoft 365 ×4, Zoho ×2, HubSpot ×1.

### 🔴 The fourth "failure looks like empty" bug — this one mine

The first version returned `[]` for both *"no such record"* and *"the lookup
failed"*. A live probe therefore reported `soprasteria.com` and `mfs.com` as
having no email stack. They run **Microsoft 365** and **Proofpoint** — both
already fingerprinted in this very file. The measured hit rate looked like 50%;
it is actually 74%.

Only `ENOTFOUND` / `ENODATA` / `NXDOMAIN` now count as absence. Everything else —
timeout, SERVFAIL, refused — throws, so the executor records `error` and the
field stays `unknown`.

**Four times in this build** a failure and an empty result have been rendered
identically: the backfill guard that named the wrong migration, the schema probe
that silently skipped thirteen tests, the benchmark that reported an exhausted
Tavily plan as "found nothing", and now this. It is the single most recurrent
defect shape here — worth checking first in anything new.

### What it cannot see

SPF only covers services that send email. A company using Salesforce purely as
an internal CRM may never authorise it to send, so absence remains `unknown`
rather than "not detected".

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npm test` | ✅ **677 passed**, 11 skipped |
| `npx eslint lib/ tests/` | ✅ zero problems |
| `npm run build` | ✅ clean |
| Live: `hubjoy.co` | ✅ Google Workspace, HubSpot |
| Live: `soprasteria.com` | ✅ Microsoft 365 |
| Live: `mfs.com` | ✅ Proofpoint |

---

## 2026-08-16 — USAspending.gov federal award provider

Free, official, no key. Spec §17 puts a government filing at HIGH confidence,
and this is the primary record of what the US federal government obligated to a
company. Four new fields: `federal_awards_total`, `federal_awards_count`,
`federal_award_types`, `federal_recipient_name`.

### Two defects found by LIVE testing, not by unit tests

**1. Strict matching zeroed out every large contractor.** `pickRecipient`
required exactly one name match. Booz Allen Hamilton files under five
registrations (`… INC.`, `… INC`, `… HOLDING CORPORATION`, …), so it was refused
as "ambiguous" and a company with **$91.6bn** in federal contracts reported
none.

Every candidate surviving the filter already normalizes to the same name, so
extra rows are duplicate registrations of one company — not rival candidates.

**2. 🔴 The fix for (1) made it worse, and only live testing caught it.**
Passing all five registrations as `keywords` returned **52 awards and a NEGATIVE
total**. Measured directly:

| Keywords sent | Result |
|---|---|
| `["BOOZ ALLEN HAMILTON INC."]` | 128,168 awards / $91,565,378,997 |
| `["BOOZ ALLEN HAMILTON INC"]` | 128,168 awards / $91,565,378,997 |
| both together | **52 awards / −$1,505,882** |

**`filters.keywords` is AND, not OR.** Nothing in the endpoint list says so.

Final design: the strict name match is a **gate** (does a federal recipient with
exactly this company's name exist?), and the query then uses **one** keyword —
the *shortest* verified registration, because the search is a substring match so
the shortest form is the most inclusive while still being the company's full
name. `Palantir Technologies` resolves to 1,919 awards / $5.1bn; a bare
`Palantir` is refused, since none of its five substring candidates *is*
"Palantir".

### Coverage expectation

Narrow by design — only US federal contractors and grant recipients appear. On a
Sales Navigator list of small B2B SaaS companies most will legitimately return
nothing, and that is a fact about the company rather than a failure. It earns
its place by being free and authoritative, not by hitting often. One company
from the live lead list, *Thinklytics*, resolved to 3 awards / $15,000.

### Also

`company_profile` now names `usaspending` explicitly at the end of its
waterfall — it answers only federal fields and declines the rest through
`canHandle`, so its position costs nothing, but stating it beats relying on
registration order. The registry test now asserts **relative** order rather than
exact array equality: a test that breaks whenever a provider is added trains
people to update it without reading it.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npm test` | ✅ **666 passed**, 11 skipped |
| `npx eslint lib/ tests/ components/` | ✅ zero problems |
| `npm run build` | ✅ clean |
| Live: Palantir Technologies | ✅ 1,919 awards / $5.1bn |
| Live: Booz Allen Hamilton | ✅ 128,168 awards / $91.6bn |
| Live: bare "Palantir" | ✅ refused |

---

## 2026-08-15 — The benchmark was lying about a provider outage

### What happened

With every key configured, the domain benchmark reported:

```
tavily-domain-discovery
  resolved : 0/100 (0.0%)
  est. cost: $0.1000
```

Read plainly: *we paid $0.10 and Tavily found nothing.* Both halves were wrong.

Tavily was returning **HTTP 432 — "This request exceeds your plan's set usage
limit"** on every single call. Nothing was searched and nothing was billed.

### Why it read as a data finding

`resolved: 0` is what a provider reports when it searched successfully and found
nothing — and also what it reports when every request was rejected. One is a
fact about the data; the other is an outage. The benchmark rendered them
identically, and the first conclusion drawn from it was that these companies are
simply unfindable. They are not: the sample contains names like *Network Optix*,
which plainly has `networkoptix.com`.

Cost was also summed across **all** attempts including failures, so a provider
that never ran appeared to have been paid for.

### Fixed

The benchmark now prints a status breakdown per provider, counts cost for
billable calls only, and shouts when every call failed:

```
--- tavily-domain-discovery ---
  resolved       : 0/10 (0.0%)
  call statuses  : error=10
  est. cost      : $0.0000 (billable calls only)
  ⚠️  EVERY CALL FAILED — this is an outage, an exhausted plan or a
      bad key, NOT a finding about the data. Coverage is unmeasured.
```

Against the same sample, `wikidata` reports `not_found=10` — searched, found
nothing — which is a genuine finding and now visibly different.

**This is the third misleading diagnostic in this build**, after the backfill
guard that named the wrong migration and the schema probe that silently skipped
thirteen tests. The pattern is the same each time: a failure and an empty result
rendered identically. Worth watching for in anything new.

### Current domain coverage

| | |
|---|---|
| Companies | 2,017 |
| With a domain | **555 (27.5%)** |
| Without | 1,462 |

The 555 came from the earlier production backfill. Wikidata's contribution to
the remaining tail is near zero, as the 4% sample predicted — these are SMBs it
has never heard of.

### 🟡 Blocked on Tavily quota

Domain discovery for the remaining 1,462 companies cannot proceed until the
Tavily plan has headroom. Everything keyed on a domain — the Apify Actor,
PageSpeed, website intelligence, and the strongest contact-match path — stays
behind it.

---

## 2026-08-15 — Official SEC EDGAR company metadata provider

### Built

- Added `SecEdgarService`: business name → cached official ticker/CIK list →
  exact unambiguous identity match → public submissions JSON.
- The clean metadata payload includes the ten-digit CIK, official legal name,
  SEC entity type, SIC and description, EIN, LEI, tickers, exchanges, state of
  incorporation, business address, SEC-reported websites, former names, and up
  to 100 recent filings with official document links.
- Added `sec-edgar` behind the existing company-profile provider abstraction.
  All facts become high-authority evidence, while an SEC-reported website also
  becomes reusable bonus `company_domain` evidence.
- Added planner vocabulary, field-specific TTLs, result labels/rendering, and
  qualification allow-list entries for the SEC business attributes.

### SEC compliance controls

- Public lookup uses `www.sec.gov/files/company_tickers.json` and
  `data.sec.gov/submissions/CIK##########.json`; no API key or filer token is
  used.
- Every attempt, including a retry, declares exactly
  `User-Agent: OUTLIO husnain@outlio.io` and
  `Accept-Encoding: gzip, deflate`.
- A Postgres advisory-lock scheduler coordinates every application instance and
  both SEC hosts under one `sec.gov` bucket. It targets five request starts per
  second—half the SEC maximum—and fails closed before network access when the
  scheduler is unavailable.
- The master list is cached globally in Postgres for 24 hours, with same-process
  promise coalescing and memory reuse to prevent duplicate cold-start downloads.

### Accuracy boundaries

- SEC conformed-name annotations and legal suffixes are normalized, but fuzzy
  matches are refused. One normalized name mapping to multiple CIKs is unknown.
- The submissions CIK must equal the selected master-list CIK.
- Malformed identifiers, dates, filings, and unsafe archive paths are dropped;
  missing data never becomes `false` or a fabricated value.
- The ticker master is not a universal list of every US private company. This
  provider correctly returns unknown for businesses it cannot identify there.

### Verification

- 13 focused SEC/HTTP tests plus the related planner, registry, routing, and
  qualification suites pass.
- TypeScript, focused ESLint, the complete suite (**645 tests passed, 11
  intentional skips**), and the Next.js production build are clean.
- Migration `0049_sec_edgar_provider.sql` must be applied before live traffic;
  until then the distributed limiter fails closed and no SEC call is made.

---

## 2026-08-15 — Companies House intelligence provider

### Built

- Added the official UK Companies House company-profile API behind Outlio's
  existing provider abstraction. A lookup searches by the captured company
  name, requires one exact normalized legal-name match, then retrieves the
  requested `/company/{companyNumber}` profile.
- Added evidence-backed fields for company number, legal status, company type,
  jurisdiction, incorporation date, SIC codes, registered office, overdue
  accounts, overdue confirmation statement, and insolvency history.
- One successful profile request stores all returned registry facts as reusable
  evidence. The result table still exposes only fields requested by the user.
- Added centralized TTLs: permanent identity/incorporation facts, medium-lived
  classification/address facts, and seven-day status/compliance facts.
- Registered the free provider in the company-profile waterfall and added
  server-only `COMPANIES_HOUSE_API_KEY` configuration.
- Added migration `0048_companies_house_fields.sql` so the new professional and
  business attributes can be used safely in saved qualification rules.

### Accuracy and cost decisions

- Ambiguous and near-name matches return `unknown`; they are never guessed.
- The profile company number and legal name must agree with the search result
  before evidence is accepted.
- A registered office is stored separately from headquarters because it may be
  an accountant or formation agent address.
- Absent booleans remain `unknown`, not `false`.
- The provider is paced at two requests per second to stay within the published
  600-requests-per-five-minutes limit. Its provider cost is recorded as zero.

### Verification

- 13 focused tests cover identity ambiguity, malformed identifiers, defensive
  response parsing, Basic authentication, request sequence, evidence metadata,
  current-field preference, unknown booleans, and minimum-tool routing.
- TypeScript and focused ESLint pass. The complete suite passes with **632
  tests** and 11 intentional skips, and the Next.js production build is clean.
- Live verification remains pending until `COMPANIES_HOUSE_API_KEY` is configured.

---

## 2026-08-15 — Fixed “The planner was unavailable”

### Root cause

The Intelligence UI and query route were healthy. The configured Gemini key
was present, but the planner's pinned default was `gemini-2.5-flash`. Google
returned HTTP 404 for that model to this API user and explicitly reported that
it is no longer available to new users. The adapter correctly converted the
vendor failure into the safe UI message and prevented research from starting.

### Fixed

- Updated the pinned default to `gemini-3.6-flash`, while retaining the
  server-side `GEMINI_MODEL` override.
- Added request-time Gemini/Groq fallback. A configured alternative now takes
  over when the preferred vendor is unavailable, not merely when its key is
  absent at startup.
- An unparseable completion does **not** invoke the second vendor. The planner
  gives the same model its schema-feedback retry, avoiding an unnecessary paid
  call.
- Documented the current default in `.env.example` and added focused regression
  tests for the model pin, override, fallback, no-key skip, and minimum-call
  behavior.

Google recommends its newer Interactions API for new agentic workflows, but
continues to support `generateContent`. Outlio's planner is a single stateless,
schema-constrained classification call, so changing only the active model is
the smaller and safer repair; migrating transport does not improve this path.

### Live verification

The exact planner request that failed was rerun through the real adapter with no
model override. `gemini-3.6-flash` returned a validated funding ResearchPlan and
the smoke test passed. No company research or enrichment provider ran during
this check.

| Check | Result |
|---|---|
| real Gemini planner smoke test | ✅ planned successfully |
| `npm run typecheck` | ✅ zero errors |
| focused ESLint | ✅ zero problems |
| `npm test -- --run` | ✅ **619 passed**, 11 skipped |
| `npm run build` | ✅ clean production build |

---

## 2026-08-15 — Production company-domain backfill

### Result

The opt-in production backfill ran through Outlio's normal research pipeline,
tenant by tenant. It did not bypass evidence, usage, or cost tracking.

| Metric | Result |
|---|---:|
| Companies evaluated | 2,017 |
| Domains discovered and attached | **549 (27.2%)** |
| Companies left unknown | 1,468 |
| `company_domain` evidence rows | **549** |
| Provider attempts | 3,987 |
| Estimated provider cost | **$1.97** |

Every populated `companies.normalized_domain` has a matching provenance row.
No failed lookup became a false value, and no contact-enrichment provider ran.

Provider outcomes explain the lower-than-benchmark aggregate coverage:

| Provider outcome | Calls |
|---|---:|
| Wikidata success | 47 |
| Wikidata not found | 1,970 |
| Tavily success | 502 |
| Tavily not found | 399 |
| Tavily unavailable | 1,049 |
| Tavily timeout | 20 |

On Tavily calls that returned a real answer or a real no-match, discovery yield
was 502 / 901 (**55.7%**), consistent with the 100-company benchmark. The
remaining 1,069 failed Tavily attempts are preserved as provider unavailable or
timeout and remain `unknown`; they were not silently treated as negative facts.
The $1.97 figure is the cost ledger's estimate, not a claim about final provider
billing for failed calls.

### Built

`tests/integration/domain-backfill-live.test.ts` is an explicit, credit-spending
maintenance command. It:

- processes tenants sequentially so provider concurrency does not multiply;
- creates ordinary `research_runs`, tool-call telemetry, evidence and costs;
- resumes the same pending run after a transient infrastructure failure;
- retries a failed tenant only when it made zero external calls; and
- skips terminal runs so a second invocation does not repurchase known misses.

It is gated by `RUN_DOMAIN_BACKFILL=1` and skipped by normal `npm test` runs.

### Fixed — large PostgREST `.in(...)` reads

The first large tenant exposed a scale bug before making any paid call.
`getCompaniesForLeads` put 500 UUIDs into a PostgREST GET query string; the URL
could exceed the proxy limit and surfaced as `TypeError: fetch failed`.

Read batches now use 100 UUIDs. Write/RPC batches remain at 500 because those
IDs are carried in request bodies. The zero-call failed run was then safely
replaced, and both large tenants completed.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| focused ESLint | ✅ zero problems |
| `npm test -- --run` | ✅ **614 passed**, 11 skipped |
| live backfill | ✅ 1 passed in 29m 7s |

### Next operational decision

Do not blindly rerun all 1,468 unknown companies: 399 already have a genuine
Tavily no-match. If provider availability is restored, a follow-up command
should target only the 1,069 unavailable/timeout entities, preserving the
minimum-call rule.

---

## 2026-08-15 — Provider benchmark, and a hard finding about domain coverage

### Built

`tests/integration/provider-benchmark.test.ts` — opt-in, measurement only:

```
RUN_PROVIDER_BENCHMARK=1 BENCHMARK_SAMPLE=100 \
  npx vitest run tests/integration/provider-benchmark.test.ts --disable-console-intercept
```

Each provider is measured **alone**, not through the waterfall. Run in sequence
the second provider only ever sees what the first missed, so its raw coverage
would be understated and the two could not be compared. Incremental coverage is
computed afterwards from the sets (spec §52).

It writes **nothing** to `research_evidence`. A benchmark that mutates
production data cannot be re-run for comparison, and a provider would look
better simply for having gone first and warmed the cache.

### 🔴 Wikidata resolves 4 companies in 100

Measured on 100 real companies with no domain:

| Provider | Resolved | Incremental |
|---|---|---|
| wikidata | **4 / 100 (4.0%)** | +4 |
| tavily-domain-discovery | 0 (no key configured) | +0 |
| **combined** | **4 / 100** | **96 unresolved** |

This is the notability problem, quantified. Wikidata knows large companies; a
Sales Navigator prospect list is almost entirely SMBs it has never heard of.
The provider is working correctly — the data simply is not there.

**Consequence:** roughly **1,940 of the 2,017 companies would need a paid
Tavily search** to get a domain. Everything downstream — the Apify Actor,
PageSpeed tech detection, website intelligence, and the strongest Prospeo and
Apollo match path — sits behind that spend.

Wikidata also paced at ~453ms per company, so the free pass alone is about
15 minutes over the full set.

### Recommended sequencing

Add `TAVILY_API_KEY` and **re-run the same 100-company benchmark**. That is ~96
searches to learn the real hit rate before committing ~1,940. The discovery
heuristic deliberately returns `null` on ambiguity, so its true yield is
unknown and could be well below 100%.

### 🟡 The Apify Actor is blocked

`teodor_banea/b2b-lead-enrichment-free` takes a CSV with a **`domain` column**.
With zero domains it cannot process a single row. Its input schema also offers
*"generate email pattern candidates"* — guessed addresses, which rule 4 forbids
and which would bounce. Decision taken: harvest only technographics and
firmographics from it, reject anything it did not actually observe. Not built
yet, because it cannot be exercised against any row in the database.

---

## 2026-08-15 — Apollo added to the email waterfall

### Built

| File | Purpose |
|---|---|
| `lib/intelligence/providers/apollo.ts` | second email provider, plus its own company windfall |
| `tests/unit/apollo.test.ts` | 16 tests |

The email waterfall is now `prospeo-email → apollo-email`. Phone stays on
Prospeo alone.

### Apollo is EMAIL ONLY, deliberately

`reveal_phone_number` requires a `webhook_url`: the enrichment response returns
synchronously and phone numbers arrive **later, asynchronously**, at a public
callback. That needs a webhook route, signature verification, and a way to match
a callback back to a lead — none of which exists. Prospeo already returns mobile
synchronously.

Half-wiring it would produce a provider that appears to support phone numbers
and silently never delivers one. It is left unimplemented, and a test asserts
Apollo registers under `contact_email` only.

### 🔴 A locked address is not an address

Apollo returns `email_not_unlocked@domain.com` when it holds an address but will
not release it on the current plan. Stored naively that becomes a
deliverable-looking address on a lead, and the first anyone hears of it is a
bounce. Matched on the local part, since the domain varies per company, and
masked forms are rejected too — the same guard as Prospeo, for the same reason.

### Two labels that stop a wrong filter

- **`employee_count` is marked `isEstimate: true`.** Apollo's figure is
  estimated; applying a `between 10 and 50` filter to it as though it came from
  a filing excludes companies on a number nobody stands behind.
- **`funding_amount` is marked `isTotalFunding: true`.** Apollo reports TOTAL
  raised across all rounds, not the latest round. "Raised more than $5M" means
  something different against each, and conflating them qualifies companies that
  never had a $5M round.

Prospeo's funding, by contrast, is a specific round with a date and stage — so
where both answer, Prospeo's is the more precise fact.

### Waterfall order is a starting assumption, not a finding

`prospeo-email` first is a guess. Spec §52 requires the order to come from
measured **cost per incremental valid result**, and
`INTELLIGENCE_PROVIDER_ORDER` flips it without a deploy once a benchmark has
run. That benchmark has not run.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npm test` | ✅ **614 passed**, 9 skipped |
| `npx eslint lib/ tests/` | ✅ zero problems |
| `npm run build` | ✅ clean |
| Locked and masked addresses rejected | ✅ |
| No Apollo phone provider registered | ✅ |

### 🟡 Pending

- `PROSPEO_API_KEY` and `APOLLO_API_KEY` are not set. Both providers decline
  through `canHandle`; contact fields return `unknown` at no cost.
- **No live benchmark has run.** Match rate, incremental coverage and cost per
  valid result are all unmeasured on real leads.

---

## 2026-08-15 — Phase 8: Prospeo contact enrichment

### Built

| File | Purpose |
|---|---|
| `lib/intelligence/providers/prospeo.ts` | email + phone providers, and the company windfall |
| `lib/intelligence/execute.ts` | splits provider output into requested vs bonus evidence |
| `tests/unit/prospeo.test.ts` | 18 tests, masking guard first |

### The two rules that cost money if broken

**Masked is not a value.** Prospeo returns unrevealed contact details MASKED
rather than absent — `eoghan.*****@intercom.com`, `+1 415-3**-****`, with
`revealed: false`. Storing one as a contact detail would be fabricating lead
data that looks exactly like a successful enrichment, and nobody would notice
until someone tried to send to it. Every value is gated on `revealed === true`
**and** the absence of a mask character: `revealed` is the contract, the mask is
the observable proof, and a provider change must not slip one past the other.

**Mobile costs 10× email.** `enrich_mobile` is set only when a plan explicitly
asked for `mobile_phone`. Requesting it opportunistically would multiply every
enrichment bill by ten for data nobody wanted.

### Matching on this data

Prospeo accepts a LinkedIn URL but **public profile URLs only — explicitly not
member IDs or URNs**. Every LinkedIn URL in this product is the URN form built
from Sales Navigator, so that path is unusable here. Matching goes through
**name + company name**, which Prospeo accepts and which the captured data has
on 94% of leads. The zero-domain problem is therefore not a blocker for Prospeo,
and Prospeo *returns* the domain, which backfills everything downstream.

### The windfall, and a change to the executor

One paid contact call returns the employer's domain, industry, headcount,
revenue band, funding events, technology list and open roles. Discarding that
would mean paying again later for facts already in hand.

`acceptableEvidence` now splits provider output in two:

- **requested** — the task's fields, on the task's entity. Satisfies fields and
  stops the waterfall.
- **bonus** — facts about that person's employer. Stored, but **never counts as
  answering the question**, so a windfall can never mask a field that genuinely
  failed. A provider returning only bonus data is recorded as `not_found`.

Evidence about an unrelated entity is still dropped outright.

`PersonEntity` gained `companyId` so those facts have somewhere to be filed.

### Provider quality note

Prospeo's funding carries a real round date and stage with a Crunchbase link,
which is better than the news-derived provider's announcement-date guess. Its
technology list names actual SaaS tools, which Lighthouse stack packs cannot
see. Both are still capped at MEDIUM — aggregated from a third party, not the
company speaking.

### 🐛 The skip guard was hiding thirteen tests

`research-run` passed in isolation but skipped during full runs, reporting a
green suite. The probe treated ANY error as "migration missing", so a transient
hiccup under load silently disabled the runner, clarification and scoring tests
— the exact "a skip is not a pass" failure the comments warn about.

`missingMigrations` in `tests/integration/helpers.ts` now distinguishes
PostgREST's genuine "table/column does not exist" from an unverifiable probe,
and **throws** on the latter. An unreachable database fails the suite instead of
quietly disabling it. Recovered 13 tests.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npm test` | ✅ **598 passed**, 9 skipped |
| `npx eslint lib/ tests/ components/` | ✅ zero problems |
| `npm run build` | ✅ clean |
| Masked email / phone rejected | ✅ |
| Unknown funding stage not reported as a round | ✅ |
| Windfall stored but not counted as an answer | ✅ |

### 🟡 Pending — `PROSPEO_API_KEY`

Not set. Until it is, both providers decline through `canHandle` and contact
fields return `unknown` — no error, no cost.

---

## 2026-08-15 — Qualification profiles can be built from the product

Closes the dead end left by Phase 7: the "Score against" dropdown had no way to
be filled.

### Built

| File | Purpose |
|---|---|
| `lib/qualification/parse.ts` | **pure** value parsing per operator |
| `lib/qualification/actions.ts` | `assertAccess`-gated, rate-limited create and delete |
| `components/qualification/ProfileManager.tsx` | the criterion builder |
| `app/(product)/dashboard/intelligence/profiles/page.tsx` | the screen |
| `tests/unit/qualification-parse.test.ts` | 12 tests |

### Decisions

**An unparseable value is an error, never a default.** Coercing "ten to fifty"
into `[0, 0]` would produce a profile scoring confidently against criteria
nobody expressed, and the first sign of trouble would be a wrong list weeks
later. Every operator's parsing fails loudly instead.

**Values are parsed on the server.** What a user typed is untrusted input like
any other; the client only collects it.

**Human numbers are accepted** — `$5M`, `5,000,000`, `50k`, `£2bn` — because
that is what people paste out of a deck. Anything that is not a number returns
`null` rather than a guess.

**`tech_stack` criteria get `valuePath: 'detected'` automatically.** That
payload nests its list, and without the path the comparison runs against the
wrapper object and matches nothing — the same defect found in the scoring engine
earlier today, prevented here at the point profiles are created.

**Weights are relative, and the UI says so.** Otherwise the natural assumption
is that they must total 100 before a profile is valid.

**The empty dropdown now links to the builder.** A control with no way to fill
it is a dead end.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npm test` | ✅ **577 passed**, 9 skipped |
| `npx eslint` on all new code | ✅ zero problems |
| `npm run build` | ✅ both intelligence routes compiled |
| Both screens signed out | ✅ 307 → `/sign-in?next=…` |

One transient integration failure appeared in a single full run and did not
reproduce in unit, integration, or a subsequent full run.

### Still to build

- Phase 8: contact enrichment — **no provider configured**, so the control is
  deliberately absent rather than present and returning `unknown` for everyone.
- Phases 9–10: cost analytics, circuit breakers, retention jobs.
- Website intelligence beyond PageSpeed; GitHub, GLEIF, Hacker News, YC.

---

## 2026-08-15 — Phase 7: the intelligence UI

The pipeline is reachable from the product for the first time.

### Built

| File | Purpose |
|---|---|
| `lib/intelligence/results.ts` | assembles a run into the requested columns; pre-flight scope estimate |
| `app/api/intelligence/query/route.ts` | plan → create run → hand to the queue via `after()` |
| `app/api/intelligence/clarify/route.ts` | answer clarification questions and release the run |
| `app/api/intelligence/runs/[id]/route.ts` | poll status and results; reaps stale runs first |
| `components/intelligence/IntelligenceConsole.tsx` | search bar, scope selector, clarification prompt, dynamic table |
| `app/(product)/dashboard/intelligence/page.tsx` | the screen, with designed empty states |

Nav gained an **Intelligence** entry. `ACTION_LIMITS.research` limits the two
write routes — research spends money, so it is capped harder than a read.

### Decisions

**Only the requested columns.** The table is driven by the plan's
`requiredFields`. A funding question returns founder, company, amount and date —
not a 40-column dump. Giant lead profiles are explicitly not the product (§2).

**No ambiguous blanks.** Every researched cell renders as a value with a
`source` link, or as *Unknown* in italics. "Does not use HubSpot" and "we could
not find out" must not look identical (§49).

**The estimate is shown before anything runs**, and the figure that matters is
COMPANIES, because that is what gets researched and therefore what it costs
(§31). `all_leads` is an explicit choice, never a default.

**Polling, not waiting.** The route returns a run id immediately and the work
happens in `after()`. Research over hundreds of companies takes minutes and must
survive the tab closing; the queue row already exists, so a cut-short function
is recovered by the reaper.

**The status route is deliberately not rate-limited** like the write routes —
it is what the open screen polls, and throttling it would make a long job look
broken.

### 🐛 Double-nested error envelope

All three routes wrapped `toClientError(...)` in another `{ error: … }`, so
clients received `{"error":{"status":401,"body":{"error":{…}}}}`. Caught by
curling the routes unauthenticated rather than by a type — the shapes are both
valid JSON. `toClientError` already returns the complete envelope.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npm test` | ✅ **565 passed**, 9 skipped |
| `npx eslint` on all new code | ✅ zero problems |
| `npm run build` | ✅ all four routes compiled |
| `/dashboard/intelligence` signed out | ✅ 307 → `/sign-in?next=…` |
| All three API routes unauthenticated | ✅ `401 ERR_UNAUTHENTICATED`, single envelope |
| Sign-in page renders, zero console errors | ✅ |

### ⚠️ Not visually verified while signed in

The console itself — search bar, scope selector, clarification prompt, results
table — has **not been seen rendered with a real session**, because signing in
requires a password and MFA. Compilation, route guards, and the signed-out path
are verified; the authenticated layout is not.

### Still to build

- Phase 8: contact enrichment. **No provider is configured**, so an "enrich
  contacts" control would return `unknown` for everyone. Deliberately absent
  from the UI rather than present and broken.
- Phases 9–10: cost analytics, circuit breakers, retention jobs.
- A UI for creating qualification profiles — they can be created through
  `lib/qualification/repository.ts` but not yet from the product.
- Website intelligence beyond PageSpeed; GitHub, GLEIF, Hacker News, YC.

---

## 2026-08-15 — Qualification wired into the runner

A run can now research AND score. `createResearchRun` takes an optional
`qualificationProfileId`; after evidence is written, the runner scores every
company and persists `qualification_results` with the per-criterion breakdown.

### Built

| File | Purpose |
|---|---|
| `supabase/migrations/0047_run_qualification_profile.sql` | `research_runs.qualification_profile_id` |
| `lib/qualification/repository.ts` | profile + rule persistence, result writes |
| `lib/intelligence/run.ts` | `qualifyRun` step after evidence is persisted |
| `tests/integration/qualification.test.ts` | 6 live tests |
| `tests/integration/research-run.test.ts` | +3 end-to-end scoring tests |

### Decisions

**Evidence is re-read after the run's own findings are written.** Scoring
against the pre-research snapshot would ignore everything the run just paid
for — every freshly researched company would score as `unknown`.

**Scoring failure is non-fatal.** Evidence is the durable product and is already
committed; a score is recomputable from it. A scoring error costs a re-score,
not the run.

**`qualifiedCount` is `null`, not `0`, when no profile was attached.** Nothing
was scored, which is a different statement from nothing qualifying.

**A profile that fails to save is rolled back entirely.** A profile scoring on
only the criteria that happened to be accepted would silently mean something
different from what the user configured — worse than no profile.

**0047 uses a single-column FK.** A composite `(profile_id, user_id)` reference
would be the stricter tenant guard, but `ON DELETE SET NULL` nulls *every*
referencing column including `user_id`, which is `NOT NULL`, so the delete would
fail. The column-scoped form is Postgres 15+ only and this migration is pasted
by hand. Cross-tenant safety comes from `getProfile(userId, …)` instead — the
same rule every service-role query here follows. Verified on Postgres 16:
deleting a profile nulls the reference and the run survives.

### 🔧 The skip guard was lying

`tests/integration/research-run.test.ts` reported *"migration 0045 is not
applied"* whenever any probe failed — while 0045 was in fact applied and 0047
was the gap. A guard that names the wrong migration is worse than none: it sends
whoever reads it to re-apply something already deployed. It now probes each
migration separately and names exactly what is missing.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npx eslint lib/ tests/` | ✅ zero problems |
| Unit tests | ✅ **503 passed** |
| Qualification persistence, live | ✅ 6 passed |
| 0047 applied twice to Postgres 16 | ✅ clean, idempotent |
| Deleting a profile nulls the ref, run survives | ✅ |
| Protected-characteristic criterion, **live project** | ✅ rejected by CHECK |
| Cross-tenant profile read / delete | ✅ refused |

### ✅ Migration 0047 applied live — 2026-08-15

All 13 previously-skipping tests now pass against `ptewhpmxzenbmxlizxhu`:
the runner, the clarification round trip, and end-to-end scoring.

**Full suite: 565 passed, 9 skipped** (only the opt-in live-provider suite).

Migrations 0043–0047 are all applied. Phases 1–6 are complete and verified
against the live project.

---

## 2026-08-15 — Phases 5 and 6: clarification round trip and qualification

### Built

| File | Purpose |
|---|---|
| `lib/intelligence/run.ts` | `createResearchRun` now branches on clarification; `answerClarifications` resumes a waiting run |
| `lib/qualification/score.ts` | **pure** deterministic ICP scoring, operators, required/preferred/excluded, explanation |
| `supabase/migrations/0046_qualification.sql` | `qualification_profiles`, `qualification_rules`, `qualification_results` |
| `tests/unit/qualification.test.ts` | 18 tests |
| `tests/integration/research-run.test.ts` | +4 clarification round-trip tests |

### Phase 5 — nothing is charged while a question is open

A plan needing clarification is stored as `waiting_for_clarification` and
**deliberately not enqueued**. `answerClarifications` folds the answers into the
plan's `filters`, appends both halves of the exchange to `clarifications`, and
only then enqueues — so a run always records what was asked and what the user
chose. It refuses to act on a run that is not waiting, so a double-submitted
form cannot start the same job twice.

### Phase 6 — the score is arithmetic, not an opinion

The LLM never produces the number. Providers supply facts, `scoreEntity`
computes the score, and a model may only explain the result afterwards. Same
evidence + same profile = same number, every time.

**UNKNOWN IS NOT FAILURE.** A company we could not research has not failed a
criterion:

- an unknown **required** criterion does **not** disqualify — asserting it
  failed would be fabricating a negative;
- the score is **normalised over what could actually be evaluated**, not over
  the whole profile. A company with 6 of 8 criteria researched is scored out of
  those 6. Scoring it out of 8 would punish it for *our* missing data — which is
  precisely how a good-fit company with a thin public footprint silently drops
  off a list, and on Sales Navigator data that is most of them.
- `unknownCount` is reported so a result can say "scored on 6 of 8" instead of a
  falsely precise number.

**Protected characteristics are impossible by schema.** `qualification_rules.field`
is CHECK-constrained to the research vocabulary. Verified on Postgres 16: a
`religion` criterion is rejected with `check_violation`; `employee_count` is
accepted. Spec §44 enforced by the database, not by UI discipline.

### 🐛 The spec's headline tech-stack query silently excluded nobody

Tech-stack evidence is `{ detected: [...], coverage, scannedUrl }`, but
`readObserved` did not know the `detected` key, so it compared against the whole
wrapper object, matched nothing, and returned `not_met`. A rule like
*"excluded: uses Salesforce"* therefore excluded **no one** — silently, on the
exact query spec §54 leads with. Found by testing; `detected` and the other real
provider payload keys are now in the lookup.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npx eslint lib/ tests/` | ✅ zero problems |
| Qualification unit tests | ✅ 18 passed |
| Clarification round trip, live | ✅ 10 passed |
| 0046 applied twice to Postgres 16 | ✅ clean, idempotent, RLS 3/3 |
| Protected-characteristic criterion | ✅ **rejected by CHECK** |

### 🟡 Pending — apply migration 0046

Not yet applied to `ptewhpmxzenbmxlizxhu`. The scoring engine is pure and fully
tested without it; only profile persistence needs the tables.

### Still to build

- Wiring qualification into the runner (score after research, persist results)
- **Phase 7**: the search bar and results table. Still no UI.
- Website intelligence beyond PageSpeed; GitHub, GLEIF, Hacker News, YC.

---

## 2026-08-15 — Phase 4: the LLM query planner

Natural language → validated `ResearchPlan`. Phases 3 and 4 are now joined:
a question can be planned, and a plan can be executed.

### Built

| File | Purpose |
|---|---|
| `lib/intelligence/llm/provider.ts` | vendor-neutral `LLMProvider` + Gemini (default) and Groq adapters |
| `lib/intelligence/planner.ts` | question → plan, the field catalog prompt, protected-characteristic refusal, clarification folding |
| `tests/unit/planner.test.ts` | 19 tests, all against a stub model |

**No new npm dependencies.** Both adapters go over the existing
`lib/intelligence/http.ts`, so timeouts, bounded backoff, host pacing and error
redaction apply to model calls exactly as they do to data providers.

### Decisions

**The model plans; it never answers.** It chooses which FIELDS a question needs.
It never supplies a funding figure, headcount, technology, or date — those come
from a provider with a source URL or stay `unknown` (spec §5, §16).

**Its output is a proposal, not an instruction.** `researchPlanSchema` decides
whether anything runs. A hallucinated field name is rejected and the model gets
one retry with the shape error fed back — never its own previous output, which
would let a bad completion steer the correction.

**The model never sees lead records.** It gets the question and the catalog of
researchable fields. A test asserts the prompt contains no `@` and no
`linkedin.com`, so prospect data cannot drift into a vendor payload.

**Gemini uses constrained decoding** (`responseMimeType` + `responseSchema`), so
it cannot return prose at all. Groq's OpenAI-compatible API guarantees syntactic
JSON but not shape, so the schema is repeated in the prompt — and in both cases
Zod is still the thing that decides.

**The API key travels in a header, never a query string.** A URL carrying a key
ends up in logs and error messages.

**Protected characteristics are refused before the model is called** (spec §44).
Whether to filter people by religion or ethnicity is not a judgement to delegate
to a model; the question is rejected with a plain explanation of what Outlio
does qualify on.

**A clarification request with no questions is treated as executable.** Otherwise
a run would wait forever on a question nobody can answer.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npm test` | ✅ **532 passed**, 9 skipped |
| `npx eslint lib/intelligence tests/` | ✅ zero problems |
| Spec acceptance Test 2 (emails only) | ✅ |
| Spec acceptance Test 3 (asks what "recently" means) | ✅ |
| Spec acceptance Test 4 (specific question runs straight through) | ✅ |
| Hallucinated field rejected, corrected retry accepted | ✅ |
| Prose or unreachable model → `failed`, nothing charged | ✅ |

Live planner checks were added to the opt-in suite:

```
RUN_LIVE_PROVIDERS=1 npx vitest run tests/integration/providers-live.test.ts
```

### ✅ Migration 0045 applied live — 2026-08-15

All six runner tests now pass against `ptewhpmxzenbmxlizxhu`, including
single-claimant enforcement and cross-tenant refusal. Full suite: **532 passed**.

### Still to build

- **Phase 5**: persisting clarification answers on a run and resuming it.
  `applyClarifications` exists; the round trip through `research_runs` does not.
- **Phase 6**: qualification profiles, rules, and deterministic ICP scoring.
- **Phase 7**: the search bar and results table. **There is still no UI** —
  `planQuery` and `createResearchRun` are library calls.
- Website intelligence beyond PageSpeed; GitHub, GLEIF, Hacker News, YC.

---

## 2026-08-15 — Phase 3 IN PROGRESS: search, funding, and domain discovery

**Not finished.** Built and tested so far; the rest is listed at the end.

### Built

| File | Purpose |
|---|---|
| `lib/intelligence/http.ts` | the only path providers take to the network — timeout, bounded backoff honouring `Retry-After`, per-host pacing, streamed size cap, redacted errors |
| `lib/intelligence/providers/tavily.ts` | licensed search primitive |
| `lib/intelligence/providers/gdelt.ts` | open news API — the free fallback in `web_research` |
| `lib/intelligence/providers/domain-discovery.ts` | finds a company website from its name |
| `lib/intelligence/providers/web-research.ts` | recent news, hiring signals, competitors (Tavily → GDELT) |
| `lib/intelligence/providers/funding.ts` | funding derived from news, MEDIUM confidence (Tavily → GDELT) |
| `tests/unit/provider-extraction.test.ts` | 30 tests over every pure extraction path |

Added the `company_domain` research field. `.env.example` documents
`GEMINI_API_KEY`, `GROQ_API_KEY`, `TAVILY_API_KEY`, `GITHUB_TOKEN`,
`INTELLIGENCE_PROVIDER_ORDER`, `INTELLIGENCE_TTL_OVERRIDES`.

### Decisions

**No funding database exists in this stack.** No Crunchbase, no Harmonic. The
`FundingProvider` reads round, amount, currency, date and investors out of
sentences in retrieved articles. It is therefore capped at MEDIUM source
confidence, always carries the source URL, and reports nothing when no article
states a figure. It answers "has this company been reported as raising?", not
"what is this company's funding history?" — coverage is whatever the press wrote
about, which is thin for small and non-US companies. **Do not present it as
authoritative.** Decision taken with the user after the gap was flagged.

**Extraction is deterministic regex, never the LLM.** The LLM must never be the
origin of a number (spec §5).

**An amount with no currency marker is ignored.** "raised 5 million" could be
any currency, and defaulting to USD would silently misprice every non-US
company on a list.

**Domain discovery returns `null` rather than a plausible guess.** A wrong
domain becomes the company's primary identity — it outranks the LinkedIn URL in
precedence — so a bad guess attaches another company's facts to these leads and
can merge two real companies. Aggregators (Crunchbase, Glassdoor, LinkedIn, G2,
YC…) are excluded outright, and two domains matching the name equally well are
treated as unknown.

**GDELT is second in both waterfalls** because it needs no key. When the paid
search key is missing, throttled, or out of credit, research degrades to a free
source instead of to `unknown`.

### 🐛 Two defects found by testing, both fixed

1. **Search ranking could break a domain tie.** `acme.com` and `acme.io` match
   the name equally well, but the "first result" bonus silently elected the
   top-ranked one. Being listed first is popularity, not ownership. Ambiguity is
   now judged on the name-correspondence score alone, and a tie returns `null`.
2. **Subsidiary rounds were attributed to the parent.** "Stripe Press raises
   $8M" satisfied a word-boundary match on "Stripe". A company name followed by
   a distinct-entity token (`press`, `labs`, `ventures`, `capital`…) that is not
   part of the company's own name is now rejected.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npm test` | ✅ **469 passed** (was 439) |
| `npx eslint lib/intelligence` | ✅ zero problems |

No live provider calls are made by the suite — every test runs against
recorded-shape responses.

### Added since — Wikidata, PageSpeed, and the live registry

| File | Purpose |
|---|---|
| `lib/intelligence/providers/wikidata.ts` | official website, industry, HQ, employee count — free, no key |
| `lib/intelligence/providers/pagespeed.ts` | tech detection via Lighthouse stack packs |
| `lib/intelligence/providers/index.ts` | the live registry and default waterfall order |
| `tests/unit/provider-registry.test.ts` | 25 tests over Wikidata matching, stack-pack parsing, and waterfall order |
| `tests/integration/providers-live.test.ts` | opt-in smoke test against real credentials |

**Wikidata runs before domain discovery.** It states what a company's website
IS; the discovery heuristic only notices that a host looks like the company's
name. A stated fact beats an inferred one, so the heuristic now only sees
companies Wikidata has never heard of — which, for a Sales Navigator list, will
be most of them. Coverage is notability-based and thin for SMBs; that is
expected, not a failure.

**PageSpeed gives official-API tech detection, but a narrow kind.** Lighthouse
stack packs name the CMS and framework (WordPress, Shopify, React, Magento…).
They do NOT reveal the marketing and sales tools an ICP question usually asks
about — it cannot tell you whether a company uses HubSpot, Intercom, or
Salesforce. Evidence carries `coverage: 'cms_and_framework_only'` so no consumer
can mistake it for a full stack scan. It also needs a domain, so it runs behind
the Wikidata → discovery chain.

### 🔧 Type variance forced a change to the provider contract

`IntelligenceProvider<T>` is invariant in `T` — the type is both an `execute`
return and a `normalize` parameter — so a registry could not hold providers with
different output shapes without `any`. Added `AnyIntelligenceProvider` and
`eraseProviderType()`, which pair the two calls behind one `run()` and keep `T`
private to the adapter that authored it. The four-method contract from spec §36
is unchanged; only the registry and executor see the sealed form.

### One test expectation was wrong, not the code

`pickWikidataEntity('Acme', [{ label: 'Acme Corporation' }])` was asserted to
return null. It should match: stripping legal forms is the entire point of
`normalizeCompanyName`. The case that must be refused is a disambiguated label
like `Acme Corporation (film)`, which is now what the test checks.

### Verification (updated)

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npm test` | ✅ **494 passed**, 6 skipped (the opt-in live suite) |
| `npx eslint lib/intelligence tests/` | ✅ zero problems |

### Smoke-testing real credentials

```
RUN_LIVE_PROVIDERS=1 npx vitest run tests/integration/providers-live.test.ts
```

Skipped by default so `npm test` never spends API credit. Assertions are loose
on purpose — a live API is not a stable fixture, and a smoke test that fails
because a company had a quiet news week teaches nothing. Parsing correctness is
proved offline.

### Added since — the research queue and runner

| File | Purpose |
|---|---|
| `supabase/migrations/0045_research_queue.sql` | `research_job_queue` + enqueue / claim / claim-next / reap, mirroring 0013 exactly |
| `lib/intelligence/plan.ts` | the `ResearchPlan` schema — **the gate between a model's proposal and paid API calls** |
| `lib/intelligence/run.ts` | the runner: scope → companies → cache → routing → execute → persist |
| `tests/unit/research-plan.test.ts` | 13 tests over plan and scope validation |
| `tests/integration/research-run.test.ts` | 6 end-to-end runner tests, **no network** |

**The runner's order of operations is the cost model.** Resolve scope to leads,
collapse to distinct companies, read existing evidence, route only the gaps,
execute, persist. Steps 2 and 3 are where the money is saved.

**Discovered domains are written back to `companies.domain`.** This closes the
loop: a domain found once by Wikidata or discovery becomes the company's stored
identity, so later runs and every website-dependent provider start from it
instead of paying to rediscover it.

**`all_leads` is an explicit scope, never a default.** A missing scope fails
validation rather than quietly becoming "spend money on everything" (§31). A
single run is capped at 10,000 leads.

**A run is `completed` only when nothing was left unanswered.** Anything else is
`partially_complete` — a status a user can act on, rather than a green tick over
a table of blanks.

### 🐛 The 0013 OUT-parameter trap, again

`claim_research_run` failed at runtime with `column reference "user_id" is
ambiguous`. `RETURNS TABLE` declares OUT parameters of the same names as the
columns, so a bare reference in the function body is ambiguous — the identical
bug `claim_next_job` hit with `attempts` in 0013. Both UPDATEs are now fully
qualified, and the comment explaining why is in the migration so it is not
rediscovered a third time. **Unreachable without executing the SQL.**

### Verification (updated)

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npm test` | ✅ **507 passed**, 12 skipped |
| `npx eslint lib/intelligence tests/` | ✅ zero problems |
| 0045 applied twice to throwaway Postgres 16 | ✅ clean, idempotent |
| Claim sets `running` + `started_at` | ✅ |
| **Second claim of the same run** | ✅ **0 rows — exactly one claimant** |
| Claim with the wrong user id | ✅ 0 rows |
| Reaper requeues with future backoff | ✅ |
| Dead-letter past `max_attempts` | ✅ queue + run `failed`, `ERR_TIMEOUT` |

### Still to build

- Website intelligence beyond PageSpeed: public pages with `robots.txt`
  respected, for pricing and positioning signals
- GitHub, GLEIF, Hacker News, Y Combinator providers
- **Phase 4**: the LLM planner that produces a `ResearchPlan` from natural
  language. The schema and the runner are ready for it; nothing generates a plan
  automatically yet, so a run must currently be created with a hand-built plan.
- **No UI.** `createResearchRun` is a library call. There is no search bar, no
  API route, and no results table (Phase 7).

### 🟡 Pending — apply migration 0045

Not yet applied to `ptewhpmxzenbmxlizxhu`. Until it is,
`tests/integration/research-run.test.ts` **skips itself with a loud warning** and
the runner is unverified against the live schema. Queue semantics are proven on
local Postgres 16.

### 🔴 Credentials pasted into chat must be rotated

The Gemini, Groq, Tavily, and GitHub keys were shared in conversation and should
be considered exposed. The GitHub token especially — a fine-grained token with
**no scopes** is all this integration needs, since it reads only public data.

---

## 2026-08-14 — Intelligence layer, Phases 1 + 2 (company identity + research infrastructure)

First two phases of the Lead Engine → intelligence-layer build spec. **No AI, no
search UI, no external provider calls.** This is the foundation the cost model
rests on: companies exist as first-class entities, and researched facts have
provenance, expiry, and a router that refuses to buy what we already own.

Extraction, auth, billing, the extension, and every existing integration are
untouched.

### Built

| File | Purpose |
|---|---|
| `supabase/migrations/0043_companies.sql` | `companies`, `extracted_leads.company_id` + `company_match_strategy`, and the atomic `link_leads_to_companies` RPC |
| `supabase/migrations/0044_research_infrastructure.sql` | `research_runs`, `research_evidence`, `research_tool_calls`, `purge_expired_evidence` |
| `lib/companies/normalize.ts` | **pure** domain / company-name / LinkedIn-company-URL normalization + `resolveCompanyIdentity` + `groupLeadsByCompany` |
| `lib/companies/repository.ts` | service-role, user-scoped linking and company lookup |
| `lib/companies/backfill.ts` | resumable backfill for leads extracted before 0043 |
| `lib/intelligence/types.ts` | `IntelligenceProvider` contract (spec §36), field → category → entity map, evidence Zod schema |
| `lib/intelligence/ttl.ts` | **the single** field → TTL map |
| `lib/intelligence/evidence.ts` | **pure** freshness, §17 conflict resolution, evidence validation |
| `lib/intelligence/evidence-store.ts` | service-role read/write + tool-call telemetry |
| `lib/intelligence/registry.ts` | config-driven provider ordering (the waterfall) |
| `lib/intelligence/router.ts` | **pure** `planToTasks` — company dedup, cache subtraction, minimum categories |
| `lib/intelligence/execute.ts` | waterfall execution, per-task isolation, timeout, `unknown` on exhaustion |
| `lib/intelligence/costs.ts` | integer-micros cost accounting |
| `components/admin/CompanyBackfill.tsx` | admin control for the backfill |
| 5 unit suites + 1 integration suite + `tests/stubs/intelligence-providers.ts` | 98 new tests |

Modified: `lib/worker/process-job.ts` (non-fatal linking step after lead insert),
`lib/admin/actions.ts` (`backfillCompaniesAction`, audited), `app/admin/page.tsx`,
`lib/errors/catalog.ts` (3 codes), `types/database.ts`.

### Design decisions

**Tenancy stays `user_id`.** The spec assumes `workspace_id` on every new table,
but Outlio has no workspace model — every existing table scopes to `auth.users`.
Confirmed with the user before writing code. New tables use the same shape, so
there is one tenancy model rather than two.

**One `company_id` column, not a `lead_company_links` join table.** A captured
lead row records exactly one current employer. A many-to-many table would add a
join to every query and buy nothing. Deviation from spec §25, flagged.

**Identity precedence is conditional, enforced by three PARTIAL unique indexes.**
Domain → company LinkedIn URL → normalized name. The name index only governs
rows carrying nothing stronger, so once a company has a domain its name stops
being an identity and two same-named companies coexist correctly (spec §10).

**Normalization lives only in TypeScript.** `link_leads_to_companies` receives
already-normalized values. Re-implementing the rules in SQL would create the
same two-sources-of-truth drift that `lib/limits/credits.ts` carries a warning
about.

**Linking is atomic in Postgres, not read-then-write in application code.**
`after()` can process two jobs for one user concurrently. The RPC uses a
select → adopt → insert-on-conflict retry loop. Verified with 8 parallel
connections: exactly one company row.

**Name-only companies are PROMOTED, not duplicated.** Captures are inconsistent —
the same company arrives with a website on one page and only a name on another.
A domain capture adopts the existing name-only row instead of creating a second
company.

**Evidence is insert-only and doubles as the cache.** A newer observation sits
alongside the old one, so a disagreement between two providers stays
inspectable. `resolveConflict` adjudicates: source confidence, then per-record
confidence, then recency — and **a stale high-confidence record never beats a
fresh weaker one**, or TTLs would be decorative.

**Absence of evidence is `unknown`, never `false`.** Carried through the type
system: `FieldKnowledge` is a discriminated union with a reason
(`never_researched` / `expired` / `no_provider_configured` / `provider_unavailable`
/ `not_found`).

**Mock providers live in `tests/stubs/`, not `lib/`.** Shipped code contains no
fake implementations (rule 7). The interfaces are real; Phase 3 adapters
implement the same contract.

**Research queue deferred to Phase 3.** A queue with no tools to run is a stub.
It will be a copy of the proven `job_queue` pattern when there is work for it.

**Money is integer micros everywhere.** Provider prices are fractions of a cent;
summing 460 of them as floats produces a margin nobody can reconcile.

### 🐛 Four defects found by testing, all fixed

1. **`normalizeCompanyLinkedInUrl` did not check the host.**
   `example.com/company/acme` matched the same path shape and was accepted as a
   LinkedIn company identity. Any site could impersonate a company page.
2. **`%2E%2E%2F` survived slug validation.** The trailing-slash strip ran
   *before* the character check, so `../` became `..` and passed — the exact
   decode-order trap that bit the sign-up LinkedIn validator in Phase 4.
   Validation now runs on the decoded form, and `..` is rejected outright.
3. **`Acme B.V.` normalized to `acme b v`.** Punctuation was collapsed to spaces
   before legal-suffix stripping, splitting `B.V.` into two fragments matching
   nothing. Periods are now removed rather than spaced, so `bv` is recognised.
4. **🔴 `z.string().url()` accepts `javascript:alert(1)`.** `source_url` is
   rendered as a clickable "view source" link, so a hostile provider response
   was stored XSS. Now refined to http/https only.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npm test` | ✅ **434 passed, 0 skipped** (was 326) against the live project |
| `npm run lint` | ⚠️ 0 errors, 100 warnings — **all pre-existing** in `app/` and `extensions/dist/` |
| `npm run build` | ✅ clean |
| `npx eslint` on every changed file | ✅ zero problems |
| 0043 + 0044 on throwaway Postgres 16 | ✅ apply clean, **idempotent on re-apply** |
| RLS enabled on all 4 new tables | ✅ 4/4 |
| **500 leads, one domain → 1 company** | ✅ 500 linked, 1 distinct company |
| **8 parallel connections, same new domain** | ✅ **exactly 1 company**, all 8 linked |
| Same name, different domains → 2 companies | ✅ never merged on name |
| Name-only row promoted when a domain arrives | ✅ 1 company, not 2 |
| Lead with no company identifier | ✅ left unlinked, never invented |
| Alice reads own companies / evidence / runs | ✅ 1 / 1 / 1 |
| **Bob reads Alice's companies / evidence / runs** | ✅ **0 / 0 / 0** |
| Bob forges evidence | ✅ refused, `42501` |
| Bob updates a company | ✅ refused, `42501`, row intact |
| Bob calls `link_leads_to_companies` | ✅ refused, `42501` |
| Acceptance Tests 1, 2, 5, 6, 7, 8 | ✅ asserted as task counts, not mocked call counts |

RLS was verified by switching to the `authenticated` role inside a transaction
with `request.jwt.claim.sub` set. **A first attempt used `SET LOCAL` outside a
transaction, which silently no-ops** — the whole script ran as superuser and
"passed" while proving nothing. Worth remembering for future RLS checks.

### ✅ Migrations 0043 + 0044 applied live — 2026-08-15

Applied to `ptewhpmxzenbmxlizxhu` by the user. The full suite was re-run against
the live project immediately afterwards:

**`npm test` → 434/434 passing, zero skipped.**

That includes all ten live tenant-isolation and concurrency tests, which had
been skipping themselves while the schema was absent:

| Live check | Result |
|---|---|
| Alice reads her own company | ✅ |
| Bob reads Alice's company / evidence / run | ✅ **0 rows each** |
| Bob writes into Alice's company | ✅ refused, row intact |
| Bob inserts evidence directly | ✅ refused |
| 25 leads, one domain → one company row | ✅ |
| 8 parallel RPCs racing one new domain | ✅ **exactly 1 company** |
| Lead with no company identifier | ✅ left unlinked |
| RPC called with the wrong user's id | ✅ refused, lead untouched |

New extractions now link to companies automatically.

### 🐛 Backfill skipped two accounts while reporting success — fixed

The first live backfill run reported `hasMore: false` and `usersProcessed: 2`,
but 50 perfectly linkable leads were still unlinked afterwards. Two separate
defects in `lib/companies/backfill.ts`:

**1. 🔴 `.limit(5000)` silently returned 1000 rows.** PostgREST caps every
response at `db-max-rows` (1000 on Supabase) and says nothing when it truncates.
`listUsersWithUnlinkedLeads` enumerated accounts by reading `user_id` from the
unlinked leads — over 2,213 rows it saw only the first 1,000, which happened to
contain just 2 of the 4 affected accounts. **The other two accounts, 25 leads
each, were never processed, and the admin UI said the job had finished.**

Fixed by paginating with `.range()` under an explicit ordering, and returning
`{ userIds, truncated }` so a scan that stops early cannot be mistaken for a
complete one. `backfillCompaniesAction` now seeds `hasMore` from `truncated`.

**Rule worth keeping: never trust a bare `.limit()` above the row cap.** A short
page is the only reliable end-of-table signal.

**2. Per-user paging re-read leads that can never be linked.** Successfully
linked leads drop out of the `company_id is null` filter, but unidentifiable
ones stay in it and collect at the front of every page. The loop re-counted them
each pass (`leadsUnidentified` reported 203 against 175 real), and a page that
filled entirely with stuck rows would have stalled the run. Now it skips past
the attempted-but-unlinked count with `.range()`, so every lead is examined
exactly once.

`tests/integration/company-backfill.test.ts` covers both: multi-page enumeration
finds every account, a truncated scan admits it, and a user whose leads are half
unlinkable is fully processed with each lead counted once.

### ✅ Company backfill complete — 2026-08-15

Two runs, both recorded in `admin_audit_logs`:

| Run | usersProcessed | leadsLinked | leadsUnidentified |
|---|---|---|---|
| 1 (before the fix) | **2** | 2,038 | 203 (over-counted) |
| 2 (after the fix) | **4** | 50 | 125 (exact) |

The second run's `usersProcessed: 4` is the enumeration fix working — it found
the two accounts the first run never saw — and `leadsUnidentified: 125` matching
the true remainder exactly is the double-count fix working.

Final state:

| | |
|---|---|
| Leads total | 2,213 |
| Leads linked | **2,088** |
| Leads unlinked | 125 |
| Companies | 1,993 |
| **Unlinked leads still carrying a company field** | **0** ✅ |

That last row is the invariant: every lead that carried anything capable of
identifying a company now has one. The remaining 125 have no company name, no
company page, and no website — nothing to match, and inventing one would violate
rule 4.

### ⚠️ Company deduplication on real data is 4.5%, not the ~63% the spec assumes

Measured across the 2,088 linked leads:

| | |
|---|---|
| Distinct companies | 1,993 |
| Companies with exactly 1 lead | 1,911 |
| Companies with more than 1 | 82 (largest: 10 leads) |
| Leads sitting on a shared company | 177 |

**Spec §53 assumes 5,000 leads collapse to ~1,850 companies and prices Phase 3
on that.** This dataset collapses 2,088 → 1,993. The dedup machinery is working
correctly — it is just that these saved searches return roughly one person per
company, so there is very little to collapse.

The cost consequence is direct: company-level research here costs ~0.95 calls
per lead, not ~0.37. Company deduplication is still worth having (it is what
makes the 82 shared companies free, and it compounds as more lists are imported
for the same accounts), but **Phase 3 budgeting must not assume a 63% saving.**
Re-measure per workspace before quoting a cost.

Also observed: **every match came through the company LinkedIn page**
(`strategy = linkedin`, 2,036 leads; `strategy = name`, 2; `strategy = domain`,
**0**). `company_website_url` is only populated when the saved page happens to
expose it. Domain is the strongest identity and the field most external
providers key on, so Phase 3 will mostly be resolving companies by name plus
LinkedIn URL. Worth weighing when choosing funding and tech-stack providers —
several accept only a domain.

### Next — Phase 3

Funding, tech-stack, and web-research adapters against the existing
`IntelligenceProvider` interface, plus `research_job_queue` copied from 0013.
Provider credentials are still required; until they arrive the adapters have no
real source to call.

---

## 2026-08-14 — Dashboard navigation feedback + readable extension captures

- Added a 2px dashboard route-progress indicator with immediate click feedback,
  a fast completion transition, and reduced-motion support.
- Extension captures now carry the visible Sales Navigator list/search name and
  page number through the authenticated API.
- Captured files and extraction-history rows display as
  `{lead list name} - Page {number}` instead of an opaque run identifier.
- Storage keys remain server-generated; the human-readable name is sanitized
  and used only as display metadata.
- Chrome and Firefox extension packages rebuilt; focused tests, typecheck,
  extension builds, and lint all pass.

---

## 2026-08-06 — Phase 0 and Phase 1 complete

### Built

**Phase 0 (gate):**
- `docs/REPO_AUDIT.md` — repository inventory
- `docs/DESIGN_TOKENS.md` — extracted design system + app adaptation rules

**Phase 1 (gate):**
- `docs/SCRAPER_AUDIT.md` — sections A–K
- `docs/UNSUPPORTED_FIELDS.md`
- `docs/SELECTOR_MAP.md` — validated selectors (written 2026-08-05)

**Supporting:**
- `Linkedin Sales Navigator Scraper SaaS/recovered/scraper_gui_recovered.py`
- `.gitignore` — rules blocking real saved pages, `.rar`, `.exe`, `.pyc`

### Files touched

| File | Change |
|---|---|
| `.gitignore` | **modified** — added personal-data and binary exclusions |
| `docs/*.md` | created (5 files) |
| `…/recovered/scraper_gui_recovered.py` | created |

**Zero application code written. `app/` untouched.**

### Key findings

1. **The existing scraper is obsolete.** LinkedIn moved Sales Navigator from
   `<table>` to `<ol>/<li>`. Every structural selector returns 0 matches. The tool
   extracts zero leads from a page saved today.
2. **Source was lost; recovered from bytecode.** The `.exe` is a PyInstaller
   bundle. Extracted the CArchive, unmarshalled with CPython 3.11, disassembled.
   Never executed.
3. **No network I/O in the original** — zero `certifi`/`urllib3` is conclusive.
   The "file processor, not a crawler" constraint held from the start.
4. **New parser validated: 25/25 rows, 100% on ten fields, 25 unique dedupe keys.**
5. **Silent-corruption trap:** `div[data-anonymize="job-title"]` still matches but
   now holds tenure, not the title. Real titles are at
   `span[data-anonymize="title"]`.

### Decisions

| Decision | Value | Source |
|---|---|---|
| Product URL | **`outlio.io/dashboard`** via `app/(product)/dashboard/` | user, 2026-08-06 |
| `Notes` / `Date Entered` | **dropped** | user, 2026-08-06 |
| Database | **Supabase** — project `ptewhpmxzenbmxlizxhu` | user, 2026-08-06 |
| Scraper integration | **Port to TypeScript + cheerio** (spec §5.1.J option 2) | Phase 1 audit |
| Worker runtime | **Node** — no Python service, §11.4 not needed | follows from above |
| Name/URL storage | **separate columns**; `sanitizeCell()` unchanged; links rebuilt at export | Phase 1 §H2 |

### Deviations from spec

| Spec | Reality | Action |
|---|---|---|
| `pnpm` | repo uses **npm** | all commands `npm run …` |
| shadcn/ui "(existing)" | **not installed** | install in Phase 3, CSS-variable mode |
| `typecheck` + `test` scripts | **neither exists** | add both at start of Phase 3 |
| Product at `/app` | `app/` is the router root | `app/(product)/dashboard/` |
| `lib/supabase/` | Supabase scaffold suggests `utils/supabase/` | follow spec: `lib/supabase/` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | project issues `sb_publishable_…` | use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| Golden test vs the binary | `.exe` is Windows-only, cannot run | equivalence proven against `SELECTOR_MAP.md` §3 |

### Open items — need the user

1. **`SUPABASE_SERVICE_ROLE_KEY`** — must be placed in `.env.local` by the user
   directly. Never pasted in chat, never prefixed `NEXT_PUBLIC_`.
2. **More saved pages** — one page only. Every field showed 100% presence, so
   nullable behaviour is unverified. Want: a different search, and a "Saved leads"
   list. Kept local, never committed.
3. **Worker host** — Railway / Fly.io / Render account needed by Phase 7.
4. **Legal review (spec §13.3)** — lead data on identifiable people is personal
   data under GDPR/UK GDPR, and processing platform-sourced data may be restricted
   by that platform's terms regardless of how the file was obtained. This is a
   business decision for the owner and qualified counsel, not something to resolve
   in code or copy. **Unresolved.**
5. **Placeholder Search Console tokens** — `app/layout.tsx:70-73` ships literal
   `'your-google-verification-code'` / `'your-yandex-verification-code'`. Outside
   SaaS scope; flagged because `app/` is otherwise read-only.

---

## 2026-08-06 — Phase 2 complete

### Built

- `docs/ARCHITECTURE.md` — extraction location, rejected alternatives, trust
  boundaries, request lifecycle, failure modes, idempotency, retention,
  observability, environments
- `docs/FILE_TREE.md` — planned structure with per-directory responsibility
- `CLAUDE.md` — rewritten with all decisions baked in
- `docs/IMPLEMENTATION_PROMPT.md` — spec copied into the repo
- `.env.local` — created, gitignored, **verified working**

**Zero application code written. `app/` still untouched.**

### Supabase verified

Service role key confirmed against the live project:

| Check | Result |
|---|---|
| JWT structure | 3 segments, valid |
| `role` claim | `service_role` ✅ |
| `ref` claim | `ptewhpmxzenbmxlizxhu` — matches URL ✅ |
| Expiry | 2036-08-06 ✅ |
| `GET /rest/v1/` | **HTTP 200** ✅ |
| Tables in `public` | **0** — greenfield |

### Architecture decisions

| Decision | Value |
|---|---|
| Extraction location | Dedicated **Node worker**, own container, no public inbound HTTP |
| Queue | **Postgres** `job_queue`, `FOR UPDATE SKIP LOCKED` |
| Fallback if self-hosting is rejected | Inngest / Trigger.dev (adds a vendor, moves job state out of Postgres) |
| Spec §11.4 subprocess contract | **VOID** — no subprocess exists |
| Idempotency | Three layers: claim lock, `content_sha256`, delete-then-insert scoped to `extraction_job_id` |
| Zero-lead result | `ERR_FILE_FORMAT` — loud failure, never silent success |

### Open items — unchanged from Phase 1, minus the resolved key

1. ~~`SUPABASE_SERVICE_ROLE_KEY`~~ — ✅ **resolved 2026-08-06**, verified connecting
2. **More saved pages** — still one page only. Every field showed 100% presence, so
   nullable behaviour remains unverified. Want a different search and a "Saved
   leads" list. **Highest-value outstanding item.**
3. **Worker host** — Railway / Fly.io / Render account needed by Phase 7
4. **Staging Supabase project** — does not exist; recommend creating before Phase 12
5. **Legal review (spec §13.3)** — GDPR/UK GDPR and platform-terms question.
   Business decision for the owner and counsel. **Unresolved.**
6. **Placeholder Search Console tokens** — `app/layout.tsx:70-73`. Outside SaaS scope.

---

## 2026-08-06 — Phase 3 (schema + RLS) — code complete, **migrations not yet applied**

### Built

| File | Purpose |
|---|---|
| `supabase/migrations/0001_extensions_enums_functions.sql` | pgcrypto, pg_trgm, 10 enums, `set_updated_at()`, `is_admin()`, `deny_mutation()` |
| `0002_plans.sql` | `plans` + seeded PLACEHOLDER limits |
| `0003_profiles.sql` | `profiles`, auth trigger, **privilege-escalation guard** |
| `0004_access_subscriptions_usage.sql` | `access_requests`, `subscriptions`, `usage_counters`, `invitation_codes` |
| `0005_jobs_files_queue.sql` | `extraction_jobs`, `uploaded_files`, `job_queue` |
| `0006_extracted_leads.sql` | leads — columns from `SELECTOR_MAP.md` §3 |
| `0007_audit_and_events.sql` | `admin_audit_logs` (append-only), `system_events` |
| `supabase/APPLY_ALL.sql` | all migrations concatenated, paste-ready |
| `lib/supabase/{client,server,admin}.ts` | the three clients |
| `types/database.ts` | hand-written, regenerate with `npm run db:types` |
| `tests/integration/{helpers.ts,rls.test.ts}` | RLS + escalation tests |
| `vitest.config.ts`, `tests/setup.ts` | test harness |

### Tooling added

- `npm run typecheck` → `tsc --noEmit` ✅ **passes**
- `npm test` → `vitest run` ✅ **runs**
- `npm run db:types` → regenerate types from the live schema
- Installed: `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `server-only`,
  `vitest`, `@vitest/coverage-v8`, `dotenv`

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ **zero errors** |
| `npx eslint lib/ types/ tests/` | ✅ **zero problems** |
| `npm run lint` (whole repo) | ⚠️ 1 error + 10 warnings, **all pre-existing** |
| `npm test` | ❌ **6 failed — `PGRST205: table not found`** |

The lint error is in `app/components/OrbitalCaseStudies.tsx:135` from commit
`c9589c6`, predating this session. `app/` was not modified. Per `CLAUDE.md` rule
5 it is not mine to fix — flagged, not touched.

### 🐛 Bug found and fixed on first apply attempt

The user's first paste failed:

```
ERROR: 42P01: relation "public.profiles" does not exist
LINE 109: select 1 from public.profiles
```

**Cause:** `is_admin()` was declared `language sql`. Postgres parses and validates
a SQL-language function body at CREATE time, so it required `public.profiles` to
already exist — but the policies in `0002_plans.sql` already need `is_admin()`,
which forces the function to be defined before the table it reads.

**Fix:** `is_admin()` is now `language plpgsql`. plpgsql bodies resolve table
references at execution time, not creation time, so the function can be defined
ahead of `profiles` while still working correctly once `0003` has run.

### Verified against a real Postgres

Installed `postgresql@16` locally and built a throwaway cluster with a
Supabase-shaped stub (`auth.users`, `auth.uid()`, and the `anon` /
`authenticated` / `service_role` roles) so migrations run unmodified.

| Verification | Result |
|---|---|
| `APPLY_ALL.sql` runs clean | ✅ exit 0, zero errors |
| 12 tables created | ✅ |
| RLS enabled on **every** table | ✅ 0 tables without RLS |
| `job_queue` has zero policies | ✅ correct — denies all non-service-role |
| 5 plans seeded | ✅ |
| Profile auto-created on `auth.users` insert | ✅ |
| **User cannot self-promote to `admin`** | ✅ role reverted to `registered_user` |
| **User cannot grant themselves `access_expires_at`** | ✅ reverted to null |
| User *can* update `full_name` | ✅ allowed column works |
| **Bob cannot read Alice's profile** | ✅ 0 rows |
| `job_queue` invisible to `authenticated` | ✅ 0 rows |
| **`admin_audit_logs` UPDATE blocked** | ✅ raises, even as superuser |
| **`admin_audit_logs` DELETE blocked** | ✅ raises, even as superuser |
| One pending `access_request` per user | ✅ second insert rejected |
| **Idempotency — second full run** | ✅ exit 0, no duplicates, 12 tables, RLS intact |

Test cluster stopped and left no stray process. To rebuild it:
`initdb` a temp cluster, apply a Supabase stub schema, then `APPLY_ALL.sql`.

### ✅ Applied to the live project — 2026-08-06

Migrations applied to `ptewhpmxzenbmxlizxhu` via the SQL Editor by the user.

**`npm test` → 14/14 passing against the live project.**

| Final check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npx eslint lib/ types/ tests/ vitest.config.mts` | ✅ exit 0 |
| `npm test` | ✅ **14 passed (14)** |
| `npm run lint` (whole repo) | ⚠️ 1 error + 10 warnings, **all pre-existing in `app/`** |

Also renamed `vitest.config.ts` → `.mts` to clear a Vite ESM-in-CJS warning.

### Phase 3 acceptance (spec §7.4)

- [x] All migrations run cleanly from empty — verified on local Postgres 16 **and**
      applied live
- [x] Every table reports `rowsecurity = true` (12/12)
- [~] **`types/database.ts` is hand-written, not generated** — see deviation
- [x] `extracted_leads` columns match `SELECTOR_MAP.md` §3 exactly
- [x] Test proves user A cannot read user B's rows via the anon client
- [x] Test proves a non-admin cannot escalate their own `profiles.role`

### Deviation — types are hand-written

`supabase gen types --db-url` requires **Docker**, which is not installed here.
Generating against the remote project (`--project-id`) requires `supabase login`,
and no access token is available.

The hand-written file matches the migrations exactly, typechecks cleanly, and all
14 tests pass against the live schema. The only thing it lacks is populated
`Relationships` metadata, used by PostgREST for embedded-resource queries —
**this project writes joins explicitly and does not use them.**

To replace with generated types, run `npx supabase login` once, then
`npm run db:types`. Not blocking; worth doing before Phase 7.

### Design notes

- **`extracted_leads` columns come from `SELECTOR_MAP.md` §3**, not the wish-list.
  All parsed fields nullable — 100% presence on one page is not proof.
- **`job_queue` has RLS enabled and no policies** — deliberate. Denies every
  non-service-role client.
- **Privilege escalation is blocked by a trigger, not only a policy.** A policy
  cannot express "row writable but these columns frozen". `protect_profile_columns()`
  reverts `role`, `plan_id`, `access_expires_at`, `suspended_at`, `deleted_at`.
- **`admin_audit_logs` rejects UPDATE/DELETE for every role including service.**
- `lib/supabase/admin.ts` imports `server-only`, so the build fails if it ever
  becomes reachable from a Client Component.

---

## 2026-08-06 — Second real page analysed (parser hardening)

User supplied a second saved page (5 leads). Analysed locally, never committed.

### Findings

1. **`company_name` / `company_url` are genuinely nullable.** One lead's company
   has no LinkedIn company page: no `a[data-anonymize="company-name"]`, no
   `/sales/company/` link anywhere in the row.

2. **🔴 The company name is still present — as a bare text node.** It sits inside
   `div.artdeco-entity-lockup__subtitle`, untagged. The current selector misses
   it entirely.

   **Without a fallback we silently lose the company on ~20% of leads** (1 of 5
   on this page). A fallback rule is now mandatory — see `SELECTOR_MAP.md` §3.
   Verified: no regression on page 1 (25/25 still via anchor), recovers the
   missing company on page 2. `company_url` correctly stays NULL.

3. **The row filter is load-bearing, not defensive.** Page 2 has 25
   `li.artdeco-list__item` elements but only **5 leads** — the remainder are
   sidebar and filter items. Anchoring on `li.artdeco-list__item` alone would
   have produced 20 phantom rows.

4. **Non-ASCII parses correctly** — a German company name containing `ü`
   extracted intact.

5. Lead counts vary widely on the same layout: 25 vs 5.

### `.gitignore` hardened

The new file was named `bad list navigator .html`, which **did not match** the
`*Sales Navigator*.html` rule. Name-based patterns are not reliable.

Now denies `*.html` outright and re-allows only `tests/fixtures/html/**`.
Verified with `git add --dry-run`: a fabricated fixture is trackable, a real page
dropped anywhere else is refused. No `.html` file is tracked in this repo, so the
blanket deny costs nothing.

### Validation status

**2 pages / 30 leads.** Still unverified: a lead with no location, no blurb, or
no job title; "Saved leads" account lists; non-Latin scripts; non-UTF-8 encodings.

---

---

## 2026-08-06 — Phase 4 complete: authentication and access control

### Built

| File | Purpose |
|---|---|
| `supabase/migrations/0008_rate_limits_and_bootstrap.sql` | `rate_limits` table, `consume_rate_limit()`, `increment_usage()`, `sweep_rate_limits()`, `bootstrap_admin()` |
| `lib/errors/catalog.ts` | typed error catalog + `AppError` + `toClientError` |
| `lib/limits/plans.ts` | plan reads, Zod-validated `limits` blob |
| `lib/limits/usage.ts` | usage snapshot + atomic increment |
| **`lib/auth/decide.ts`** | **the access decision as a PURE function** |
| `lib/auth/access.ts` | `getAccessContext` / `requireAccess` / `requireAdmin` / `assert*` |
| `lib/auth/password.ts` | 12-char minimum + deny-list, **no composition rules** |
| `lib/auth/rate-limit.ts` | Postgres-backed limiter, fails **open** |
| `lib/auth/actions.ts` | the six auth flows |
| `proxy.ts` | session refresh + authentication guard |
| `app/(auth)/*` | sign-in, sign-up, verify-email, forgot-password, reset-password |
| `app/auth/callback/route.ts` | code exchange for verification + reset links |
| `app/(product)/*` | authenticated shell, dashboard, access-status page |
| `components/auth/*` | `AuthShell`, `Field`, `FormFeedback`, `SubmitButton` |
| `tests/unit/access-decision.test.ts` | 30 tests over every branch |
| `tests/unit/password.test.ts` | 15 tests |

### Design tokens added (the one permitted `globals.css` edit)

Flagged in advance in `DESIGN_TOKENS.md` §8. **Additive only** — no existing
landing-page value changed: border tokens, radius scale, shadow scale, and
status colors (success / warning / danger / info).

### 🔧 Next.js 16: `middleware` → `proxy`

The build emitted a deprecation notice. Per `AGENTS.md` ("heed deprecation
notices"), read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`
and migrated `middleware.ts` → **`proxy.ts`** with the function renamed to
`proxy`. Build is now warning-free.

Next's own docs describe this layer as **"a last resort"** and note it may run
at the CDN edge, separate from render code — which reinforces the existing rule
that it is *not* an authorization boundary.

### Design decision — the access decision is a pure function

`lib/auth/decide.ts` holds `decideAccess()`, which takes `(profile,
emailVerified, limits, usage)` and returns `{canUseScraper, reason}`. No I/O, no
request context, no secrets. `access.ts` gathers inputs and delegates.

Rationale: security logic that cannot be exhaustively tested tends not to be.
All 30 branch tests run in milliseconds with no database.

Precedence, verified by test: **suspended › email_unverified › role › expired ›
payment_required › limit_reached**. Suspension outranks admin.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npx eslint` on all new code | ✅ zero problems |
| `npm test` | ✅ **59 passed (59)** |
| `npm run build` | ✅ clean, **no deprecation warnings** |
| `grep -rn "role ===" app/ components/` | ✅ **none** — no access logic outside `lib/auth/` |
| service-role client imports | ✅ only `lib/`, never `app/` or `components/` |
| Migration 0008 applied locally + idempotent | ✅ |
| Rate limit: 5 allowed, 6th blocked | ✅ (fixed an off-by-one — it blocked the 5th) |
| `increment_usage` atomic | ✅ 1 → 5 |
| `bootstrap_admin` promotes + writes audit row | ✅ |
| `bootstrap_admin` on unknown email raises | ✅ |

### Verified in the browser

- `/sign-in` renders with the aurora treatment and product tokens
- **`/dashboard` while signed out → redirects to `/sign-in?next=%2Fdashboard`**
- Weak password (`password1234`) → rejected with the danger banner,
  **and zero users created** — the check returns before touching Supabase
- Zero console errors

### 🟡 Pending — apply migration 0008

`supabase/migrations/0008_rate_limits_and_bootstrap.sql` is verified locally but
**not yet applied to `ptewhpmxzenbmxlizxhu`**. Until it is, rate limiting
**fails open** (deliberate — a broken limiter must not lock everyone out) and
`increment_usage` will error when first called.

Paste that one file into the SQL Editor, or re-paste `APPLY_ALL.sql` (idempotent).

### First admin

There is no self-service path. After signing up and verifying your email, run
once in the SQL Editor:

```sql
select public.bootstrap_admin('husnain@outlio.io');
```

---

## 2026-08-06 — Required contact fields at sign-up (user request)

Phone number and LinkedIn profile URL are now **required to create an account**,
so a human can vet an access request before approving it.

### Built

| File | Change |
|---|---|
| `supabase/migrations/0009_profile_contact_fields.sql` | `profiles.phone`, `profiles.linkedin_url`, format CHECKs, updated `handle_new_user()` |
| `lib/auth/profile-fields.ts` | `normalizePhone`, `normalizeLinkedInUrl`, `normalizeFullName` — pure |
| `lib/auth/actions.ts` | sign-up now requires and normalises all three |
| `app/(auth)/sign-up/SignUpForm.tsx` | phone + LinkedIn fields with hints |
| `types/database.ts` | `ProfileRow.phone`, `ProfileRow.linkedin_url` |
| `tests/unit/profile-fields.test.ts` | 23 tests including hostile input |

### ⚠️ This does NOT weaken CLAUDE.md rule 1

`profiles.linkedin_url` is the **account holder's own** profile, self-supplied at
sign-up for manual vetting. It is stored as a string and **never fetched,
visited, or scraped**. It is not lead data. No request to `linkedin.com` exists
anywhere in the codebase.

### Design decisions

**Phone is E.164, country code required.** No default region is assumed —
guessing silently corrupts numbers for anyone outside it, and the customer base
is international. Also avoids a ~145 KB libphonenumber dependency for one field.
Common formatting (spaces, dashes, dots, parens) and a `00` prefix are accepted
and normalised.

**LinkedIn URL is canonicalised** to `https://www.linkedin.com/in/{slug}`.
Accepts bare domains, missing protocol, regional subdomains, trailing slashes,
query strings, and locale path prefixes. Rejects company pages, school pages,
and Sales Navigator links with a **specific** reason for each.

**Columns are NULLABLE in the database** despite being required at sign-up.
Users created out-of-band — by an admin in the Supabase dashboard, or by the
integration test suite — carry no sign-up metadata. `NOT NULL` would break admin
user creation for no security gain, since enforcement that matters is in the
sign-up flow. Format CHECKs still apply whenever a value is present.

### 🐛 Security gap caught by a hostile test

`https://www.linkedin.com/in/<script>` was **accepted**. `new URL()`
percent-encodes it to `%3Cscript%3E`, and the slug pattern allowed `%` in order
to support international names (`müller` → `m%C3%BCller`).

**Fix:** decode the slug first, then validate the DECODED form against a
unicode-aware `^[\p{L}\p{N}_-]{2,100}$`, and re-encode for storage. Unicode
letters pass; structural characters do not. Regression tests added for
`%3Cscript%3E`, `%2E%2E%2F`, `%20`, `%00`, and malformed `%zz`.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npx eslint` (all new code) | ✅ zero problems |
| `npm test` | ✅ **82 passed (82)** |
| `npm run build` | ✅ clean, zero warnings |
| Migration 0009 applied locally + idempotent | ✅ |
| Trigger copies metadata into `profiles` | ✅ all three fields |
| CHECK rejects malformed phone / phone without `+` | ✅ |
| CHECK rejects a company URL | ✅ |
| CHECK still allows NULL (admin-created users) | ✅ |

### ✅ Verified in the browser — 2026-08-07

Migration 0009 applied live by the user. Sign-up form confirmed end to end:

- All five fields render with hints and placeholders
- Phone without a country code → *"Include your country code, starting with +…"*
- LinkedIn company URL → *"That is a company page. Use your personal profile URL,
  which contains /in/."*
- **No account created** by any rejected attempt

### 🐛 Three defects found and fixed while verifying

**1. `readCounter` dumped an entire HTML page into the error message.**
Supabase went down mid-session (Cloudflare 522). Supabase surfaces upstream
failures with the origin's HTML body as `error.message`, so the thrown Error
carried a full Cloudflare error page — flooding logs and, had it ever reached a
response, leaking infrastructure detail. Now truncated to one line via
`concise()`, with `<`-prefixed bodies collapsed to `upstream returned HTML`.

**2. `getAccessContext` fetched plan + usage for users who could never pass.**
The same outage 500'd `/verify-email` and `/sign-up` — pages that only needed to
know whether anyone was signed in. Split `decideAccess` into `precheckAccess`
(profile only) and `decideLimits` (plan + usage). Pre-checks run first, so plan
and usage are fetched **only** when a user has otherwise qualified.
Two fewer round trips for denied users, and a usage-table outage can no longer
take down sign-in or verify-email.

**3. 🔴 React 19 resets uncontrolled form fields after a form action.**
One mistyped field wiped the entire sign-up form — name, email, phone, LinkedIn
URL and password all cleared. Fixed by echoing submitted values back on the
error state and restoring them via `defaultValue`. **The password is never
echoed**, and is correctly the only field cleared. Applied to sign-in too.

### 🔧 Turbopack workspace root

`next dev` and `next build` warned on every run: a stray
`~/package-lock.json` (an accidental `npm install` in the home directory, Feb
2026) made Turbopack infer `~` as the workspace root, broadening filesystem
watching. Fixed project-locally by pinning `turbopack.root` in `next.config.ts`
per the bundled docs. **Nothing outside the repo was modified** — the stray
lockfile is still there and is the user's to remove.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npx eslint` (all new code) | ✅ zero problems |
| `npm test` | ✅ **82 passed (82)**, 4 files |
| `npm run build` | ✅ clean, zero warnings |
| Sign-up validation live | ✅ specific errors, values retained, password cleared |
| Accounts created by rejected attempts | ✅ **zero** |

---

---

## 2026-08-07 — Phase 5 complete: access requests, entitlements, payments

### Built

| File | Purpose |
|---|---|
| `supabase/migrations/0010_entitlements_and_invitations.sql` | `grant_entitlement()`, `revoke_entitlement()`, `redeem_invitation_code()` |
| `supabase/migrations/0011_audit_logs_survive_user_deletion.sql` | drops FKs that blocked account deletion |
| `lib/payments/provider.ts` | `PaymentProvider` interface + `NotConfiguredError` |
| `lib/payments/manual.ts` | **fully implemented** — records a `payment` access request |
| `lib/payments/stripe.ts` | real compiling class, every method throws `NotConfiguredError` |
| `lib/payments/registry.ts` | selection by `PAYMENT_PROVIDER`; swapping needs no change elsewhere |
| `lib/payments/grant.ts` | `grantEntitlement` / `revokeEntitlement` / `redeemInvitationCode` |
| `lib/access/actions.ts` | four request flows, each rate-limited |
| `components/access/RequestOptions.tsx` | the four options |
| `app/(product)/dashboard/access/page.tsx` | status + options, per-reason copy |
| `tests/integration/invitations.test.ts` | 8 tests incl. the concurrency criterion |

### Design decisions

**Entitlement granting is a Postgres function, not application code.** A grant
touches `profiles`, `subscriptions`, `access_requests` and `admin_audit_logs`.
Splitting that across round trips would let it half-apply. `grant_entitlement()`
is the single path every provider, the invitation flow, and the admin panel call.

**Redemption atomicity comes from one guarded UPDATE**, not a read-then-write:
`update ... where used_count < max_uses`. Postgres serialises concurrent writers
on the row, so exactly one caller observes each transition.

**`invalid` and `unavailable` are distinguished for logs only.** The UI shows one
generic message so redemption cannot become a code-enumeration oracle.

### 🐛 Two real bugs found by testing under concurrency

**1. Multi-use codes silently behaved as single-use.**
`redeem_invitation_code` passed the *invitation code's id* as
`subscriptions.provider_ref`, colliding with the
`subscriptions_provider_ref_uniq (provider, provider_ref)` index. With
`max_uses = 3`, the 2nd and 3rd redeemers failed on a unique violation.
Fixed by composing `{code_id}:{user_id}` — preserving the Stripe guarantee
(one subscription per provider reference) while allowing a code to serve
`max_uses` distinct users.

**2. 🔴 Users with audit rows could not be deleted at all.**
`admin_audit_logs.admin_id` was `references auth.users on delete set null`.
Postgres implements SET NULL as an UPDATE, which the append-only trigger from
0007 correctly refused:

```
ERROR: Table public.admin_audit_logs is append-only; UPDATE is not permitted
```

So `delete from auth.users` failed for anyone who appeared in an audit row —
breaking account deletion and the GDPR right to erasure. Migration 0011 drops
those FKs and keeps plain uuid columns, which is the correct design for an
append-only log: it must outlive the rows it describes, and "who did this?" must
stay answerable after the actor's account is gone. Verified that append-only
enforcement still holds afterwards.

Neither bug is reachable by sequential testing. Both needed genuinely parallel
connections.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npx eslint` (all new code) | ✅ zero problems |
| `npm run build` | ✅ clean, zero warnings |
| Migrations 0010 + 0011 local, idempotent | ✅ |
| **10 parallel redemptions, `max_uses=1`** | ✅ **exactly 1 ok**, `used_count=1`, 1 subscriber |
| **12 parallel redemptions, `max_uses=3`** | ✅ **exactly 3 ok**, `used_count=3`, 3 subscribers, 3 subscription rows |
| Expired / inactive code → `unavailable` | ✅ |
| Already-entitled user → `already_active` | ✅ |
| Grant writes subscription + audit row | ✅ |
| User with audit rows can be deleted | ✅ (was broken) |
| Audit log still append-only after 0011 | ✅ |

Also configured `@typescript-eslint/no-unused-vars` to honour the leading-underscore
convention — interface implementations must accept parameters they do not use.

### ✅ Migrations 0010 + 0011 applied live — 2026-08-07

Verified by RPC probe, then the full suite run against the project.

**`npm test` → 90/90 passing against `ptewhpmxzenbmxlizxhu`.**

Migration 0011 confirmed working in production: six test users carrying
`entitlement.grant` audit rows were deleted successfully. That delete would have
failed before the fix.

### Test-suite fixes found while running against the real project

**1. Unnecessary sign-ins were tripping Supabase's per-IP token rate limit.**
`createTestUser` signs a user in, but the invitation tests drive everything
through service-role RPCs and never need an authenticated client. ~24 sign-ins
per run hit the limit and produced empty-message failures. Added
`createAuthUser()` (create, no sign-in) and switched the invitation suite to it.
Side effect: suite runtime dropped from **122s → 28s**.

**2. A failed sign-in leaked the user it had just created.**
`createTestUser` threw before the caller learned the id, so no `afterAll` could
remove it — six orphaned users and eight orphaned codes accumulated in the live
project. The error path now deletes the user before throwing, and the message
explains the rate-limit cause.

**3. `afterAll` exceeded Vitest's 10s default hook timeout**, deleting ~20 users
sequentially. A timed-out cleanup hook silently leaves orphans. Cleanup is now
`Promise.allSettled` in parallel — settled, not all, so one failed delete cannot
abandon the rest — and `hookTimeout` is raised to 60s.

Live project swept clean afterwards: 1 user (`husnain@outlio.io`), 0 test codes,
0 subscriptions.

---

## 2026-08-07 — Phase 6: upload pipeline

### Built

| File | Purpose |
|---|---|
| `supabase/migrations/0012_storage_policies.sql` | `storage.objects` RLS — own-prefix only |
| `lib/upload/sniff.ts` | content sniffing, 20 binary signatures, encoding detection |
| `lib/upload/storage-key.ts` | server-generated keys, filename sanitisation |
| `lib/upload/limits.ts` | effective limits = stricter of plan and service |
| `lib/upload/process.ts` | validation order + job creation |
| `lib/upload/actions.ts` | the upload Server Action |
| `components/upload/UploadForm.tsx` | drag-drop, per-file list, consent gate |
| `app/(product)/dashboard/extract/new/page.tsx` | the upload screen |
| `tests/unit/upload-sniff.test.ts` | 34 tests |
| `tests/unit/storage-key.test.ts` | 21 tests |

### Storage bucket created

Private `uploads` bucket created via the Storage API: `public: false`,
10 MB `file_size_limit`, `allowed_mime_types: ["text/html"]`.

### Design decisions

**Extension and MIME are checked, but only as hints.** Both are attacker-
controlled. They run first purely because they are cheap and produce a clearer
message than a sniff failure. The decision is made by bytes.

**Encoding is detected, not assumed.** A page saved as UTF-16 is valid HTML whose
bytes read as `<\0h\0t\0m\0l\0`; a hardcoded UTF-8 decode finds no markers and
would reject it. That is exactly defect G3 in the original scraper
(`SCRAPER_AUDIT.md`), so the sniffer detects BOMs and infers UTF-16 from
interleaved NULs.

**Storage keys are structurally incapable of traversal.** All three components
are validated as UUIDs before the key is built, so the result can only ever
match `^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.html$`. A hostile filename
cannot influence it because the filename is never an input.

**Two different filename sanitisers, deliberately.** `sanitizeDisplayFilename`
is permissive — it is a display string, and mangling the user's filename is
worse than showing it, since nothing executes it. `sanitizeExportFilename` is
strict `[A-Za-z0-9._-]` because that value does reach a `Content-Disposition`
header.

**Size is measured from the bytes actually held**, never `file.size`, which the
client controls.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npx eslint` (all new code) | ✅ zero problems |
| `npm test` | ✅ **145 passed (145)** |
| `npm run build` | ✅ clean, zero warnings |
| **`.exe` (PE header) named `.html` rejected** | ✅ `ERR_FILE_TYPE` |
| 15 binary signatures rejected | ✅ ZIP, PDF, ELF, PNG, GIF, JPEG, GZIP, RAR, 7z, Mach-O, class, Office, SQLite, WASM |
| 0-byte and whitespace-only rejected | ✅ `ERR_FILE_EMPTY` |
| Valid HTML but not a results page | ✅ `ERR_FILE_FORMAT` |
| UTF-16LE HTML with BOM accepted | ✅ |
| NUL inside UTF-8 rejected | ✅ |
| HTML only after the 4 KB window rejected | ✅ |
| **`../`, NUL, `; rm -rf /`, `$(id)` cannot reach a key** | ✅ throws |
| Prefix-collision `{uuid}-evil/…` rejected | ✅ |

### Storage privacy verified against the live bucket

| Attempt | Result |
|---|---|
| Anonymous GET, no key | **HTTP 400** — denied |
| GET via the public path | **HTTP 400** — denied |
| GET with the publishable (anon) key | **HTTP 400** — denied |
| GET with a 60s signed URL | **HTTP 200** ✅ |

That is spec §10.4's "unreachable without a signed URL", proven end to end. The
probe object was deleted afterwards.

### ✅ Migration 0012 applied live — 2026-08-07

**Gotcha for future storage migrations:** `alter table storage.objects enable row
level security` fails from the SQL Editor with

```
ERROR: 42501: must be owner of table objects
```

because `storage.objects` is owned by `supabase_admin`, not the `postgres` role
the editor runs as. Supabase enables RLS there by default, so the statement was
only an assertion — it was removed. Creating and dropping POLICIES is permitted,
which is all that is needed. The migration now carries a comment explaining this
so nobody adds the line back.

### Storage policies verified behaviourally, with a real user session

| Test | Result |
|---|---|
| User reads **own** prefix | **200** ✅ |
| User reads **another user's** prefix | **400** denied ✅ |
| User **deletes** another user's object | **400** denied ✅ |
| Bare anon key, no session | **400** denied ✅ |
| Victim's object still present afterwards | **200** ✅ |

The last row matters most: it proves the delete was blocked by policy rather
than erroring while succeeding. Test user and objects removed afterwards.

### Not yet built (Phase 7)

The upload creates an `extraction_jobs` row with status `uploaded` and stores the
files, but **nothing processes them yet** — no `job_queue` row is enqueued and no
worker exists. The upload screen is honest about this; the jobs list arrives with
the worker.

---

## 2026-08-07 — Phase 7: parser, queue, worker, CSV

### Architecture change — worker deployment (at ~5 users)

Railway deferred on cost. **The queue is unchanged**: `job_queue`,
`FOR UPDATE SKIP LOCKED`, claims, attempts, backoff all identical. Only the
trigger differs — `after()` on the upload request instead of a container loop.
`lib/worker/process-job.ts` is deployment-agnostic; moving to Railway means
calling `claimAndProcessOne()` from a loop instead of from `after()`.

**Consequence:** a Vercel function timeout can cut `after()` short, leaving a job
`claimed` forever. `reap_stale_jobs()` is therefore not optional — it is the only
thing that recovers a stalled job without an always-on worker.

### Built

| File | Purpose |
|---|---|
| `supabase/migrations/0013_queue_and_retention.sql` | `enqueue_job`, `claim_next_job`, `reap_stale_jobs`, `purge_job_leads`, `lead_keys` |
| `lib/leads/parse.ts` | cheerio parser from `SELECTOR_MAP.md` |
| `lib/leads/canonical-url.ts` | URL canonicalisation |
| `lib/leads/dedupe.ts` | 5 strategies, 4 modes, cross-job keys |
| `lib/export/sanitize.ts` | **the single** `sanitizeCell` + RFC 4180 CSV |
| `lib/worker/process-job.ts` | per-file isolation, idempotent persist, CSV build |
| `lib/jobs/actions.ts` | signed download URL, purge |
| `components/jobs/JobActions.tsx` | download + clear buttons |
| `app/(product)/dashboard/jobs/page.tsx` | jobs list |
| `tests/fixtures/html/*` | 8 fabricated fixtures incl. hostile set |
| `tests/unit/parse.test.ts` | 40 tests |

### Product decision — CSV-first, no leads table

Per the user: leads are delivered as a **CSV download**, not browsed in a table,
and the data is cleared once they have it.

**`lead_keys` retains only the opaque dedupe key** after a purge — no name,
company, URL or blurb. Cross-job duplicate detection survives at ~8% of the
storage, and it is a privacy improvement rather than a compromise. Verified:
7 leads purged → 0 lead rows, 7 keys retained, re-purge bumps `seen_count`.

### Profile URL — resolved

The public `linkedin.com/in/` URL is **not** in the saved HTML (0 occurrences of
`/in/`, `publicIdentifier`, `vanityName` across both real pages). But each row
carries `urn:li:fs_salesProfile:(ACwAA…)` — and that identifier is **identical**
to the `/sales/lead/` id (25 distinct from each, same set).

LinkedIn accepts a member URN in the `/in/` path, so
`https://www.linkedin.com/in/{memberUrn}` is built from data already extracted —
no request to linkedin.com, no guessing. **Awaiting user confirmation that these
resolve**; if not, fall back to the Sales Nav URL.

⚠️ The page also contains `urn:li:member:{id}` — the ACCOUNT HOLDER's own member
id, in A/B-test config. Never parsed, never stored.

### 🐛 Four bugs found by testing

1. **Tenure split broke on node boundaries.** Extraction walked child text nodes,
   so it worked on real pages (two nodes) but not fixtures (one node). Rewritten
   to parse the combined string — node boundaries are an implementation detail.
2. **`\b` after `"in role"` silently returned null** when the halves are welded:
   the next char is a digit, and `e`→`3` is not a word boundary.
3. **`claim_next_job`: ambiguous `attempts`** — `RETURNS TABLE` declares an OUT
   parameter of the same name as the column. Qualified as `public.job_queue.attempts`.
4. **`reap_stale_jobs`: enum cast** — a bare `'failed'` in a CASE is text and
   will not coerce into `queue_status`. Added `::public.queue_status`.

Bugs 3 and 4 were unreachable without executing the SQL.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npx eslint` | ✅ zero problems |
| `npm test` | ✅ **185 passed** |
| `npm run build` | ✅ clean |
| Real page 1 | ✅ 25 leads, all 10 fields 25/25 |
| Real page 2 | ✅ 5 leads, company **5/5** via fallback, companyUrl **4/5** |
| Job-title trap | ✅ title never starts with a digit; tenure split both shapes |
| Two workers claim different jobs | ✅ SKIP LOCKED |
| Stale claim reaped with backoff | ✅ 2 reaped, `attempts+1`, future `next_attempt_at` |
| Dead letter past `max_attempts` | ✅ queue+job `failed`, `ERR_TIMEOUT` |
| Purge retains keys only | ✅ 7 → 0 leads, 7 keys, no PII columns |
| `=cmd\|'/c calc'!A1` neutralised | ✅ `'=cmd\|…` |
| Hostile fixtures rejected | ✅ binary, div bomb, empty, zero-results |

### 🟡 Pending — apply migration 0013

`supabase/APPLY_PENDING.sql` (218 lines). Uploads will queue but never process
until it is applied — `enqueue_job` and `claim_next_job` do not exist yet.

### Not yet built

- Scheduled reaper invocation (currently only callable, not called on a timer)
- XLSX export (CSV only)
- Admin dashboard (Phase 11)

---

## 2026-08-08 — Phase 8: made it actually usable

Phase 7 finished with a working pipeline that **could not be used**. Three gaps:

1. **`/admin` did not exist** — the product layout linked to it for admins, so
   the only admin account got a 404.
2. **No navigation** — nothing linked `/dashboard` to `/dashboard/jobs` or
   `/dashboard/extract/new`. Every route was reachable only by typing a URL.
3. **Nothing called `reap_stale_jobs()`** — it existed but ran on no schedule,
   so a stalled job stayed stalled forever.

And the one that actually blocked the business model: **access is
manual-approval only, but there was no UI to approve anyone.** Users could
request access; granting it required hand-written SQL.

### Built

| File | Purpose |
|---|---|
| `components/product/ProductNav.tsx` | primary nav with `aria-current` |
| `lib/admin/actions.ts` | approve / revoke / suspend, all `assertAdmin()` |
| `components/admin/UserRow.tsx` | per-user admin controls |
| `app/admin/layout.tsx` | admin shell, `requireAdmin()` |
| `app/admin/page.tsx` | users, pending requests, audit log |

Also: dashboard now links to upload and jobs (the old copy still said "upload is
not available yet", which was stale), and the jobs page calls
`reap_stale_jobs()` on load.

### Design decisions

**The reaper runs on jobs-page load, not a cron.** Viewing the jobs list is the
moment a stuck job matters to someone. One indexed UPDATE, idempotent, and it
needs no scheduler on the free tier. Failures are swallowed — a reaper that
cannot run must not break the page.

**`requireAdmin()` is called in the layout AND every page AND every action.**
A layout is not an authorization boundary: Next can render a route without
re-running a parent layout on some navigations, and Server Actions never pass
through layouts at all.

**Admins cannot revoke or suspend themselves** — that would lock the only admin
out of the page that grants access.

### Verification — signed in as a real admin

Session obtained by minting a magic link with the service-role key; no password
was handled.

| Route | Result |
|---|---|
| `/dashboard` | 200, nav renders, usage cards |
| `/dashboard/extract/new` | 200, dropzone + consent gate |
| `/dashboard/jobs` | 200 |
| `/admin` | 200 |
| Signed out → `/dashboard` | redirects to `/sign-in?next=…` |

**The admin page showed a REAL pending request** — a second user had signed up
and requested a sales call. Signup → access request → admin review works
end to end for a real person, not just in tests.

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npx eslint` | ✅ zero problems |
| `npm test` | ✅ **185 passed** |
| `npm run build` | ✅ clean, 19 routes |
| `grep "role ===" app/ components/` | 1 hit, annotated as presentation-only |
| service-role importers | all server modules; none client-reachable |

### Still not built

- Compliance pages `/acceptable-use`, `/data-processing` (spec §13.3)
- Security headers: CSP, HSTS, `Referrer-Policy` (spec §13.1)
- XLSX export (CSV only)
- `npm audit`: 3 high-severity in `sharp`, needs Next 16.2.10 → 16.3.0
- Admin: job inspection, invitation-code management, system events

### Open questions for the user

1. **Do `linkedin.com/in/{memberUrn}` URLs resolve?** Every CSV row depends on it.
2. **Lead List page DOM** — the parser targets search results and will reject a
   lead-list page with `ERR_FILE_FORMAT`.

---

## 2026-08-08 — Lead Engine marketing page

### Built

| File | Purpose |
|---|---|
| `app/leadengine/page.tsx` | product landing page at `/leadengine` |
| `components/leadengine/StudioHero.tsx` | hero wrapper, dynamic import |
| `components/ui/volumetric-studio.tsx` | 3D volumetric spotlight room |
| `lib/utils.ts` | `cn()` — clsx + tailwind-merge |

Nav gained a **"Try Outlio's Lead Engine"** button (desktop + mobile).

### ⚠️ Landing page modified — rule 5 exception

`CLAUDE.md` rule 5 says the landing page is read-only. The user explicitly asked
for this nav button, which is their call to make. **Only `Nav.tsx` was touched**,
and only to add two links. No other landing-page file was changed.

### Design decisions

**Beams tinted to `rgb(196,198,255)`** — a desaturated lift of `--accent`
(#4f4bff). A literal accent reads as a stage gel rather than light. The room
stays black because the volumetric effect requires darkness; it works as
deliberate contrast against the paper-white marketing pages, and every section
below the hero returns to the normal Outlio palette.

**three.js is dynamically imported with `ssr: false`.** It is ~25 MB unpacked and
lands in a 908 KB chunk. Verified: **the homepage does not reference that chunk
at all.** The volumetric spotlights also need WebGL, which does not exist during
SSR.

**Reveal timings compressed from 1.6–2.3s to 0.45–1.0s**, and the flicker from
~1.8s to ~0.73s. The headline was gated behind the flicker; content invisible for
over two seconds reads as a broken page.

**Reduced motion resolved in initial state, not an effect.** Setting it inside an
effect renders dark then immediately re-renders lit — a cascading render, and a
visible flash for exactly the users who asked for less movement.

### Pricing published

| Plan | Price | Limits |
|---|---|---|
| Free trial | $0, 1 day | **5 extractions**, all features, no card |
| Lead Engine | **$40/month** | Unlimited extractions, 100 files/batch |

⚠️ These are **marketing copy only**. `plans.limits` in the database still holds
the Phase 3 PLACEHOLDER values and does NOT match. Seeding a real `$40 unlimited`
plan and a `5-extraction / 1-day` trial is outstanding.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ zero errors |
| `npx eslint` | ✅ zero problems |
| `npm test` | ✅ 185 passed |
| `npm run build` | ✅ `/leadengine` static, 20 routes |
| three.js in homepage bundle | ✅ **0 references** |
| Pricing/product copy server-rendered | ✅ present in initial HTML |

One transient test failure occurred on a live-Supabase integration run and did
not reproduce.

### Not done — `app.outlio.io` subdomain

Requires DNS + Vercel domain config (user), then a `proxy.ts` rewrite and an
auth-cookie domain decision (me). See the handover notes.

---

## 2026-08-14 — Lead export and CRM integrations, Phase 1

### Built

| File | Purpose |
|---|---|
| `supabase/migrations/0034_lead_exports_and_integrations.sql` | Provider-independent connection metadata, service-only encrypted secrets, OAuth transactions, export history/errors, CRM record links, RLS, and Sales Navigator URL persistence |
| `lib/export/leads.ts` | Real database row → normalized LinkedIn/Sales Navigator `ExportLead` mapping |
| `lib/integrations/types.ts` | Extensible integration/provider contracts and result types |
| `lib/integrations/crypto.ts` | Versioned AES-256-GCM credential envelopes backed by `INTEGRATION_ENCRYPTION_KEY` |
| `.env.example` | Server-only provider credential and callback environment contract |
| `tests/unit/export-leads.test.ts` | Normalization and missing-data coverage |
| `tests/unit/integration-crypto.test.ts` | Credential round-trip, nonce, wrong-key, tamper, and key-length coverage |

The parser already emitted `salesNavUrl`, but `process-job.ts` did not persist it.
Migration 0034 adds `extracted_leads.sales_navigator_url`, and new lead inserts now
preserve the real value. No scraper selectors or extraction behavior changed.

### Security model

- `integration_connections` contains safe account/status metadata only.
- OAuth tokens and Clay credentials are stored only as AES-256-GCM ciphertext in
  `integration_secrets`, which has RLS enabled, no client policies, and no client
  grants.
- OAuth `state` is represented by a SHA-256 hash; PKCE verifiers have an encrypted
  storage column and transactions expire.
- Composite foreign keys prevent service-role writes from linking connections,
  leads, export jobs, and errors across tenants.
- CRM record links provide a deterministic deduplication/update path for later
  provider adapters.

### Verification

| Check | Result |
|---|---|
| Full unit suite | ✅ 311 passed |
| `npm run typecheck` | ✅ zero errors |
| ESLint on every changed TS/TSX file | ✅ zero problems |
| `git diff --check` | ✅ clean |
| Migration applied twice to throwaway Postgres | ✅ zero errors / idempotent |
| New integration tables with RLS enabled | ✅ 6/6 |
| `npm run build` | ✅ production build completed |

### Deployment status

Migrations 0034 and 0035 are applied to the live Supabase project. The provider
adapters, OAuth routes, canonical CSV fields, Settings UI, and selected-lead
export UI are implemented. External connections still require an authenticated
customer to complete each provider's interactive connection flow.

## 2026-08-14 — Clay integration vertical slice

### Built

- Settings → Integrations now has a Clay connection card with Webhook URL,
  optional Authentication Token, Connect, Test Connection, and Disconnect.
- Connection credentials are tested before save, encrypted server-side, and
  never displayed again. Disconnect atomically deletes the encrypted secret.
- The latest-leads table now has accessible row selection and select-all-visible
  controls without changing the existing table hierarchy or navigation.
- Exporting selected leads re-authenticates, enforces existing access/rate limits,
  reloads every lead by tenant-owned ID, batches webhook requests, records export
  history and per-lead failures, and reports partial completion accurately.
- Clay payloads use stable normalized fields and preserve unavailable values as
  null rather than inventing data.

### Verification

- Clay adapter tests cover webhook allow-list validation, optional auth header,
  safe 401 handling, payload mapping, and partial exports.
- Migration save/disconnect RPCs were exercised on throwaway Postgres: one
  encrypted secret existed after connect and zero remained after disconnect.
- The supplied test webhook rejects both no token and the literal
  `YOUR_AUTH_TOKEN_HERE` placeholder with HTTP 401. A real test token is still
  required before the external Clay connection can be marked verified.
- Full unit suite: 311 passed. TypeScript, changed-file ESLint, migration
  idempotency, and the Next.js production build all pass.

## 2026-08-14 — HubSpot multi-tenant OAuth integration

### Built

- Added POST connect/disconnect routes and the GET OAuth callback at
  `/api/integrations/hubspot/*` using the fixed production callback
  `https://app.outlio.io/api/integrations/hubspot/callback`.
- The authorization URL is account-agnostic, so every Outlio user selects and
  authorizes their own HubSpot account. No developer/test portal ID is present.
- OAuth state is a 32-byte nonce stored only as a SHA-256 hash and atomically
  consumed against the initiating `auth.uid()`.
- Because authenticated product sessions may be host-only on `app.outlio.io`
  while the required callback is on `outlio.io`, a ten-minute encrypted,
  HttpOnly browser binding crosses only the Outlio subdomains. It contains no
  Supabase session token and returns the user to the host where they started.
- Current HubSpot `2026-03` endpoints exchange, refresh, and revoke OAuth
  tokens. Access/refresh tokens are AES-256-GCM encrypted in the service-only
  secret table; safe account ID, scopes, and expiry remain tenant metadata.
- Migration 0035 atomically saves connections and rotates tokens with an
  optimistic ciphertext check. Every service-role query is scoped by user ID
  and provider.
- Settings uses the existing integration-card visual language for Connect,
  Reconnect, and Disconnect without changing the page structure.
- Selected leads export through HubSpot's current contacts batch endpoints.
  Existing tenant-scoped CRM record links are updated; unlinked leads are
  created and linked for future deterministic updates.
- The canonical lead fields map to first/last name, LinkedIn URL, job title,
  company, website, and a Sales Navigator URL note. No broad HubSpot scope or
  custom schema permission is required.

### Verification

- Full unit suite: 311 passed across 24 test files.
- TypeScript and focused HubSpot ESLint: zero errors.
- Production build includes all three dynamic HubSpot routes.
- HubSpot CLI validation: `SUCCESS Project outlio-lead-engine is valid and ready
  to upload` after replacing placeholder support metadata.
- HubSpot CLI build 5 uploaded, built, and deployed successfully.
- Vercel production deployment `dpl_8LFcD2NTHWpqNW42MUCbcoXDke6R` completed and
  is aliased to `outlio.io`; `app.outlio.io` serves the deployed routes through
  the configured proxy.
- Live unauthenticated checks confirm invalid callback state is rejected and
  connect/disconnect require an Outlio session. The final customer-authorized
  OAuth round trip remains interactive and is not claimed complete.

### Deployment configuration

- Migrations 0034 and 0035 are applied.
- Server-only `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`,
  `HUBSPOT_REDIRECT_URI`, and `INTEGRATION_ENCRYPTION_KEY` are set in Vercel
  Production.
- The production redirect URI must remain
  `https://app.outlio.io/api/integrations/hubspot/callback`.

## 2026-08-14 — Salesforce multi-tenant OAuth and lead export

### Built

- Added authenticated connect, callback, and disconnect routes under
  `/api/integrations/salesforce/*` plus the JSON export endpoint at
  `/api/exports/salesforce`.
- Uses Salesforce OAuth 2.0 Web Server authorization-code flow with a one-time
  SHA-256-hashed state, S256 PKCE, an encrypted server-side verifier, and the
  confidential client secret only in server token requests.
- Stores each Supabase user's Salesforce organization ID, encrypted access and
  refresh tokens, and validated `instance_url` in that tenant's connection.
  API calls use the returned organization instance, never a developer org.
- Refresh Token Rotation is race-safe across serverless instances: migration
  0037 adds a short database lease, atomically swaps the encrypted replacement
  refresh token, and makes competing requests reuse the saved winner.
- Exports selected Outlio records as standard Salesforce `Lead` objects through
  REST Composite API v67.0, then stores tenant-scoped record links so later
  exports update the same Salesforce leads.
- Salesforce Lead mapping splits First/Last Name, maps Company and Website,
  and places LinkedIn Profile, LinkedIn Sales Navigator URL, and raw
  location in Description. Missing LastName or Company produces a
  per-lead validation error instead of fabricated CRM data.
- `/api/exports/salesforce` returns `totalRequested`,
  `successfullyExported`, `failed`, and safe per-lead `errors`; raw Salesforce
  validation text is never returned or persisted.
- Added the Salesforce card and export control using the existing Settings and
  extraction-workspace visual language.

### Deployment

- Migrations 0034–0037 are registered and applied in the linked production
  Supabase project.
- Production contains server-only `SALESFORCE_CLIENT_ID`,
  `SALESFORCE_CLIENT_SECRET`, `SALESFORCE_REDIRECT_URI`, and
  `INTEGRATION_ENCRYPTION_KEY` environment entries.
- Full suite: 320 tests across 26 files; TypeScript, focused ESLint, local
  production build, Vercel production build, and diff checks pass.
- Vercel deployment `dpl_H2sQj6n7N6Dn7s2XFf9j4rP9FBPi` is live. Smoke tests
  confirm callback state rejection, Supabase authentication on connect and
  disconnect, same-origin enforcement, and authentication on the export API.
- The external client app must allow
  `https://app.outlio.io/api/integrations/salesforce/callback`, scopes `api` and
  `refresh_token`, PKCE, client-secret validation, and Refresh Token Rotation.

### Canonical lead export fields

The active CSV/sheet schema, Clay payload, CRM adapters, normalized export
object, and dashboard lead table now use this exact order: **Name, LinkedIn
Profile, Job Title, Company, Company URL, Location, Sales Navigator URL**. New
extraction CSVs contain only these seven columns. Existing stored CSV objects
are immutable and must be regenerated by a new extraction if the new format is
required.

## 2026-08-14 — Connector menu, Google exports, Clay pacing, and HighLevel MVP

### Built

- Replaced the separate CRM buttons and per-run Download CSV button with a
  single logo-based export dropdown. It offers CSV, Google Sheets, Google
  Drive, HubSpot, Salesforce, GoHighLevel, and Clay while preserving the
  existing dashboard layout and selection behavior.
- Added real connector marks to integration cards and export menus. Added a
  combined Google Sheets & Drive settings card and a branded GoHighLevel card.
- Implemented multi-tenant Google OAuth under `/api/integrations/google/*`.
  Tokens are encrypted server-side per Supabase user, refreshed with an
  optimistic compare-and-swap, and never returned to client JavaScript.
- Google Sheets exports create a spreadsheet with the canonical seven columns;
  Google Drive exports create a CSV file in the connected user's Drive using
  the narrow `drive.file` scope.
- Diagnosed Clay's production 22/24 partial export: all 24 failures were HTTP
  429 rate limits. Clay exports are now paced sequentially and retry 429/5xx
  responses with bounded exponential backoff and `Retry-After` support.
- Added visible pending states to HubSpot and Salesforce connect buttons and
  safe server telemetry for OAuth-start failure reasons. Quoted Vercel values
  are normalized without ever logging credentials.
- Made the extension prompt compact and moved it from the right sidebar into
  the dashboard's left/main column.
- Implemented GoHighLevel with per-user Private Integration Tokens (no
  Marketplace OAuth): connect, test, update token, disconnect, selected/run
  exports, and `/api/exports/ghl`. Tokens and Location IDs are encrypted in the
  existing service-role-only secrets table. Contact exports map name, company,
  website, and raw location, and use reusable optional custom fields for the
  LinkedIn, Sales Navigator, and company profile URLs.

### Verification

- Production Clay export records confirm the prior failures were exactly 24
  `CLAY_RATE_LIMITED` errors.
- TypeScript, focused ESLint, and the Next.js production build pass.
- Added six Google and HighLevel integration tests and strengthened the Clay
  rate-limit test; the complete suite passes: 326 tests across 28 files,
  including live tenant-isolation tests.
- Google and HighLevel persistence works against the existing integration
  tables without requiring the new helper functions; migrations 0038–0039 add
  optional atomic database helpers for environments that apply repository
  migrations automatically.
- Vercel production deployment `dpl_J9sCpPWoSyMzxDAmnucvMBR3zCB4` is live on
  both `outlio.io` and `app.outlio.io`. Public smoke tests confirm every OAuth
  start route requires a Supabase session, invalid Google state is rejected,
  and all HighLevel mutation/export routes return 401 without authentication.

---

### Superseded — Phase 6 plan

1. `/dashboard/extract/new` — drag-and-drop, per-file progress, consent checkbox
2. Server validation in order: auth → limits → count/size → extension+MIME →
   **content sniffing** → sha256 → server-generated storage key
3. Private `uploads` bucket, signed URLs only
4. Hostile fixture tests: `.exe` renamed `.html`, 0-byte, `../` in filename,
   null bytes, oversized

---

### Superseded — Phase 5 plan

1. `lib/payments/provider.ts` interface + `ManualProvider` (fully implemented)
   + `StripeProvider` throwing `NotConfiguredError` (real, compiling, not a stub)
2. `grantEntitlement()` — one path every provider and the admin panel call
3. Access-request submission form on `/dashboard/access`
4. Invitation codes: constant-time compare, atomic redemption
5. Test: concurrent redemption of a `max_uses = 1` code succeeds exactly once

---

### Superseded — Phase 4 plan

1. `lib/auth/access.ts` — `getAccessContext()`, `requireAccess()`, `requireAdmin()`.
   **The single source of access truth.** Nothing else decides access.
2. `middleware.ts` — session refresh and an authentication guard only.
   Authorization happens in the route; middleware is convenience, not a boundary.
3. Six auth flows: sign-up with email verification, sign-in, password reset,
   sign-out, resend verification, session refresh
4. Rate limiting: 5 attempts / 15 min per IP+email, generic errors that do not
   reveal whether an account exists
5. Admin bootstrap via `ADMIN_BOOTSTRAP_EMAIL` — no self-service path to admin
6. Tests: `registered_user` gets 403 on protected routes; suspended and expired
   accounts blocked with **distinct `reason` values**

Phase 4 needs nothing further from the user.

## 2026-08-26 — Public web research MCP MVP

### Built

- Added a standalone Node/TypeScript MCP service under
  `services/web-research-mcp` with stateless Streamable HTTP tools for starting,
  polling, and retrieving durable lead-research jobs.
- Implemented the end-to-end public-web pipeline: deterministic query
  generation, a modular DuckDuckGo HTML search provider, URL normalization,
  safe concurrent page fetching, Cheerio cleanup, code-level signal
  extraction, relevance and source-quality scoring, bounded chunking, Gemini
  semantic extraction, confidence scoring, corroboration, conflict retention,
  and structured results.
- Added explicit CAPTCHA/challenge, login, paywall, restricted-host, response
  size, timeout, redirect, and SSRF boundaries. DuckDuckGo challenges fail
  closed as `SEARCH_PROVIDER_BLOCKED`; no bypass is attempted.
- Added PostgreSQL-backed jobs and TTL caches using `FOR UPDATE SKIP LOCKED`,
  with an in-memory local/test implementation. Search results, fetched pages,
  and extraction outputs are cached independently.
- Added tenant-and-lead-scoped completed result storage plus the
  `research_latest` MCP tool, allowing Hubble/RAG to reuse one completed
  research bundle instead of repeating web searches.
- Added the bounded `web_search` MCP tool and an authenticated, server-only
  Outlio MCP client. Hubble's search waterfall now prefers cached Solr evidence,
  then the operator-owned research MCP, while retaining Google CSE, Brave, and
  Tavily as automatic fallbacks when the MCP is absent, stopped, challenged, or
  returns malformed output.
- Added bearer authentication for hosted use, production configuration
  ceilings, global and per-domain concurrency limits, health reporting, an
  environment template, and a deployment/egress viability runbook.
- Added a multi-stage, non-root Docker image, container health check, and a
  PostgreSQL-backed local Compose stack. Database transport security is
  explicit through `DATABASE_SSL_MODE` instead of being guessed from the host.

### Verification

- MCP service TypeScript typecheck and production build pass.
- Eight focused tests pass for configuration normalization, URL normalization, query generation, DuckDuckGo
  parsing/challenge detection, Cheerio cleanup and deterministic extraction,
  fact corroboration/conflict retention, and durable job lifecycle.
- Four Outlio-side MCP provider tests cover remote HTTPS/token requirements,
  loopback development, structured-result mapping, and graceful failure. The
  complete Outlio suite passes: 1,130 tests with 23 intentionally skipped.
- A live local Streamable HTTP smoke test completed MCP initialization using
  protocol version `2025-11-25`; `/health` returned an operational response.
  A second smoke test used the official MCP v2 client to list all five tools
  and call `web_search`, confirming the challenge reaches Hubble as a normal
  tool failure and activates its existing provider fallback.
- The current local egress IP receives DuckDuckGo's bot challenge. This is a
  deployment gate rather than an application defect: the intended hosting
  provider must pass the documented harmless search probe, or a lawful
  alternative `SearchProvider` must be configured.
- The Compose definition and 63 MB ARM64 production image build successfully.
  Both containers become healthy; the MCP runs as the non-root `outlio` user,
  reports PostgreSQL storage, rejects unauthenticated requests with HTTP 401,
  survives an application-container restart, and retains its durable job row.
  The official MCP client listed all five tools and exercised a real queued job
  through PostgreSQL. No cloud CLI/login or production database/model secrets
  are present in this workspace, so public deployment still requires those
  operator inputs.

## 2026-08-28 — Hubble bulk contact-result correction

### Fixed

- Added deterministic planning for explicit phone-number requests, so “give me
  phone numbers of all” no longer depends on the semantic planner being online.
- Traced the reported 199-lead run in stored telemetry: 195 contact searches
  completed and nine public phone facts were persisted, but the result panel
  incorrectly announced that nothing was found when the optional summary LLM
  returned no paragraph.
- Added a deterministic coverage summary for every run that has evidence, even
  when semantic summarisation is unavailable or fails.
- Contact questions now render only the actionable matched leads in a compact
  sourced list. Unknown leads remain a coverage count instead of becoming a
  long wall of “not found” cards.
- Contact search now tries the displayed company name before the normalized
  website domain, retains the domain as a fallback, and extracts after each
  query so it stops once a supported contact is found. This fixes cases where
  the public search result is indexed under a dotted brand name that differs
  from the stored website host and reduces unnecessary free-search traffic.

### Verification

- The exact reported run was confirmed as 199 leads, 96 companies, 195 contact
  calls, nine successful phone discoveries, and nine stored `mobile_phone`
  facts—proving the prior zero-result message was a presentation defect.
- A live first-query search using the displayed company name returned the
  referenced public directory phone result; the older domain-first queries did
  not contain it.
- Planner, contact extraction, summary-panel tests, TypeScript, and focused
  ESLint pass. The complete suite passes 1,255 tests across 90 files, with 24
  intentionally skipped, and the Next.js 16.3 production build passes.
