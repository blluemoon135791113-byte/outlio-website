-- 0104 — carry the threading header through to the send (R11)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  THE SMTP PROVIDER HAS ALWAYS SET In-Reply-To. NOTHING EVER FILLED IT IN.║
-- ║                                                                           ║
-- ║  `providers/smtp.ts` reads `message.inReplyToMessageId` and sets both     ║
-- ║  In-Reply-To and References from it. `OutboundMessage` declares the       ║
-- ║  field. But no column carried the value and the claim function never      ║
-- ║  returned one, so it was `undefined` on every send the product has ever   ║
-- ║  made.                                                                    ║
-- ║                                                                           ║
-- ║  The visible consequence is that a reply sent from Outlio arrives as a    ║
-- ║  NEW conversation in the recipient's client rather than landing under the ║
-- ║  message it answers — which makes the person on the other end feel they   ║
-- ║  are talking to a system rather than to someone who read their email.     ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

alter table public.email_messages
  add column if not exists in_reply_to_message_id text;

comment on column public.email_messages.in_reply_to_message_id is
  'RFC 5322 Message-ID of the message this one answers. Sets In-Reply-To and '
  'References on the wire so a reply threads in the recipient''s client. NULL '
  'for anything that starts a conversation.';

-- ---------------------------------------------------------------------------
-- claim_email_messages must return the new column, or the worker cannot pass
-- it to the provider.
--
-- ⚠️ THE RETURN TYPE CHANGES, so the function is dropped and recreated rather
-- than replaced: Postgres refuses `create or replace` when the OUT parameters
-- differ, and the failure is at deploy time with a message that does not name
-- the real cause.
-- ---------------------------------------------------------------------------
drop function if exists public.claim_email_messages(text, integer, integer);

create function public.claim_email_messages(
  p_claimed_by     text,
  p_limit          integer default 10,
  p_claim_seconds  integer default 120
)
returns table (
  id              uuid,
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
