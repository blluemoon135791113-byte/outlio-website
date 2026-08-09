# Selector Map — Sales Navigator search results

**Status:** validated against both saved-page layouts, most recently a 25-lead
table page on 2026-08-09.
**Method:** parsed with BeautifulSoup, field-presence measured across all 25 rows.
No real personal data appears in this document or in the repo.

> **2026-08-09 layout update:** LinkedIn reintroduced a table-based people list
> using `tr[data-x--people-list--row]`. It is not the obsolete table described
> below: the stable fields still use `data-anonymize`, the person name is now an
> anchor, and `div[data-anonymize="job-title"]` contains the actual role. The
> parser supports this table and the card-list layout. Fixture coverage prevents
> the shared field name from being confused with legacy tenure data.

---

## 1. The existing scraper is obsolete

The bundled `NEW_LinkedIn_Lead_Scraper.exe` targets a **table-based layout that
LinkedIn no longer ships**. Run against a page saved today it extracts **zero
leads** and shows the user "No leads found in the HTML file!".

Measured on the real page:

| Old selector | Occurrences today |
|---|---|
| `tr[data-x--people-list--row]` | **0** |
| `<tr>` anywhere in the document | **0** |
| `a[class*=view-profile-image-link]` | **0** |
| `span[class*=lead-detail-entity-details]` | **0** |
| `div.list-entity-notes__preview-text` | **0** |
| `td[class*=date-added]` | **0** |
| `div#hue-web-tooltip-content-company-hovercard-…` | **0** |

The layout moved from `<table>/<tr>/<td>` to `<ol>/<li>` with the `artdeco` +
`hue-web` design system. Every row-level and name-level selector is dead.

**Consequence:** this is a rewrite, not a port. The recovered source in
`Linkedin Sales Navigator Scraper SaaS/recovered/scraper_gui_recovered.py`
remains useful as a record of intent — which fields the business wants — but
its selectors must not be carried forward.

---

## 2. Current structure

```
div._search-container_…
└─ ol.artdeco-list                     ← results list
   └─ li.artdeco-list__item            ← ONE LEAD  (row anchor)
      └─ div.artdeco-entity-lockup
         ├─ a.ember-view[href*="/sales/lead/"]
         │  └─ span[data-anonymize="person-name"]
         ├─ span[data-anonymize="title"]
         ├─ div[data-anonymize="job-title"]      ← tenure, NOT the title
         ├─ a[data-anonymize="company-name"][href*="/sales/company/"]
         ├─ span[data-anonymize="location"]
         └─ div[data-anonymize="person-blurb"]
```

**Row anchor:** `ol.artdeco-list > li.artdeco-list__item`, filtered to those
containing a `span[data-anonymize="person-name"]`.

The filter matters: `li.artdeco-list__item` also appears in filter panels and
sidebars. Requiring a `person-name` descendant yielded exactly 25 — matching the
25 `person-name` spans on the page.

Do **not** anchor on `id="ember####"` or `_lockup-column_wpvxyb`-style classes.
Ember IDs are assigned per render and CSS-module hashes change every LinkedIn
deploy. `data-anonymize` is the only stable contract on the page.

---

## 3. Validated field map

All ten fields resolved on **25 / 25 rows (100%)**.

Validated across **2 pages / 30 leads**.

| Field | Selector | Extraction | Presence |
|---|---|---|---|
| `full_name` | `span[data-anonymize="person-name"]` | `get_text(strip=True)` | 30/30 |
| `linkedin_url` | nearest ancestor `a[href]` of the name span | `href` | 30/30 |
| `job_title` | `span[data-anonymize="title"]` | `get_text(strip=True)` | 30/30 |
| `company_name` | `a[data-anonymize="company-name"]`, **else subtitle text-node fallback** | `get_text(strip=True)` | 29/30 anchor + **1 fallback** |
| `company_url` | same anchor element | `href` | **29/30 — genuinely null on 1** |
| `location` | `span[data-anonymize="location"]` | `get_text(strip=True)` | 30/30 |
| `person_blurb` | `div[data-anonymize="person-blurb"]` | `get_text(strip=True)` | 30/30 |
| `tenure_in_role` | `div[data-anonymize="job-title"]` | text node containing `in role` | 30/30 |
| `tenure_in_company` | `div[data-anonymize="job-title"]` | text node containing `in company` | 30/30 |
| `dedupe_key` | derived from `linkedin_url` | `li:lead:{id}` | 30/30 unique |

### ⚠️ The company-name fallback — REQUIRED, not optional

When a company **has no LinkedIn company page**, there is no
`a[data-anonymize="company-name"]` and no `/sales/company/` link anywhere in the
row. The company name is still rendered — as a **bare text node** inside
`div.artdeco-entity-lockup__subtitle`.

Confirmed structure:

```
div.artdeco-entity-lockup__subtitle
├── span[data-anonymize="title"]        ← job title
├── span                                 ← empty separator element
├── a[data-anonymize="company-name"]     ← company, WHEN it has a page
│   …or…
├── (bare text node)                     ← company, when it has NO page
└── button
```

**Rule:**

1. Try `a[data-anonymize="company-name"]` → gives both `company_name` and `company_url`
2. If absent, take the longest bare text node in the subtitle div, whitespace-collapsed
   → gives `company_name` only; **`company_url` stays NULL**

This is extraction, not inference — the text is the company name, in the company
slot. There is no `at`/`bei` separator word to strip; the separator is a distinct
empty element.

**Without this fallback we silently lose the company name on ~20% of leads**
(1 of 5 on the second sample page). Verified: applying the fallback changes
nothing on page 1 (25/25 still resolve via anchor) and recovers the missing
company on page 2.

### ⚠️ The `job-title` trap

`div[data-anonymize="job-title"]` does **not** contain the job title. It holds
two sibling text nodes of tenure:

```
"8 years 7 months in role"
"8 years 7 months in company"
```

`get_text()` concatenates them into
`"8 years 7 months in role8 years 7 months in company"` — 49–51 characters,
always starting with a digit.

This is the single most dangerous selector on the page, because it is the one
selector the old scraper used that still *matches something*. Trusting it
silently fills every lead's title with tenure garbage. The real title is
`span[data-anonymize="title"]`.

Store the two tenure values as separate nullable columns, parsed from the
individual text nodes — never from `get_text()` on the parent.

---

## 4. Fields gained and lost

**Gained** (absent from the old scraper, present in today's DOM):

- `person_blurb` — ~120-char summary sentence, 25/25
- `tenure_in_role`, `tenure_in_company` — 25/25
- Page-level only, 1 occurrence each, from the sidebar company card:
  `industry`, `company-size`, `company-blurb`. These describe the *filtered*
  company, not per-lead values. **Do not map them to lead columns.**

**Lost** (old scraper extracted them; today's DOM has no equivalent):

- `Notes` — `list-entity-notes__preview-text` no longer exists
- `Date Entered` — `date-added` cell no longer exists

Both go in `docs/UNSUPPORTED_FIELDS.md` per spec §5.1E. Do not invent them.

---

## 5. Deduplication

Profile hrefs have the shape:

```
https://www.linkedin.com/sales/lead/{ID},{TOKEN},{TOKEN2}?_ntb={VOLATILE}
```

Canonicalising to `li:lead:{ID}` per spec §12.2 gave **25 unique keys from 25
rows**. The trailing tokens and `_ntb` query parameter are session-scoped and
change between saves — discarding them is required, not optional, or the same
lead saved twice would produce two different keys.

Company hrefs canonicalise to `li:company:{N}` from `/sales/company/(\d+)`.

---

## 6. Consequences for the build

1. **Parser is a rewrite.** Selectors above are the source of truth, not the
   recovered Python.
2. **Still no network access required** — everything above came from one static
   file. The "file processor, not a crawler" constraint holds.
3. **TypeScript + cheerio remains the right call.** The new selectors are plain
   attribute matches with no regex-on-class needed, which maps to cheerio even
   more cleanly than the old code did. No Python worker.
4. **`extracted_leads` columns** come from §3 above, replacing the old six-column
   shape. `full_name` and `linkedin_url` are separate columns — never fused into
   an `=HYPERLINK()` formula (spec §12.6 would neuter it anyway).
5. **Selector drift is now a known, recurring risk.** LinkedIn has already broken
   this parser once. Ship a fixture-backed golden test and treat a zero-lead
   result as a loud alert, not a silent empty state.

---

## 7. Validation status

**2 pages, 30 leads.** Both people-search results, saved from Chrome via
"Webpage, Complete".

### Now confirmed

| Property | Evidence |
|---|---|
| `company_name` / `company_url` are **genuinely nullable** | 1 lead had no company page at all — no anchor, no `/sales/company/` link |
| Company name still recoverable without a company page | via the subtitle text-node fallback (§3) |
| Row filter is **necessary**, not defensive | page 2 had 25 `li.artdeco-list__item` but only **5 leads** — the rest are sidebar/filter items |
| Non-ASCII content parses correctly | German company name containing `ü` extracted intact |
| Lead counts vary widely | 25 leads vs 5 leads on the same layout |
| Dedupe keys stay unique | 30/30 across both pages |

### Still unverified

- A lead with **no location**, **no blurb**, or **no job title** — all three were
  present on all 30 leads
- **"Saved leads" / account lists** rather than people search — likely a different
  DOM; unknown whether the row anchor holds at all
- Non-Latin scripts (Japanese, Arabic, Cyrillic)
- Pages saved from Safari or Firefox, or via "Single File" rather than "Complete"
- Non-UTF-8 encodings

Every column stays **nullable** in the schema regardless. Two pages is better
than one; it is not proof.
