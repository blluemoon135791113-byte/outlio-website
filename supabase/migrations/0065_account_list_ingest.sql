-- ---------------------------------------------------------------------------
-- Account List ingestion
-- ---------------------------------------------------------------------------
--
-- Saved Sales Navigator ACCOUNT lists are a company-volume feature, separate
-- from individual lead extraction. A lead page yields people who happen to
-- have employers; an account list yields companies directly, with no person
-- attached.
--
-- `link_leads_to_companies` (0043) cannot serve this: it requires a lead_id and
-- skips any row without one. This function performs the same identity
-- resolution with no lead, and additionally reports whether the row was
-- CREATED, so ingestion can tell a user "18 new, 7 already known" instead of a
-- single meaningless total.
--
-- The resolution below deliberately mirrors 0043 step for step — precedence,
-- name-row adoption, the contended-retry loop, and the guarded attachment of
-- the weaker identifier. Divergence between the two would mean the same
-- company resolving differently depending on which page it arrived on, which
-- is exactly the duplicate this table's partial unique indexes exist to stop.

create or replace function public.upsert_companies(
  p_user_id   uuid,
  p_companies jsonb
)
returns table (company_id uuid, match_strategy text, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row         jsonb;
  v_name        text;
  v_norm_name   text;
  v_domain      text;
  v_norm_domain text;
  v_li          text;
  v_norm_li     text;
  v_industry    text;
  v_strategy    text;
  v_company_id  uuid;
  v_created     boolean;
  v_attempt     int;
begin
  if p_user_id is null then
    raise exception 'upsert_companies: p_user_id is required';
  end if;

  for v_row in
    select value from jsonb_array_elements(coalesce(p_companies, '[]'::jsonb))
  loop
    v_name        := nullif(v_row ->> 'name', '');
    v_norm_name   := nullif(v_row ->> 'normalized_name', '');
    v_domain      := nullif(v_row ->> 'domain', '');
    v_norm_domain := nullif(v_row ->> 'normalized_domain', '');
    v_li          := nullif(v_row ->> 'linkedin_url', '');
    v_norm_li     := nullif(v_row ->> 'normalized_linkedin_url', '');
    v_industry    := nullif(v_row ->> 'industry', '');

    -- Precedence (spec §9), chosen from what THIS row carries.
    if v_norm_domain is not null then
      v_strategy := 'domain';
    elsif v_norm_li is not null then
      v_strategy := 'linkedin';
    elsif v_norm_name is not null then
      v_strategy := 'name';
    else
      -- Nothing identifies a company. Never invent one.
      continue;
    end if;

    v_company_id := null;
    v_created    := false;
    v_attempt    := 0;

    while v_company_id is null and v_attempt < 3 loop
      v_attempt := v_attempt + 1;

      -- 1 — find by the strongest identifier this row has.
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

      -- 2 — adopt a name-only row rather than creating a second company. The
      --     same company arrives from a lead page with a website and from an
      --     account list with only a name; promoting the weaker row keeps them
      --     as one company.
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
      --     written, so this can only conflict on the index the retry loop
      --     re-reads.
      insert into public.companies (
        user_id, name, normalized_name,
        domain, normalized_domain,
        linkedin_url, normalized_linkedin_url,
        industry
      )
      values (
        p_user_id, v_name, v_norm_name,
        case when v_strategy = 'domain'   then v_domain end,
        case when v_strategy = 'domain'   then v_norm_domain end,
        case when v_strategy = 'linkedin' then v_li end,
        case when v_strategy = 'linkedin' then v_norm_li end,
        v_industry
      )
      on conflict do nothing
      returning id into v_company_id;

      if v_company_id is not null then
        v_created := true;
      end if;
    end loop;

    -- Gave up after three contended attempts. Skip rather than guess.
    continue when v_company_id is null;

    -- 4 — attach the weaker identifier this row also carried, if still free.
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
             normalized_name = coalesce(normalized_name, v_norm_name)
       where id = v_company_id
         and user_id = p_user_id;
    end if;

    -- ⚠️ INDUSTRY IS ONLY EVER FILLED IN, NEVER OVERWRITTEN.
    --
    -- `companies.industry` is a projection of `research_evidence`, which is
    -- the source of truth and carries provenance and a TTL. A captured page is
    -- weaker than researched evidence, so it may seed an empty cell and must
    -- not replace a value some provider stood behind.
    if v_industry is not null then
      update public.companies
         set industry = v_industry
       where id = v_company_id
         and user_id = p_user_id
         and industry is null;
    end if;

    company_id     := v_company_id;
    match_strategy := v_strategy;
    created        := v_created;
    return next;
  end loop;
end;
$$;

revoke all on function public.upsert_companies(uuid, jsonb) from public, anon, authenticated;

comment on function public.upsert_companies(uuid, jsonb) is
  'Upserts companies from a saved account list. Service-role only; every read '
  'and write is scoped by p_user_id. Mirrors link_leads_to_companies identity '
  'resolution so a company resolves identically whichever page it arrived on.';
