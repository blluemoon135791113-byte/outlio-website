# PostHog validation report

Validation executed: 16 September 2026; finalized 19 September 2026
Branch: `codex/posthog-validation`
PostHog project: `612494` (US)
Operating-definition dashboard: [Analytics basics (wizard)](https://us.posthog.com/project/612494/dashboard/2113797)
Validation dashboard: [Outlio synthetic validation](https://us.posthog.com/project/612494/dashboard/2113829)

## Results

| Check | Status | Evidence |
| --- | --- | --- |
| Existing project reused | PASS | Authenticated project URL is `/project/612494`; the configured public token matched the existing project |
| Browser/server delivery | PASS | Both channels received `analytics_validation_completed` in the existing project |
| Event UUID deduplication | PASS | Two server sends with UUID `fabfef7a-fbb3-4ad4-a0cc-4a4c21951683` produced exactly one stored row |
| Typed event names/properties | PASS | `lib/analytics/catalog.ts`; 12 focused governance tests |
| Runtime property allowlist | PASS | Unknown, nested, prohibited, oversized, and non-finite values are removed |
| URL sanitization | PASS | Current, initial, referrer, and session-entry URL properties were observed without query strings/fragments |
| IP/GeoIP suppression | PASS | Fresh browser/server rows showed `$ip=0.0.0.0` and GeoIP disabled |
| Stable internal identity | PASS | Browser/server events used the same synthetic auth UUID; no email/name/phone was used as the distinct ID |
| Workspace group binding | PASS | Primary and secondary synthetic workspaces resolved to their expected workspace group IDs |
| Logout/account-switch reset | PASS | Recording stops before `posthog.reset()`; different user IDs reset before identify |
| Analytics fails open | PASS | Helpers isolate SDK failures; server flushes are scheduled with Next `after` and bounded transport settings |
| Worker terminal delivery | PASS (code/test) | Extractor terminal events use `delivery:'immediate'`, so the worker awaits the bounded PostHog flush instead of relying on request-context `after()`; live canary pending |
| Replay route controls | PASS | Exact safe-route allowlist, stable 10% sample, development override, and query/hash exclusion are tested |
| Replay privacy | PASS (synthetic) | Replay `01a0ab35-d62e-7575-8c64-12b49ef079df` showed masked text, links, and attributes; synthetic email and URL probe were absent |
| Error privacy | PASS (synthetic) | Controlled browser/server exceptions arrived with generic messages/codes; injected email/token values were absent |
| Hubble metadata privacy | PASS (static) | Success/failure events require `feature:hubble_ask` and bounded operational metadata; prompt/output/body keys are rejected |
| Source-map resolution | UNKNOWN | No source-map upload secret/workflow is configured; minified production resolution was not exercised |
| Validation dashboard | PASS with replay-count limitation | Dashboard `2113829` contains all seven requested validation views. Its `$snapshot` unique-session tile currently reports no matching product-analytics events even though replay `01a0ab35-d62e-7575-8c64-12b49ef079df` exists in the Replay product and was visually inspected. |
| Production operating dashboards | NOT CREATED | The authorization requires waiting for sufficient real traffic. Dashboard `2113797` remains an event-definition aid, not a production KPI baseline. |
| Alerts | DEFERRED | Synthetic traffic is not a baseline; thresholds require at least 14 days of real traffic |
| Paid/self-driving features | NOT RUN | No paid provider, self-driving PR, survey, experiment, destination, or subscription was enabled |
| Production deployment | NOT RUN | The authorization explicitly excluded deploy/merge; all implementation and validation stayed local/staging plus the existing PostHog project |

## Live validation dashboard assets

- [Outlio synthetic validation](https://us.posthog.com/project/612494/dashboard/2113829), dashboard `2113829`. Description explicitly limits it to synthetic validation and says to exclude it from product decisions.
- [Received events by environment (validation)](https://us.posthog.com/project/612494/insights/YBs6v2D9), insight `YBs6v2D9`: `analytics_validation_completed` grouped by `app_environment`.
- [Browser versus server (validation)](https://us.posthog.com/project/612494/insights/rUkg4gVW), insight `rUkg4gVW`: `analytics_validation_completed` grouped by `channel`.
- [Events by test workspace (validation)](https://us.posthog.com/project/612494/insights/Ry0QWgNG), insight `Ry0QWgNG`: `analytics_validation_completed` grouped by `workspace_id`.
- [Failures by safe error code (validation)](https://us.posthog.com/project/612494/insights/CryAnomA), insight `CryAnomA`: `$exception` grouped by the allowlisted `error_code`.
- [Hubble success and failure (validation)](https://us.posthog.com/project/612494/insights/E27rmamu), insight `E27rmamu`: completed and failed event counts.
- [Hubble average duration (validation)](https://us.posthog.com/project/612494/insights/j3443aiN), insight `j3443aiN`: average allowlisted `duration_ms` on completed queries.
- [Session replay count (validation)](https://us.posthog.com/project/612494/insights/pVUzpV4e), insight `pVUzpV4e`: `$snapshot` unique sessions. The query is intentionally retained as a diagnostic but currently returns no matching product-analytics rows; the Replay product remains the authoritative evidence.
- [Signup to first value (wizard)](https://us.posthog.com/project/612494/insights/lGgGqUb1), insight `lGgGqUb1`: synthetic `account_signed_up` → `leads_imported` → `flow_published` funnel.

## Event-definition assets

- [Signup to first value (wizard)](https://us.posthog.com/project/612494/insights/lGgGqUb1): `account_signed_up` → `leads_imported` → `flow_published`.
- [Published flows (wizard)](https://us.posthog.com/project/612494/insights/ofnWRYvf): flow publish volume.
- [Hubble outcomes (wizard)](https://us.posthog.com/project/612494/insights/ubstg01u): completed and failed Hubble outcomes.
- [Email activation funnel (wizard)](https://us.posthog.com/project/612494/insights/ofKnqHOk): `integration_connected` → `campaign_created` → `campaign_launched`.
- [CRM activation (wizard)](https://us.posthog.com/project/612494/insights/z0qtkSxw): `crm_contact_created` → `crm_opportunity_created` → `crm_opportunity_stage_changed`. This is a definition-only insight until the new events pass a post-deploy canary.

The event-definition dashboard name retains the exact `(wizard)` marker. Eleven event-definition
rows were seeded only after the dashboard UI proved it could not reference
unseen events. Every seed uses the authorized synthetic person/workspace,
`is_synthetic=true`, development environment, zeroed IP, disabled GeoIP, and
non-customer values. The Hubble rows are metadata-only seeds; they did not call
search, browser, or LLM providers and must not be treated as product usage.

## Automated evidence

| Command | Result |
| --- | --- |
| `npx vitest run --project unit tests/unit/analytics-catalog.test.ts tests/unit/posthog-server.test.ts` | PASS — 2 files, 14 tests |
| `npm run typecheck` | PASS |
| scoped `npx eslint …` over every analytics integration point | PASS |
| `npm run test:unit` | PASS — 234 files, 4,003 tests |
| `npm run build` | PASS — Next.js 16.3.0 compiled and generated 86 routes |

## End-to-end evidence and limits

Two staging-only synthetic accounts and workspaces were used. Browser/server
identity, workspace grouping, sanitized exceptions, deduplication, URL
scrubbing, replay start/stop rules, replay masking, and a user switch were
observed in PostHog. The first replay test exposed that replay snapshot metadata
could retain a query string even though normal events passed through
`before_send`; recording is now blocked whenever the current URL has a query or
fragment. A logout check also exposed that the recorder could continue briefly
after identity reset; logout now stops recording before reset.

No paid Hubble provider was invoked, no email was sent, no charge was created,
no production customer record was changed, and no production deployment or
merge was performed. The Hubble call sites and privacy schema are verified, but
a real provider-backed Hubble run remains a post-approval canary check.

### Synthetic journey coverage

| Journey step | Result | Evidence / limit |
| --- | --- | --- |
| Landing page and client navigation | PASS for transport; PARTIAL for attribution | Browser validation event arrived through `/ingest`; URL properties were scrubbed. With persistence disabled, client navigation keeps the in-memory anonymous ID but a hard refresh does not. |
| Test authentication | PASS | Two synthetic auth UUIDs were observed as separate people; browser and server rows for the primary user used the same UUID. |
| Onboarding and workspace selection | PASS for identity/group boundary | Two synthetic workspace UUIDs were observed under their matching users. No customer workspace was touched. |
| Extractor/import | CONTRACT VERIFIED; NOT A FULL UI E2E | Synthetic event-definition rows prove the approved schema can be queried. No real LinkedIn page or customer CSV was processed. |
| Hubble success/failure | METADATA VALIDATED; PROVIDER RUN BLOCKED | Synthetic success/failure rows and the live dashboard prove queryability. Paid search/browser/LLM providers stayed disabled, so raw provider execution was intentionally not claimed. |
| Export/CRM addition and contact/deal update | IMPLEMENTED; LIVE CANARY PENDING | Privacy-safe contracts now cover persisted export outcomes, new manual contacts, assignment changes, new opportunities, and successful stage changes. Focused schema/privacy tests pass and insight `z0qtkSxw` is defined, but no production or customer mutation was performed to manufacture live rows. |
| Logout and second user | PASS | Recording stops before reset; a second synthetic user/workspace did not inherit the first user's identity or group. |

The event-definition seeds above are deliberately not represented as full UI
journeys. A fresh authenticated UI rerun would require a new synthetic login
credential handoff; the previous ephemeral credentials were not retained.

## Before production rollout

1. Add source-map upload in CI using an approved PostHog personal API key.
2. Deploy only after explicit approval, then run one production-canary event
   per critical path with `is_synthetic=true`.
3. Confirm returning authenticated loads still identify the stable auth UUID.
4. Re-inspect replay after SDK upgrades and keep query/hash URLs excluded.
5. Exclude `is_synthetic=true` from business reporting and wait for a real
   baseline before setting alerts.
6. Canary `extractor_job_finished`, `records_exported`, and the four new CRM
   events after an approved deployment; do not treat empty insight `z0qtkSxw`
   as a transport failure before then.

## Rollback

Removing the PostHog environment variables makes capture a no-op. Replay can be
stopped immediately by retaining `disable_session_recording: true` and removing
the safe-route starts. Product actions remain independent because analytics
helpers fail open.
