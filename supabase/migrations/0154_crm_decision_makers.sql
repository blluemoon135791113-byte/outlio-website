-- ---------------------------------------------------------------------------
-- 0154 — Decision makers (Phase B of the 2026-10-02 redesign), plus two
--        hardening items carried from Phase A
--
-- 1. crm_contact_links — a lead's OTHER public profiles: X, Facebook,
--    Instagram, GitHub, a website, or any labelled link. LinkedIn and Sales
--    Navigator keep their own columns on crm_contacts (0138); they are refused
--    here so one address never lives in two places.
--
--    ⚠️ ONLY WHAT A PERSON TYPED (or, later, an import carried). Nothing in
--    Outlio guesses a handle from a name: `source` says where each row came
--    from and `created_by` who added it (CLAUDE.md rule 4).
--
-- 2. crm_add_contact_role — adds ONE role by system key ("Add decision
--    maker") and pins the lead, under the same per-lead lock as 0152. The
--    lead's other roles are kept and become a person's choice too; an "Other"
--    (= none of the above) is dropped, because it stops being true.
--
-- 3. crm_delete_tag_value — the Phase A race. Counting a value's uses and then
--    deleting it were two statements, and crm_contact_tags CASCADES (0071): a
--    lead tagged in between lost the tag silently. One locked statement now —
--    FOR UPDATE on the tag conflicts with the KEY SHARE lock every FK insert
--    takes, so a concurrent tagging either commits first (and is counted) or
--    waits and then fails on the missing tag. It is never stripped.
--
-- 4. crm_set_company_tags refuses to ADD values to a disabled group (the
--    service already did; now the database does too). Body otherwise
--    identical to 0153.
--
-- ⚠️ VALIDATE BEFORE APPLYING:
--   scripts/check-migration.sh supabase/migrations/0154_crm_decision_makers.sql \
--     supabase/migrations/smoke/0154_crm_decision_makers.smoke.sql
--
-- APPLY BEFORE DEPLOYING the Phase B code (it calls the new functions). The
-- deployed Phase A code is unaffected: it calls none of them, and the
-- crm_set_company_tags signature is unchanged.
--
-- ROLLBACK (no existing table is modified):
--   drop function if exists public.crm_add_contact_role(uuid, uuid, text, uuid);
--   drop function if exists public.crm_add_contact_links(uuid, uuid, jsonb, uuid, text);
--   drop function if exists public.crm_delete_tag_value(uuid, uuid);
--   drop trigger if exists crm_contact_links_follow_merge on public.crm_contacts;
--   drop function if exists public.crm_contact_links_follow_merge();
--   drop table if exists public.crm_contact_links;
--   then re-run 0153's crm_set_company_tags definition.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. crm_contact_links
-- ===========================================================================

create table if not exists public.crm_contact_links (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id   uuid not null,
  kind         text not null,
  -- Shown instead of the kind; required for 'other' ("Podcast", "Blog"…).
  label        text,
  url          text not null,
  -- What makes two addresses the same link: host without "www.", path without
  -- a trailing slash, lowercased. Computed by lib/crm/social-links.ts.
  url_key      text not null,
  source       text not null default 'manual',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint crm_contact_links_kind_valid
    check (kind in ('x', 'facebook', 'instagram', 'github', 'website', 'other')),
  constraint crm_contact_links_label_valid
    check (label is null or char_length(btrim(label)) between 1 and 40),
  constraint crm_contact_links_other_needs_label
    check (kind <> 'other' or label is not null),
  -- ⚠️ THE SCHEME IS CHECKED HERE, NOT ONLY IN CODE. These become hrefs on
  -- pages every rep opens; a `javascript:` value would be stored XSS.
  constraint crm_contact_links_url_valid
    check (url ~* '^https?://[^[:space:]]+$' and char_length(url) <= 500),
  constraint crm_contact_links_url_key_valid
    check (char_length(url_key) between 3 and 500),
  constraint crm_contact_links_not_linkedin
    check (url_key !~ '^([a-z0-9-]+\.)*linkedin\.com(/|$)'),
  constraint crm_contact_links_source_valid
    check (source in ('manual', 'import')),

  constraint crm_contact_links_contact_fk
    foreign key (contact_id, workspace_id)
    references public.crm_contacts (id, workspace_id)
    on delete cascade
);

create unique index if not exists crm_contact_links_uniq
  on public.crm_contact_links (contact_id, url_key);

create index if not exists crm_contact_links_contact_idx
  on public.crm_contact_links (workspace_id, contact_id);

-- Same policy as every CRM table (0071): members read, the service role
-- writes behind lib/workspaces/permissions.ts. A setter's narrower view is
-- dataScope() in the caller.
alter table public.crm_contact_links enable row level security;
drop policy if exists crm_contact_links_select_member on public.crm_contact_links;
create policy crm_contact_links_select_member on public.crm_contact_links
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());
revoke all on table public.crm_contact_links from public, anon, authenticated;
grant select on table public.crm_contact_links to authenticated;
grant select, insert, update, delete on table public.crm_contact_links to service_role;

comment on table public.crm_contact_links is
  'A lead''s other public profiles (X, Facebook, Instagram, GitHub, website, labelled). Typed or imported, never inferred.';

/*
 * A MERGE TAKES THE LINKS ALONG. crm_merge_contacts (0074) moves every child
 * of the retired contact to the survivor and soft-deletes it; a table added
 * after 0074 is invisible to that function, so without this its links would
 * stay on a hidden row. Fires when merged_into_id is set; a link the survivor
 * already has (same url_key) is dropped, the rest move. No cap on a merge —
 * the 20 is a limit on adding, not a reason to discard what two records held.
 */
create or replace function public.crm_contact_links_follow_merge()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.crm_contact_links l
   where l.contact_id = new.id
     and exists (
       select 1 from public.crm_contact_links k
        where k.contact_id = new.merged_into_id and k.url_key = l.url_key
     );
  update public.crm_contact_links
     set contact_id = new.merged_into_id
   where contact_id = new.id;
  return null;
end;
$$;

drop trigger if exists crm_contact_links_follow_merge on public.crm_contacts;
create trigger crm_contact_links_follow_merge
  after update of merged_into_id on public.crm_contacts
  for each row
  when (new.merged_into_id is not null and old.merged_into_id is distinct from new.merged_into_id)
  execute function public.crm_contact_links_follow_merge();

revoke all on function public.crm_contact_links_follow_merge() from public, anon, authenticated;

/*
 * Adds links to one lead, at most 20 per lead. A link the lead already has
 * (same url_key) is skipped, not an error. Locks the lead row so two adds
 * cannot both pass the cap.
 *
 * p_links: [{kind, label, url, url_key}] — already validated and normalised
 * by lib/crm/social-links.ts; the table constraints check again.
 */
create or replace function public.crm_add_contact_links(
  p_workspace_id uuid,
  p_contact_id   uuid,
  p_links        jsonb,
  p_actor_id     uuid,
  p_source       text default 'manual'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing integer;
  v_added    integer;
begin
  if jsonb_typeof(p_links) is distinct from 'array' then
    raise exception 'crm_add_contact_links: links must be an array' using errcode = 'check_violation';
  end if;

  perform 1 from public.crm_contacts
   where id = p_contact_id and workspace_id = p_workspace_id and deleted_at is null
   for no key update;
  if not found then
    raise exception 'crm_add_contact_links: no such lead in workspace %', p_workspace_id
      using errcode = 'no_data_found';
  end if;

  select count(*) into v_existing from public.crm_contact_links where contact_id = p_contact_id;

  with incoming as (
    select distinct on (l->>'url_key')
           l->>'kind' as kind, nullif(btrim(l->>'label'), '') as label, l->>'url' as url, l->>'url_key' as url_key,
           ord
      from jsonb_array_elements(p_links) with ordinality as e(l, ord)
     order by l->>'url_key', ord
  ), fresh as (
    select i.* from incoming i
     where not exists (
       select 1 from public.crm_contact_links c where c.contact_id = p_contact_id and c.url_key = i.url_key
     )
  )
  select count(*) into v_added from fresh;

  if v_existing + v_added > 20 then
    raise exception 'crm_add_contact_links: a lead can have at most 20 links' using errcode = 'check_violation';
  end if;

  insert into public.crm_contact_links (workspace_id, contact_id, kind, label, url, url_key, source, created_by)
  select p_workspace_id, p_contact_id, i.kind, i.label, i.url, i.url_key, p_source, p_actor_id
    from (
      select distinct on (l->>'url_key')
             l->>'kind' as kind, nullif(btrim(l->>'label'), '') as label, l->>'url' as url, l->>'url_key' as url_key
        from jsonb_array_elements(p_links) with ordinality as e(l, ord)
       order by l->>'url_key', ord
    ) i
  on conflict (contact_id, url_key) do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

-- ===========================================================================
-- 2. crm_add_contact_role
-- ===========================================================================

create or replace function public.crm_add_contact_role(
  p_workspace_id uuid,
  p_contact_id   uuid,
  p_system_key   text,
  p_actor_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.crm_lead_roles%rowtype;
begin
  if not exists (
    select 1 from public.crm_contacts
     where id = p_contact_id and workspace_id = p_workspace_id and deleted_at is null
  ) then
    raise exception 'crm_add_contact_role: no such lead in workspace %', p_workspace_id
      using errcode = 'no_data_found';
  end if;

  select * into v_role from public.crm_lead_roles
   where workspace_id = p_workspace_id and system_key = p_system_key;
  if v_role.id is null or not v_role.is_active then
    raise exception 'crm_add_contact_role: that role is disabled in this workspace'
      using errcode = 'check_violation';
  end if;

  -- The same per-lead lock both 0152 writers take.
  perform public.crm_lock_contact_role_state(p_workspace_id, p_contact_id);

  if p_system_key <> 'other' then
    delete from public.crm_contact_role_assignments a
     using public.crm_lead_roles r
     where a.contact_id = p_contact_id and a.workspace_id = p_workspace_id
       and r.id = a.role_id and r.system_key = 'other';
  end if;

  update public.crm_contact_role_assignments
     set is_auto = false
   where contact_id = p_contact_id and workspace_id = p_workspace_id;

  insert into public.crm_contact_role_assignments (workspace_id, contact_id, role_id, is_auto, created_by)
  values (p_workspace_id, p_contact_id, v_role.id, false, p_actor_id)
  on conflict (contact_id, role_id) do nothing;

  update public.crm_contact_role_state
     set manual_at = now(), manual_by = p_actor_id
   where contact_id = p_contact_id;

  return jsonb_build_object('role', v_role.id);
end;
$$;

-- ===========================================================================
-- 3. crm_delete_tag_value
-- ===========================================================================

/*
 * Deletes one tag value only if nothing carries it. Returns
 * 'deleted' | 'in_use' | 'not_found'.
 */
create or replace function public.crm_delete_tag_value(p_workspace_id uuid, p_tag_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform 1 from public.crm_tags
   where id = p_tag_id and workspace_id = p_workspace_id and group_id is not null and deleted_at is null
   for update;
  if not found then
    return 'not_found';
  end if;

  if exists (select 1 from public.crm_contact_tags where tag_id = p_tag_id)
     or exists (select 1 from public.crm_company_tags where tag_id = p_tag_id) then
    -- An allocation TARGET is configuration, not data on a record: it goes
    -- with the value (its FK cascades), as it did before this function.
    return 'in_use';
  end if;

  delete from public.crm_tags where id = p_tag_id and workspace_id = p_workspace_id;
  return 'deleted';
end;
$$;

-- ===========================================================================
-- 4. crm_set_company_tags — 0153's body plus the disabled-group refusal
-- ===========================================================================

create or replace function public.crm_set_company_tags(
  p_workspace_id uuid,
  p_company_id   uuid,
  p_group_id     uuid,
  p_primary      uuid,
  p_tag_ids      uuid[],
  p_actor_id     uuid,
  p_merge        boolean default false,
  p_source       text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group    public.crm_tag_groups%rowtype;
  v_wanted   uuid[];
  v_current  uuid[];
  v_added    uuid[];
  v_removed  uuid[];
  v_primary  uuid;
  v_old_prim uuid;
begin
  if p_source not in ('manual', 'import') then
    raise exception 'crm_set_company_tags: unknown source %', p_source using errcode = 'check_violation';
  end if;

  perform 1 from public.crm_companies
   where id = p_company_id and workspace_id = p_workspace_id and deleted_at is null
   for update;
  if not found then
    raise exception 'crm_set_company_tags: no such account in workspace %', p_workspace_id
      using errcode = 'no_data_found';
  end if;

  select * into v_group from public.crm_tag_groups
   where id = p_group_id and workspace_id = p_workspace_id and entity = 'company';
  if v_group.id is null then
    raise exception 'crm_set_company_tags: no such account tag group in workspace %', p_workspace_id
      using errcode = 'check_violation';
  end if;

  v_wanted := array(
    select distinct x from unnest(array_prepend(p_primary, coalesce(p_tag_ids, '{}'))) x where x is not null
  );

  select coalesce(array_agg(tag_id), '{}'), max(tag_id::text) filter (where is_primary)::uuid
    into v_current, v_old_prim
    from public.crm_company_tags
   where company_id = p_company_id and group_id = p_group_id;

  v_added := array(select x from unnest(v_wanted) x where not x = any (v_current));
  v_removed := case when p_merge then '{}'::uuid[]
                    else array(select x from unnest(v_current) x where not x = any (v_wanted)) end;

  /*
   * 0154: a DISABLED GROUP takes no new values. Its chips are hidden, so a
   * value added now would filter lists for a reason nobody can see. Removing
   * values from it stays possible.
   */
  if cardinality(v_added) > 0 and not v_group.is_active then
    raise exception 'crm_set_company_tags: % is disabled', v_group.name
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from unnest(v_added) x
     where not exists (
       select 1 from public.crm_tags t
        where t.id = x and t.workspace_id = p_workspace_id and t.group_id = p_group_id
          and t.is_active and t.deleted_at is null
     )
  ) then
    raise exception 'crm_set_company_tags: a value is unknown, disabled, or not in this group'
      using errcode = 'check_violation';
  end if;

  v_primary := case
    when not v_group.has_primary then null
    when p_merge then coalesce(v_old_prim, p_primary, v_wanted[1])
    else coalesce(p_primary, case when cardinality(v_wanted) > 0 then v_wanted[1] end)
  end;

  delete from public.crm_company_tags
   where company_id = p_company_id and group_id = p_group_id and tag_id = any (v_removed);

  insert into public.crm_company_tags (workspace_id, company_id, tag_id, group_id, source, created_by)
  select p_workspace_id, p_company_id, x, p_group_id, p_source, p_actor_id from unnest(v_added) x;

  /*
   * A person (or an import) saying "this value" makes it theirs: a value a
   * rule or the AI suggested becomes a manual one when it is re-chosen.
   */
  if not p_merge then
    update public.crm_company_tags
       set source = p_source, confidence = null, evidence = null
     where company_id = p_company_id and group_id = p_group_id and source in ('rule', 'ai')
       and tag_id = any (v_wanted);
  end if;

  update public.crm_company_tags set is_primary = false
   where company_id = p_company_id and group_id = p_group_id and is_primary
     and tag_id is distinct from v_primary;
  update public.crm_company_tags set is_primary = true
   where company_id = p_company_id and group_id = p_group_id and tag_id = v_primary and not is_primary;

  if cardinality(v_added) > 0 or cardinality(v_removed) > 0 or v_old_prim is distinct from v_primary then
    insert into public.crm_activities (workspace_id, company_id, activity_type, channel, actor_user_id, metadata)
    values (
      p_workspace_id, p_company_id, 'ACCOUNT_TAGS_CHANGED', 'manual', p_actor_id,
      jsonb_build_object(
        'group', p_group_id, 'group_name', v_group.name,
        'added', to_jsonb(v_added), 'removed', to_jsonb(v_removed),
        'primary_from', v_old_prim, 'primary_to', v_primary,
        'mode', case when p_merge then 'merge' else 'replace' end, 'source', p_source
      )
    );
    return jsonb_build_object('changed', true, 'added', to_jsonb(v_added),
                              'removed', to_jsonb(v_removed), 'primary', v_primary);
  end if;

  return jsonb_build_object('changed', false, 'added', '[]'::jsonb, 'removed', '[]'::jsonb, 'primary', v_primary);
end;
$$;

-- ===========================================================================
-- Grants
-- ===========================================================================

revoke all on function public.crm_add_contact_links(uuid, uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.crm_add_contact_links(uuid, uuid, jsonb, uuid, text) to service_role;
revoke all on function public.crm_add_contact_role(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.crm_add_contact_role(uuid, uuid, text, uuid) to service_role;
revoke all on function public.crm_delete_tag_value(uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_delete_tag_value(uuid, uuid) to service_role;
revoke all on function public.crm_set_company_tags(uuid, uuid, uuid, uuid, uuid[], uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.crm_set_company_tags(uuid, uuid, uuid, uuid, uuid[], uuid, boolean, text) to service_role;
