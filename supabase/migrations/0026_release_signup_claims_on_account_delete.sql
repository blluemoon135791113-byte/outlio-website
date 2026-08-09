-- 0026: release trial-eligibility claims when the owning account is deleted.
--
-- The trigger runs in the same transaction as deletion from auth.users. This
-- matters: claims are never released while the account still exists, and a
-- failed Auth deletion rolls the claim cleanup back as well. It covers both
-- dashboard self-deletion and deletions performed directly in Supabase.

create or replace function public.release_signup_claims_on_account_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.signup_identity_claims where user_id = old.id;
  delete from public.signup_device_claims where user_id = old.id;
  delete from public.signup_ip_claims where user_id = old.id;
  return old;
end;
$$;

revoke all on function public.release_signup_claims_on_account_delete()
  from public, anon, authenticated;

drop trigger if exists auth_user_release_signup_claims on auth.users;
create trigger auth_user_release_signup_claims
  after delete on auth.users
  for each row execute function public.release_signup_claims_on_account_delete();

comment on function public.release_signup_claims_on_account_delete() is
  'Atomically releases network, device, and identity signup claims after an Auth account is deleted.';
