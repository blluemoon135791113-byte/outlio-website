# PostHog privacy and data map

This is a technical privacy review, not legal advice.

## Data flow

Browser events go to same-origin `/ingest`, which Next.js forwards to the US
PostHog ingestion and asset hosts. Server events go directly to the US
ingestion host. The public project token is configured in browser/server
environments; no private PostHog key is committed.

| Data category | Purpose | Source → destination | Controls | Retention/deletion implication |
| --- | --- | --- | --- | --- |
| Stable user UUID | Person continuity | Supabase auth → PostHog US | Never email; reset on logout/account switch | Must be included in account-deletion workflow if PostHog person deletion is required |
| Workspace UUID | Tenant analytics | Workspace context → PostHog group | Stable internal ID; no workspace name | Group data may require separate deletion |
| Coarse account traits | Segmentation | App shell → person/group | Plan, admin flag, role, size band only | Changes overwrite current properties |
| Explicit product events | Funnel/adoption | Server/client success points → PostHog | Typed allowlist, scalar values, 120-char bound | Subject to project retention settings |
| CRM operational outcomes | Activation/adoption | Successful contact/deal server actions → PostHog | Workspace UUID, coarse state enums, presence booleans and stage duration only; no record IDs, names, values, notes, reasons, or contact/company fields | Subject to project retention settings; live canary pending |
| Export/extractor terminal outcomes | Reliability/adoption | Persisted export jobs and extraction workers → PostHog | Provider/category/result plus aggregate counts only; deterministic UUID deduplication; no destination URL, exported records, HTML, CSV, or provider messages | Legacy flows are person-scoped because their database rows have no workspace key |
| Web navigation | Acquisition/navigation | Browser → PostHog | Query/fragment stripped; DNT respected; no persistence | Referrer/origin may remain as standard analytics metadata |
| Session replay | UX debugging | Safe routes → PostHog | Disabled by default; stable 10% sample; exact route allowlist; all text/inputs/attributes masked; bodies/headers/console/performance off | Recordings remain sensitive operational data despite masking; keep access narrow |
| Exceptions | Reliability | Browser/server → PostHog | Selected manual capture only; generic message, bounded error name, stack frames with original message removed, safe route/env/release | Stack can disclose code structure; no request payloads/context |
| Hubble metadata | Reliability/cost proxy | Hubble API → PostHog | No prompt, answer, sources, lead data, tool args, or fetched content; Node privacy mode | Aggregate operational metadata only |
| Release/environment | Regression analysis | Vercel runtime → PostHog | Commit SHA and environment only | Low privacy risk |

## Session replay policy

Replay is allowed only on exact `/dashboard`, `/flows`, and `/crm/reports`
routes and for a deterministic 10% sample of authenticated user IDs. It stops
on every other route. Authentication, billing/checkout, settings, tokens,
integrations/OAuth, contact/company/deal views, imports/CSV, lead intelligence,
campaigns/composers, inbox/messages, extension pages, admin pages, and dynamic
flow detail routes are excluded.

Even on allowed routes, all rendered text, inputs, and element attributes are
masked. Hidden/file inputs and `[data-private]`/`[data-sensitive]` subtrees are
blocked. Network headers/bodies, cross-origin iframes, JSON-LD, console logs,
canvas, and performance capture are disabled locally.

Status: **PASS for the synthetic validation window**. Replay
`01a0ab35-d62e-7575-8c64-12b49ef079df` was visually inspected in project
`612494`: application text, links, and attributes were masked, and neither the
synthetic email nor the URL probe was visible. Replay now refuses to start on
any route carrying a query string or fragment because replay snapshot metadata
bypasses normal event `before_send` sanitization. Logout also stops recording
before resetting identity. Continue treating recordings as sensitive and
re-check this control after PostHog SDK upgrades.

Dashboard `2113829` includes a `$snapshot` unique-session diagnostic, insight
`pVUzpV4e`. It currently returns no product-analytics rows even though the
recording above exists in the Replay product. This is documented as a PostHog
query-surface limitation; the replay inspection result is not inferred from
the empty chart.

## Data explicitly excluded

- passwords, session/auth tokens, cookies, API keys and OAuth codes;
- payment or card data;
- emails, phone numbers, names, raw form values;
- lead/contact/company field values and scraped profile content;
- full email subjects/bodies, replies, campaigns, notes, tasks, contracts;
- CSV rows, uploaded document contents, request/response bodies;
- Hubble prompts, questions, completions, sources, tool arguments, fetched pages;
- database/provider exception messages.

## Consent and persistence

PostHog browser persistence is disabled and `respect_dnt` is enabled. This
reduces tracking and identity carryover but does not by itself decide whether
consent is legally required in every target jurisdiction. The published privacy
policy discloses privacy-limited analytics. Counsel/owner should confirm the
final retention period, lawful basis, data-processing agreement, and deletion
process before expanding capture.

With persistence disabled, anonymous identity survives client-side navigation
inside one loaded document but not a hard refresh. `reuseAnonymousId` is enabled
to prevent a fresh anonymous ID from being merged into the same authenticated
person on every load. The deliberate cost is that landing-page → signup cannot
be a reliable person-level funnel across a hard load, and anonymous feature-flag
assignments would not be stable. Authenticated identity and the replay sample
remain stable because both use the internal user UUID. The most privacy-safe
current choice is to accept aggregate acquisition measurement. Reliable
cross-load attribution would require an opaque, short-lived first-party ID and
an owner-approved consent/storage decision; it is not enabled automatically.

No persistent identifier or consent-affecting setting was changed during
validation. If feature flags are introduced before that approval, evaluate
them only after authentication using the stable internal UUID; anonymous flag
assignments would otherwise change across hard refreshes.

## Access and incident response

Limit PostHog project access to operators who need product/reliability data.
Never paste event payloads containing customer data into support channels. If a
prohibited property is discovered: stop its source, keep evidence of field and
time window, assess affected events/persons, and obtain approval before deleting
production PostHog data.
