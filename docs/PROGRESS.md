# Progress

Append-only log. Read this before writing any code.

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
