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
for _ in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

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
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create or replace function public.is_admin() returns boolean language sql stable as $$ select false $$;
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text, full_name text, company_name text, deleted_at timestamptz);
create table public.plans (id uuid primary key default gen_random_uuid());
create table public.extraction_jobs (id uuid primary key default gen_random_uuid());
create table public.extracted_leads (id uuid primary key default gen_random_uuid());
create table public.companies (id uuid primary key default gen_random_uuid());
SQL

# Prerequisites, in order. Extend this list as the platform grows.
for m in 0070_workspaces 0071_crm_core_identity 0072_crm_ingestion 0073_fix_ingest_ambiguity 0074_crm_deduplication 0075_crm_operations 0076_crm_opportunities 0077_fix_move_errcode 0078_crm_realtime 0079_crm_collision_guard 0080_crm_contact_search; do
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
