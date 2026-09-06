-- 0106 — restore the claim function's suppression sweep and retry cap
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  0104 SILENTLY DELETED TWO SAFETY RULES BY RETYPING THE FUNCTION.        ║
-- ║                                                                           ║
-- ║  Adding `in_reply_to_message_id` meant recreating                         ║
-- ║  `claim_email_messages`. I wrote the body from the part of 0086 I had     ║
-- ║  read, and lost the two things above it:                                  ║
-- ║                                                                           ║
-- ║    1. THE SUPPRESSION SWEEP. The original marks queued messages to a      ║
-- ║       do-not-contact address as `suppressed` BEFORE anything is claimed.  ║
-- ║       Without it, a message queued before someone unsubscribed is sent to ║
-- ║       them — proven by five failing tests that deliver real mail to a     ║
-- ║       suppressed address. This is the one rule in the email system that   ║
-- ║       has legal weight, not merely product weight.                        ║
-- ║                                                                           ║
-- ║    2. `attempts < max_attempts`. Without it a permanently failing message ║
-- ║       is retried forever, hammering a mail server that has already said   ║
-- ║       no and burning the sending domain's reputation.                     ║
-- ║                                                                           ║
-- ║  ⚠️ THIS FILE IS THE 0086 BODY COPIED VERBATIM, with exactly two edits:   ║
-- ║  the new column in `RETURNS TABLE` and in the final SELECT. Retyping a    ║
-- ║  function from memory is what caused both regressions; it is not done     ║
-- ║  again here.                                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

drop function if exists public.claim_email_messages(text, integer, integer);

-- suppressed recipient is transitioned straight to `suppressed` and is never
-- handed to a worker at all.
-- ---------------------------------------------------------------------------

create function public.claim_email_messages(
  p_claimed_by      text,
  p_limit           integer default 10,
  p_claim_seconds   integer default 120
)
returns table (
  message_id   uuid,
  workspace_id uuid,
  account_id   uuid,
  to_email     text,
  subject      text,
  body_text    text,
  body_html    text,
  thread_id    text,
  in_reply_to_message_id text,
  idempotency_key text,
  attempts     integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
begin
  -- Suppressed recipients leave the queue without ever being claimed.
  update public.email_messages m
     set status = 'suppressed',
         suppression_reason = s.reason,
         error_code = 'SUPPRESSED',
         error_message = 'This address is on the do-not-contact list.'
    from public.email_suppressions s
   where m.status = 'queued'
     and m.scheduled_at <= now()
     and s.workspace_id = m.workspace_id
     and s.email = m.to_email;

  select array_agg(q.id)
    into v_ids
    from (
      select m.id
        from public.email_messages m
       where m.status = 'queued'
         and m.scheduled_at <= now()
         and m.attempts < m.max_attempts
       order by m.scheduled_at
       for update skip locked
       limit greatest(p_limit, 1)
    ) q;

  if v_ids is null then
    return;
  end if;

  /*
   * ⚠️ `attempts` MUST BE QUALIFIED. `RETURNS TABLE` declares an OUT parameter
   * of the same name, so a bare reference is ambiguous and raises at RUNTIME
   * rather than at creation — the exact trap that shipped broken in 0072 and
   * had to be fixed in 0073.
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
