-- 0101 — make the genuinely-optional inbound arguments optional (M8 Phase 26)
--
-- ⚠️ A TYPING BUG WITH A REAL CAUSE. In 0100 every argument except
-- `p_contact_id` was declared without a default, so the generated TypeScript
-- types them as required, non-null `string`. But a received email genuinely
-- MAY have no subject and no text body -- a bare attachment, or a message
-- whose only content is HTML -- and the columns behind them are nullable.
--
-- The alternative was casting `null as string` at the call site, which puts a
-- lie in the types to keep the compiler quiet. This makes the signature say
-- what is actually true.
--
-- Postgres requires that every parameter after the first defaulted one also
-- has a default, so `p_received_at` and `p_classification` gain the values
-- they were already being given in practice.
--
-- ⚠️ `create or replace` IS SAFE HERE because the argument TYPES are
-- unchanged -- adding defaults does not change the function's signature, so
-- no dependent grant or call site breaks.

create or replace function public.email_record_inbound(
  p_workspace_id        uuid,
  p_account_id          uuid,
  p_provider_thread_key text,
  p_provider_message_id text,
  p_from_email          text,
  p_subject             text default null,
  p_body_text           text default null,
  p_received_at         timestamptz default now(),
  p_classification      text default 'reply',
  p_contact_id          uuid default null
)
returns table (thread_id uuid, is_new boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_id uuid;
  v_inserted  uuid;
begin
  insert into public.email_threads (
    workspace_id, account_id, provider_thread_key, subject, contact_id,
    last_message_at, last_direction, message_count
  )
  values (
    p_workspace_id, p_account_id, p_provider_thread_key, p_subject, p_contact_id,
    p_received_at, 'inbound', 0
  )
  on conflict (workspace_id, provider_thread_key) do update
    set updated_at = now()
  returning id into v_thread_id;

  insert into public.email_inbound_messages (
    workspace_id, thread_id, account_id, provider_message_id,
    from_email, subject, body_text, received_at, classification
  )
  values (
    p_workspace_id, v_thread_id, p_account_id, p_provider_message_id,
    p_from_email, p_subject, p_body_text, p_received_at,
    coalesce(p_classification, 'reply')
  )
  on conflict (workspace_id, provider_message_id) do nothing
  returning id into v_inserted;

  if v_inserted is null then
    -- Already filed. The thread is NOT touched: re-marking it unread on every
    -- re-sync would resurface answered threads.
    return query select v_thread_id, false;
    return;
  end if;

  update public.email_threads
  set
    message_count   = message_count + 1,
    last_message_at = greatest(last_message_at, p_received_at),
    last_direction  = 'inbound',
    status          = 'open',
    read_at         = null,
    contact_id      = coalesce(contact_id, p_contact_id),
    subject         = coalesce(subject, p_subject)
  where id = v_thread_id;

  return query select v_thread_id, true;
end;
$$;

revoke all on function public.email_record_inbound(
  uuid, uuid, text, text, text, text, text, timestamptz, text, uuid
) from public, anon, authenticated;
