# Data Inventory — what large-scale lead and business analytics needs

**Written 2026-08-21.** The catalogue of every data class worth holding, what
each one lets you *answer*, and where it can actually come from.

Organised by **analytical purpose**, not by source. A field nobody can ask a
question with is a column that costs storage and returns nothing.

## How to read the status column

| Status | Meaning |
|---|---|
| **HAVE** | Populated in production today |
| **SCHEMA** | Column exists, effectively empty |
| **MODELLED** | In `RESEARCH_FIELDS`, provider-fed, mostly unfilled |
| **PROBE** | Might be extractable — the census must confirm before anything is built |
| **NEVER** | Confirmed absent from LinkedIn at any layout |

⚠️ **PROBE is not a promise.** Every selector this project guessed at has been
wrong; every one it censused has held. Nothing moves from PROBE to built
without a measurement.

---

## 1. Identity and resolution

The join keys. Without these, nothing else can be aggregated — two spellings of
one company become two rows and every count is wrong.

| Data | Enables | Status |
|---|---|---|
| Person member id (`/in/…`, `/sales/lead/…`) | The only cross-page person key | **HAVE** |
| Company numeric id (`/sales/company/{id}`) | The only cross-page company key | **HAVE** |
| Company LinkedIn URL | Fallback identity | **HAVE** — 100% |
| Company domain | **Primary identity.** Joins to every external dataset | **HAVE** — 27% |
| Normalised name | Last-resort matching | **HAVE** |
| Public company URL | Derived from the Sales Nav id | **HAVE** |

> ⚠️ **Domain coverage is the single highest-leverage number in the system.**
> It is what lets Hubble scope a search to a site, what makes source-tiering
> recognise a company's own pages, and what joins your data to any third party.
> At 27% almost three-quarters of the book cannot be enriched or verified.

## 2. Firmographics — segmenting the book

| Data | Enables | Status |
|---|---|---|
| Industry | Segment performance, ICP concentration | **SCHEMA** — 1 of 2,094 |
| Employee count, exact | Size banding, ACV modelling | **SCHEMA** — 0 |
| Employee range (`2-10`) | Coarse banding when exact is absent | **SCHEMA** |
| Headquarters | Territory, timezone, expansion | **SCHEMA** — 0 |
| Other locations | Multi-site accounts | **PROBE** |
| Founded year / company age | Maturity cohorts | **MODELLED** |
| Company type (public, private, nonprofit) | Procurement path | **MODELLED** |
| Specialties / description | Category, keyword clustering | **MODELLED** |
| Business model (B2B, SaaS, marketplace) | Fit scoring | **MODELLED** |

## 3. Growth and momentum — who is expanding

The highest-value class for prioritisation, and the least covered.

| Data | Enables | Status |
|---|---|---|
| Headcount growth % | **Rank the book by momentum** | **PROBE** |
| Headcount trend over time | Trajectory, not a snapshot | Derived from repeat observation |
| Open job count | Budget and expansion proxy | **PROBE** |
| Hiring by department | *Which* function is growing — sales hiring predicts GTM spend | **MODELLED** |
| New office / location added | Geographic expansion | **PROBE** |
| Employee growth (provider) | Same signal, paid source | **MODELLED** |
| Product launches | Timing a conversation | **MODELLED** |

## 4. Financial and funding — buying power and timing

| Data | Enables | Status |
|---|---|---|
| Funding round / stage | Stage cohorts, budget expectation | **MODELLED** |
| Funding amount + currency | Capacity, deal sizing | **MODELLED** |
| Funding date / recency | **The timing signal.** Freshly funded buys | **MODELLED** |
| Investors | Warm paths, portfolio patterns | **MODELLED** |
| Revenue estimate | Sizing | **MODELLED** — always `estimated` |
| Registry filings (Companies House, SEC) | Verified financials, officers | **MODELLED** |
| Federal awards | Public-sector spend | **MODELLED** |

> ⚠️ **None of this is on LinkedIn.** Funding, revenue and investors come from
> providers or they do not come. An account-list extraction will not change
> that — worth knowing before it is expected to.

## 5. Technographics — fit and compatibility

| Data | Enables | Status |
|---|---|---|
| Tech stack | Compatibility, displacement targeting | **MODELLED** — free DNS detection exists |
| Tech churn (added/dropped) | **A migration is a buying window** | **MODELLED** |
| GitHub presence and activity | Engineering weight, stack truth | **MODELLED** — free |
| Website signals (analytics, chat, CMS) | Sophistication, spend | **MODELLED** |
| App store presence | Mobile product, consumer reach | **PROBE** |

## 6. People and organisational structure

| Data | Enables | Status |
|---|---|---|
| Person name, title, location | The basics | **HAVE** |
| Seniority | Buying committee mapping | **MODELLED** |
| Department / function | Routing, persona segmentation | **MODELLED** |
| Personnel list on a company page | **Org discovery without a people search** | **PROBE** |
| Decision-maker count | Committee size | **SCHEMA** |
| Leads per company (density) | Account coverage; you sit at 0.52 | **Derived** |
| Leadership changes / new in role | **New execs buy** | **PROBE** |
| Tenure in role / company | Authority, stability | **NEVER** — NULL on 400 of 400 |

> ⚠️ A person's **role is not labelled** on a company page. Their title is theirs;
> anything else is inference. `lead_source` records *where we found them*.

## 7. Engagement and activity — warmth and timing

You named this as what identifies personnel. Everything here is **PROBE** — the
census must prove the page renders it.

| Data | Enables | Status |
|---|---|---|
| Recent post / activity presence | Active vs dormant account | **HAVE** (`last_activity`) |
| Post recency ("2d ago") | Timing an approach | **PROBE** |
| Posting volume about the company | **How tied someone is to the business** | **PROBE** |
| Follower count | Reach, influence | **PROBE** |
| Company page followers | Brand pull | **PROBE** |
| Shared / reposted content | Advocacy | **PROBE** |

## 8. Relationship and network — the path in

| Data | Enables | Status |
|---|---|---|
| Connection degree | Warm-path routing | **HAVE** |
| Reachable badge | Contactability | **HAVE** |
| Saved-list membership | Prior interest | **HAVE** (`list_count`) |
| Mutual connections | **The strongest intro path** | **PROBE** |
| Shared experiences (school, employer) | Rapport hooks | **PROBE** |
| Teammates who know them | Internal routing | **PROBE** |

## 9. Web and digital presence — the evidence surface

⚠️ **The most operationally valuable class right now**, because these are URLs
Hubble can *fetch*. With web search unreliable, a page that hands over a
company's own links is a route to evidence needing no search engine.

| Data | Enables | Status |
|---|---|---|
| Company website | Grounds everything | **HAVE** — 27% |
| Landing / launch pages | Product truth, positioning | **PROBE** |
| Product pages | What they actually sell | **PROBE** |
| Pricing page | Deal sizing, model | **MODELLED** |
| Careers page | Hiring signal at source | Extracted by the fetcher |
| Partner links | Ecosystem, co-sell paths | **PROBE** |
| Social accounts (X, YouTube, IG, FB) | Channel presence | **MODELLED** |
| GitHub org | Engineering signal | **MODELLED** |
| Crunchbase link | Funding cross-reference | **PROBE** |
| App store links | Mobile presence | **PROBE** |

## 10. Market position

| Data | Enables | Status |
|---|---|---|
| Competitors | Displacement, battlecards | **MODELLED** |
| Review presence, rating, count | Maturity, satisfaction | **MODELLED** |
| Recent news | Trigger events | **MODELLED** |
| Similar companies | **Lookalike expansion from your own book** | **PROBE** |
| Customer logos | Social proof, ICP evidence | **PROBE** |

## 11. Risk and compliance

| Data | Enables | Status |
|---|---|---|
| Company status (active, dissolved) | **Do not sell to a dead company** | **MODELLED** |
| Insolvency history | Credit risk | **MODELLED** |
| Accounts / statement overdue | Distress signal | **MODELLED** |
| Jurisdiction, SIC codes | Regulatory segmentation | **MODELLED** |

## 12. Provenance and time — what makes trends possible

⚠️ **Without these, every metric is a snapshot and no trend exists.**

| Data | Enables | Status |
|---|---|---|
| Source list / search name | Which campaign produced which leads | **HAVE** |
| Capture date, page number | Reconstruction, auditing | **HAVE** |
| Observed-at per field | **Freshness; the basis of every trend** | **HAVE** (`research_evidence`) |
| Source URL per claim | Verification, trust | **HAVE** |
| Added-to-list date | Ageing, pipeline velocity | **HAVE** |
| Repeat observation of the same company | Growth deltas over time | **Derived** |

## 13. Derived — computed, never stored

Aggregate answers. Computed **in code** at query time, because a stored
aggregate is stale the moment the next row lands.

Industry and geographic concentration · size distribution · funding-stage
cohorts · lead density per company · **coverage gaps** (which fields are thin,
so effort goes where it pays) · ICP-fit distribution · momentum ranking ·
duplicate and overlap rates · time-to-contact.

> ⚠️ Arithmetic here is **code's job, never the model's**. A language model
> asked to total four funding figures reported $46,000,000 when the answer was
> $47,700,000 — see `lib/hubble/summarize.ts`.

## 14. Confirmed absent — the boundary

Do not build features that promise these from extraction:

- **Email and phone.** Censused: zero addresses, zero `tel:` links, at any
  layout. They come from enrichment providers or not at all.
- **Funding, revenue, investors as financial data.** LinkedIn is not Crunchbase.
- **Tenure fields.** NULL on 400 of 400 real leads.
- **Anything behind a login, paywall or CAPTCHA.** Out of scope by rule, not by
  difficulty.

---

## What to fix first, by leverage

1. **Domain coverage, 27% → high.** Unblocks enrichment, verification and every
   Hubble answer at once.
2. **Industry, headcount, HQ — 0% → populated.** Segmentation is impossible
   without them, and an account list should carry all three.
3. **Growth % and job counts.** New signal classes, currently unobtainable free.
4. **Web presence links.** Direct evidence for Hubble, bypassing search.
5. **Repeat observation.** Turns every snapshot above into a trend.

`scripts/census-page.mjs` probes for every **PROBE** row in this document.
Run it on a saved page and the forecast becomes a specification.
