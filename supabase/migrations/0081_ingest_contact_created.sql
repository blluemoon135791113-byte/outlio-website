-- 0081 — record CONTACT_CREATED on ingestion
--
-- Found by opening the contact detail page: every ingested contact had a
-- completely empty timeline. `CONTACT_CREATED` has been in the
-- `crm_activity_type` enum since 0075 and nothing was writing it.
--
-- Two things were wrong with that. The page looks broken — a real person with
-- a real company and no history at all reads as a failed import. And M4's
-- funnel ("extracted → canonical contacts → assigned → emailed") has no event
-- marking the moment a lead became a contact, so the first step of the funnel
-- would have to be inferred from a batch count rather than derived from the
-- event stream like every other metric.
--
-- The insert goes INSIDE the create branch, so the event and the contact share
-- a transaction: a contact that exists without its creation event is exactly
-- the inconsistency the event stream is supposed to make impossible.
--
-- ⚠️ Only fires on CREATE, never on a match. Re-ingesting a batch must not
-- manufacture a second birth for someone who already existed — that is what
-- makes ingestion idempotent (M2 criterion 1).
--
-- Nothing else in the function changes.

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

  if p_batch_id is not null and not exists (
    select 1 from public.crm_lead_batches b
     where b.id = p_batch_id and b.workspace_id = p_workspace_id
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
      select c.id into v_contact
        from public.crm_contacts c
       where c.workspace_id = p_workspace_id
         and c.linkedin_identity_key = v_li_key
         and c.deleted_at is null
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

        /*
         * The contact's first event, written in the SAME transaction as the
         * contact. Without it an ingested person has a completely empty
         * timeline — which looks broken on the detail page, and leaves M4's
         * funnel with no event marking the moment a lead became a canonical
         * contact.
         */
        insert into public.crm_activities (
          workspace_id, activity_type, channel, contact_id,
          actor_user_id, owner_user_id_at_event, refs, metadata
        ) values (
          p_workspace_id, 'CONTACT_CREATED', 'system', v_contact,
          nullif(v_row ->> 'owner_user_id', '')::uuid,
          nullif(v_row ->> 'owner_user_id', '')::uuid,
          case when p_batch_id is null then '{}'::jsonb
               else jsonb_build_object('batch_id', p_batch_id) end,
          jsonb_build_object('source', coalesce(nullif(v_row ->> 'source', ''), 'manual'))
        );
      exception when unique_violation then
        -- Another transaction created this person between the match and the
        -- insert. Its row is the canonical one; this is not an error.
        select c.id into v_contact
          from public.crm_contacts c
         where c.workspace_id = p_workspace_id
           and c.linkedin_identity_key = v_li_key
           and c.deleted_at is null
         limit 1;
        v_matched := 'linkedin';
      end;
    end if;

    continue when v_contact is null;

    -- ---- emails ---------------------------------------------------------
    select exists (
      select 1 from public.crm_contact_emails ce
       where ce.workspace_id = p_workspace_id
         and ce.contact_id = v_contact
         and ce.deleted_at is null
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
      select 1 from public.crm_contact_phones cp
       where cp.workspace_id = p_workspace_id
         and cp.contact_id = v_contact
         and cp.deleted_at is null
    ) into v_has_phone;

    for v_phone in select value from jsonb_array_elements(coalesce(v_row -> 'phones', '[]'::jsonb))
    loop
      continue when nullif(v_phone ->> 'raw', '') is null;

      -- No unique index here by design (Ledger D14), so the duplicate check is
      -- explicit and scoped to THIS contact.
      if exists (
        select 1 from public.crm_contact_phones cp
         where cp.workspace_id = p_workspace_id
           and cp.contact_id = v_contact
           and cp.deleted_at is null
           and (
             (nullif(v_phone ->> 'e164', '') is not null and cp.e164 = v_phone ->> 'e164')
             or (nullif(v_phone ->> 'e164', '') is null and cp.raw = v_phone ->> 'raw')
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
      -- No explicit conflict target: the primary key is the only constraint
      -- that can fire here, and naming it re-introduces the ambiguity this
      -- migration exists to fix.
      insert into public.crm_batch_members (
        workspace_id, batch_id, contact_id, source_lead_id, created_contact
      ) values (
        p_workspace_id, p_batch_id, v_contact,
        nullif(v_row ->> 'source_lead_id', '')::uuid,
        v_created
      )
      on conflict do nothing;
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
