-- 0025: close direct-client avatar write paths after the initial bucket setup.
-- The application uploads through a server action using the service role only
-- after size and magic-byte validation.

drop policy if exists "avatars_insert_own" on storage.objects;
drop policy if exists "avatars_update_own" on storage.objects;
drop policy if exists "avatars_delete_own" on storage.objects;

-- avatar_path is server-controlled, just like entitlement columns. Without
-- this assignment a custom authenticated client could update the newly-added
-- column because profiles_update_own intentionally permits ordinary profile
-- edits.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  new.role                := old.role;
  new.plan_id             := old.plan_id;
  new.access_expires_at   := old.access_expires_at;
  new.suspended_at        := old.suspended_at;
  new.suspended_reason    := old.suspended_reason;
  new.deleted_at          := old.deleted_at;
  new.created_at          := old.created_at;
  new.id                  := old.id;
  new.avatar_path         := old.avatar_path;

  return new;
end;
$$;

revoke all on function public.protect_profile_columns()
  from public, anon, authenticated;
