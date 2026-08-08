-- 0018 - one account per network signup gate
--
-- The browser-facing Supabase URL and publishable key are intentionally public.
-- That means a UI-only IP check is not enough: a caller could invoke
-- auth.signUp directly. This migration makes the database trigger require a
-- short-lived, one-time reservation created by the server before any auth user
-- can be inserted.
--
-- Privacy: raw IP addresses are never stored. The application sends a keyed
-- HMAC-SHA256 digest. Reservation tokens are also stored only as SHA-256
-- digests. A completed claim is retained after account deletion so deleting an
-- account cannot reset trial eligibility.

-- The signup form already normalizes both fields. Existing production data can
-- contain duplicates, so a new UNIQUE index would be destructive or fail to
-- apply. This forward-only trigger preserves existing rows while rejecting any
-- new duplicate identity. Transaction-scoped advisory locks close the race
-- where two concurrent inserts check before either row is visible.
create or replace function public.prevent_duplicate_signup_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.phone is not null
     and (tg_op = 'INSERT' or new.phone is distinct from old.phone) then
    perform pg_advisory_xact_lock(hashtextextended('signup-phone:' || new.phone, 0));
    if exists (
      select 1 from public.profiles
       where phone = new.phone and id <> new.id
    ) then
      raise exception 'Signup identity is already in use' using errcode = '23505';
    end if;
  end if;

  if new.linkedin_url is not null
     and (tg_op = 'INSERT' or new.linkedin_url is distinct from old.linkedin_url) then
    perform pg_advisory_xact_lock(
      hashtextextended('signup-linkedin:' || new.linkedin_url, 0)
    );
    if exists (
      select 1 from public.profiles
       where linkedin_url = new.linkedin_url and id <> new.id
    ) then
      raise exception 'Signup identity is already in use' using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_prevent_duplicate_signup_identity on public.profiles;
create trigger profiles_prevent_duplicate_signup_identity
  before insert or update of phone, linkedin_url on public.profiles
  for each row execute function public.prevent_duplicate_signup_identity();

create table if not exists public.signup_ip_claims (
  ip_hash         text primary key,
  token_hash      text unique,
  user_id         uuid unique,
  reserved_until  timestamptz not null,
  claimed_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint signup_ip_claims_ip_hash_format
    check (ip_hash ~ '^[0-9a-f]{64}$'),
  constraint signup_ip_claims_token_hash_format
    check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  constraint signup_ip_claims_claim_shape
    check (
      (claimed_at is null and user_id is null and token_hash is not null)
      or
      (claimed_at is not null and user_id is not null and token_hash is null)
    )
);

drop trigger if exists signup_ip_claims_set_updated_at on public.signup_ip_claims;
create trigger signup_ip_claims_set_updated_at
  before update on public.signup_ip_claims
  for each row execute function public.set_updated_at();

create index if not exists signup_ip_claims_pending_idx
  on public.signup_ip_claims (reserved_until)
  where claimed_at is null;

-- Service role only. There are deliberately no RLS policies.
alter table public.signup_ip_claims enable row level security;
revoke all on table public.signup_ip_claims from public, anon, authenticated;
grant select, insert, update, delete on table public.signup_ip_claims to service_role;

-- Atomically reserve an IP digest. A completed claim can never be replaced.
-- An abandoned pending reservation may be replaced after ten minutes.
create or replace function public.reserve_signup_ip(
  p_ip_hash             text,
  p_token_hash          text,
  p_reservation_seconds int default 600
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reserved boolean;
begin
  if p_ip_hash !~ '^[0-9a-f]{64}$'
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_reservation_seconds < 60
     or p_reservation_seconds > 1800 then
    raise exception 'Invalid signup reservation';
  end if;

  insert into public.signup_ip_claims (
    ip_hash, token_hash, reserved_until
  ) values (
    p_ip_hash,
    p_token_hash,
    now() + make_interval(secs => p_reservation_seconds)
  )
  on conflict (ip_hash) do update
    set token_hash = excluded.token_hash,
        user_id = null,
        claimed_at = null,
        reserved_until = excluded.reserved_until
    where public.signup_ip_claims.claimed_at is null
      and public.signup_ip_claims.reserved_until <= now()
  returning true into v_reserved;

  return coalesce(v_reserved, false);
end;
$$;

revoke all on function public.reserve_signup_ip(text, text, int)
  from public, anon, authenticated;
grant execute on function public.reserve_signup_ip(text, text, int)
  to service_role;

-- Release only the caller's still-pending reservation. Once the auth trigger
-- consumes a token it is nulled, so this can never erase a completed claim.
create or replace function public.release_signup_ip(
  p_ip_hash    text,
  p_token_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted boolean;
begin
  delete from public.signup_ip_claims
   where ip_hash = p_ip_hash
     and token_hash = p_token_hash
     and claimed_at is null
  returning true into v_deleted;

  return coalesce(v_deleted, false);
end;
$$;

revoke all on function public.release_signup_ip(text, text)
  from public, anon, authenticated;
grant execute on function public.release_signup_ip(text, text)
  to service_role;

-- Require and consume the reservation in the same transaction that inserts
-- auth.users. Direct calls to Supabase Auth without a server-issued token fail
-- here and the auth user insert is rolled back.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token      text;
  v_token_hash text;
  v_ip_hash    text;
begin
  v_token := nullif(new.raw_user_meta_data ->> 'signup_reservation_token', '');

  if v_token is null or length(v_token) > 256 then
    raise exception 'Signup is not authorized' using errcode = '28000';
  end if;

  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  update public.signup_ip_claims
     set token_hash = null,
         user_id = new.id,
         claimed_at = now(),
         reserved_until = now()
   where token_hash = v_token_hash
     and claimed_at is null
     and reserved_until > now()
  returning ip_hash into v_ip_hash;

  if v_ip_hash is null then
    raise exception 'Signup is not authorized' using errcode = '28000';
  end if;

  insert into public.profiles (id, email, full_name, phone, linkedin_url)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'linkedin_url', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Clear abandoned reservations without touching completed claims.
create or replace function public.sweep_signup_ip_reservations()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.signup_ip_claims
   where claimed_at is null
     and reserved_until <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.sweep_signup_ip_reservations()
  from public, anon, authenticated;
grant execute on function public.sweep_signup_ip_reservations()
  to service_role;
