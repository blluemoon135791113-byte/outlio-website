-- 0083 — lead-batch funnel and pipeline totals (M4 Phase 10)
--
-- Both are SQL functions rather than TypeScript for the same two reasons.
--
-- ROUND TRIPS. The funnel is nine distinct-count questions about one set of
-- contacts. Asked separately that is nine queries per batch, and a batch list
-- of twenty becomes a hundred and eighty.
--
-- MONEY. Ledger D25: `value_amount` is `numeric` and must be summed in
-- Postgres. PostgREST hands JavaScript a double, which is fine for one value
-- and wrong for a total — and a pipeline total is exactly a total.

-- ---------------------------------------------------------------------------
-- crm_batch_funnel
--
-- M4 ACCEPTANCE CRITERION 4: ties a source batch to revenue end to end.
--
-- ⚠️ EVERY STEP COUNTS DISTINCT CONTACTS, so a person counted at one step is
-- counted at every later step they reach. Counting events instead would let a
-- funnel widen — four emails to one person would show more "emailed" than
-- "canonical", which is nonsense a reader cannot recover from.
--
-- `extracted` is the one step NOT drawn from the event stream: a source row
-- that identified nobody never became a contact, so only the batch itself
-- knows how many rows there were.
-- ---------------------------------------------------------------------------

create or replace function public.crm_batch_funnel(
  p_workspace_id uuid,
  p_batch_id     uuid
)
returns table (
  extracted        bigint,
  canonical        bigint,
  with_email       bigint,
  assigned         bigint,
  engaged          bigint,
  replied          bigint,
  qualified        bigint,
  call_booked      bigint,
  opportunities    bigint,
  won_deals        bigint,
  won_revenue      numeric
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with members as (
    select m.contact_id
      from public.crm_batch_members m
      join public.crm_contacts c
        on c.id = m.contact_id and c.workspace_id = p_workspace_id
     where m.workspace_id = p_workspace_id
       and m.batch_id = p_batch_id
       and c.deleted_at is null
  ),
  -- One pass over the batch's activities, reused by four steps below. Asking
  -- the same table four times would be four scans of the same rows.
  acts as (
    select a.contact_id, a.activity_type
      from public.crm_activities a
      join members m on m.contact_id = a.contact_id
     where a.workspace_id = p_workspace_id
  )
  select
    coalesce((select b.rows_seen from public.crm_lead_batches b
               where b.id = p_batch_id and b.workspace_id = p_workspace_id), 0)::bigint,
    (select count(*) from members),
    (select count(distinct e.contact_id)
       from public.crm_contact_emails e
       join members m on m.contact_id = e.contact_id
      where e.workspace_id = p_workspace_id and e.deleted_at is null),
    (select count(*) from members m
       join public.crm_contacts c on c.id = m.contact_id
      where c.owner_user_id is not null),
    (select count(distinct contact_id) from acts
      where activity_type in ('EMAIL_SENT', 'ENGAGEMENT', 'OPENER_SENT',
                              'PERSONALIZED_DM', 'FOLLOW_UP')),
    (select count(distinct contact_id) from acts where activity_type = 'EMAIL_REPLIED'),
    (select count(distinct contact_id) from acts where activity_type = 'QUALIFIED'),
    (select count(distinct contact_id) from acts where activity_type = 'CALL_BOOKED'),
    (select count(distinct o.contact_id)
       from public.crm_opportunities o
       join members m on m.contact_id = o.contact_id
      where o.workspace_id = p_workspace_id and o.deleted_at is null),
    (select count(*)
       from public.crm_opportunities o
       join members m on m.contact_id = o.contact_id
      where o.workspace_id = p_workspace_id and o.deleted_at is null
        and o.status = 'won'),
    -- Summed HERE, never in JavaScript.
    coalesce((select sum(o.value_amount)
       from public.crm_opportunities o
       join members m on m.contact_id = o.contact_id
      where o.workspace_id = p_workspace_id and o.deleted_at is null
        and o.status = 'won'), 0);
$$;

revoke all on function public.crm_batch_funnel(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- crm_pipeline_totals
--
-- Open pipeline and the weighted forecast, for a whole workspace or one owner.
--
-- ⚠️ `p_owner_user_id` NULL means EVERY owner, which is a manager's view. A
-- setter must always be passed their own id — the scope decision belongs to
-- `dataScope()` in the caller, and this function trusts what it is given.
-- ---------------------------------------------------------------------------

create or replace function public.crm_pipeline_totals(
  p_workspace_id    uuid,
  p_owner_user_id   uuid default null
)
returns table (
  open_deals       bigint,
  open_value       numeric,
  weighted_value   numeric,
  won_deals        bigint,
  won_value        numeric
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    count(*) filter (where o.status = 'open'),
    coalesce(sum(o.value_amount) filter (where o.status = 'open'), 0),
    /* The forecast: value × probability. Deterministic and credit-free —
       Ledger and M4 Phase 10.5 both require that it never involves Hubble.
       ROUNDED, because `numeric / 100.0` carries sixteen decimal places and a
       forecast reported to the ten-thousandth of a penny is noise pretending
       to be precision. */
    round(coalesce(sum(o.value_amount * o.probability / 100.0)
               filter (where o.status = 'open'), 0), 2),
    count(*) filter (where o.status = 'won'),
    coalesce(sum(o.value_amount) filter (where o.status = 'won'), 0)
  from public.crm_opportunities o
  where o.workspace_id = p_workspace_id
    and o.deleted_at is null
    and (p_owner_user_id is null or o.owner_user_id = p_owner_user_id);
$$;

revoke all on function public.crm_pipeline_totals(uuid, uuid)
  from public, anon, authenticated;

comment on function public.crm_batch_funnel(uuid, uuid) is
  'Every step counts DISTINCT contacts, so a funnel can only narrow. Counting '
  'events would let "emailed" exceed "canonical", which is nonsense a reader '
  'cannot recover from.';

comment on function public.crm_pipeline_totals(uuid, uuid) is
  'Money summed in Postgres, never in JavaScript (Ledger D25). A NULL owner '
  'means every owner — the scope decision belongs to the caller.';
