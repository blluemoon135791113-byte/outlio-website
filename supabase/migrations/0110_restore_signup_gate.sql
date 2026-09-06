-- 0110 — restore the signup gate that 0070 deleted
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  `0070_workspaces.sql` IS A MIGRATION ABOUT WORKSPACES. IT CONTAINS A     ║
-- ║  `create or replace function public.handle_new_user()` THAT SILENTLY      ║
-- ║  DELETED EVERY ANTI-ABUSE CONTROL ADDED BY 0009, 0018 AND 0019.           ║
-- ║                                                                           ║
-- ║  `create or replace function` does not merge. It replaces. The new body   ║
-- ║  created a profile and a workspace and nothing else, so all of this       ║
-- ║  stopped happening on every signup:                                       ║
-- ║                                                                           ║
-- ║    • the one-time reservation token was no longer validated or consumed   ║
-- ║    • the device fingerprint was no longer claimed                         ║
-- ║    • email / phone / linkedin reuse was no longer blocked                 ║
-- ║    • full_name, phone and linkedin_url were no longer written to profiles ║
-- ║                                                                           ║
-- ║  MEASURED IN PRODUCTION, 2026-09-04:                                      ║
-- ║                                                                           ║
-- ║    signup_ip_claims           915 rows, 19 ever claimed                   ║
-- ║    signup_device_claims        19 rows, newest 2026-08-24                 ║
-- ║    signup_identity_claims      62 rows, newest 2026-08-24                 ║
-- ║    profiles                    60 rows, newest 2026-09-04                 ║
-- ║    profiles with null full_name / phone / linkedin_url          39 of 60  ║
-- ║                                                                           ║
-- ║  Signups continued for eleven days. The gate recorded nothing. 896        ║
-- ║  reservations were created and never consumed, because the only code      ║
-- ║  that consumed them had been overwritten.                                 ║
-- ║                                                                           ║
-- ║  ⚠️ NOTHING FAILED. The server still computes all four hashes and still   ║
-- ║  reserves an IP on every attempt — `lib/auth/actions.ts:183-187` is       ║
-- ║  unchanged and correct, and the comment above it still says "Direct       ║
-- ║  calls to Supabase Auth without a reservation fail." The database simply  ║
-- ║  stopped listening, and no error was raised on either side.               ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- THE FIX: one function that does BOTH jobs — 0019's gate and 0070's workspace
-- bootstrap — in an order where the gate runs first and a rejection costs
-- nothing.

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
  v_workspace     uuid;
begin
  ---------------------------------------------------------------------------
  -- 1. THE GATE (restored from 0019, unchanged in substance)
  ---------------------------------------------------------------------------
  v_token         := nullif(new.raw_user_meta_data ->> 'signup_reservation_token', '');
  v_device_hash   := nullif(new.raw_user_meta_data ->> 'signup_device_hash', '');
  v_email_hash    := nullif(new.raw_user_meta_data ->> 'signup_email_hash', '');
  v_phone_hash    := nullif(new.raw_user_meta_data ->> 'signup_phone_hash', '');
  v_linkedin_hash := nullif(new.raw_user_meta_data ->> 'signup_linkedin_hash', '');

  if v_token is null or length(v_token) > 256
     or v_device_hash is null   or v_device_hash   !~ '^[0-9a-f]{64}$'
     or v_email_hash is null    or v_email_hash    !~ '^[0-9a-f]{64}$'
     or v_phone_hash is null    or v_phone_hash    !~ '^[0-9a-f]{64}$'
     or v_linkedin_hash is null or v_linkedin_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Signup is not authorized' using errcode = '28000';
  end if;

  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  -- Consuming the reservation is what makes the token one-time. The UPDATE
  -- both claims it and proves it was live, in a single statement.
  update public.signup_ip_claims
     set token_hash     = null,
         user_id        = new.id,
         claimed_at     = now(),
         reserved_until = now()
   where token_hash = v_token_hash
     and claimed_at is null
     and reserved_until > now()
  returning ip_hash into v_ip_hash;

  if v_ip_hash is null then
    raise exception 'Signup is not authorized' using errcode = '28000';
  end if;

  -- Both tables key on the hash itself, so a second claim raises a unique
  -- violation and the whole signup transaction rolls back. That IS the gate;
  -- there is no separate "is this taken?" query to race against.
  insert into public.signup_device_claims (device_hash, user_id)
  values (v_device_hash, new.id);

  insert into public.signup_identity_claims (identity_hash, identity_kind, user_id)
  values (v_email_hash,    'email',    new.id),
         (v_phone_hash,    'phone',    new.id),
         (v_linkedin_hash, 'linkedin', new.id);

  ---------------------------------------------------------------------------
  -- 2. THE PROFILE (restored from 0009 — 0070 wrote only id and email)
  ---------------------------------------------------------------------------
  insert into public.profiles (id, email, full_name, phone, linkedin_url)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'linkedin_url', '')
  )
  on conflict (id) do nothing;

  ---------------------------------------------------------------------------
  -- 3. THE WORKSPACE (kept from 0070, verbatim)
  ---------------------------------------------------------------------------
  -- left(…, 100) keeps the name inside the 120-character check constraint no
  -- matter how long the local part is. A failure here would fail the signup.
  insert into public.workspaces (owner_user_id, name)
  values (
    new.id,
    left(
      coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'My'),
      100
    ) || '''s workspace'
  )
  returning id into v_workspace;

  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (v_workspace, new.id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- ⚠️ THIS MIGRATION MAKES SIGNUP STRICTER. READ BEFORE APPLYING.
--
-- After this runs, a signup that does not carry all four 64-hex hashes AND a
-- live, unconsumed reservation token is REFUSED. That is the intended
-- behaviour and it is what shipped between 0019 and 0070.
--
-- The server path already sends all five values on every attempt
-- (`lib/auth/actions.ts:183-187`), so the normal sign-up form is unaffected.
-- What WILL start failing, correctly:
--
--   • `supabase.auth.admin.createUser()` without signup metadata — including
--     any seed or test script that creates users directly. Integration tests
--     already build the metadata via `createTestSignupSecurityMetadata`.
--   • A second account reusing a device, email, phone or LinkedIn URL.
--
-- ROLLBACK: re-apply 0070's shorter body. Do NOT "roll back" by dropping the
-- trigger — that leaves users with no profile and no workspace.
--
-- NOT BACKFILLED, DELIBERATELY: the 39 profiles with null full_name / phone /
-- linkedin_url cannot be repaired from here. Those values were never written
-- anywhere — auth.users.raw_user_meta_data still holds them, so a backfill is
-- possible, but it is a separate data migration with its own review, and
-- guessing is worse than a visible null.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ⚠️ THE MIGRATION PROVES ITSELF.
--
-- The failure mode being repaired is a function that was replaced by a
-- migration about something else, silently. A migration that asserts nothing
-- about the body it just installed could be undone the same way tomorrow.
-- ---------------------------------------------------------------------------
do $$
declare
  body text;
begin
  select prosrc into body
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'handle_new_user';

  if body is null then
    raise exception '0110 failed: handle_new_user does not exist';
  end if;

  -- The gate.
  if position('signup_device_claims' in body) = 0
     or position('signup_identity_claims' in body) = 0
     or position('signup_ip_claims' in body) = 0
     or position('Signup is not authorized' in body) = 0 then
    raise exception
      '0110 failed: handle_new_user is installed without the signup gate — this is the exact 0070 regression';
  end if;

  -- The profile fields.
  if position('linkedin_url' in body) = 0 or position('full_name' in body) = 0 then
    raise exception
      '0110 failed: handle_new_user does not write the profile contact fields';
  end if;

  -- The workspace bootstrap must have survived the merge.
  if position('workspace_memberships' in body) = 0 then
    raise exception
      '0110 failed: handle_new_user no longer creates the owner membership';
  end if;

  raise notice '0110: signup gate restored, workspace bootstrap intact';
end $$;

comment on function public.handle_new_user() is
  'Signup gate (0018/0019) + profile (0009) + workspace bootstrap (0070), '
  'merged by 0110 after 0070''s create-or-replace silently deleted the first '
  'three. ⚠️ Any migration that replaces this function must carry ALL FOUR '
  'responsibilities forward. See tests/unit/signup-gate-intact.test.ts.';
