-- 0105 — restore the claim function's original column name (fixes 0104)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  0104 RENAMED AN OUTPUT COLUMN AND BROKE SENDING IN PRODUCTION.          ║
-- ║                                                                           ║
-- ║  `claim_email_messages` has returned its first column as `message_id`     ║
-- ║  since 0086. Recreating the function to add `in_reply_to_message_id`, I   ║
-- ║  wrote `id` instead. `runSendWorker` reads `message.message_id`, so it    ║
-- ║  became `undefined` on every claimed row and no message could be sent,    ║
-- ║  marked or retried.                                                       ║
-- ║                                                                           ║
-- ║  ⚠️ WHY THE SMOKE TEST MISSED IT: it asserted on `idempotency_key` and    ║
-- ║  the new threading column — never on the identifier the CALLER depends    ║
-- ║  on. A test that exercises a function without asserting its contract      ║
-- ║  proves the function runs, not that it is usable. The test below now      ║
-- ║  names every column the worker reads.                                     ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

drop function if exists public.claim_email_messages(text, integer, integer);

create function public.claim_email_messages(
  p_claimed_by     text,
  p_limit          integer default 10,
  p_claim_seconds  integer default 120
)
returns table (
  -- ⚠️ `message_id`, NOT `id`. Named this way since 0086 and read by
  -- `runSendWorker`. Renaming it breaks sending silently: the worker gets
  -- `undefined` and every send fails with no obvious cause.
  message_id      uuid,
  workspace_id    uuid,
  account_id      uuid,
  to_email        text,
  subject         text,
  body_text       text,
  body_html       text,
  thread_id       text,
  in_reply_to_message_id text,
  idempotency_key text,
  attempts        integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
begin
  /*
   * ⚠️ FOR UPDATE SKIP LOCKED IS THE WHOLE DESIGN. Two workers running at once
   * must never claim the same row, and SKIP LOCKED is what lets the second one
   * take different work instead of blocking behind the first.
   */
  select array_agg(m.id)
    into v_ids
    from (
      select m2.id
        from public.email_messages m2
       where m2.status = 'queued'
         and m2.scheduled_at <= now()
       order by m2.scheduled_at
       limit greatest(p_limit, 1)
       for update skip locked
    ) m;

  if v_ids is null then
    return;
  end if;

  /*
   * ⚠️ `attempts` MUST BE QUALIFIED. `RETURNS TABLE` declares an OUT parameter
   * of the same name, so a bare reference is ambiguous and raises at RUNTIME
   * rather than at creation — the exact trap that shipped broken in 0072.
   */
  update public.email_messages m
     set status           = 'sending',
         claimed_by       = p_claimed_by,
         claimed_at       = now(),
         claim_expires_at = now() + make_interval(secs => greatest(p_claim_seconds, 30)),
         attempts         = m.attempts + 1
   where m.id = any(v_ids);

  return query
    select m.id, m.workspace_id, m.account_id, m.to_email, m.subject,
           m.body_text, m.body_html, m.thread_id, m.in_reply_to_message_id,
           m.idempotency_key, m.attempts
      from public.email_messages m
     where m.id = any(v_ids);
end;
$$;

revoke all on function public.claim_email_messages(text, integer, integer)
  from public, anon, authenticated;
