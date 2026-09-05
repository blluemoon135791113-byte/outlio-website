-- 0033 — fix an ambiguous column reference in claim_capture_page
--
-- 0032 declared the function as:
--
--   returns table (status text, page_id uuid)
--
-- which makes `status` a PL/pgSQL output variable. The body then read
-- capture_sessions.status unqualified:
--
--   select (status = 'active') into v_active from public.capture_sessions ...
--
-- Postgres cannot tell whether `status` means the output variable or the
-- column, so every call failed with:
--
--   column reference "status" is ambiguous
--
-- That is the whole capture path, so nothing would have worked. Caught by
-- probing the function after deploying rather than by reading the SQL.
--
-- The fix is to alias the table and qualify every column. The signature is
-- unchanged, so types/database.ts and the callers stay as they are.
--
-- Worth remembering: RETURNS TABLE output names share a namespace with column
-- names inside the body. Any future function returning a column name that also
-- exists on a table it queries needs the same treatment.

create or replace function public.claim_capture_page(
  p_session_id   uuid,
  p_user_id      uuid,
  p_content_hash text,
  p_source_url   text,
  p_page_ident   text
)
returns table (status text, page_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_page_id uuid;
  v_active  boolean;
begin
  -- Aliased and fully qualified: cs.status is the column, never the output.
  select (cs.status = 'active')
    into v_active
    from public.capture_sessions cs
   where cs.id = p_session_id
     and cs.user_id = p_user_id;

  if not found then
    status := 'not_found'; page_id := null; return next; return;
  end if;

  if not v_active then
    status := 'session_closed'; page_id := null; return next; return;
  end if;

  begin
    insert into public.capture_pages as cp (
      capture_session_id, user_id, content_hash, source_url, page_identifier, status
    )
    values (p_session_id, p_user_id, p_content_hash, p_source_url, p_page_ident, 'received')
    returning cp.id into v_page_id;
  exception when unique_violation then
    -- Already captured by this user, in this or any earlier session.
    update public.capture_sessions cs
       set duplicates_skipped = cs.duplicates_skipped + 1
     where cs.id = p_session_id;

    status := 'duplicate'; page_id := null; return next; return;
  end;

  status := 'claimed'; page_id := v_page_id; return next;
end;
$$;

revoke all on function public.claim_capture_page(uuid, uuid, text, text, text)
  from public, anon, authenticated;
