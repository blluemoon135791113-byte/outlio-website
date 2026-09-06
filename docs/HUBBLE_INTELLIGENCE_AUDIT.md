# Hubble intelligence audit

**Date:** 2026-08-27  
**Scope:** public contact discovery, company/signals research, RAG, correctness,
cost controls, and operational architecture

## Decision

Keep the current modular Hubble + Web Research MCP architecture. It has the
right ownership boundaries and already supports grounded RAG. Improve precision
and measured coverage before adding another crawler, index, or paid data vendor.

Current review scores are engineering-readiness judgments, not measured recall
claims; a consented golden set is still required to produce accuracy metrics.

| Capability | Score | Current evidence and limitation |
| --- | ---: | --- |
| Public email discovery | 7.0/10 | Exact person/domain search, official-site/profile discovery, provenance, and honest statuses; no universal mailbox verification and deliberately no guessed addresses |
| Public phone discovery | 5.8/10 | Search/page extraction, identity context, provenance, E.164 validation for international numbers; no independent line-owner or carrier verification |
| Social profiles | 6.5/10 | First-party site links and public search evidence; LinkedIn URLs may be discovered but LinkedIn is never fetched or automated |
| Company facts | 7.3/10 | Multiple deterministic providers, MCP pages, citations, caching, and conflict-aware evidence; provider coverage varies by company |
| Pain points / buying signals | 5.2/10 | Hubble can derive cited interpretations from retrieved pages, but these signals are not yet complete first-class typed fields throughout the application pipeline |
| RAG | 7.4/10 | 632 page chunks plus a typed-evidence bridge and citation validation; vector service is currently unavailable, so retrieval is BM25-only |
| Overall intelligence | **6.6/10** | Useful and source-grounded, but not yet benchmarked as a high-recall contact database |
| Overall architecture | **7.6/10** | Modular, bounded, cache-first, tenant-scoped, zero-meter capable, and resilient; observability and quality evaluation need another production-hardening pass |

## Corrections completed in this audit

1. Connected fresh sourced `research_evidence` to Hubble retrieval, including
   contact facts that came from search snippets rather than fetched pages.
2. Scoped cached person answers by `lead_id` and `company_id` to prevent
   cross-lead answer reuse inside one company.
3. Prevented generic and other-person mailboxes from becoming an individual's
   work email solely because they appear on the employer's domain or profile.
4. Standardized public contact status to `publicly_found`; reserved `verified`
   for a permitted verification step.
5. Added structural validation and E.164 storage for international public phone
   numbers.
6. Repaired the root 404 component and removed a deprecated duplicate
   middleware entry point that blocked the Next.js build.

## Alternatives considered

| Alternative | Decision | Tradeoff |
| --- | --- | --- |
| Install a second search/index stack now | Reject | Adds queues, data copies, RAM, and failure modes before current Postgres retrieval has reached its scale threshold |
| Treat any company-domain inbox as the person's email | Reject | Higher apparent recall but unacceptable person-attribution errors |
| Infer likely email patterns and display them as facts | Reject | Creates convincing guesses and damages trust; SMTP-gated candidates remain the only permitted verification path |
| Require vectors for all answers | Reject | Makes a local optional accelerator a single point of failure; BM25 must remain functional |
| Fetch authenticated/restricted social pages | Reject | Conflicts with the public-data, no-CAPTCHA, no-shared-cookie boundary |

## Next audit and correction queue

1. Build a consented golden set and report precision/recall separately for
   `verified`, `publicly_found`, `inferred`, and `not_found` contacts. This is the
   highest-priority missing proof.
2. Make pain points, growth, buying signals, and personalization points
   first-class typed fields from MCP schema through evidence storage and UI,
   always retaining their supporting passages.
3. Restore or intentionally disable the local Ollama embedding endpoint, then
   benchmark BM25 versus hybrid retrieval on the same question set.
4. Add provider-level dashboards for success, challenge/rate-limit rate,
   latency, facts per run, cache-hit rate, and source-tier distribution.
5. Require independent corroboration before increasing phone/email confidence;
   preserve conflicting public contacts rather than selecting silently.
6. Load-test queue leases, company cache reuse, typed-evidence retrieval, and
   database growth under concurrent tenant workloads.

## Consequences

Hubble can answer from prior enriched facts and pages without searching again,
and the no-charge mode remains viable. It will still return `not_found` for some
leads because the architecture prioritizes correct public evidence over maximum
apparent coverage. That limitation is deliberate until measured, compliant
sources justify a broader provider.
