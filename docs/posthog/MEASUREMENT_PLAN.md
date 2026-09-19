# Outlio measurement plan

## Product outcome

**North-star outcome:** weekly active workspaces that complete a useful lead
workflow: acquire/import leads and complete at least one next-value action
(Hubble research, publish a flow, or launch a campaign). This is a hypothesis
grounded in the current repository and should be revisited after four weeks of
clean data.

**Activation:** within seven days of account creation, a workspace completes a
lead acquisition/import action and at least one next-value action.

**Time to first value:** elapsed time from `account_signed_up` to the first of
successful/partial `extractor_job_finished`, `leads_imported`,
`hubble_query_completed`, `flow_published`, `campaign_launched`, or
`crm_opportunity_created`. An extension job only starting is progress, not
value.

**Retention:** an activated workspace returns in a later ISO week and completes
another next-value event.

## Top-level KPIs

No more than eight should appear in the founder view.

| Category | KPI | Definition |
| --- | --- | --- |
| Product | Weekly valuable workspaces | Unique workspace groups with a next-value event |
| Product | Seven-day activation rate | New workspaces meeting the activation definition / eligible new workspaces |
| Product | Median time to first value | Median signup-to-first-value duration among activated workspaces |
| Growth | Signup-to-checkout rate | Known accounts with `checkout_started` / signed-up accounts |
| Adoption | Core workflow completion | Workspaces progressing from acquisition/import to a next-value event |
| Retention | Week-1 retained workspaces | Activated workspaces with next-value usage in the following week |
| Reliability | Core action failure rate | Failed Hubble/core jobs / all corresponding outcomes; expands as failure events are added |
| Cost | Hubble work per answer | Median calls/pages/duration per `hubble_query_completed` |

## Funnels and questions

1. **Acquisition:** landing page `$pageview` → `account_signed_up` →
   `checkout_started`. Which referrers and campaigns create activated users, not
   merely visits?
2. **Lead workflow:** `extractor_job_started` or `leads_imported` →
   `hubble_query_completed`, `flow_published`, or `campaign_launched`. Where do
   workspaces stop before value?
3. **Email activation:** `integration_connected` → `campaign_created` →
   `campaign_launched`. How long does setup take and which step loses users?
4. **Automation adoption:** `flow_created` → `flow_published`. Do templates
   improve publish completion?
5. **CRM activation:** `crm_contact_created` → `crm_opportunity_created` →
   `crm_opportunity_stage_changed`. How many workspaces progress from adding a
   person to actively moving a deal?

These are workspace-level funnels where workspace IDs exist. Signup and
checkout begin person-level and must not be incorrectly grouped before a
workspace is resolved.

## Safe segmentation dimensions

- environment and release;
- plan and workspace role;
- coarse workspace size band (`1`, `2-5`, `6-20`, `21+`);
- integration type, campaign type, billing interval, extractor source,
  export destination/category, and terminal result enums;
- boolean cache/template/authentication states;
- browser/device properties automatically provided by PostHog, subject to DNT;
- UTM/referrer data after URL query stripping.

Never segment on names, emails, phone numbers, lead/contact attributes,
questions, answers, message content, CSV content, or scraped profile fields.

## Dashboard specification

| Dashboard | Assets to create after ingestion | Named question |
| --- | --- | --- |
| Founder overview | KPI trends, activation funnel, time-to-value, W1 retention, serious errors | Is customer value and reliability improving? |
| Acquisition and onboarding | Source/page trends and landing→signup→activation funnel | Which acquisition sources create activated workspaces? |
| Core product adoption | Lead workflow funnel, email and flow completion, workspace retention | Which workflows create repeat value? |
| Reliability and operations | Hubble outcomes/latency, job failures, exceptions by release | Where is value being lost to failures or latency? |
| Hubble operations | volume, outcome, p50/p95 duration, cache rate, calls/pages per answer | Is AI-assisted research reliable and cost-efficient? |

Status: **PARTIAL**. Synthetic browser/server events, exceptions, identity,
workspace grouping, replay, and event UUID deduplication are now visible in the
project. Dashboard `2113797` contains the initial activation, workflow, Hubble,
email, and definition-only CRM activation insights. The extended CRM,
export, and extractor events are implemented and locally tested but still need
a post-deploy synthetic canary. This proves ingestion and query definitions but is not a
customer-behavior baseline: exclude `is_synthetic=true` from business reporting
and wait for at least 14 days of real traffic before setting thresholds.

## Initial alert policy

Do not use arbitrary fixed thresholds. After 14 days, establish weekday-aware
baselines and propose alerts for: a new critical exception, a release-correlated
regression, Hubble failures above the normal band, and a material drop in core
workflow completion. Alert routing must be tested with internal recipients and
requires approval before external destinations are added.
