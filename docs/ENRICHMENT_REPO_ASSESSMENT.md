# Enrichment repository assessment

Assessed 2026-08-28, before any integration work.

Six B2B enrichment repositories were proposed as inputs to Hubble's lead
enrichment layer. This document records what each one actually is, and the
decision taken about it. **Two techniques were adopted. Four repositories were
rejected in full.**

The governing question was never "can this be made to work" — it was "does this
answer a question Outlio cannot already answer, without violating a hard rule."

---

## Constraints every candidate was measured against

From `CLAUDE.md`, in force before this assessment began:

1. **Rule 1 — no browser automation, of any kind.** No Playwright, Puppeteer or
   Selenium; no headless Chromium; no anti-detection or CAPTCHA handling. This
   disqualifies a technique regardless of how well it works.
2. **Rule 4 — never fabricate lead data.** A pattern-generated address that was
   never observed is fabrication. Marking it "predicted" does not change that;
   it changes only how the fabrication is labelled.
3. **Worker runtime is Node.** No Python service (decision already recorded).
   Every Python repository here is therefore a source of *technique*, never a
   dependency.
4. **No paid provider may be reachable by default.** `PAID_PROVIDERS` is
   enforced at registry construction.
5. A repository without a license cannot be copied from at all.

---

## Verdicts

### 1. `FAAQJAVED/Email-Phone-Number-Enrichment-Tool` — ADOPT ONE TECHNIQUE

| | |
|---|---|
| Stack | Python 3.10–3.12, Requests + Playwright + OpenPyXL |
| Input / output | CSV of website URLs → XLSX of emails and phones |
| External APIs | None. No keys, no paid services. |
| License | MIT |
| Activity | 23 commits, CI across three platforms, 88 unit tests |
| Latency / compute | Pass 1 threaded HTTP; Pass 2 spawns Chromium per site |
| Overlap | Its Pass 1 duplicates `lib/intelligence/providers/scout.ts` |

**Adopted:** the **Cloudflare `data-cfemail` XOR decode**.

Cloudflare's email-obfuscation feature replaces a published `mailto:` with a
hex payload in a `data-cfemail` attribute; the first byte is an XOR key for the
rest. A large share of B2B contact pages carry it. Outlio's Scout reads those
pages today and sees *nothing*, because the address is not present as text.
That is a silent recall loss on exactly the pages most likely to hold a real
published address — a company's own `/contact`. The decode is deterministic,
about twenty lines, needs no dependency, and produces a **published** address
rather than an inferred one, so it lands squarely inside rule 4.

**Rejected:** the Playwright pass (rule 1), the CSV/XLSX harness (Outlio has its
own export pipeline), and the checkpoint/resume machinery (`job_queue` already
provides durable claims with backoff).

---

### 2. `FAAQJAVED/Leadhunter_Pro` — ADOPT ONE IDEA

| | |
|---|---|
| Stack | Python 3.10+, httpx + BeautifulSoup + Playwright |
| Input / output | `queries.txt` → colour-coded XLSX with HOT/WARM/COLD ratings |
| External APIs | None |
| License | MIT |
| Activity | 42 commits, 9 stars |
| Overlap | Its Pass 2 is the same code as repository 1 |

**Adopted:** the **keyless multi-engine SERP fallback tier** (Mojeek,
DuckDuckGo, Yahoo, Bing queried directly rather than through a metered API).
This matters because Outlio's live search is capped hard — Google CSE is 100
queries/day and Brave is ~66/day — and a capped tier that runs out looks
identical to a company nobody has written about. A keyless bottom tier turns
quota exhaustion into degraded quality instead of a false negative.

**Rejected:** the Playwright Pass 2 (rule 1); the HOT/WARM/COLD keyword scoring,
which is a relevance heuristic dressed as a qualification signal and would
compete with Outlio's evidence-confidence model; and any engine that requires
rotation or disguise to keep working.

---

### 3. `kzarov/bytemine-bytemine-mcp` — REJECT

3 commits, 4 stars, no license, and the repository contains configuration
rather than code — the actual enrichment is a closed, paid, 130M-contact
database behind an API key. There is nothing to analyse and nothing to port,
and adding it would put a metered vendor on a path that must stay free by
default. If Bytemine is ever wanted, it belongs behind the existing
`PAID_PROVIDERS` gate as a normal `IntelligenceProvider`, written from their
API docs. Nothing in this repository shortens that work.

---

### 4. `bhumit01/B2B-Email-Finder` — REJECT

**No license.** That alone ends it: code cannot be copied from a repository
that grants no rights. Beyond that, 3 commits, one open issue, and the stated
technique is generating an address from first name + last name + company —
which rule 4 forbids outright. Outlio already refuses this deliberately:
`lib/intelligence/providers/scout.ts` infers a house pattern only to *probe*
candidates, and stores nothing that was not either published or SMTP-confirmed.

---

### 5. `Vaishnavi-Aswale/AI-Agent-for-SaaS-Outreach` — REJECT

Streamlit demo, 5 commits, no license, and it requires two paid APIs (OpenAI +
Exa) to do anything at all. Its four "agents" are prompt templates, not
enrichment logic; the repository contains no verification, no confidence model,
no identity matching and no provenance. Outlio's `lib/intelligence/planner.ts`
and `lib/hubble/reason.ts` already do strictly more, over evidence that carries
a source.

---

### 6. `Ivan298-a/ai-lead-finder` — REJECT

The most competently built of the six — MIT, FastAPI, Celery/Redis, Alembic
migrations — and still not applicable, because it solves a different problem.
Its core is **discovering companies by geography** through Nominatim and
Overpass. Outlio does not discover leads; leads arrive from a page the user
opened themselves (rule 1). Strip the geo-discovery and what remains is website
scraping Outlio already has, plus an email filter dropping `noreply@` and
`dpo@` — which `lib/intelligence/providers/search-contact.ts` already enforces
through a broader generic-mailbox set.

Its Claude-based "AI enrichment for descriptions and qualification scoring" is
specifically the thing rule 4 exists to prevent: an LLM writing company facts
that trace to no source.

---

## Summary

| Repository | Verdict | What was taken |
|---|---|---|
| Email-Phone-Number-Enrichment-Tool | Partial | Cloudflare `cfemail` decode |
| Leadhunter_Pro | Partial | Keyless multi-engine SERP fallback tier |
| bytemine-bytemine-mcp | Reject | — |
| B2B-Email-Finder | Reject | — |
| AI-Agent-for-SaaS-Outreach | Reject | — |
| ai-lead-finder | Reject | — |

Net: **two techniques, no new runtime dependencies, no new paid vendor, no
Python service.** Both adopted items address a measured gap in recall rather
than adding a parallel pipeline beside the one that already exists.

---

## Open decision for the product owner

The originating brief asked that pattern-generated emails be stored and
"clearly marked as predicted." **This was not implemented**, because hard rule 4
forbids fabricated lead data and marking a guess does not make it an
observation. A predicted address that reaches a CRM is indistinguishable from a
found one the moment it leaves Outlio's UI.

Lifting that rule is a product decision, not an engineering one. Until it is
lifted explicitly, only published, corroborated or SMTP-confirmed addresses are
stored.
