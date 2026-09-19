# Event catalog

Schema owner: product engineering
Runtime contract: `lib/analytics/catalog.ts`
Schema version: `1`
Machine-readable discovery file: `.posthog-events.json`

All event names are typed and all properties pass through an exact runtime
allowlist. Unknown keys, nested objects, non-finite numbers, prohibited key
names, and strings beyond 120 characters are removed. Every event receives
`schema_version`; environment and release are added when available.

## Approved events

| Event | Successful trigger and location | Required properties | Identity / group | Volume | Tests / lifecycle |
| --- | --- | --- | --- | --- | --- |
| `account_signed_up` | Supabase account creation succeeds; `lib/auth/actions.ts` | `has_referral_code:boolean` | person; no group yet | once/account | schema test; active v1 |
| `account_signed_in` | Password auth succeeds; `lib/auth/actions.ts` | `requires_mfa:boolean` | person | low | schema test; active v1 |
| `checkout_started` | FastSpring checkout is configured and opened; `components/leadengine/FastSpringPricing.tsx` | `plan:enum`, `billing_interval:enum`, `is_authenticated:boolean` | anonymous or person | low | typed client; active v1 |
| `extractor_job_started` | Authenticated capture is accepted and queued; `app/api/extension/capture/route.ts` | `source:browser_extension`, `correlation_id:string`, two presence booleans | person; legacy user-scoped job | per captured page | schema test; active v1 |
| `extractor_job_finished` | Claimed worker job reaches a terminal result; `lib/worker/process-job.ts` | result; file counts; optional authoritative lead-result counts | person; legacy user-scoped job | once/job | deterministic event UUID prevents retry duplicates; worker awaits immediate bounded flush; schema/privacy test; implemented v1, live canary pending |
| `leads_imported` | CSV import completes; `app/(product)/crm/import/actions.ts` | `workspace_id`, succeeded/matched/failed counts | person + workspace | per import | schema test; active v1 |
| `records_exported` | Persisted provider export reaches completed/partial/failed; `lib/export/actions.ts` | destination, record kind, result, aggregate success/failure counts | person; legacy user-scoped export | once/export job | export-job UUID deduplication; schema/privacy test; implemented v1, live canary pending |
| `crm_contact_created` | Deduplicating manual contact creation returns `created=true`; `lib/crm/contact-actions.ts` | `workspace_id`, `source:manual` | person + workspace | once/new contact | duplicate resolution does not emit; schema/privacy test; implemented v1, live canary pending |
| `crm_contact_assignment_updated` | Contact assignment succeeds; `lib/crm/contact-actions.ts` | `workspace_id`, assignment state, override-used boolean | person + workspace | per successful assignment change | schema/privacy test; implemented v1, live canary pending |
| `crm_opportunity_created` | Opportunity insert succeeds; `app/(product)/crm/opportunities-actions.ts` | `workspace_id`; person/company/value presence booleans | person + workspace | once/opportunity | opportunity UUID deduplication; schema/privacy test; implemented v1, live canary pending |
| `crm_opportunity_stage_changed` | Optimistic-lock-protected stage move succeeds; `lib/crm/board-actions.ts` | `workspace_id`, result, terminal flag, seconds in prior stage | person + workspace | per successful stage move | failed/stale/no-op moves do not emit; schema/privacy test; implemented v1, live canary pending |
| `integration_connected` | SMTP/IMAP validation and account save succeed; `app/(product)/email/actions.ts` | `workspace_id`, `integration_type:smtp`, `supports_inbound` | person + workspace | once/setup | schema test; active v1 |
| `flow_created` | Draft and optional template version persist; `app/(product)/flows/actions.ts` | `workspace_id`, `used_template`; optional `template_key` | person + workspace | per flow | schema test; active v1 |
| `flow_published` | Authorized definition publishes; `app/(product)/flows/actions.ts` | `workspace_id`, `sends_email` | person + workspace | per publish | schema test; active v1 |
| `campaign_created` | Campaign draft persists; `app/(product)/email/actions.ts` | `workspace_id`, `campaign_type` | person + workspace | per campaign | schema test; active v1 |
| `campaign_launched` | Launch validation and enrollment succeed; `app/(product)/email/actions.ts` | `workspace_id`, `campaign_type`, step/enrollment counts | person + workspace | per launch | schema test; active v1 |
| `hubble_query_completed` | Hubble returns an answer result; `app/api/hubble/ask/route.ts` | `workspace_id`, `feature:hubble_ask`, result, duration, cache flag, search/page/browser/LLM counts | person + workspace | per query | schema + privacy test; active v1 |
| `hubble_query_failed` | Hubble throws after request validation; `app/api/hubble/ask/route.ts` | `workspace_id`, `feature:hubble_ask`, `error_code:RESEARCH_FAILED`, `duration_ms` | person + workspace | exception only | schema + privacy test; active v1 |
| `analytics_validation_completed` | Development-only synthetic delivery probe succeeds; `app/(product)/dashboard/analytics-validation/actions.ts` | `workspace_id`, `channel`, `validation_run_id` | synthetic person + workspace | validation only | Browser/server live delivery + UUID deduplication verified in project `612494`; dashboard `2113829`, insights `YBs6v2D9`, `rUkg4gVW`, and `Ry0QWgNG`; active v1 |

## Common properties

| Property | Type | Source | Notes |
| --- | --- | --- | --- |
| `schema_version` | number | catalog | Always `1` |
| `app_environment` | string | Vercel/Node environment | Bounded |
| `release` | string | Vercel Git SHA | Bounded to 40 chars; `unknown` locally |
| `is_synthetic` | boolean | validation only | Must be true for synthetic traffic |

Browser identity properties are limited to `plan`, `is_admin`, and
`workspace_role`. Workspace group properties are limited to `plan` and
`workspace_size_band`. Server identify accepts the same coarse traits.

## Prohibited properties

Never add raw email, phone, name, password, secret, token, cookie,
authorization, OAuth code, prompt/question, response/answer, message/body,
HTML/content, lead/contact/profile fields, CSV rows, full URLs with query
strings, request/response objects, or uploaded documents. Error messages are
also prohibited because provider/database messages can contain customer data.

## Semantics and migrations

- Emit only after the documented successful state transition. Attempts are not
  successes.
- `extractor_job_started` and `extractor_job_finished` deliberately use
  different deterministic event UUIDs derived from the same internal job ID;
  retries cannot duplicate the terminal event or collide with the start event.
- `correlation_id` exists only for asynchronous job debugging and must be a
  generated internal ID, never a customer field.
- Breaking property changes require a schema-version increment and a migration
  note here. Do not silently reuse an event name with new semantics.
- Events renamed before first ingestion: `user_signed_up` →
  `account_signed_up`, `user_signed_in` → `account_signed_in`,
  `mailbox_connected` → `integration_connected`,
  `email_campaign_created/launched` → `campaign_created/launched`,
  `crm_import_completed` → `leads_imported`, and
  `extension_capture_queued` → `extractor_job_started`.

## Known measurement gaps

Workspace creation/onboarding, subscription lifecycle webhooks, enrichment
batch outcomes, email send/reply outcomes, and flow-run outcomes are not yet in
the approved catalog. Export terminal outcomes, extractor terminal outcomes,
manual contact creation/assignment, and opportunity creation/stage movement are
implemented but still require a post-deploy synthetic canary before being
classified as live-verified.

The synthetic `account_signed_up`, `leads_imported`, `flow_published`,
`hubble_query_completed`, and `hubble_query_failed` rows used to define
dashboard queries are definition seeds, not evidence that each product UI flow
completed end to end. They use `is_synthetic=true`, development environment,
the authorized test identities/workspaces, zeroed IP, and disabled GeoIP.
