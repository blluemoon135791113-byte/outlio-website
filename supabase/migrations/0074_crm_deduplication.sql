-- 0074 — deduplication: candidates, merge, and merge history (M2 Phase 4)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  NEVER SILENTLY MERGE UNCERTAIN PEOPLE.                                   ║
-- ║                                                                           ║
-- ║  Nothing in this migration merges anything on its own. Detection produces ║
-- ║  CANDIDATES with a score and human-readable reasons; a person decides.    ║
-- ║  The only automatic dedup in this system is the pair of unique indexes    ║
-- ║  from 0071 — same mailbox, same LinkedIn identity — and those are         ║
-- ║  certainties, not judgements.                                            ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- SCORING LIVES IN TypeScript (`lib/crm/dedupe.ts`), not here, for the same
-- reason normalization does: one implementation, exhaustively unit-testable,
-- and no second source of truth to drift. This migration stores what the
-- scorer decided and provides the atomic merge it can never do from
-- application code.

-- ---------------------------------------------------------------------------
-- crm_contacts.merged_into_id
--
-- A merged contact is soft-deleted, not erased, and keeps a pointer to the
-- survivor. Without it a stale link or a cached id is a dead end; with it,
-- anything still holding the old id can follow the merge forward.
-- ---------------------------------------------------------------------------

alter table public.crm_contacts
  add column if not exists merged_into_id uuid references public.crm_contacts(id) on delete set null;

create index if not exists crm_contacts_merged_into_idx
  on public.crm_contacts (workspace_id, merged_into_id)
  where merged_into_id is not null;

-- ---------------------------------------------------------------------------
-- crm_duplicate_candidates
--
-- ONE ROW PER PAIR, NOT TWO. `record_a_id < record_b_id` is enforced, so
-- (A,B) and (B,A) cannot both exist — otherwise the Duplicate Center shows
-- every pair twice and resolving one leaves the other open forever.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_duplicate_candidates (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  entity        public.crm_custom_field_entity not null,

  record_a_id   uuid not null,
  record_b_id   uuid not null,

  /* 0–100. 100 is reserved for a certainty (same mailbox, same LinkedIn
     identity); everything a human has to judge scores below it. */
  score         integer not null check (score between 0 and 100),
  confidence    text not null check (confidence in ('exact', 'possible')),

  /* The reasons, structured, so the UI can render them and a test can assert
     them: [{ kind, weight, reason }]. */
  signals       jsonb not null default '[]'::jsonb,
  /* The same reasons as one sentence, e.g. "Same company, very similar name —
     89%". Stored rather than recomputed so what a user saw when they decided
     is what the record shows afterwards. */
  summary       text not null,

  status        text not null default 'open'
                check (status in ('open', 'resolved', 'ignored')),
  /* How it ended. `not_duplicate` is a real answer and must be remembered, or
     detection re-flags the same pair forever and the Center becomes noise. */
  resolution    text check (resolution is null or resolution in ('merged', 'not_duplicate')),
  resolved_at   timestamptz,
  resolved_by   uuid references auth.users(id) on delete set null,

  detected_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint crm_dupe_ordered_pair check (record_a_id < record_b_id),
  constraint crm_dupe_resolution_consistent check (
    (status = 'open' and resolution is null and resolved_at is null)
    or (status <> 'open' and resolved_at is not null)
  )
);

drop trigger if exists crm_duplicate_candidates_set_updated_at on public.crm_duplicate_candidates;
create trigger crm_duplicate_candidates_set_updated_at
  before update on public.crm_duplicate_candidates
  for each row execute function public.set_updated_at();

create unique index if not exists crm_dupe_pair_uniq
  on public.crm_duplicate_candidates (workspace_id, entity, record_a_id, record_b_id);

-- The Duplicate Center's four tabs are this index: Exact / Possible / Resolved
-- / Ignored, newest first.
create index if not exists crm_dupe_center_idx
  on public.crm_duplicate_candidates (workspace_id, entity, status, confidence, score desc);

create index if not exists crm_dupe_record_a_idx
  on public.crm_duplicate_candidates (workspace_id, record_a_id);
create index if not exists crm_dupe_record_b_idx
  on public.crm_duplicate_candidates (workspace_id, record_b_id);

-- ---------------------------------------------------------------------------
-- crm_merge_events
--
-- APPEND-ONLY. No UPDATE or DELETE grant, deliberately.
--
-- A merge destroys a record's separate existence. Reporting attribution, an
-- audit, and a support question six months later all depend on being able to
-- say which two records became one, who decided, and what the loser looked
-- like at the time. A snapshot is the only way to answer the last one after
-- the fact.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_merge_events (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  entity        public.crm_custom_field_entity not null,

  surviving_id  uuid not null,
  merged_id     uuid not null,

  /* The merged record as it was, plus how many children moved. Enough to
     explain the merge without joining anything that may since have changed. */
  snapshot      jsonb not null default '{}'::jsonb,

  performed_by  uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),

  constraint crm_merge_events_distinct check (surviving_id <> merged_id)
);

create index if not exists crm_merge_events_workspace_idx
  on public.crm_merge_events (workspace_id, created_at desc);
create index if not exists crm_merge_events_merged_idx
  on public.crm_merge_events (workspace_id, merged_id);

-- ---------------------------------------------------------------------------
-- crm_merge_contacts
--
-- ATOMIC AND CONCURRENCY-SAFE, which is the whole reason it is a function.
--
-- Two people can open the same pair in the Duplicate Center and both click
-- Merge. In application code that is a read, a dozen writes and a delete, with
-- no lock across them: the second caller would move children onto a contact
-- the first has already merged away, and the records would end up split
-- between two survivors.
--
-- ⚠️ BOTH ROWS ARE LOCKED IN ASCENDING id ORDER, whichever is the survivor.
-- Locking "survivor first" would let two callers merging A→B and B→A take the
-- locks in opposite orders and deadlock.
--
-- CHILD COLLISIONS. Every child table has a uniqueness rule that both contacts
-- may already satisfy — the same tag, the same batch, the same employer, the
-- same custom field. Moving blindly raises a unique violation and aborts the
-- merge. For each table the loser's colliding row is dropped and the rest
-- moved, because a duplicate membership carries no information. The ONE place
-- that is a real choice is a custom field where both hold a value: the
-- survivor's wins, and the loser's is preserved in the merge snapshot.
-- ---------------------------------------------------------------------------

create or replace function public.crm_merge_contacts(
  p_workspace_id uuid,
  p_survivor_id  uuid,
  p_merged_id    uuid,
  p_actor_id     uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_first    uuid;
  v_second   uuid;
  v_survivor public.crm_contacts%rowtype;
  v_merged   public.crm_contacts%rowtype;
  v_moved    jsonb := '{}'::jsonb;
  v_discarded jsonb := '[]'::jsonb;
  v_count    integer;
  v_event    uuid;
begin
  if p_survivor_id = p_merged_id then
    raise exception 'crm_merge_contacts: a contact cannot be merged into itself';
  end if;

  -- Deterministic lock order. See the banner above.
  v_first  := least(p_survivor_id, p_merged_id);
  v_second := greatest(p_survivor_id, p_merged_id);

  perform 1 from public.crm_contacts
   where id = v_first and workspace_id = p_workspace_id for update;
  perform 1 from public.crm_contacts
   where id = v_second and workspace_id = p_workspace_id for update;

  select * into v_survivor from public.crm_contacts
   where id = p_survivor_id and workspace_id = p_workspace_id;
  select * into v_merged from public.crm_contacts
   where id = p_merged_id and workspace_id = p_workspace_id;

  if v_survivor.id is null or v_merged.id is null then
    raise exception 'crm_merge_contacts: both contacts must exist in workspace %',
      p_workspace_id using errcode = 'no_data_found';
  end if;

  -- FAILS SAFELY UNDER A RACE. The loser of two concurrent merges finds the
  -- record already gone and stops, rather than half-applying a second merge.
  if v_merged.deleted_at is not null then
    raise exception 'crm_merge_contacts: contact % has already been merged or deleted',
      p_merged_id using errcode = 'check_violation';
  end if;
  if v_survivor.deleted_at is not null then
    raise exception 'crm_merge_contacts: contact % has already been merged or deleted',
      p_survivor_id using errcode = 'check_violation';
  end if;

  -- ---- emails -----------------------------------------------------------
  -- The workspace-wide unique index means an address cannot collide between
  -- two contacts; only the one-primary-per-contact rule can.
  update public.crm_contact_emails
     set is_primary = false
   where workspace_id = p_workspace_id and contact_id = p_merged_id;

  with moved as (
    update public.crm_contact_emails
       set contact_id = p_survivor_id
     where workspace_id = p_workspace_id and contact_id = p_merged_id
    returning 1
  )
  select count(*) into v_count from moved;
  v_moved := v_moved || jsonb_build_object('emails', v_count);

  -- ---- phones -----------------------------------------------------------
  update public.crm_contact_phones
     set is_primary = false
   where workspace_id = p_workspace_id and contact_id = p_merged_id;

  -- A number both contacts already carry is one number, not two.
  delete from public.crm_contact_phones loser
   where loser.workspace_id = p_workspace_id
     and loser.contact_id = p_merged_id
     and exists (
       select 1 from public.crm_contact_phones keep
        where keep.workspace_id = p_workspace_id
          and keep.contact_id = p_survivor_id
          and keep.deleted_at is null
          and (
            (loser.e164 is not null and keep.e164 = loser.e164)
            or (loser.e164 is null and keep.raw = loser.raw)
          )
     );

  with moved as (
    update public.crm_contact_phones
       set contact_id = p_survivor_id
     where workspace_id = p_workspace_id and contact_id = p_merged_id
    returning 1
  )
  select count(*) into v_count from moved;
  v_moved := v_moved || jsonb_build_object('phones', v_count);

  -- ---- employment -------------------------------------------------------
  update public.crm_contact_company_relationships
     set is_primary = false
   where workspace_id = p_workspace_id and contact_id = p_merged_id;

  delete from public.crm_contact_company_relationships loser
   where loser.workspace_id = p_workspace_id
     and loser.contact_id = p_merged_id
     and exists (
       select 1 from public.crm_contact_company_relationships keep
        where keep.workspace_id = p_workspace_id
          and keep.contact_id = p_survivor_id
          and keep.company_id = loser.company_id
          and keep.deleted_at is null
     );

  with moved as (
    update public.crm_contact_company_relationships
       set contact_id = p_survivor_id
     where workspace_id = p_workspace_id and contact_id = p_merged_id
    returning 1
  )
  select count(*) into v_count from moved;
  v_moved := v_moved || jsonb_build_object('employment', v_count);

  -- ---- tags -------------------------------------------------------------
  delete from public.crm_contact_tags loser
   where loser.workspace_id = p_workspace_id
     and loser.contact_id = p_merged_id
     and exists (
       select 1 from public.crm_contact_tags keep
        where keep.contact_id = p_survivor_id and keep.tag_id = loser.tag_id
     );

  with moved as (
    update public.crm_contact_tags
       set contact_id = p_survivor_id
     where workspace_id = p_workspace_id and contact_id = p_merged_id
    returning 1
  )
  select count(*) into v_count from moved;
  v_moved := v_moved || jsonb_build_object('tags', v_count);

  -- ---- batch membership -------------------------------------------------
  -- ⚠️ `created_contact` is preserved on the SURVIVING row. Undoing an import
  -- must still know whether that import created this person, and a merge is
  -- not an import.
  delete from public.crm_batch_members loser
   where loser.workspace_id = p_workspace_id
     and loser.contact_id = p_merged_id
     and exists (
       select 1 from public.crm_batch_members keep
        where keep.contact_id = p_survivor_id and keep.batch_id = loser.batch_id
     );

  with moved as (
    update public.crm_batch_members
       set contact_id = p_survivor_id
     where workspace_id = p_workspace_id and contact_id = p_merged_id
    returning 1
  )
  select count(*) into v_count from moved;
  v_moved := v_moved || jsonb_build_object('batches', v_count);

  -- ---- lists ------------------------------------------------------------
  delete from public.crm_list_members loser
   where loser.workspace_id = p_workspace_id
     and loser.contact_id = p_merged_id
     and exists (
       select 1 from public.crm_list_members keep
        where keep.contact_id = p_survivor_id and keep.list_id = loser.list_id
     );

  with moved as (
    update public.crm_list_members
       set contact_id = p_survivor_id
     where workspace_id = p_workspace_id and contact_id = p_merged_id
    returning 1
  )
  select count(*) into v_count from moved;
  v_moved := v_moved || jsonb_build_object('lists', v_count);

  -- ---- custom fields ----------------------------------------------------
  -- THE ONE REAL CHOICE IN A MERGE. Where both hold a value for the same
  -- field the survivor's wins; the loser's is not thrown away, it goes into
  -- the snapshot so the decision can be reviewed.
  --
  -- ⚠️ CAPTURED BEFORE THE DELETE. Reading these afterwards returns nothing —
  -- they are exactly the rows the delete removes.
  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into v_discarded
    from public.crm_custom_field_values d
   where d.workspace_id = p_workspace_id
     and d.entity = 'contact'
     and d.record_id = p_merged_id
     and exists (
       select 1 from public.crm_custom_field_values keep
        where keep.workspace_id = p_workspace_id
          and keep.entity = 'contact'
          and keep.record_id = p_survivor_id
          and keep.definition_id = d.definition_id
     );

  delete from public.crm_custom_field_values loser
   where loser.workspace_id = p_workspace_id
     and loser.entity = 'contact'
     and loser.record_id = p_merged_id
     and exists (
       select 1 from public.crm_custom_field_values keep
        where keep.workspace_id = p_workspace_id
          and keep.entity = 'contact'
          and keep.record_id = p_survivor_id
          and keep.definition_id = loser.definition_id
     );

  with moved as (
    update public.crm_custom_field_values
       set record_id = p_survivor_id
     where workspace_id = p_workspace_id
       and entity = 'contact'
       and record_id = p_merged_id
    returning 1
  )
  select count(*) into v_count from moved;
  v_moved := v_moved || jsonb_build_object('custom_fields', v_count);

  -- ---- retire the merged contact ----------------------------------------
  -- ⚠️ THIS MUST HAPPEN BEFORE THE SURVIVOR IS UPDATED.
  --
  -- The survivor may inherit the merged contact's LinkedIn identity below, and
  -- the unique index on (workspace_id, linkedin_identity_key) WHERE deleted_at
  -- is null would see both rows holding it at once. Setting deleted_at first
  -- takes the loser out of that index; nulling the key as well makes it
  -- unmistakable.
  update public.crm_contacts
     set deleted_at = now(),
         merged_into_id = p_survivor_id,
         linkedin_identity_key = null
   where id = p_merged_id and workspace_id = p_workspace_id;

  -- ---- fill gaps on the survivor ----------------------------------------
  -- Only where the survivor is EMPTY. A merge enriches; it never overwrites a
  -- value someone chose. Values come from `v_merged`, read before the retire
  -- above, so nulling the key there does not erase what we are copying.
  update public.crm_contacts s
     set full_name          = coalesce(s.full_name, v_merged.full_name),
         first_name         = coalesce(s.first_name, v_merged.first_name),
         last_name          = coalesce(s.last_name, v_merged.last_name),
         job_title          = coalesce(s.job_title, v_merged.job_title),
         linkedin_url       = coalesce(s.linkedin_url, v_merged.linkedin_url),
         linkedin_identity_key =
           coalesce(s.linkedin_identity_key, v_merged.linkedin_identity_key),
         location           = coalesce(s.location, v_merged.location),
         headline           = coalesce(s.headline, v_merged.headline),
         primary_company_id = coalesce(s.primary_company_id, v_merged.primary_company_id),
         owner_user_id      = coalesce(s.owner_user_id, v_merged.owner_user_id),
         source_lead_id     = coalesce(s.source_lead_id, v_merged.source_lead_id)
   where s.id = p_survivor_id and s.workspace_id = p_workspace_id;

  -- ---- history ----------------------------------------------------------
  insert into public.crm_merge_events (
    workspace_id, entity, surviving_id, merged_id, snapshot, performed_by
  ) values (
    p_workspace_id, 'contact', p_survivor_id, p_merged_id,
    jsonb_build_object(
      'merged_contact', to_jsonb(v_merged),
      'moved', v_moved,
      'discarded_custom_fields', v_discarded
    ),
    p_actor_id
  )
  returning id into v_event;

  -- ---- close the candidate ----------------------------------------------
  update public.crm_duplicate_candidates
     set status = 'resolved',
         resolution = 'merged',
         resolved_at = now(),
         resolved_by = p_actor_id
   where workspace_id = p_workspace_id
     and entity = 'contact'
     and record_a_id = least(p_survivor_id, p_merged_id)
     and record_b_id = greatest(p_survivor_id, p_merged_id)
     and status = 'open';

  return jsonb_build_object(
    'merge_event_id', v_event,
    'surviving_id', p_survivor_id,
    'merged_id', p_merged_id,
    'moved', v_moved
  );
end;
$$;

revoke all on function public.crm_merge_contacts(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['crm_duplicate_candidates', 'crm_merge_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_member', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_workspace_member(workspace_id) or public.is_admin())',
      t || '_select_member', t
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end
$$;

grant select, insert, update, delete on table public.crm_duplicate_candidates to service_role;
-- ⚠️ INSERT AND SELECT ONLY. Merge history is append-only: no UPDATE, no
-- DELETE, not even for the service role.
grant select, insert on table public.crm_merge_events to service_role;

comment on table public.crm_duplicate_candidates is
  'One row per PAIR (record_a_id < record_b_id enforced). Detection proposes; '
  'a human decides. `not_duplicate` is remembered so a rejected pair is not '
  're-flagged forever.';

comment on table public.crm_merge_events is
  'Append-only. A merge destroys a record''s separate existence, so the '
  'snapshot is the only way to answer what the loser looked like afterwards.';
