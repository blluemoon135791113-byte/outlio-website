-- 0022: private profile avatars with owner-scoped storage access.

alter table public.profiles
  add column if not exists avatar_path text;

alter table public.profiles
  drop constraint if exists profiles_avatar_path_shape;

alter table public.profiles
  add constraint profiles_avatar_path_shape
  check (
    avatar_path is null
    or avatar_path ~ '^[0-9a-f-]{36}/profile-[0-9a-f-]{36}\.(png|jpg|webp)$'
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Writes are deliberately service-role-only. The settings Server Action checks
-- the file's magic bytes before storing it; permitting direct client writes
-- here would let a custom client bypass that validation.
