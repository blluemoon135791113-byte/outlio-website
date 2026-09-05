-- 0040: repair trial claims left behind by Auth users deleted before migration
-- 0026 installed the auth.users deletion trigger.
--
-- A claim without an owning auth.users row can never represent a usable
-- account. Keeping it permanently prevents the former owner from creating a
-- replacement account, so remove only those provably orphaned rows.

delete from public.signup_identity_claims claim
where not exists (
  select 1 from auth.users auth_user where auth_user.id = claim.user_id
);

delete from public.signup_device_claims claim
where not exists (
  select 1 from auth.users auth_user where auth_user.id = claim.user_id
);

delete from public.signup_ip_claims claim
where claim.user_id is not null
  and not exists (
    select 1 from auth.users auth_user where auth_user.id = claim.user_id
  );

-- Re-declare the deletion trigger so environments upgraded from older schema
-- states have the prevention in place after the one-time repair.
drop trigger if exists auth_user_release_signup_claims on auth.users;
create trigger auth_user_release_signup_claims
  after delete on auth.users
  for each row execute function public.release_signup_claims_on_account_delete();
