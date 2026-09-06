-- 0072 — Lead Engine → CRM ingestion, batches, lists and CSV import (M2 Phase 3)
--
-- THE INGESTION CONTRACT:
--   extraction (or CSV) → lead batch → normalization → dedup → canonical
--   contact → batch membership → optional list / setter assignment
--
-- ⚠️ NO CSV ROUND-TRIPPING. Nothing in this path writes a file and reads it
-- back. `extracted_leads` rows go directly to `crm_contacts`; the CSV export
-- that already exists is for the USER, never a stage in our own pipeline.
--
-- ⚠️ NORMALIZATION IS NOT HERE. `crm_ingest_contacts` receives values already
-- normalized by lib/crm/normalize.ts, exactly as `link_leads_to_companies`
-- does in 0043. Re-implementing identity rules in SQL would create a second
-- source of truth that drifts silently.
--
-- WHY THE INGEST IS A DATABASE FUNCTION AND NOT A TypeScript LOOP:
-- a 500-lead extraction is 500 matches + 500 inserts + 1,000 child inserts. In
-- application code that is thousands of round trips, and — worse — `after()`
-- can process two extractions for one workspace concurrently, so a
-- read-then-write would let both create the same person. One statement per
-- batch, with the unique indexes as the arbiter, is the same reasoning 0043
-- records for companies.

-- ---------------------------------------------------------------------------
-- crm_lead_batches
--
-- One ingestion run. The unit the funnel report groups by: extracted →
-- canonical → emailed → replied → won (M4).
-- ---------------------------------------------------------------------------

create table if not exists public.crm_lead_batches (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null references public.workspaces(id) on delete cascade,
  name                     text not null check (length(trim(name)) between 1 and 200),
  source                   public.crm_record_source not null,

  -- Exactly one of these is set, and which one tells you where the batch came
  -- from without a join.
  source_extraction_job_id uuid references public.extraction_jobs(id) on delete set null,
  source_import_job_id     uuid,

  -- Counts are stored rather than derived: `crm_batch_members` loses the
  -- distinction once a contact is deleted, and the funnel still has to be able
  -- to say how many rows the source actually contained.
  rows_seen                integer not null default 0 check (rows_seen >= 0),
  contacts_created         integer not null default 0 check (contacts_created >= 0),
  contacts_matched         integer not null default 0 check (contacts_matched >= 0),
  rows_skipped             integer not null default 0 check (rows_skipped >= 0),

  undone_at                timestamptz,
  deleted_at               timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid references auth.users(id) on delete set null,

  unique (id, workspace_id)
);

drop trigger if exists crm_lead_batches_set_updated_at on public.crm_lead_batches;
create trigger crm_lead_batches_set_updated_at
  before update on public.crm_lead_batches
  for each row execute function public.set_updated_at();

-- IDEMPOTENCY, AT THE SOURCE.
--
-- M2 acceptance criterion 1: importing the same batch twice creates zero new
-- contacts. Contact-level dedup already guarantees no duplicate PEOPLE; this
-- index additionally guarantees no duplicate BATCH, so re-running ingestion
-- for an extraction is a no-op rather than a second funnel row.
create unique index if not exists crm_lead_batches_extraction_uniq
  on public.crm_lead_batches (workspace_id, source_extraction_job_id)
  where source_extraction_job_id is not null and deleted_at is null;

create index if not exists crm_lead_batches_workspace_idx
  on public.crm_lead_batches (workspace_id, created_at desc) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- crm_batch_members
--
-- Association, NEVER duplication (Constitution A3). A person in four batches is
-- one contact and four rows here.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_batch_members (
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  batch_id       uuid not null,
  contact_id     uuid not null,

  -- The extraction row this membership came from, when it came from one.
  source_lead_id uuid references public.extracted_leads(id) on delete set null,

  -- ⚠️ LOAD-BEARING FOR UNDO. True only when THIS batch created the contact.
  -- Undo may delete the people an import brought in; it must never delete a
  -- person who already existed and was merely matched.
  created_contact boolean not null default false,

  created_at     timestamptz not null default now(),

  primary key (batch_id, contact_id),

  constraint crm_batch_members_batch_fk
    foreign key (batch_id, workspace_id)
    references public.crm_lead_batches (id, workspace_id)
    on delete cascade,
  constraint crm_batch_members_contact_fk
    foreign key (contact_id, workspace_id)
    references public.crm_contacts (id, workspace_id)
    on delete cascade
);

create index if not exists crm_batch_members_contact_idx
  on public.crm_batch_members (workspace_id, contact_id);

-- ---------------------------------------------------------------------------
-- Lists
--
-- A batch is HISTORY — what one import contained, fixed forever. A list is a
-- WORKING SET a person curates. Conflating them means you cannot remove
-- someone from a list without rewriting history.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_lists (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 120),
  normalized_name text not null,
  description     text,

  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,

  unique (id, workspace_id),
  constraint crm_lists_normalized_lowercase check (normalized_name = lower(normalized_name))
);

drop trigger if exists crm_lists_set_updated_at on public.crm_lists;
create trigger crm_lists_set_updated_at
  before update on public.crm_lists
  for each row execute function public.set_updated_at();

create unique index if not exists crm_lists_name_uniq
  on public.crm_lists (workspace_id, normalized_name) where deleted_at is null;

create table if not exists public.crm_list_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  list_id      uuid not null,
  contact_id   uuid not null,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  primary key (list_id, contact_id),

  constraint crm_list_members_list_fk
    foreign key (list_id, workspace_id)
    references public.crm_lists (id, workspace_id)
    on delete cascade,
  constraint crm_list_members_contact_fk
    foreign key (contact_id, workspace_id)
    references public.crm_contacts (id, workspace_id)
    on delete cascade
);

create index if not exists crm_list_members_contact_idx
  on public.crm_list_members (workspace_id, contact_id);

-- ---------------------------------------------------------------------------
-- crm_import_jobs — the CSV path
-- ---------------------------------------------------------------------------

create table if not exists public.crm_import_jobs (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,

  filename       text not null,
  -- SHA-256 of the uploaded bytes. Not a uniqueness constraint: re-importing
  -- the same file to pick up people who were skipped the first time is
  -- legitimate. It is here so the UI can WARN, and so support can tell two
  -- identical-looking imports apart.
  content_hash   text not null,

  -- Column header → contact field. The user's choices, kept so a failed import
  -- can be retried without re-mapping, and so an audit can show what a value
  -- was interpreted as.
  mapping        jsonb not null default '{}'::jsonb,

  status         text not null default 'pending'
                 check (status in ('pending', 'validating', 'importing', 'completed',
                                   'partially_completed', 'failed', 'undone')),

  rows_total     integer not null default 0 check (rows_total >= 0),
  rows_imported  integer not null default 0 check (rows_imported >= 0),
  rows_skipped   integer not null default 0 check (rows_skipped >= 0),

  -- PARTIAL FAILURE IS THE NORMAL CASE. A 5,000-row CSV with nine bad rows
  -- must import 4,991 people and tell the user precisely which nine failed and
  -- why. Refusing the whole file for nine rows is not validation, it is a
  -- tantrum. Capped in application code so one malformed file cannot store
  -- five thousand error objects.
  errors         jsonb not null default '[]'::jsonb,

  batch_id       uuid,
  undone_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null,

  unique (id, workspace_id),
  constraint crm_import_jobs_errors_is_array check (jsonb_typeof(errors) = 'array'),
  constraint crm_import_jobs_mapping_is_object check (jsonb_typeof(mapping) = 'object'),
  constraint crm_import_jobs_batch_fk
    foreign key (batch_id, workspace_id)
    references public.crm_lead_batches (id, workspace_id)
    on delete set null
);

drop trigger if exists crm_import_jobs_set_updated_at on public.crm_import_jobs;
create trigger crm_import_jobs_set_updated_at
  before update on public.crm_import_jobs
  for each row execute function public.set_updated_at();

create index if not exists crm_import_jobs_workspace_idx
  on public.crm_import_jobs (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- crm_ingest_contacts
--
-- THE ingestion primitive. One statement, one transaction, whatever the source.
--
-- Every element of p_contacts must ALREADY BE NORMALIZED:
--   {
--     ref, full_name, first_name, last_name, job_title, linkedin_url,
--     linkedin_identity_key, location, headline, owner_user_id,
--     source, source_lead_id, company_id,
--     emails: [{ address, identity_key }],
--     phones: [{ raw, e164 }]
--   }
--
-- `ref` is the caller's own handle for the row (a lead id, a CSV line number)
-- and is echoed back so results can be matched to inputs without relying on
-- ordering.
--
-- MATCH PRECEDENCE: canonical LinkedIn identity, then any email identity.
-- Phone is deliberately NOT a match key — a switchboard is shared, so it
-- raises a Phase 4 candidate instead (Ledger D14).
-- ---------------------------------------------------------------------------

create or replace function public.crm_ingest_contacts(
  p_workspace_id uuid,
  p_batch_id     uuid,
  p_contacts     jsonb
)
returns table (ref text, contact_id uuid, created boolean, matched_by text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row        jsonb;
  v_ref        text;
  v_li_key     text;
  v_email_keys text[];
  v_contact    uuid;
  v_created    boolean;
  v_matched    text;
  v_email      jsonb;
  v_phone      jsonb;
  v_has_email  boolean;
  v_has_phone  boolean;
begin
  if p_workspace_id is null then
    raise exception 'crm_ingest_contacts: p_workspace_id is required';
  end if;

  -- The batch must belong to the workspace. The service role bypasses RLS, so
  -- this is the only thing standing between a mistyped id and a cross-tenant
  -- write.
  if p_batch_id is not null and not exists (
    select 1 from public.crm_lead_batches
     where id = p_batch_id and workspace_id = p_workspace_id
  ) then
    raise exception 'crm_ingest_contacts: batch % is not in workspace %',
      p_batch_id, p_workspace_id;
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_contacts, '[]'::jsonb))
  loop
    v_ref     := v_row ->> 'ref';
    v_li_key  := nullif(v_row ->> 'linkedin_identity_key', '');
    v_contact := null;
    v_created := false;
    v_matched := null;

    select coalesce(array_agg(e ->> 'identity_key'), '{}')
      into v_email_keys
      from jsonb_array_elements(coalesce(v_row -> 'emails', '[]'::jsonb)) e
     where nullif(e ->> 'identity_key', '') is not null;

    -- ---- match ----------------------------------------------------------
    if v_li_key is not null then
      select id into v_contact
        from public.crm_contacts
       where workspace_id = p_workspace_id
         and linkedin_identity_key = v_li_key
         and deleted_at is null
       limit 1;
      if v_contact is not null then v_matched := 'linkedin'; end if;
    end if;

    if v_contact is null and array_length(v_email_keys, 1) > 0 then
      select ce.contact_id into v_contact
        from public.crm_contact_emails ce
       where ce.workspace_id = p_workspace_id
         and ce.identity_key = any (v_email_keys)
         and ce.deleted_at is null
       limit 1;
      if v_contact is not null then v_matched := 'email'; end if;
    end if;

    -- ---- create ---------------------------------------------------------
    if v_contact is null then
      -- A row that identifies nobody is skipped rather than stored: it can
      -- never be matched, merged or contacted, and would accumulate silently.
      if nullif(trim(coalesce(v_row ->> 'full_name', '')), '') is null
         and v_li_key is null
         and array_length(v_email_keys, 1) is null then
        continue;
      end if;

      begin
        insert into public.crm_contacts (
          workspace_id, owner_user_id, full_name, first_name, last_name,
          job_title, linkedin_url, linkedin_identity_key, location, headline,
          primary_company_id, source, source_lead_id
        ) values (
          p_workspace_id,
          nullif(v_row ->> 'owner_user_id', '')::uuid,
          nullif(v_row ->> 'full_name', ''),
          nullif(v_row ->> 'first_name', ''),
          nullif(v_row ->> 'last_name', ''),
          nullif(v_row ->> 'job_title', ''),
          nullif(v_row ->> 'linkedin_url', ''),
          v_li_key,
          nullif(v_row ->> 'location', ''),
          nullif(v_row ->> 'headline', ''),
          nullif(v_row ->> 'company_id', '')::uuid,
          coalesce(nullif(v_row ->> 'source', ''), 'manual')::public.crm_record_source,
          nullif(v_row ->> 'source_lead_id', '')::uuid
        )
        returning id into v_contact;

        v_created := true;
      exception when unique_violation then
        -- Another transaction created this person between the match and the
        -- insert. Its row is the canonical one; this is not an error.
        select id into v_contact
          from public.crm_contacts
         where workspace_id = p_workspace_id
           and linkedin_identity_key = v_li_key
           and deleted_at is null
         limit 1;
        v_matched := 'linkedin';
      end;
    end if;

    continue when v_contact is null;

    -- ---- emails ---------------------------------------------------------
    select exists (
      select 1 from public.crm_contact_emails
       where workspace_id = p_workspace_id and contact_id = v_contact
         and deleted_at is null
    ) into v_has_email;

    for v_email in select value from jsonb_array_elements(coalesce(v_row -> 'emails', '[]'::jsonb))
    loop
      continue when nullif(v_email ->> 'identity_key', '') is null;

      -- ON CONFLICT DO NOTHING, not an upsert: the unique index is workspace
      -- wide, so a conflict means the address belongs to ANOTHER contact.
      -- Moving it would silently reassign a mailbox between two people.
      insert into public.crm_contact_emails (
        workspace_id, contact_id, address, identity_key, is_primary, source
      ) values (
        p_workspace_id, v_contact,
        v_email ->> 'address', v_email ->> 'identity_key',
        not v_has_email,
        coalesce(nullif(v_row ->> 'source', ''), 'manual')::public.crm_record_source
      )
      on conflict do nothing;

      -- Only claim the primary slot if the insert actually happened.
      if found then v_has_email := true; end if;
    end loop;

    -- ---- phones ---------------------------------------------------------
    select exists (
      select 1 from public.crm_contact_phones
       where workspace_id = p_workspace_id and contact_id = v_contact
         and deleted_at is null
    ) into v_has_phone;

    for v_phone in select value from jsonb_array_elements(coalesce(v_row -> 'phones', '[]'::jsonb))
    loop
      continue when nullif(v_phone ->> 'raw', '') is null;

      -- No unique index here by design (Ledger D14), so the duplicate check is
      -- explicit and scoped to THIS contact.
      if exists (
        select 1 from public.crm_contact_phones
         where workspace_id = p_workspace_id
           and contact_id = v_contact
           and deleted_at is null
           and (
             (nullif(v_phone ->> 'e164', '') is not null and e164 = v_phone ->> 'e164')
             or (nullif(v_phone ->> 'e164', '') is null and raw = v_phone ->> 'raw')
           )
      ) then
        continue;
      end if;

      insert into public.crm_contact_phones (
        workspace_id, contact_id, raw, e164, is_primary, source
      ) values (
        p_workspace_id, v_contact,
        v_phone ->> 'raw', nullif(v_phone ->> 'e164', ''),
        not v_has_phone,
        coalesce(nullif(v_row ->> 'source', ''), 'manual')::public.crm_record_source
      );
      v_has_phone := true;
    end loop;

    -- ---- batch membership ------------------------------------------------
    if p_batch_id is not null then
      insert into public.crm_batch_members (
        workspace_id, batch_id, contact_id, source_lead_id, created_contact
      ) values (
        p_workspace_id, p_batch_id, v_contact,
        nullif(v_row ->> 'source_lead_id', '')::uuid,
        v_created
      )
      on conflict (batch_id, contact_id) do nothing;
    end if;

    ref := v_ref;
    contact_id := v_contact;
    created := v_created;
    matched_by := v_matched;
    return next;
  end loop;
end;
$$;

revoke all on function public.crm_ingest_contacts(uuid, uuid, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- crm_undo_batch
--
-- ⚠️ DELETES ONLY WHAT THIS BATCH CREATED.
--
-- A contact the import MATCHED already existed — they may since have been
-- emailed, assigned, or moved through a pipeline. Deleting them because an
-- import that merely recognised them was undone would destroy work nobody
-- asked to undo. Those contacts lose their batch membership and nothing else.
--
-- Contacts created by the batch are SOFT deleted, consistent with the rest of
-- the CRM: hard delete is reserved for GDPR erasure (Phase 5).
-- ---------------------------------------------------------------------------

create or replace function public.crm_undo_batch(
  p_workspace_id uuid,
  p_batch_id     uuid
)
returns table (contacts_deleted integer, memberships_removed integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer := 0;
  v_removed integer := 0;
begin
  if not exists (
    select 1 from public.crm_lead_batches
     where id = p_batch_id and workspace_id = p_workspace_id
  ) then
    raise exception 'crm_undo_batch: batch % is not in workspace %',
      p_batch_id, p_workspace_id;
  end if;

  with created as (
    select contact_id
      from public.crm_batch_members
     where workspace_id = p_workspace_id
       and batch_id = p_batch_id
       and created_contact
  ),
  soft_deleted as (
    update public.crm_contacts c
       set deleted_at = now()
      from created
     where c.id = created.contact_id
       and c.workspace_id = p_workspace_id
       and c.deleted_at is null
    returning c.id
  )
  select count(*) into v_deleted from soft_deleted;

  -- The addresses go with them, or the mailbox stays claimed and the person
  -- can never be re-imported.
  update public.crm_contact_emails e
     set deleted_at = now()
    from public.crm_batch_members m
   where m.workspace_id = p_workspace_id
     and m.batch_id = p_batch_id
     and m.created_contact
     and e.contact_id = m.contact_id
     and e.workspace_id = p_workspace_id
     and e.deleted_at is null;

  with removed as (
    delete from public.crm_batch_members
     where workspace_id = p_workspace_id and batch_id = p_batch_id
    returning 1
  )
  select count(*) into v_removed from removed;

  update public.crm_lead_batches
     set undone_at = now()
   where id = p_batch_id and workspace_id = p_workspace_id;

  contacts_deleted := v_deleted;
  memberships_removed := v_removed;
  return next;
end;
$$;

revoke all on function public.crm_undo_batch(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_lead_batches',
    'crm_batch_members',
    'crm_lists',
    'crm_list_members',
    'crm_import_jobs'
  ]
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
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role', t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Documentation
-- ---------------------------------------------------------------------------

comment on table public.crm_lead_batches is
  'One ingestion run. The unit the M4 funnel groups by. Unique per extraction '
  'job, so re-running ingestion is a no-op rather than a second funnel row.';

comment on column public.crm_batch_members.created_contact is
  'True only when THIS batch created the contact. Load-bearing for undo: a '
  'contact that already existed must never be deleted by undoing an import '
  'that merely recognised them.';

comment on table public.crm_lists is
  'A curated working set. Distinct from a batch, which is immutable history: '
  'removing someone from a list must not rewrite what an import contained.';
