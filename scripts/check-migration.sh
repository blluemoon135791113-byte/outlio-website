#!/usr/bin/env bash
#
# Validate a migration against a REAL Postgres before anyone applies it to the
# project database.
#
# WHY THIS EXISTS
#
# Migrations here are applied by hand in the Supabase SQL editor, so a mistake
# costs a round trip with a human in the middle. Worse, PL/pgSQL defers most
# checking to execution: 0072 shipped a function whose body was ambiguous,
# applied without complaint, generated a correct-looking type signature, passed
# typecheck, and failed on the first real call.
#
# This spins up a throwaway Postgres, scaffolds just enough of the Supabase
# shape (auth.users, the three roles, set_updated_at, is_admin), replays the
# CRM migrations, and applies the one under test. Optionally it then runs a
# smoke file so a FUNCTION can be executed rather than merely created — the
# only way to catch the 0072 class of bug.
#
# Nothing here touches the project database. It needs Docker and nothing else.
#
# Usage:
#   scripts/check-migration.sh supabase/migrations/0074_crm_deduplication.sql
#   scripts/check-migration.sh supabase/migrations/0074_...sql /tmp/smoke.sql

set -euo pipefail

MIGRATION="${1:?usage: check-migration.sh <migration.sql> [smoke.sql]}"
SMOKE="${2:-}"
CONTAINER=outlio-sqlcheck
PSQL="docker exec -i $CONTAINER psql -U postgres -X -q -v ON_ERROR_STOP=1"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

cleanup
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=check postgres:16 >/dev/null
# ⚠️ NOT pg_isready. The postgres image starts a TEMPORARY server to run its
# init scripts, then shuts it down and starts the real one. pg_isready answers
# "yes" during that first window, so the loop broke early and every psql after
# it failed with "No such file or directory" on the socket -- a confusing error
# that looks like Docker is broken rather than like a race.
#
# Waiting on an actual query, twice a second apart, only passes once the real
# server is up and staying up.
ready=""
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" psql -U postgres -X -q -c 'select 1' >/dev/null 2>&1; then
    sleep 1
    if docker exec "$CONTAINER" psql -U postgres -X -q -c 'select 1' >/dev/null 2>&1; then
      ready=yes
      break
    fi
  fi
  sleep 1
done
if [ -z "$ready" ]; then
  echo "Postgres in $CONTAINER never accepted a connection." >&2
  docker logs "$CONTAINER" 2>&1 | tail -20 >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Scaffold. Deliberately minimal: only the objects the CRM migrations reference,
# with only the columns they touch. A fuller replica would drift from the real
# schema and give false confidence.
# ---------------------------------------------------------------------------
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
/*
 * ⚠️ `key` IS THE ENUM, NOT text. It was scaffolded as `text` and the harness
 * therefore reported "applies cleanly" for a migration that failed in the
 * Supabase editor with:
 *
 *   ERROR: function string_agg(plan_key, unknown) does not exist
 *
 * A scaffold looser than production is not a conservative approximation — it
 * is a harness that passes what the real database rejects, which is the one
 * failure mode a pre-flight check must not have. `text` accepts every
 * expression the enum does AND every one it does not, so the entire class of
 * enum-type errors on `plans.key` was invisible here.
 *
 * The comment above about a fuller replica "giving false confidence" still
 * stands for columns nothing references. It does not license modelling a
 * column LOOSER than production, which is the opposite mistake.
 */
create type public.plan_key as enum (
  'trial', 'starter', 'professional', 'agency', 'custom');
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  key public.plan_key unique,
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
-- `user_id` is needed by 0114's backfill, which joins evidence to the lead it
-- came from and scopes the join by owner. Real type and FK from 0006.
create table public.extracted_leads (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade);
create table public.companies (id uuid primary key default gen_random_uuid());
/*
 * 0113 adds `evidence_id` FKs pointing here and then ASSERTS the constraint
 * resolves to this exact relname; 0114 backfills through it. Created by 0044,
 * which this harness does not replay.
 *
 * ⚠️ TYPES AND CHECKS COPIED FROM 0044, NOT APPROXIMATED. `entity_type` and
 * `source_confidence` carry CHECK constraints in production, and a scaffold
 * that dropped them would accept a backfill the real database rejects — the
 * same too-permissive mistake that let `plans.key` hide an enum error. Only
 * the columns 0113/0114 touch are modelled, which is the scaffold's rule.
 */
create table public.research_evidence (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  entity_type       text not null check (entity_type in ('company', 'person')),
  entity_id         uuid not null,
  field             text not null,
  value_json        jsonb not null,
  source_provider   text not null,
  source_url        text,
  source_confidence text not null check (source_confidence in ('high', 'medium', 'low')),
  retrieved_at      timestamptz not null default now(),
  expires_at        timestamptz,
  created_at        timestamptz not null default now());
SQL

# Prerequisites, in order. Extend this list as the platform grows.
#
# ⚠️ IT STOPPED AT 0106 AND THE PLATFORM DID NOT. Twenty migrations later,
# anything depending on 0107..0126 got a FALSE FAILURE here — 0124 reported
# "column o.value_amount_base does not exist" (it is created by 0123) and 0125
# reported "relation public.linkedin_senders does not exist" (0122). Both apply
# perfectly to the real database.
#
# This is the exact outcome the scaffold comment above warns about: "a harness
# that reports a false failure gets ignored, which is worse than not having
# one." It was ignored, and 0127 went to the SQL editor unvalidated and failed
# there on an enum cast this harness is built to catch.
#
# ⚠️ SO EXTENDING THIS LIST IS NOT HOUSEKEEPING. A skipped prerequisite does
# not weaken the check, it INVERTS it: the migration under test fails for a
# reason that has nothing to do with the migration, and the only rational
# response to a tool that cries wolf is to stop running it.
for m in 0070_workspaces 0071_crm_core_identity 0072_crm_ingestion 0073_fix_ingest_ambiguity 0074_crm_deduplication 0075_crm_operations 0076_crm_opportunities 0077_fix_move_errcode 0078_crm_realtime 0079_crm_collision_guard 0080_crm_contact_search 0081_ingest_contact_created 0082_reporting_aggregates 0083_crm_funnel 0084_crm_forecast 0085_email_accounts 0086_email_messages 0087_email_readiness 0088_email_campaigns 0089_email_templates 0090_email_events 0091_fix_event_fk_append_only 0092_email_reporting 0093_flow_engine 0094_hubble_credits 0095_meetings 0096_fix_meeting_status_cast 0097_public_api 0098_webhook_url_loopback 0099_notification_channels 0100_unified_inbox 0101_inbound_optional_args 0102_onboarding_state 0103_plan_module_entitlements 0104_email_reply_threading 0105_fix_claim_column_name 0106_restore_claim_safety \
          0107_dashboards 0108_flow_run_variables 0109_fix_user_fk_append_only \
          0110_restore_signup_gate 0111_sender_postal_address \
          0112_contact_list_sort_indexes 0113_contact_value_citations \
          0114_backfill_contact_citations 0115_rls_membership_setmembership \
          0116_due_webhook_deliveries 0117_worker_runs \
          `# ⚠️ 0118 and 0119 ARE DELIBERATELY ABSENT AND MUST STAY ABSENT.` \
          `# 0118 needs pg_cron and 0119 reads cron.job and net._http_response.` \
          `# Supabase provides those; stock postgres:16 does not, so replaying` \
          `# them here fails on the ENVIRONMENT rather than on the SQL — the` \
          `# false-failure mode this list's header is about. Verified that` \
          `# nothing in 0120..0127 references a cron or net object, so skipping` \
          `# them costs no schema. A migration that itself touches pg_cron` \
          `# cannot be checked by this harness at all; say so rather than` \
          `# letting it report a green it did not earn.` \
          0120_suppress_by_contact \
          0121_contact_dnc_and_timezone 0122_linkedin_senders \
          0123_deal_fx_snapshot 0124_rollups_convert_currency \
          0125_linkedin_tasks 0126_contact_version_columns; do
  file="supabase/migrations/$m.sql"
  [ -f "$file" ] || continue
  [ "$(basename "$MIGRATION")" = "$m.sql" ] && break
  $PSQL < "$file" >/dev/null 2>&1 || { echo "FAILED replaying prerequisite $m"; exit 1; }
done

echo "→ applying $(basename "$MIGRATION")"
# ⚠️ Capture, then inspect. Piping psql into `grep -v NOTICE` makes the
# pipeline's exit status GREP's, so a migration that produced nothing but
# notices — the success case — reads as a failure.
set +e
output=$($PSQL < "$MIGRATION" 2>&1)
status=$?
set -e

echo "$output" | grep -v '^NOTICE' | grep -v '^psql:.*NOTICE' || true

if [ $status -ne 0 ]; then
  echo "✗ migration failed"
  exit 1
fi
echo "✓ applies cleanly"

if [ -n "$SMOKE" ]; then
  echo "→ running smoke test $(basename "$SMOKE")"
  docker exec -i "$CONTAINER" psql -U postgres -X -q < "$SMOKE"
fi
