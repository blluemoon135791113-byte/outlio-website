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
# Nothing here touches the project database.
#
# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  ⚠️ IT NO LONGER NEEDS DOCKER, AND THAT IS A CORRECTNESS FIX RATHER THAN  ║
# ║  A CONVENIENCE.                                                           ║
# ║                                                                           ║
# ║  This script used to require Docker outright. Docker is not part of this  ║
# ║  product — nothing in the app, the build or the deployment uses it — so   ║
# ║  the only thing gating migration validation was a dependency the project  ║
# ║  does not otherwise have. When Docker was unavailable the harness did not ║
# ║  warn; it simply could not run, and migrations shipped UNCHECKED.         ║
# ║  `scripts/rehearse-migration.mjs` exists because that already happened:   ║
# ║  0095 reached staging with a cast error that failed on every call.        ║
# ║                                                                           ║
# ║  So the engine is now chosen, not assumed:                                ║
# ║                                                                           ║
# ║    docker   — a throwaway container, as before                            ║
# ║    local    — a throwaway cluster from an installed initdb/postgres       ║
# ║                                                                           ║
# ║  Both are disposable and neither touches the project database. Set        ║
# ║  CHECK_MIGRATION_ENGINE to force one.                                     ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
#
# Usage:
#   scripts/check-migration.sh supabase/migrations/0074_crm_deduplication.sql
#   scripts/check-migration.sh supabase/migrations/0074_...sql /tmp/smoke.sql

set -euo pipefail

MIGRATION="${1:?usage: check-migration.sh <migration.sql> [smoke.sql]}"
SMOKE="${2:-}"
CONTAINER=outlio-sqlcheck

engine="${CHECK_MIGRATION_ENGINE:-}"
if [ -z "$engine" ]; then
  if docker info >/dev/null 2>&1; then
    engine=docker
  elif command -v initdb >/dev/null 2>&1 && command -v postgres >/dev/null 2>&1; then
    engine=local
  else
    echo "No Postgres to validate against." >&2
    echo "  Either start Docker, or install PostgreSQL so initdb and postgres are on PATH." >&2
    echo "  A migration cannot be checked without a real server -- plpgsql bodies are" >&2
    echo "  not name-resolved until they run (see 0072)." >&2
    exit 1
  fi
fi
echo "→ engine: $engine"

if [ "$engine" = docker ]; then
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
else
  # ---------------------------------------------------------------------------
  # A throwaway cluster on a spare port.
  #
  # ⚠️ THE DATA DIRECTORY IS SHORT AND OUTSIDE THE REPO, deliberately. On
  # Windows initdb fails with a bare "No such file or directory" when the path
  # approaches MAX_PATH, which reads as a missing binary rather than a long
  # path. Keeping it under the system temp root avoids that, and keeps a
  # throwaway cluster out of the working tree where a stray `git add` could
  # reach it.
  #
  # ⚠️ PORT 55432, NOT 5432. A developer machine with a real local Postgres
  # must not have this script connect to it -- scaffolding and replaying 50
  # migrations into somebody's actual database would be destructive, and the
  # failure would look like a migration bug.
  # ---------------------------------------------------------------------------
  #
  # ⚠️ AND NOT A FIXED PORT, EITHER. Two runs at once — two sessions, two
  # worktrees — used to share 55432. The second postgres failed to bind, but
  # its readiness loop only asked whether SOMETHING answered, so it scaffolded
  # into the first run's cluster: one run validating against another's
  # database. So each run names its cluster uniquely and is only ready once
  # the server answering carries that name.
  #
  # ⚠️ PROBING A PORT IS NOT RESERVING IT. A run still inside initdb is not
  # listening yet, so a second run can probe the same port, find it quiet, and
  # lose the bind. When our postgres exits before it is ready, the next port is
  # tried rather than the run failing.
  PGCHECK_DIR="${TMPDIR:-/tmp}/outlio-sqlcheck.$$"
  PGCHECK_NAME="outlio-sqlcheck-$$"
  PGCHECK_PORT=""
  # ⚠️ A PORT THAT ACCEPTS AND NEVER ANSWERS HANGS psql INDEFINITELY — seen on
  # a wedged cluster left by another run. Without a timeout the port scan
  # below stops there for good instead of moving on.
  export PGCONNECT_TIMEOUT=5

  # ⚠️ STOPPED WITH pg_ctl AND WAITED FOR, NOT JUST KILLED. On Windows `kill`
  # does not wait for the postmaster or its backends to exit, so `rm -rf` ran
  # while they still held data/ open: the files went, the directory stayed,
  # and every run left an empty outlio-sqlcheck.* behind in the temp root.
  stop_cluster() {
    if [ -n "${PGCHECK_PID:-}" ]; then
      pg_ctl -D "$PGCHECK_DIR/data" -m immediate -w -t 30 stop >/dev/null 2>&1 \
        || kill "$PGCHECK_PID" >/dev/null 2>&1 || true
      wait "$PGCHECK_PID" 2>/dev/null || true
      PGCHECK_PID=""
    fi
  }

  cleanup() {
    stop_cluster
    # A handle can outlive its process by a moment on Windows; retry briefly.
    for _ in $(seq 1 10); do
      rm -rf "$PGCHECK_DIR" >/dev/null 2>&1 || true
      [ -e "$PGCHECK_DIR" ] || break
      sleep 1
    done
    if [ -e "$PGCHECK_DIR" ]; then
      echo "warning: could not remove $PGCHECK_DIR" >&2
    fi
  }
  trap cleanup EXIT

  mkdir -p "$PGCHECK_DIR"
  initdb -D "$PGCHECK_DIR/data" -U postgres -A trust -E UTF8 >"$PGCHECK_DIR/initdb.log" 2>&1 || {
    echo "initdb failed:" >&2
    tail -20 "$PGCHECK_DIR/initdb.log" >&2
    exit 1
  }

  is_ours() {
    [ "$(psql -h 127.0.0.1 -p "$1" -U postgres -d postgres -X -qtA \
          -c "select current_setting('cluster_name')" 2>/dev/null | tr -d '\r')" = "$PGCHECK_NAME" ]
  }

  ready=""
  for p in $(seq 55432 55471); do
    # Something already answers here — another run, or a real local server.
    if psql -h 127.0.0.1 -p "$p" -U postgres -d postgres -X -q -c 'select 1' >/dev/null 2>&1; then
      continue
    fi

    postgres -D "$PGCHECK_DIR/data" -p "$p" -k "" -c cluster_name="$PGCHECK_NAME" \
      >"$PGCHECK_DIR/pg.log" 2>&1 &
    PGCHECK_PID=$!

    # Same two-checks-apart wait as the container path, for the same reason: a
    # server that answers once and then exits is not a server that is up.
    for _ in $(seq 1 60); do
      if is_ours "$p"; then
        sleep 1
        if is_ours "$p"; then
          ready=yes
          break
        fi
      fi
      # Exited without becoming ready: most likely it lost the bind race.
      kill -0 "$PGCHECK_PID" >/dev/null 2>&1 || break
      sleep 1
    done

    if [ -n "$ready" ]; then
      PGCHECK_PORT=$p
      break
    fi
    stop_cluster
  done

  if [ -z "$ready" ]; then
    echo "The local cluster never accepted a connection." >&2
    tail -20 "$PGCHECK_DIR/pg.log" >&2
    exit 1
  fi
  echo "→ local cluster on port $PGCHECK_PORT"
  PSQL="psql -h 127.0.0.1 -p $PGCHECK_PORT -U postgres -d postgres -X -q -v ON_ERROR_STOP=1"
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
/*
 * ⚠️ `user_id` IS NOT DECORATION. 0114's backfill joins
 * `research_evidence.user_id = extracted_leads.user_id` — the seam between the
 * user-keyed Lead Engine and the workspace-keyed CRM. Without the column the
 * migration fails here while working perfectly on the real database, which is
 * the false-failure this scaffold's header warns about.
 */
create table public.extracted_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade);
create table public.companies (id uuid primary key default gen_random_uuid());
/*
 * From 0044, which this harness does not replay. 0113 adds an `evidence_id` FK
 * pointing here and then VERIFIES the constraint resolves, so a stub with only
 * an id is not enough — 0114 reads entity_type, entity_id, field, value_json
 * and user_id to decide which citation belongs to which address.
 */
create table public.research_evidence (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  entity_type  text not null,
  entity_id    uuid not null,
  field        text not null,
  value_json   jsonb not null default '{}'::jsonb,
  -- 0114 ranks candidate citations newest-first, so this one is load-bearing
  -- rather than descriptive.
  retrieved_at timestamptz not null default now());
SQL

# ---------------------------------------------------------------------------
# Prerequisites, in order. Extend this list as the platform grows.
#
# ⚠️ A MIGRATION MISSING FROM HERE IS NOT NEUTRAL — IT VALIDATES THE ONE UNDER
# TEST AGAINST A SCHEMA NOBODY RUNS. This list stopped at 0106 while the
# repository reached 0123, so seventeen migrations' worth of tables, columns and
# constraints were absent from every check. 0123 passed anyway, but only because
# it happened to touch nothing newer than 0075 — luck, not coverage.
#
# ⚠️ 0118_pg_cron_tick IS DELIBERATELY EXCLUDED, AND THAT IS DIFFERENT FROM
# BEING FORGOTTEN. It does `create extension pg_cron`, which is not available in
# a stock postgres image — verified: "extension pg_cron is not available". A
# migration that CANNOT replay locally belongs here as a named exclusion, so the
# next person knows the gap is understood rather than overlooked.
#
# 0119_scheduler_diagnostics is included and passes: it reads cron.job through
# a guard that tolerates the schema being absent.
# ---------------------------------------------------------------------------
for m in 0070_workspaces 0071_crm_core_identity 0072_crm_ingestion 0073_fix_ingest_ambiguity 0074_crm_deduplication 0075_crm_operations 0076_crm_opportunities 0077_fix_move_errcode 0078_crm_realtime 0079_crm_collision_guard 0080_crm_contact_search 0081_ingest_contact_created 0082_reporting_aggregates 0083_crm_funnel 0084_crm_forecast 0085_email_accounts 0086_email_messages 0087_email_readiness 0088_email_campaigns 0089_email_templates 0090_email_events 0091_fix_event_fk_append_only 0092_email_reporting 0093_flow_engine 0094_hubble_credits 0095_meetings 0096_fix_meeting_status_cast 0097_public_api 0098_webhook_url_loopback 0099_notification_channels 0100_unified_inbox 0101_inbound_optional_args 0102_onboarding_state 0103_plan_module_entitlements 0104_email_reply_threading 0105_fix_claim_column_name 0106_restore_claim_safety 0107_dashboards 0108_flow_run_variables 0109_fix_user_fk_append_only 0110_restore_signup_gate 0111_sender_postal_address 0112_contact_list_sort_indexes 0113_contact_value_citations 0114_backfill_contact_citations 0115_rls_membership_setmembership 0116_due_webhook_deliveries 0117_worker_runs 0119_scheduler_diagnostics 0120_suppress_by_contact 0121_contact_dnc_and_timezone 0122_linkedin_senders 0123_crm_assign_contact_owner 0124_crm_tasks_opportunity 0125_crm_round_robin_assign 0126_crm_task_actions 0127_crm_intake_routing; do
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
  # ⚠️ THROUGH $PSQL, NOT `docker exec`. This line named the container directly
  # while every other statement went through $PSQL -- harmless while docker was
  # the only engine, and an immediate failure the moment it is not.
  #
  # ⚠️ EXIT 0 IS NOT A PASS. psql fails only on a SQL error, and a check that
  # prints `ok = f` is not one — seven false checks once exited 0 here. Nor can
  # this parse psql's `t`/`f` instead: a NULL `ok` prints blank, and a check
  # whose `where` matched no rows prints nothing at all, so there is nothing to
  # find.
  #
  # So a smoke file must END IN A GATE that raises unless every recorded check
  # is true (see any file under supabase/migrations/smoke/), and this demands
  # the notice that gate emits on success. A file with no gate is refused
  # rather than passed: it cannot fail, so its exit 0 proves nothing.
  set +e
  smoke_output=$($PSQL < "$SMOKE" 2>&1)
  smoke_status=$?
  set -e

  echo "$smoke_output"

  if [ $smoke_status -ne 0 ]; then
    echo "✗ smoke test failed"
    exit 1
  fi
  if ! echo "$smoke_output" | grep -Eq 'NOTICE: +SMOKE PASSED:'; then
    echo "✗ smoke test has no gate — it exited 0, but nothing in it could have failed"
    echo "  Record checks in smoke_checks and end with the SMOKE PASSED gate;"
    echo "  see supabase/migrations/smoke/0120_suppress_by_contact.smoke.sql"
    exit 1
  fi
  echo "✓ smoke test passed"
fi
