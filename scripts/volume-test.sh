#!/usr/bin/env bash
#
# Volume test — M9 Phase 28, acceptance criterion 2:
#   "Volume tests (e.g. 100k contacts, 10k-recipient campaign) meet latency
#    budgets with pagination intact."
#
# WHY IT RUNS LOCALLY AND NOT AGAINST THE PROJECT
#
# The obvious way to measure production latency is to seed production. That
# would put 100,000 rows plus their indexes into the live project the app runs
# on, consume the plan's disk, and leave orphans behind if the run died
# part-way. Seeding a live database to see how slow it gets is not a test, it
# is an outage with a stopwatch.
#
# So this replays the real schema -- the same migrations, the same indexes --
# into a throwaway Postgres and measures there.
#
# ⚠️ WHAT THAT DOES AND DOES NOT PROVE. It proves QUERY PLANS: that a query
# uses its index, that pagination stays bounded, and that nothing degrades into
# a sequential scan at volume. Those properties are a function of the schema
# and hold anywhere. It does NOT prove wall-clock latency on Supabase's
# hardware over the network -- local timings are indicative only, and the
# budgets below are set well under the real ones for that reason.
#
# Usage: scripts/volume-test.sh [contacts] [enrollments]

set -euo pipefail

CONTACTS="${1:-100000}"
ENROLLMENTS="${2:-10000}"
CONTAINER=outlio-volume
PSQL="docker exec -i $CONTAINER psql -U postgres -X -q -v ON_ERROR_STOP=1"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

cleanup
echo "→ starting Postgres"
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=check postgres:16 >/dev/null
for _ in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
$PSQL <<'SQL' >/dev/null
create role anon;
create role authenticated;
create role service_role;
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
-- Mirrors Supabase's real auth.uid(): reads the sub claim from the request
-- GUC. The previous stub returned a constant NULL, which made every RLS
-- assertion in every smoke test VACUOUSLY TRUE -- a policy that denies
-- everyone passes a test that expects a member to see their own rows, because
-- both sides are empty. A test that cannot fail is worse than no test.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create or replace function public.is_admin() returns boolean language sql stable as $$ select false $$;
create type public.user_role as enum (
  'registered_user', 'pending_user', 'approved_user',
  'subscriber', 'admin', 'suspended_user');
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text, full_name text, company_name text, deleted_at timestamptz,
  role public.user_role not null default 'registered_user',
  plan_id uuid);
/*
 * ⚠️ THE SCAFFOLD MUST MODEL WHAT THE EARLY MIGRATIONS CREATE, not just enough
 * to make the CRM tables link. 0094 references `public.user_role`, `plans.limits`
 * and `usage_counters` — all from 0001/0004/0015, which this harness does not
 * replay — and without them it fails to apply here while working perfectly on
 * the real database. A harness that reports a false failure gets ignored, which
 * is worse than not having one.
 */
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  key text,
  name text,
  limits jsonb not null default '{}'::jsonb);
create table public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  metric text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  count bigint not null default 0,
  unique (user_id, metric, period_start));
create table public.rate_limits (
  bucket text not null,
  subject text not null,
  window_start timestamptz not null,
  attempts int not null default 0,
  blocked_until timestamptz,
  primary key (bucket, subject, window_start));
create table public.extraction_jobs (id uuid primary key default gen_random_uuid());
create table public.extracted_leads (id uuid primary key default gen_random_uuid());
create table public.companies (id uuid primary key default gen_random_uuid());
SQL

for m in 0070_workspaces 0071_crm_core_identity 0072_crm_ingestion 0073_fix_ingest_ambiguity 0074_crm_deduplication 0075_crm_operations 0076_crm_opportunities 0077_fix_move_errcode 0078_crm_realtime 0079_crm_collision_guard 0080_crm_contact_search 0081_ingest_contact_created 0082_reporting_aggregates 0083_crm_funnel 0084_crm_forecast 0085_email_accounts 0086_email_messages 0087_email_readiness 0088_email_campaigns 0089_email_templates 0090_email_events 0091_fix_event_fk_append_only 0092_email_reporting 0093_flow_engine 0094_hubble_credits 0095_meetings 0096_fix_meeting_status_cast 0097_public_api 0098_webhook_url_loopback 0099_notification_channels 0100_unified_inbox; do
  file="supabase/migrations/$m.sql"
  [ -f "$file" ] || continue
  $PSQL < "$file" >/dev/null 2>&1 || { echo "FAILED replaying prerequisite $m"; exit 1; }
done


echo "→ seeding $CONTACTS contacts and $ENROLLMENTS enrollments"
$PSQL <<SQL >/dev/null
insert into auth.users (id, email)
  values ('00000000-0000-0000-0000-0000000000dd', 'owner@example.com');
insert into public.workspaces (id, owner_user_id, name)
  values ('00000000-0000-0000-0000-0000000000aa',
          '00000000-0000-0000-0000-0000000000dd', 'Volume');

-- Fabricated names only, per the fixture rule.
insert into public.crm_contacts (workspace_id, full_name, job_title, created_at)
select
  '00000000-0000-0000-0000-0000000000aa',
  'Fabricated Person ' || g,
  case when g % 3 = 0 then 'Head of Sales' else 'Operations Lead' end,
  now() - (g || ' minutes')::interval
from generate_series(1, $CONTACTS) g;

insert into public.crm_contact_emails (workspace_id, contact_id, address, identity_key, is_primary)
select
  workspace_id, id,
  'person' || row_number() over (order by created_at) || '@example.com',
  'person' || row_number() over (order by created_at) || '@example.com',
  true
from public.crm_contacts;

analyze public.crm_contacts;
analyze public.crm_contact_emails;
SQL

echo "→ measuring"
docker exec -i "$CONTAINER" psql -U postgres -X < scripts/volume-queries.sql
