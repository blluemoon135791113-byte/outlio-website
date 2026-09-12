-- ---------------------------------------------------------------------------
-- 0120 — suppression is a fact about a PERSON, not one of their addresses.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  A CONTACT CAN HOLD SEVERAL ADDRESSES. SUPPRESSION ONLY STOPPED ONE.      ║
-- ║                                                                           ║
-- ║  `crm_contact_emails` is a child table, so one person may have two or      ║
-- ║  more addresses on file. Both suppression checks — the TypeScript one in   ║
-- ║  `enqueueEmail` and the one inside this claim function — matched on        ║
-- ║  `email` alone. So somebody who unsubscribed, or who was marked            ║
-- ║  do-not-contact after replying, kept receiving mail at their second        ║
-- ║  address, because the row recording that decision named the first.        ║
-- ║                                                                           ║
-- ║  `email_suppressions.contact_id` has existed since 0086 and                ║
-- ║  `suppressEmail` has always written it. Nothing ever read it.             ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- The TypeScript half shipped separately and needs no migration. This is the
-- other half: `enqueueEmail` refuses at enqueue, but a message QUEUED BEFORE
-- the suppression was recorded is already in the table, and only this function
-- stands between it and the wire. That is the whole point of there being two
-- checks — "neither check makes the other redundant" (lib/email/send.ts) — and
-- until this is applied only one of them covers a second address.
--
-- ⚠️ ALSO THE PREDICATE THE LINKEDIN CHANNEL NEEDS. §4.15 of the LinkedIn
-- brief requires a stop recorded against a contact to reach a send addressed
-- by email. Recorded in docs/outlio/LINKEDIN_CAPABILITY_MAP.md §2.
--
-- ⚠️ THE SIGNATURE AND BODY ARE 0106'S, UNCHANGED APART FROM THE PREDICATE.
-- `create or replace` cannot alter a return type, and this function's shape is
-- easy to get wrong from memory: `thread_id` is TEXT here, not the uuid it is
-- on the table, and `in_reply_to_message_id` and `idempotency_key` are in the
-- return set while `contact_id` and `campaign_id` are not. Copied from 0106
-- rather than reconstructed.
-- ---------------------------------------------------------------------------

create or replace function public.claim_email_messages(
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
  --
  -- ⚠️ `s.contact_id is not null` IS LOAD-BEARING. Without it, a suppression
  -- row with a null contact_id would be compared against a message with a null
  -- contact_id, and only SQL's `null = null` evaluating to unknown would stop
  -- it matching. Relying on three-valued logic for a send/do-not-send decision
  -- is not a thing to do quietly; the condition is stated instead.
  update public.email_messages m
     set status = 'suppressed',
         suppression_reason = s.reason,
         error_code = 'SUPPRESSED',
         error_message = 'This address is on the do-not-contact list.'
    from public.email_suppressions s
   where m.status = 'queued'
     and m.scheduled_at <= now()
     and s.workspace_id = m.workspace_id
     and (
           s.email = m.to_email
        or (s.contact_id is not null and s.contact_id = m.contact_id)
     );

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

-- The existing unique index covers (workspace_id, email); nothing covered
-- contact_id, and the new predicate scans on it once per claim.
create index if not exists email_suppressions_workspace_contact_idx
  on public.email_suppressions (workspace_id, contact_id)
  where contact_id is not null;

comment on function public.claim_email_messages(text, integer, integer) is
  'Claims due email messages. Suppression matches the contact as well as the '
  'address, because one contact can hold several addresses (0120).';
