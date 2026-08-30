-- 0071 — CRM core identity (M2 Phase 2)
--
-- Canonical contacts and accounts, workspace-scoped, with the association
-- tables that let one person belong to many lists, batches and campaigns
-- WITHOUT being duplicated (Constitution A3).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY `crm_companies` IS NOT `companies`
--
-- They are different entities that happen to share a word.
--
--   public.companies      the Lead Engine's RESEARCH UNIT. Scoped per USER,
--                         deduped so a company fact is researched once per
--                         company rather than once per employee (0043). Written
--                         by link_leads_to_companies on the extraction path.
--
--   public.crm_companies  the CRM ACCOUNT. Scoped per WORKSPACE, owned by a
--                         person, edited by humans, carries relationships,
--                         tags and custom fields.
--
-- Two members of one workspace who each extract Acme must end up with ONE CRM
-- account and TWO research rows — one per user, because that is how research
-- spend is attributed and cached. Collapsing these into one table would either
-- re-scope the extraction pipeline's dedup (changing live Lead Engine
-- behaviour) or duplicate CRM accounts per member. Neither is acceptable.
--
-- ⚠️ THE RISK OF TWO TABLES IS DRIFTING IDENTITY RULES, AND IT IS AVOIDED THE
-- SAME WAY 0043 AVOIDS IT: normalization lives in TypeScript
-- (`lib/companies/normalize.ts` and `lib/crm/normalize.ts`) and BOTH tables
-- receive already-normalized values. There is one implementation of "what is
-- this company's domain", and neither table owns it.
--
-- `crm_companies.source_company_id` links an account back to the research row
-- it came from. Phase 3 populates it during ingestion.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SOFT DELETE: every table here carries `deleted_at`. Hard delete is reserved
-- for GDPR erasure (M2 Phase 5). Every partial unique index therefore excludes
-- deleted rows — otherwise deleting a contact and re-importing the same person
-- would be blocked forever by a row nobody can see.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_record_source') then
    create type public.crm_record_source as enum (
      'lead_engine',  -- ingested from an extraction
      'csv_import',
      'manual',
      'api',
      'flow'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'crm_custom_field_type') then
    create type public.crm_custom_field_type as enum (
      'text',
      'number',
      'boolean',
      'date',
      'url',
      'email',
      'select',
      'multi_select'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'crm_custom_field_entity') then
    -- `opportunity` is declared now so M3 adds no enum value to a live type.
    create type public.crm_custom_field_entity as enum (
      'contact',
      'company',
      'opportunity'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- crm_companies
-- ---------------------------------------------------------------------------

create table if not exists public.crm_companies (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            uuid not null references public.workspaces(id) on delete cascade,

  -- ⚠️ Single-column FK deliberately, for the reason 0043 documents: a
  -- composite (workspace_id, owner_user_id) FK to workspace_memberships could
  -- not use ON DELETE SET NULL, because nulling the whole key would violate
  -- workspace_id NOT NULL. That the owner is a MEMBER is enforced in code, in
  -- lib/workspaces/context.ts, like every other service-role invariant here.
  owner_user_id           uuid references auth.users(id) on delete set null,

  -- ---- identity: already normalized by lib/companies/normalize.ts ---------
  name                    text,
  normalized_name         text,
  domain                  text,
  normalized_domain       text,
  linkedin_url            text,
  normalized_linkedin_url text,

  -- ---- projections -------------------------------------------------------
  industry                text,
  employee_count          integer check (employee_count is null or employee_count >= 0),
  headquarters            text,

  -- The Lead Engine research row this account came from, when it came from one.
  source                  public.crm_record_source not null default 'manual',
  source_company_id       uuid references public.companies(id) on delete set null,

  deleted_at              timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid references auth.users(id) on delete set null,

  -- Composite key so child rows can enforce that both sides are the same
  -- tenant, exactly as 0043 and 0034 do.
  unique (id, workspace_id),

  constraint crm_companies_has_identity check (
    normalized_domain is not null
    or normalized_linkedin_url is not null
    or normalized_name is not null
  )
);

drop trigger if exists crm_companies_set_updated_at on public.crm_companies;
create trigger crm_companies_set_updated_at
  before update on public.crm_companies
  for each row execute function public.set_updated_at();

-- Identity uniqueness, same conditional precedence as 0043: a NAME identifies a
-- company only while that company has nothing better. Once a domain or a
-- LinkedIn URL is known the name stops being an identity, so two same-named
-- companies coexist correctly instead of being merged.
create unique index if not exists crm_companies_domain_uniq
  on public.crm_companies (workspace_id, normalized_domain)
  where normalized_domain is not null and deleted_at is null;

create unique index if not exists crm_companies_linkedin_uniq
  on public.crm_companies (workspace_id, normalized_linkedin_url)
  where normalized_linkedin_url is not null and deleted_at is null;

create unique index if not exists crm_companies_name_uniq
  on public.crm_companies (workspace_id, normalized_name)
  where normalized_name is not null
    and normalized_domain is null
    and normalized_linkedin_url is null
    and deleted_at is null;

create index if not exists crm_companies_workspace_created_idx
  on public.crm_companies (workspace_id, created_at desc) where deleted_at is null;
create index if not exists crm_companies_owner_idx
  on public.crm_companies (workspace_id, owner_user_id) where deleted_at is null;
create index if not exists crm_companies_source_idx
  on public.crm_companies (workspace_id, source_company_id)
  where source_company_id is not null;

-- ---------------------------------------------------------------------------
-- crm_contacts
--
-- ONE REAL PERSON = ONE ROW PER WORKSPACE (Constitution A3).
--
-- Lists, batches, campaigns and sequences attach through association tables.
-- ⚠️ NEVER add a per-step column here (no `email_1_sent`): enrollment state
-- belongs to email_enrollments in M6, and a column per step makes every new
-- step a migration and every report a special case.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_contacts (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id         uuid references auth.users(id) on delete set null,

  -- ---- identity ----------------------------------------------------------
  full_name             text,
  first_name            text,
  last_name             text,
  job_title             text,

  linkedin_url          text,
  -- `li:in:{slug}` or `li:lead:{id}` from lib/crm/normalize.ts — the SAME key
  -- space the Lead Engine dedupes on, so a contact ingested from an extraction
  -- and the same person typed in by hand collide instead of duplicating.
  linkedin_identity_key text,

  location              text,
  headline              text,

  -- ---- current employer --------------------------------------------------
  -- A PROJECTION of crm_contact_company_relationships, which is the source of
  -- truth. Denormalized because every contact list renders a company name and
  -- the join would otherwise be unavoidable on every page of every list.
  primary_company_id    uuid,

  source                public.crm_record_source not null default 'manual',
  -- The immutable extraction row this contact came from. extracted_leads stays
  -- the historical record of what a page said; this table is the living person.
  source_lead_id        uuid references public.extracted_leads(id) on delete set null,

  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id) on delete set null,

  unique (id, workspace_id),

  -- A row that identifies nobody cannot be matched, merged or contacted, and
  -- would accumulate silently. Emails and phones live in child tables, so this
  -- checks only what is on the contact itself; ingestion must supply at least
  -- a name or a LinkedIn identity.
  constraint crm_contacts_has_identity check (
    nullif(trim(coalesce(full_name, '')), '') is not null
    or linkedin_identity_key is not null
  ),

  constraint crm_contacts_primary_company_fk
    foreign key (primary_company_id, workspace_id)
    references public.crm_companies (id, workspace_id)
    on delete set null
);

drop trigger if exists crm_contacts_set_updated_at on public.crm_contacts;
create trigger crm_contacts_set_updated_at
  before update on public.crm_contacts
  for each row execute function public.set_updated_at();

-- EXACT DEDUP BLOCK #1 (M2 Phase 4): the canonical LinkedIn identity.
create unique index if not exists crm_contacts_linkedin_uniq
  on public.crm_contacts (workspace_id, linkedin_identity_key)
  where linkedin_identity_key is not null and deleted_at is null;

create index if not exists crm_contacts_workspace_created_idx
  on public.crm_contacts (workspace_id, created_at desc) where deleted_at is null;
-- The index a setter's list hits: "my contacts, newest first".
create index if not exists crm_contacts_owner_idx
  on public.crm_contacts (workspace_id, owner_user_id, created_at desc)
  where deleted_at is null;
create index if not exists crm_contacts_company_idx
  on public.crm_contacts (workspace_id, primary_company_id) where deleted_at is null;
create index if not exists crm_contacts_source_lead_idx
  on public.crm_contacts (workspace_id, source_lead_id)
  where source_lead_id is not null;

-- ---------------------------------------------------------------------------
-- crm_contact_emails
--
-- A person has several addresses; one of them is primary.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_contact_emails (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id   uuid not null,

  -- What we STORE AND SEND TO: lowercased, domain punycoded, nothing folded.
  address      text not null check (position('@' in address) > 1),
  -- What we COMPARE: provider-folded (Gmail dots, +tags). See Ledger D11.
  -- ⚠️ NEVER put this in a To: header.
  identity_key text not null,

  is_primary   boolean not null default false,
  source       public.crm_record_source not null default 'manual',

  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (id, workspace_id),

  constraint crm_contact_emails_address_lowercase check (address = lower(address)),
  constraint crm_contact_emails_contact_fk
    foreign key (contact_id, workspace_id)
    references public.crm_contacts (id, workspace_id)
    on delete cascade
);

drop trigger if exists crm_contact_emails_set_updated_at on public.crm_contact_emails;
create trigger crm_contact_emails_set_updated_at
  before update on public.crm_contact_emails
  for each row execute function public.set_updated_at();

-- EXACT DEDUP BLOCK #2 (M2 Phase 4): one mailbox belongs to one person.
--
-- Enforced by the DATABASE, not just by the importer, because ingestion, CSV
-- import, the API and manual entry are four different write paths and the one
-- that forgets is the one that creates the duplicate.
create unique index if not exists crm_contact_emails_identity_uniq
  on public.crm_contact_emails (workspace_id, identity_key)
  where deleted_at is null;

create index if not exists crm_contact_emails_contact_idx
  on public.crm_contact_emails (workspace_id, contact_id) where deleted_at is null;

-- At most one primary address per contact.
create unique index if not exists crm_contact_emails_primary_uniq
  on public.crm_contact_emails (workspace_id, contact_id)
  where is_primary and deleted_at is null;

-- ---------------------------------------------------------------------------
-- crm_contact_phones
--
-- ⚠️ DELIBERATELY NOT UNIQUE ON THE NUMBER.
--
-- An email address is one mailbox; a phone number is routinely a switchboard.
-- Ten colleagues legitimately share +1 415 555 0100, and a unique index would
-- refuse to store the second one — or, worse, invite an importer to "merge"
-- ten different people. M2 Phase 4 calls a phone a STRONG match, not a block:
-- it raises a duplicate candidate for a human, and that is all.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_contact_phones (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id   uuid not null,

  -- Exactly what the source supplied. Kept even when it could not be parsed,
  -- so a number a human can still read is never silently discarded.
  raw          text not null check (length(trim(raw)) > 0),
  -- E.164, and NULL when the region was ambiguous — see Ledger D12. A null
  -- here means "we have a number but cannot dial it confidently", not "no
  -- number".
  e164         text check (e164 is null or e164 ~ '^\+[1-9][0-9]{6,14}$'),

  kind         text check (kind is null or kind in ('mobile', 'work', 'home', 'other')),
  is_primary   boolean not null default false,
  source       public.crm_record_source not null default 'manual',

  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (id, workspace_id),

  constraint crm_contact_phones_contact_fk
    foreign key (contact_id, workspace_id)
    references public.crm_contacts (id, workspace_id)
    on delete cascade
);

drop trigger if exists crm_contact_phones_set_updated_at on public.crm_contact_phones;
create trigger crm_contact_phones_set_updated_at
  before update on public.crm_contact_phones
  for each row execute function public.set_updated_at();

create index if not exists crm_contact_phones_contact_idx
  on public.crm_contact_phones (workspace_id, contact_id) where deleted_at is null;
-- Supports the Phase 4 "same phone" candidate query. NOT unique — see above.
create index if not exists crm_contact_phones_e164_idx
  on public.crm_contact_phones (workspace_id, e164)
  where e164 is not null and deleted_at is null;

create unique index if not exists crm_contact_phones_primary_uniq
  on public.crm_contact_phones (workspace_id, contact_id)
  where is_primary and deleted_at is null;

-- ---------------------------------------------------------------------------
-- crm_contact_company_relationships
--
-- The SOURCE OF TRUTH for who works where. `crm_contacts.primary_company_id`
-- is a projection of the current primary row here.
--
-- Employment history is kept rather than overwritten: "left Acme for Globex
-- last month" is a buying signal, and overwriting the row destroys it.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_contact_company_relationships (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id   uuid not null,
  company_id   uuid not null,

  title        text,
  is_primary   boolean not null default false,
  is_current   boolean not null default true,
  started_at   date,
  ended_at     date,

  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint crm_ccr_dates check (ended_at is null or started_at is null or ended_at >= started_at),
  -- A relationship cannot be both over and current.
  constraint crm_ccr_current_has_no_end check (not (is_current and ended_at is not null)),

  constraint crm_ccr_contact_fk
    foreign key (contact_id, workspace_id)
    references public.crm_contacts (id, workspace_id)
    on delete cascade,
  constraint crm_ccr_company_fk
    foreign key (company_id, workspace_id)
    references public.crm_companies (id, workspace_id)
    on delete cascade
);

drop trigger if exists crm_ccr_set_updated_at on public.crm_contact_company_relationships;
create trigger crm_ccr_set_updated_at
  before update on public.crm_contact_company_relationships
  for each row execute function public.set_updated_at();

create unique index if not exists crm_ccr_pair_uniq
  on public.crm_contact_company_relationships (workspace_id, contact_id, company_id)
  where deleted_at is null;

create unique index if not exists crm_ccr_primary_uniq
  on public.crm_contact_company_relationships (workspace_id, contact_id)
  where is_primary and deleted_at is null;

create index if not exists crm_ccr_company_idx
  on public.crm_contact_company_relationships (workspace_id, company_id)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------

create table if not exists public.crm_tags (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 60),
  -- Lowercased and space-collapsed by the caller, so "Hot Lead" and "hot lead"
  -- cannot become two tags that render identically in a filter list.
  normalized_name text not null,
  color           text check (color is null or color ~ '^[a-z_]{1,24}$'),

  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,

  unique (id, workspace_id),
  constraint crm_tags_normalized_lowercase check (normalized_name = lower(normalized_name))
);

drop trigger if exists crm_tags_set_updated_at on public.crm_tags;
create trigger crm_tags_set_updated_at
  before update on public.crm_tags
  for each row execute function public.set_updated_at();

create unique index if not exists crm_tags_name_uniq
  on public.crm_tags (workspace_id, normalized_name) where deleted_at is null;

create table if not exists public.crm_contact_tags (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id   uuid not null,
  tag_id       uuid not null,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  primary key (contact_id, tag_id),

  constraint crm_contact_tags_contact_fk
    foreign key (contact_id, workspace_id)
    references public.crm_contacts (id, workspace_id)
    on delete cascade,
  constraint crm_contact_tags_tag_fk
    foreign key (tag_id, workspace_id)
    references public.crm_tags (id, workspace_id)
    on delete cascade
);

create index if not exists crm_contact_tags_tag_idx
  on public.crm_contact_tags (workspace_id, tag_id);

-- ---------------------------------------------------------------------------
-- Custom fields
--
-- TYPED AND VALIDATED. The definition declares a type; the value is stored as
-- JSONB and validated against that type in TypeScript
-- (`lib/crm/custom-fields.ts`) before it is written.
--
-- ⚠️ VALIDATION IS NOT DUPLICATED IN SQL. A CHECK constraint cannot express
-- "this JSONB matches the type named by a row in another table", and an
-- approximation would be a second source of truth that drifts — the failure
-- 0043 and lib/limits/credits.ts both carry warnings about. The database
-- enforces SHAPE (one value per definition per record); TypeScript enforces
-- TYPE, at the single choke point every write goes through.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_custom_field_definitions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity       public.crm_custom_field_entity not null,

  -- Stable machine key used by merge variables ({{custom_field}}) and the API.
  -- Immutable by convention: renaming `label` is free, renaming `key` breaks
  -- every template and flow that referenced it.
  key          text not null check (key ~ '^[a-z][a-z0-9_]{0,48}$'),
  label        text not null check (length(trim(label)) between 1 and 80),
  field_type   public.crm_custom_field_type not null,

  -- Only for select / multi_select: the permitted choices, as a JSON array of
  -- strings. Validated in TypeScript alongside the value.
  options      jsonb not null default '[]'::jsonb,
  is_required  boolean not null default false,

  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  unique (id, workspace_id),
  constraint crm_cfd_options_is_array check (jsonb_typeof(options) = 'array')
);

drop trigger if exists crm_cfd_set_updated_at on public.crm_custom_field_definitions;
create trigger crm_cfd_set_updated_at
  before update on public.crm_custom_field_definitions
  for each row execute function public.set_updated_at();

-- One key per entity per workspace. Archived definitions keep their key
-- reserved: reusing it would silently re-point historical values at a new type.
create unique index if not exists crm_cfd_key_uniq
  on public.crm_custom_field_definitions (workspace_id, entity, key);

create table if not exists public.crm_custom_field_values (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  definition_id uuid not null,

  -- Polymorphic by design: one values table for contacts, companies and
  -- opportunities. A table per entity would triple the write path and the
  -- validation surface for no gain. `entity` is carried so a query never has
  -- to join the definition just to know what it is looking at.
  entity        public.crm_custom_field_entity not null,
  record_id     uuid not null,

  -- Shape depends on the definition's field_type; see lib/crm/custom-fields.ts.
  value         jsonb,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint crm_cfv_definition_fk
    foreign key (definition_id, workspace_id)
    references public.crm_custom_field_definitions (id, workspace_id)
    on delete cascade
);

drop trigger if exists crm_cfv_set_updated_at on public.crm_custom_field_values;
create trigger crm_cfv_set_updated_at
  before update on public.crm_custom_field_values
  for each row execute function public.set_updated_at();

-- One value per field per record. This is the SHAPE guarantee the database can
-- actually make.
create unique index if not exists crm_cfv_record_uniq
  on public.crm_custom_field_values (workspace_id, definition_id, record_id);

create index if not exists crm_cfv_record_idx
  on public.crm_custom_field_values (workspace_id, entity, record_id);

-- ---------------------------------------------------------------------------
-- Saved views
-- ---------------------------------------------------------------------------

create table if not exists public.crm_saved_views (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,

  entity        public.crm_custom_field_entity not null,
  name          text not null check (length(trim(name)) between 1 and 80),

  -- Filter/sort/column state.
  --
  -- ⚠️ NOT VALIDATED YET, and deliberately so: its schema IS the list query
  -- language, and inventing one before the query builder exists would mean
  -- guessing. The validator ships with the builder in Phase 3 (Ledger DR10).
  -- Until then nothing reads this column, and a view saved by an older release
  -- must be re-validated on READ as well as on write — a stored filter is
  -- untrusted input however it got there.
  definition    jsonb not null default '{}'::jsonb,
  is_shared     boolean not null default false,

  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint crm_saved_views_definition_is_object
    check (jsonb_typeof(definition) = 'object')
);

drop trigger if exists crm_saved_views_set_updated_at on public.crm_saved_views;
create trigger crm_saved_views_set_updated_at
  before update on public.crm_saved_views
  for each row execute function public.set_updated_at();

create index if not exists crm_saved_views_workspace_idx
  on public.crm_saved_views (workspace_id, entity, name) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- RLS
--
-- Reads are scoped to workspace members. Writes go through the service role
-- behind lib/workspaces/permissions.ts, the precedent every table in this
-- project follows. RLS is the backstop, not the authorization model
-- (CLAUDE.md: "Authorization is server-side").
--
-- ⚠️ RLS GRANTS A MEMBER THE WHOLE WORKSPACE. Narrowing a SETTER to their own
-- assignments is `dataScope()` in lib/workspaces/permissions.ts, applied as a
-- WHERE clause by the caller — a policy cannot express "rows assigned to you"
-- without embedding the ownership model of every future table in SQL. Any M2+
-- query that returns workspace data MUST consult dataScope.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_companies',
    'crm_contacts',
    'crm_contact_emails',
    'crm_contact_phones',
    'crm_contact_company_relationships',
    'crm_tags',
    'crm_contact_tags',
    'crm_custom_field_definitions',
    'crm_custom_field_values',
    'crm_saved_views'
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

comment on table public.crm_contacts is
  'The canonical person. ONE ROW PER REAL PERSON PER WORKSPACE. Lists, '
  'batches, campaigns and sequences attach via association tables — never by '
  'duplicating this row, and never by adding a per-step column here.';

comment on table public.crm_companies is
  'The CRM account, workspace-scoped. NOT public.companies, which is the Lead '
  'Engine''s per-user research unit; source_company_id links the two.';

comment on column public.crm_contacts.primary_company_id is
  'Projection of the current primary crm_contact_company_relationships row, '
  'which is the source of truth. Denormalized so a contact list does not join.';

comment on column public.crm_contact_emails.identity_key is
  'Provider-folded dedup key (Gmail dots, +tags). NEVER send to this — send '
  'to `address`. See Ledger D11.';

comment on table public.crm_contact_phones is
  'Deliberately NOT unique on the number: a switchboard is shared by colleagues, '
  'so a phone is a duplicate CANDIDATE for a human, never an automatic block.';
