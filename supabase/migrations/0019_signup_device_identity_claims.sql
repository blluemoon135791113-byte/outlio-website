-- 0019 - VPN-resistant trial claims
--
-- An IP address is not a person. A VPN can change it, while an office or
-- household can legitimately share it. Keep the network claim from 0018, then
-- add two independent, pseudonymous signals:
--
--   1. a server-signed first-party device token; and
--   2. persistent HMAC claims for normalized email, phone, and LinkedIn ID.
--
-- Raw device identifiers and identity values are never stored here. Claims
-- intentionally survive auth-user deletion so deleting an account cannot
-- restore trial eligibility.

create table if not exists public.signup_device_claims (
  device_hash text primary key,
  user_id     uuid not null unique,
  claimed_at  timestamptz not null default now(),
  constraint signup_device_claims_hash_format
    check (device_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.signup_identity_claims (
  identity_hash text primary key,
  identity_kind text not null,
  user_id       uuid not null,
  claimed_at    timestamptz not null default now(),
  constraint signup_identity_claims_hash_format
    check (identity_hash ~ '^[0-9a-f]{64}$'),
  constraint signup_identity_claims_kind
    check (identity_kind in ('email', 'phone', 'linkedin')),
  constraint signup_identity_claims_user_kind_unique
    unique (user_id, identity_kind)
);

create index if not exists signup_identity_claims_user_id_idx
  on public.signup_identity_claims (user_id);

alter table public.signup_device_claims enable row level security;
alter table public.signup_identity_claims enable row level security;

revoke all on table public.signup_device_claims
  from public, anon, authenticated;
revoke all on table public.signup_identity_claims
  from public, anon, authenticated;
grant select, insert, update, delete on table public.signup_device_claims
  to service_role;
grant select, insert, update, delete on table public.signup_identity_claims
  to service_role;

-- Consume the network reservation and all additional claims inside the same
-- transaction as auth.users. A duplicate device or identity raises a unique
-- violation, rolling back the auth user and the network-claim update together.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token         text;
  v_token_hash    text;
  v_ip_hash       text;
  v_device_hash   text;
  v_email_hash    text;
  v_phone_hash    text;
  v_linkedin_hash text;
begin
  v_token := nullif(new.raw_user_meta_data ->> 'signup_reservation_token', '');
  v_device_hash := nullif(new.raw_user_meta_data ->> 'signup_device_hash', '');
  v_email_hash := nullif(new.raw_user_meta_data ->> 'signup_email_hash', '');
  v_phone_hash := nullif(new.raw_user_meta_data ->> 'signup_phone_hash', '');
  v_linkedin_hash := nullif(new.raw_user_meta_data ->> 'signup_linkedin_hash', '');

  if v_token is null or length(v_token) > 256
     or v_device_hash is null or v_device_hash !~ '^[0-9a-f]{64}$'
     or v_email_hash is null or v_email_hash !~ '^[0-9a-f]{64}$'
     or v_phone_hash is null or v_phone_hash !~ '^[0-9a-f]{64}$'
     or v_linkedin_hash is null or v_linkedin_hash !~ '^[0-9a-f]{64}$' then
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

  insert into public.signup_device_claims (device_hash, user_id)
  values (v_device_hash, new.id);

  insert into public.signup_identity_claims (
    identity_hash, identity_kind, user_id
  ) values
    (v_email_hash, 'email', new.id),
    (v_phone_hash, 'phone', new.id),
    (v_linkedin_hash, 'linkedin', new.id);

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
