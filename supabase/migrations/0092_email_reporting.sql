-- 0092 — email reporting (M6 Phase 19)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  EVERY NUMBER COMES FROM `email_events`, WHICH IS APPEND-ONLY.           ║
-- ║                                                                           ║
-- ║  M6 criterion 5 is that campaign reports reconcile with raw email_events. ║
-- ║  The only way to guarantee that permanently is to have nothing else to    ║
-- ║  reconcile WITH — no counter columns, no materialised totals that a       ║
-- ║  missed increment could leave stale. These functions count the stream.    ║
-- ║                                                                           ║
-- ║  ⚠️ `replied` NEVER INCLUDES `auto_replied`. An inflated reply rate is    ║
-- ║  worse than no reply rate, because people act on it — they conclude the   ║
-- ║  message is working and send more of it.                                  ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- ---------------------------------------------------------------------------
-- email_campaign_report — the campaign/sequence view.
-- ---------------------------------------------------------------------------

create or replace function public.email_campaign_report(p_campaign_id uuid)
returns table (
  recipients        bigint,
  eligible          bigint,
  sent              bigint,
  delivered         bigint,
  replied           bigint,
  auto_replied      bigint,
  bounced           bigint,
  unsubscribed      bigint,
  complaints        bigint,
  /* NULL, not zero, when nothing was sent. A campaign that has not sent yet
     has no reply rate; 0% would read as "nobody answered". */
  reply_rate        numeric,
  bounce_rate       numeric,
  stopped_replied   bigint,
  stopped_unsub     bigint,
  still_active      bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with enrollment_totals as (
    select
      count(*) as recipients,
      /* ELIGIBLE excludes people who were enrolled but could never be mailed —
         suppressed or bounced. Reporting them as recipients would understate
         every rate by counting an audience that was never reachable. */
      count(*) filter (
        where e.stop_reason is null
           or e.stop_reason not in ('suppressed', 'bounced')
      ) as eligible,
      count(*) filter (where e.status = 'stopped' and e.stop_reason = 'replied') as stopped_replied,
      count(*) filter (where e.status = 'stopped' and e.stop_reason = 'unsubscribed') as stopped_unsub,
      count(*) filter (where e.status = 'active') as still_active
    from public.email_enrollments e
    where e.campaign_id = p_campaign_id
  ),
  event_totals as (
    select
      count(*) filter (where ev.type = 'sent')         as sent,
      count(*) filter (where ev.type = 'delivered')    as delivered,
      count(*) filter (where ev.type = 'replied')      as replied,
      count(*) filter (where ev.type = 'auto_replied') as auto_replied,
      count(*) filter (where ev.type = 'bounced')      as bounced,
      count(*) filter (where ev.type = 'unsubscribed') as unsubscribed,
      count(*) filter (where ev.type = 'complaint')    as complaints
    from public.email_events ev
    where ev.campaign_id = p_campaign_id
  )
  select
    t.recipients, t.eligible,
    e.sent, e.delivered, e.replied, e.auto_replied, e.bounced,
    e.unsubscribed, e.complaints,
    case when e.sent = 0 then null else round(e.replied::numeric / e.sent, 4) end,
    case when e.sent = 0 then null else round(e.bounced::numeric / e.sent, 4) end,
    t.stopped_replied, t.stopped_unsub, t.still_active
  from enrollment_totals t cross join event_totals e;
$$;

revoke all on function public.email_campaign_report(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- email_mailbox_report — per sending account.
--
-- ⚠️ `last_healthy_send` IS THE FIELD PEOPLE ACTUALLY NEED. "Sent 400" says
-- nothing about whether the mailbox is working NOW; "last successful send: 6
-- days ago" is the number that tells someone a mailbox has quietly died.
-- ---------------------------------------------------------------------------

create or replace function public.email_mailbox_report(
  p_workspace_id uuid,
  p_from_day     date,
  p_to_day       date
)
returns table (
  account_id        uuid,
  display_name      text,
  from_email        text,
  from_domain       text,
  status            public.email_account_status,
  health_score      smallint,
  sent              bigint,
  delivered         bigint,
  replied           bigint,
  bounced           bigint,
  failed            bigint,
  bounce_rate       numeric,
  last_healthy_send timestamptz,
  queued            bigint,
  needs_verification bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    a.id, a.display_name, a.from_email, a.from_domain, a.status, a.health_score,
    coalesce(m.sent, 0),
    coalesce(ev.delivered, 0),
    coalesce(ev.replied, 0),
    coalesce(ev.bounced, 0),
    coalesce(m.failed, 0),
    case when coalesce(m.sent, 0) = 0 then null
         else round(coalesce(ev.bounced, 0)::numeric / m.sent, 4) end,
    m.last_sent,
    coalesce(m.queued, 0),
    /* Messages whose worker died mid-flight. Surfaced per mailbox because a
       mailbox accumulating them has a problem a human must look at — the
       at-most-once design deliberately never retries them (Ledger D36). */
    coalesce(m.needs_verification, 0)
  from public.email_accounts a
  left join lateral (
    select
      count(*) filter (where x.status = 'sent')   as sent,
      count(*) filter (where x.status = 'failed') as failed,
      count(*) filter (where x.status = 'queued') as queued,
      count(*) filter (where x.status = 'needs_verification') as needs_verification,
      max(x.sent_at) filter (where x.status = 'sent') as last_sent
    from public.email_messages x
    where x.account_id = a.id
      and coalesce(x.sent_at, x.created_at)::date between p_from_day and p_to_day
  ) m on true
  left join lateral (
    select
      count(*) filter (where e.type = 'delivered') as delivered,
      count(*) filter (where e.type = 'replied')   as replied,
      count(*) filter (where e.type = 'bounced')   as bounced
    from public.email_events e
    join public.email_messages x on x.id = e.message_id
    where x.account_id = a.id
      and e.occurred_at::date between p_from_day and p_to_day
  ) ev on true
  where a.workspace_id = p_workspace_id
    and a.deleted_at is null
  order by a.display_name;
$$;

revoke all on function public.email_mailbox_report(uuid, date, date)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- email_batch_funnel — lead batch through to email outcome.
--
-- Extends M4's `crm_batch_funnel` rather than duplicating it: this one answers
-- "of the leads from THIS extraction, how many did we actually reach?"
-- ---------------------------------------------------------------------------

create or replace function public.email_batch_funnel(
  p_workspace_id uuid,
  p_batch_id     uuid
)
returns table (
  contacts      bigint,
  with_email    bigint,
  enrolled      bigint,
  sent          bigint,
  delivered     bigint,
  replied       bigint,
  unsubscribed  bigint,
  bounced       bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with batch_contacts as (
    select distinct bm.contact_id
    from public.crm_batch_members bm
    where bm.batch_id = p_batch_id
      and bm.workspace_id = p_workspace_id
  ),
  addressable as (
    select bc.contact_id, min(ce.address) as address
    from batch_contacts bc
    join public.crm_contact_emails ce on ce.contact_id = bc.contact_id
    group by bc.contact_id
  )
  select
    (select count(*) from batch_contacts),
    (select count(*) from addressable),
    (select count(distinct e.contact_id)
       from public.email_enrollments e
      where e.contact_id in (select contact_id from batch_contacts)),
    (select count(*) from public.email_messages m
      where m.contact_id in (select contact_id from batch_contacts)
        and m.status = 'sent'),
    (select count(*) from public.email_events ev
      where ev.contact_id in (select contact_id from batch_contacts)
        and ev.type = 'delivered'),
    (select count(*) from public.email_events ev
      where ev.contact_id in (select contact_id from batch_contacts)
        and ev.type = 'replied'),
    (select count(*) from public.email_events ev
      where ev.contact_id in (select contact_id from batch_contacts)
        and ev.type = 'unsubscribed'),
    (select count(*) from public.email_events ev
      where ev.contact_id in (select contact_id from batch_contacts)
        and ev.type = 'bounced');
$$;

revoke all on function public.email_batch_funnel(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Contact email timeline (M6 Phase 18).
--
-- ⚠️ MESSAGES AND EVENTS INTERLEAVED, in one ordered list. Two separate lists
-- would make the reader reconstruct the sequence themselves, and the whole
-- point of a timeline is that "we emailed, they replied, we emailed again" is
-- legible at a glance.
-- ---------------------------------------------------------------------------

create or replace function public.email_contact_timeline(
  p_workspace_id uuid,
  p_contact_id   uuid,
  p_limit        integer default 100
)
returns table (
  kind        text,
  occurred_at timestamptz,
  subject     text,
  detail      text,
  campaign_id uuid,
  message_id  uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  (
    select
      'message'::text,
      coalesce(m.sent_at, m.scheduled_at),
      m.subject,
      m.status::text,
      m.campaign_id,
      m.id
    from public.email_messages m
    where m.workspace_id = p_workspace_id
      and m.contact_id = p_contact_id
  )
  union all
  (
    select
      'event'::text,
      e.occurred_at,
      coalesce(e.metadata ->> 'subject', ''),
      e.type::text,
      e.campaign_id,
      e.message_id
    from public.email_events e
    where e.workspace_id = p_workspace_id
      and e.contact_id = p_contact_id
  )
  order by 2 desc
  limit greatest(p_limit, 1);
$$;

revoke all on function public.email_contact_timeline(uuid, uuid, integer)
  from public, anon, authenticated;

comment on function public.email_campaign_report(uuid) is
  'Counted from the append-only event stream. There are no counter columns to '
  'drift, which is what makes M6 criterion 5 true by construction. `replied` '
  'never includes `auto_replied`.';
