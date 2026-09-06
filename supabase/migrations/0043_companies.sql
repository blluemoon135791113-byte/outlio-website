-- 0043 — company normalization and lead → company linking
--
-- WHY THIS EXISTS
-- Company-level facts (funding, tech stack, headcount, hiring, news) are
-- researched ONCE PER COMPANY, never once per employee. 5,000 leads routinely
-- collapse to ~1,850 companies, and every external call avoided is money not
-- spent. This migration creates the company identity that makes that possible.
--
-- IDENTITY PRECEDENCE — normalized domain → company LinkedIn URL → normalized
-- name. Name is the LAST resort and only ever governs rows that carry no
-- stronger identifier, so two different companies that happen to share a name
-- can never be merged.
--
-- NORMALIZATION LIVES IN TYPESCRIPT (`lib/companies/normalize.ts`), not here.
-- This function receives already-normalized values. Re-implementing the rules
-- in SQL would create two sources of truth that silently drift.

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------

create table if not exists public.companies (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,

  -- ---- identity --------------------------------------------------------
  name                   text,
  normalized_name        text,
  domain                 text,
  normalized_domain      text,
  linkedin_url           text,
  normalized_linkedin_url text,

  -- ---- researched projections -----------------------------------------
  -- Written from `research_evidence` in a later phase. `research_evidence` is
  -- the source of truth with provenance and TTL; these columns are only the
  -- current best value, kept here so list queries do not need a join.
  industry               text,
  employee_count         integer check (employee_count is null or employee_count >= 0),
  headquarters           text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- Composite key so child tables can enforce that both sides belong to the
  -- same tenant, exactly as 0034 does for integrations.
  unique (id, user_id),

  -- A row with no identifier at all cannot be matched to anything and would
  -- accumulate silently.
  constraint companies_has_identity check (
    normalized_domain is not null
    or normalized_linkedin_url is not null
    or normalized_name is not null
  )
);

drop trigger if exists companies_set_updated_at on public.companies;
create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Identity uniqueness.
--
-- Three PARTIAL unique indexes rather than one composite key, because the
-- precedence rule is conditional: a name only identifies a company while that
-- company has nothing better. Once a domain or LinkedIn URL is known, the name
-- stops being an identity and two same-named companies coexist correctly.
-- ---------------------------------------------------------------------------

create unique index if not exists companies_user_domain_uniq
  on public.companies (user_id, normalized_domain)
  where normalized_domain is not null;

create unique index if not exists companies_user_linkedin_uniq
  on public.companies (user_id, normalized_linkedin_url)
  where normalized_linkedin_url is not null;

create unique index if not exists companies_user_name_uniq
  on public.companies (user_id, normalized_name)
  where normalized_name is not null
    and normalized_domain is null
    and normalized_linkedin_url is null;

create index if not exists companies_user_idx on public.companies (user_id);
create index if not exists companies_user_created_idx
  on public.companies (user_id, created_at desc);

comment on table public.companies is
  'One row per distinct company per user. The unit of company-level research; '
  'never research a company fact once per employee.';

-- ---------------------------------------------------------------------------
-- RLS — same shape as extracted_leads. Reads are the user''s own; all writes
-- go through the service role, which scopes by user_id in code.
-- ---------------------------------------------------------------------------

alter table public.companies enable row level security;

drop policy if exists companies_select_own on public.companies;
create policy companies_select_own on public.companies
  for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

revoke all on table public.companies from public, anon, authenticated;
grant select on table public.companies to authenticated;
grant select, insert, update, delete on table public.companies to service_role;

-- ---------------------------------------------------------------------------
-- extracted_leads → companies
--
-- One column, not a join table: a captured lead row records exactly one current
-- employer, so a many-to-many table would add a join to every query and buy
-- nothing.
--
-- The FK is single-column with ON DELETE SET NULL. Composite `(company_id,
-- user_id)` would need `ON DELETE SET NULL (company_id)`, which is Postgres 15+
-- only, and nulling the whole key would violate `user_id NOT NULL`. Cross-tenant
-- safety comes from `link_leads_to_companies` scoping BOTH sides by p_user_id,
-- the same rule every service-role query in this codebase follows.
-- ---------------------------------------------------------------------------

alter table public.extracted_leads
  add column if not exists company_id uuid
    references public.companies(id) on delete set null;

alter table public.extracted_leads
  add column if not exists company_match_strategy text;

do $$ begin
  alter table public.extracted_leads
    add constraint extracted_leads_company_match_strategy_check
    check (company_match_strategy is null
           or company_match_strategy in ('domain', 'linkedin', 'name'));
exception when duplicate_object then null; end $$;

create index if not exists extracted_leads_company_idx
  on public.extracted_leads (user_id, company_id);

comment on column public.extracted_leads.company_id is
  'Resolved company identity. NULL means the row carried nothing that could '
  'identify a company, or the linking step has not run yet.';

-- ---------------------------------------------------------------------------
-- link_leads_to_companies
--
-- ATOMIC BY DESIGN. `after()` can process two extraction jobs for the same user
-- concurrently, and a read-then-write in application code would let both insert
-- the same company — the exact bug class that only parallel connections expose
-- (see the 0010 invitation-redemption postmortem).
--
-- Every lead element must already be normalized:
--   { lead_id, name, normalized_name, domain, normalized_domain,
--     linkedin_url, normalized_linkedin_url }
--
-- Returns one row per lead that was linked.
-- ---------------------------------------------------------------------------

create or replace function public.link_leads_to_companies(
  p_user_id uuid,
  p_leads   jsonb
)
returns table (lead_id uuid, company_id uuid, match_strategy text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead        jsonb;
  v_lead_id     uuid;
  v_name        text;
  v_norm_name   text;
  v_domain      text;
  v_norm_domain text;
  v_li          text;
  v_norm_li     text;
  v_strategy    text;
  v_company_id  uuid;
  v_attempt     int;
begin
  if p_user_id is null then
    raise exception 'link_leads_to_companies: p_user_id is required';
  end if;

  for v_lead in
    select value from jsonb_array_elements(coalesce(p_leads, '[]'::jsonb))
  loop
    v_lead_id     := nullif(v_lead ->> 'lead_id', '')::uuid;
    v_name        := nullif(v_lead ->> 'name', '');
    v_norm_name   := nullif(v_lead ->> 'normalized_name', '');
    v_domain      := nullif(v_lead ->> 'domain', '');
    v_norm_domain := nullif(v_lead ->> 'normalized_domain', '');
    v_li          := nullif(v_lead ->> 'linkedin_url', '');
    v_norm_li     := nullif(v_lead ->> 'normalized_linkedin_url', '');

    continue when v_lead_id is null;

    -- Precedence (spec §9). The strategy is chosen from what THIS lead carries,
    -- so a name lookup is only ever reached when nothing stronger exists.
    if v_norm_domain is not null then
      v_strategy := 'domain';
    elsif v_norm_li is not null then
      v_strategy := 'linkedin';
    elsif v_norm_name is not null then
      v_strategy := 'name';
    else
      -- Nothing identifies a company. Leave the lead unlinked rather than
      -- inventing one.
      continue;
    end if;

    v_company_id := null;
    v_attempt    := 0;

    while v_company_id is null and v_attempt < 3 loop
      v_attempt := v_attempt + 1;

      -- 1 — find by the strongest identifier this lead has.
      if v_strategy = 'domain' then
        select c.id into v_company_id
          from public.companies c
         where c.user_id = p_user_id
           and c.normalized_domain = v_norm_domain;
      elsif v_strategy = 'linkedin' then
        select c.id into v_company_id
          from public.companies c
         where c.user_id = p_user_id
           and c.normalized_linkedin_url = v_norm_li;
      else
        select c.id into v_company_id
          from public.companies c
         where c.user_id = p_user_id
           and c.normalized_name = v_norm_name
           and c.normalized_domain is null
           and c.normalized_linkedin_url is null;
      end if;

      exit when v_company_id is not null;

      -- 2 — adopt a name-only row rather than creating a second company.
      --     Captures are inconsistent: the same company arrives with a website
      --     on one page and with only a name on another. Promoting the weaker
      --     row keeps both leads on one company.
      if v_strategy <> 'name' and v_norm_name is not null then
        begin
          if v_strategy = 'domain' then
            update public.companies
               set domain = v_domain, normalized_domain = v_norm_domain
             where user_id = p_user_id
               and normalized_name = v_norm_name
               and normalized_domain is null
               and normalized_linkedin_url is null
            returning id into v_company_id;
          else
            update public.companies
               set linkedin_url = v_li, normalized_linkedin_url = v_norm_li
             where user_id = p_user_id
               and normalized_name = v_norm_name
               and normalized_domain is null
               and normalized_linkedin_url is null
            returning id into v_company_id;
          end if;
        exception when unique_violation then
          -- A concurrent transaction claimed the same identifier. Re-select.
          v_company_id := null;
        end;

        exit when v_company_id is not null;
      end if;

      -- 3 — insert. Only the strategy's own identifier plus the name is
      --     written, so this statement can only ever conflict on the index the
      --     retry loop re-reads. Weaker identifiers are attached afterwards.
      insert into public.companies (
        user_id, name, normalized_name,
        domain, normalized_domain,
        linkedin_url, normalized_linkedin_url
      )
      values (
        p_user_id, v_name, v_norm_name,
        case when v_strategy = 'domain'   then v_domain end,
        case when v_strategy = 'domain'   then v_norm_domain end,
        case when v_strategy = 'linkedin' then v_li end,
        case when v_strategy = 'linkedin' then v_norm_li end
      )
      on conflict do nothing
      returning id into v_company_id;
    end loop;

    -- Gave up after three contended attempts. Leave the lead unlinked; the
    -- backfill repairs it. Never guess a company.
    continue when v_company_id is null;

    -- 4 — attach the weaker identifier this lead also carried, if it is still
    --     free. Guarded: another company may already own it, and that is not
    --     an error.
    if v_strategy = 'domain' and v_norm_li is not null then
      begin
        update public.companies
           set linkedin_url = v_li, normalized_linkedin_url = v_norm_li
         where id = v_company_id
           and user_id = p_user_id
           and normalized_linkedin_url is null;
      exception when unique_violation then null;
      end;
    end if;

    if v_norm_name is not null then
      update public.companies
         set name = coalesce(name, v_name),
             normalized_name = v_norm_name
       where id = v_company_id
         and user_id = p_user_id
         and normalized_name is null;
    end if;

    update public.extracted_leads
       set company_id = v_company_id,
           company_match_strategy = v_strategy
     where id = v_lead_id
       and user_id = p_user_id;

    if found then
      lead_id        := v_lead_id;
      company_id     := v_company_id;
      match_strategy := v_strategy;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.link_leads_to_companies(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.link_leads_to_companies(uuid, jsonb)
  to service_role;

comment on function public.link_leads_to_companies(uuid, jsonb) is
  'Service-role only. Resolves already-normalized lead company identities to '
  'public.companies rows and links them. Safe under concurrency.';
