-- Smoke test for 0127 — intake routing.
--
-- ⚠️ GATED, like 0126: every check is recorded through coalesce(..., false),
-- and the final block RAISES unless exactly the expected number were recorded
-- and all are true. A NULL result, a false one, or a check whose query found
-- no rows all fail the run.
--
-- ⚠️ THE ORDER OF THE ROUTING CALLS IS THE TEST. Each call changes somebody's
-- load, and the next call's answer depends on it. The sequence is designed so
-- that pool order, the workload cap, being away, not being a member and a
-- non-published rule each change a result — a check that would pass whether or
-- not the rule it names works is not a check.
--
-- Run it with:
--   scripts/check-migration.sh supabase/migrations/0127_crm_intake_routing.sql \
--     supabase/migrations/smoke/0127_crm_intake_routing.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
) on commit drop;

create temp table routed (
  label text primary key,
  res   jsonb not null
) on commit drop;

-- ---------------------------------------------------------------------------
-- People. M owns the workspace. A, B and C are setters; C is away. O is NOT a
-- member, and appears in the pool anyway.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'owner.m@example.com'),
  ('00000000-0000-4000-8000-0000000000a1', 'setter.a@example.com'),
  ('00000000-0000-4000-8000-0000000000b1', 'setter.b@example.com'),
  ('00000000-0000-4000-8000-0000000000c1', 'setter.c@example.com'),
  ('00000000-0000-4000-8000-0000000000f1', 'outsider.o@example.com');

insert into public.workspaces (id, name, owner_user_id) values
  ('11111111-1111-4111-8111-111111111111', 'Routing', '00000000-0000-4000-8000-00000000000a'),
  ('22222222-2222-4222-8222-222222222222', 'Other',   '00000000-0000-4000-8000-00000000000a');

insert into public.workspace_memberships (workspace_id, user_id, role, away_until) values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-00000000000a', 'owner',  null),
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000a1', 'setter', null),
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000b1', 'setter', null),
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000c1', 'setter', now() + interval '1 day'),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-4000-8000-00000000000a', 'owner',  null);

-- co1 is owned by B. co2 has no owner.
-- crm_companies_has_identity requires a normalized domain, LinkedIn URL or name.
insert into public.crm_companies (id, workspace_id, name, normalized_name, owner_user_id, source) values
  ('c0c00000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Owned Co',   'owned co',   '00000000-0000-4000-8000-0000000000b1', 'csv_import'),
  ('c0c00000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Unowned Co', 'unowned co', null,                                   'csv_import');

/*
 * Contacts. k6 is ALREADY owned by A, which starts A's load at 1.
 * k1 works at co1, k7 at co2; the rest have no company.
 */
insert into public.crm_contacts (id, workspace_id, full_name, owner_user_id, primary_company_id, source) values
  ('c0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'K1', null, 'c0c00000-0000-4000-8000-000000000001', 'csv_import'),
  ('c0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'K2', null, null, 'csv_import'),
  ('c0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'K3', null, null, 'csv_import'),
  ('c0000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'K4', null, null, 'csv_import'),
  ('c0000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'K5', null, null, 'csv_import'),
  ('c0000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'K6', '00000000-0000-4000-8000-0000000000a1', null, 'csv_import'),
  ('c0000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'K7', null, 'c0c00000-0000-4000-8000-000000000002', 'csv_import'),
  ('c0000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', 'K8', null, null, 'csv_import'),
  ('c0000000-0000-4000-8000-000000000020', '22222222-2222-4222-8222-222222222222', 'K20', null, null, 'lead_engine');

-- ---------------------------------------------------------------------------
-- Rule shape constraints
-- ---------------------------------------------------------------------------
do $$
declare v boolean := false;
begin
  begin
    insert into public.crm_routing_rules (workspace_id, name, kind, status)
    values ('11111111-1111-4111-8111-111111111111', 'bad', 'named_user', 'draft');
  exception when check_violation then v := true;
  end;
  insert into smoke_checks (label, ok) values ('a named_user rule without a user is refused', v);
end $$;

do $$
declare v boolean := false;
begin
  begin
    insert into public.crm_routing_rules (workspace_id, name, kind, member_ids, status)
    values ('11111111-1111-4111-8111-111111111111', 'bad', 'pool', '{}', 'draft');
  exception when check_violation then v := true;
  end;
  insert into smoke_checks (label, ok) values ('a pool with no members is refused', v);
end $$;

do $$
declare v boolean := false;
begin
  begin
    insert into public.crm_routing_rules (workspace_id, name, kind, sources, status)
    values ('11111111-1111-4111-8111-111111111111', 'bad', 'company_owner',
            array['manual']::public.crm_record_source[], 'draft');
  exception when check_violation then v := true;
  end;
  insert into smoke_checks (label, ok) values ('manual intake can never be a rule source', v);
end $$;

-- ---------------------------------------------------------------------------
-- Rules for "Routing". Position 0 holds three rules that would ALL route to M
-- if they were used: a draft, an archived one and a deleted one. The published
-- rules are 1 (company owner) and 2 (pool: C away, O not a member, A, B; cap 3).
-- ---------------------------------------------------------------------------
insert into public.crm_routing_rules (id, workspace_id, name, position, kind, user_id, member_ids, max_open_workload, status, published_at, deleted_at) values
  ('7a1e0000-0000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'Draft to M',    0, 'named_user', '00000000-0000-4000-8000-00000000000a', '{}', null, 'draft',     null,  null),
  ('7a1e0000-0000-4000-8000-0000000000a0', '11111111-1111-4111-8111-111111111111', 'Archived to M', 0, 'named_user', '00000000-0000-4000-8000-00000000000a', '{}', null, 'archived',  null,  null),
  ('7a1e0000-0000-4000-8000-0000000000d0', '11111111-1111-4111-8111-111111111111', 'Deleted to M',  0, 'named_user', '00000000-0000-4000-8000-00000000000a', '{}', null, 'published', now(), now()),
  ('7a1e0000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Company owner', 1, 'company_owner', null, '{}', null, 'published', now(), null),
  ('7a1e0000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Setter pool',   2, 'pool', null,
     array['00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000f1',
           '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1']::uuid[],
     3, 'published', now(), null);

-- "Other" routes csv_import only.
insert into public.crm_routing_rules (id, workspace_id, name, position, kind, user_id, sources, status, published_at) values
  ('7a1e0000-0000-4000-8000-000000000020', '22222222-2222-4222-8222-222222222222', 'CSV only', 1, 'named_user',
   '00000000-0000-4000-8000-00000000000a', array['csv_import']::public.crm_record_source[], 'published', now());

-- ---------------------------------------------------------------------------
-- The routing sequence. Loads before: A=1 (k6), B=0, C=0 (away).
-- ---------------------------------------------------------------------------
insert into routed values ('k1', public.crm_route_contact('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001', 'test:k1', 'csv_import'));  -- company owner B  → B=1
insert into routed values ('k2', public.crm_route_contact('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000002', 'test:k2', 'csv_import'));  -- A=1,B=1 tie → A  → A=2
insert into routed values ('k3', public.crm_route_contact('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000003', 'test:k3', 'csv_import'));  -- A=2,B=1 → B      → B=2
insert into routed values ('k4', public.crm_route_contact('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000004', 'test:k4', 'csv_import'));  -- A=2,B=2 tie → A  → A=3 (cap)
insert into routed values ('k5', public.crm_route_contact('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000005', 'test:k5', 'csv_import'));  -- A capped → B     → B=3 (cap)
insert into routed values ('k8', public.crm_route_contact('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000008', 'test:k8', 'csv_import'));  -- both capped → unassigned
insert into routed values ('k7', public.crm_route_contact('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000007', 'test:k7', 'csv_import'));  -- company unowned, pool capped
insert into routed values ('k6', public.crm_route_contact('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000006', 'test:k6', 'csv_import'));  -- already owned by A

insert into smoke_checks (label, ok)
select 'k1 goes to its company''s owner by the first published rule',
       coalesce((select owner_user_id from public.crm_contacts where id = 'c0000000-0000-4000-8000-000000000001')
                = '00000000-0000-4000-8000-0000000000b1'
                and res ->> 'rule_id' = '7a1e0000-0000-4000-8000-000000000001', false)
  from routed where label = 'k1';

insert into smoke_checks (label, ok)
select 'k1''s decision records rule, version, a pool of one, and a real OWNER_ASSIGNED activity',
       coalesce(d.rule_id = '7a1e0000-0000-4000-8000-000000000001' and d.rule_version = 1
                and d.eligible_pool = array['00000000-0000-4000-8000-0000000000b1']::uuid[]
                and d.rule_snapshot ->> 'kind' = 'company_owner'
                and exists (select 1 from public.crm_activities a
                             where a.id = d.activity_id and a.activity_type = 'OWNER_ASSIGNED'
                               and a.contact_id = d.contact_id), false)
  from public.crm_routing_decisions d where d.intake_key = 'test:k1';

insert into smoke_checks (label, ok)
select 'no decision cites a draft, archived or deleted rule',
       not exists (select 1 from public.crm_routing_decisions
                    where rule_id in ('7a1e0000-0000-4000-8000-000000000000',
                                      '7a1e0000-0000-4000-8000-0000000000a0',
                                      '7a1e0000-0000-4000-8000-0000000000d0'))
       and not exists (select 1 from public.crm_contacts
                        where workspace_id = '11111111-1111-4111-8111-111111111111'
                          and owner_user_id = '00000000-0000-4000-8000-00000000000a');

insert into smoke_checks (label, ok)
select 'k2 has no company, so rule 1 records why and the pool takes it',
       coalesce(d.outcome = 'assigned' and d.rule_id = '7a1e0000-0000-4000-8000-000000000002'
                and d.evaluated @> '[{"reason": "contact_has_no_company"}]'::jsonb, false)
  from public.crm_routing_decisions d where d.intake_key = 'test:k2';

insert into smoke_checks (label, ok)
select 'k2: an away member and a non-member are not in the eligible pool',
       coalesce(d.eligible_pool = array['00000000-0000-4000-8000-0000000000a1',
                                        '00000000-0000-4000-8000-0000000000b1']::uuid[], false)
  from public.crm_routing_decisions d where d.intake_key = 'test:k2';

insert into smoke_checks (label, ok)
select 'k2: a tie on load breaks on the order the rule lists people (A before B)',
       coalesce(owner_user_id = '00000000-0000-4000-8000-0000000000a1', false)
  from public.crm_contacts where id = 'c0000000-0000-4000-8000-000000000002';

insert into smoke_checks (label, ok)
select 'k3: the least loaded eligible member wins (B)',
       coalesce(owner_user_id = '00000000-0000-4000-8000-0000000000b1', false)
  from public.crm_contacts where id = 'c0000000-0000-4000-8000-000000000003';

insert into smoke_checks (label, ok)
select 'k5: a member at the workload cap is left out of the pool and not chosen',
       coalesce(c.owner_user_id = '00000000-0000-4000-8000-0000000000b1'
                and d.eligible_pool = array['00000000-0000-4000-8000-0000000000b1']::uuid[], false)
  from public.crm_contacts c
  join public.crm_routing_decisions d on d.contact_id = c.id and d.intake_key = 'test:k5'
 where c.id = 'c0000000-0000-4000-8000-000000000005';

insert into smoke_checks (label, ok)
select 'k8: with everyone capped it stays unassigned — never handed to the workspace owner',
       coalesce(d.outcome = 'unassigned' and d.chosen_owner is null
                and (select owner_user_id from public.crm_contacts
                      where id = 'c0000000-0000-4000-8000-000000000008') is null, false)
  from public.crm_routing_decisions d where d.intake_key = 'test:k8';

insert into smoke_checks (label, ok)
select 'k8: the unassigned decision explains itself, one entry per rule tried',
       coalesce(d.reason = 'no_eligible_owner' and jsonb_array_length(d.evaluated) = 2, false)
  from public.crm_routing_decisions d where d.intake_key = 'test:k8';

insert into smoke_checks (label, ok)
select 'k8: an unassigned decision writes no activity',
       not exists (select 1 from public.crm_activities
                    where contact_id = 'c0000000-0000-4000-8000-000000000008'
                      and activity_type = 'OWNER_ASSIGNED');

insert into smoke_checks (label, ok)
select 'k7: a company with no owner falls through, and says so',
       coalesce(d.outcome = 'unassigned'
                and d.evaluated @> '[{"reason": "company_has_no_owner"}]'::jsonb, false)
  from public.crm_routing_decisions d where d.intake_key = 'test:k7';

insert into smoke_checks (label, ok)
select 'k6: an already-owned lead keeps its owner and records already_owned',
       coalesce(d.outcome = 'already_owned'
                and (select owner_user_id from public.crm_contacts
                      where id = 'c0000000-0000-4000-8000-000000000006')
                    = '00000000-0000-4000-8000-0000000000a1', false)
  from public.crm_routing_decisions d where d.intake_key = 'test:k6';

insert into smoke_checks (label, ok)
select 'k6: an already-owned lead gets no OWNER_ASSIGNED',
       not exists (select 1 from public.crm_activities
                    where contact_id = 'c0000000-0000-4000-8000-000000000006'
                      and activity_type = 'OWNER_ASSIGNED');

-- ---------------------------------------------------------------------------
-- Once per intake
-- ---------------------------------------------------------------------------
insert into routed values ('k2-again', public.crm_route_contact('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000002', 'test:k2', 'csv_import'));

insert into smoke_checks (label, ok)
select 'the same intake key replays the first decision',
       coalesce((res ->> 'replayed')::boolean and res ->> 'outcome' = 'assigned'
                and res ->> 'chosen_owner' = '00000000-0000-4000-8000-0000000000a1', false)
  from routed where label = 'k2-again';

insert into smoke_checks (label, ok)
select 'the replay wrote no second decision and no second activity',
       (select count(id) from public.crm_routing_decisions
         where contact_id = 'c0000000-0000-4000-8000-000000000002') = 1
       and (select count(id) from public.crm_activities
             where contact_id = 'c0000000-0000-4000-8000-000000000002'
               and activity_type = 'OWNER_ASSIGNED') = 1;

do $$
declare v boolean := false;
begin
  begin
    insert into public.crm_routing_decisions (workspace_id, contact_id, intake_key, source, outcome, reason)
    values ('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000003',
            'test:k2', 'csv_import', 'already_owned', 'already_owned');
  exception when unique_violation then v := true;
  end;
  insert into smoke_checks (label, ok) values ('the table itself refuses a second decision for one intake key', v);
end $$;

-- ---------------------------------------------------------------------------
-- A later review, after C comes back (F02: retry after an availability change)
-- ---------------------------------------------------------------------------
update public.workspace_memberships
   set away_until = now() - interval '1 second'
 where workspace_id = '11111111-1111-4111-8111-111111111111'
   and user_id = '00000000-0000-4000-8000-0000000000c1';

insert into routed values ('k8-review', public.crm_route_contact('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000008', 'review:k8', 'csv_import'));

insert into smoke_checks (label, ok)
select 'after C returns, a new review routes k8 to C, and both decisions are kept',
       coalesce((select owner_user_id from public.crm_contacts where id = 'c0000000-0000-4000-8000-000000000008')
                = '00000000-0000-4000-8000-0000000000c1'
                and (select count(id) from public.crm_routing_decisions
                      where contact_id = 'c0000000-0000-4000-8000-000000000008') = 2, false);

-- ---------------------------------------------------------------------------
-- Source filters and manual intake
-- ---------------------------------------------------------------------------
insert into routed values ('k20', public.crm_route_contact('22222222-2222-4222-8222-222222222222', 'c0000000-0000-4000-8000-000000000020', 'test:k20', 'lead_engine'));

insert into smoke_checks (label, ok)
select 'a rule for csv_import does not route extractor intake: no_rule_matched',
       coalesce(d.outcome = 'unassigned' and d.reason = 'no_rule_matched'
                and jsonb_array_length(d.evaluated) = 0, false)
  from public.crm_routing_decisions d where d.intake_key = 'test:k20';

do $$
declare v boolean := false;
begin
  begin
    perform public.crm_route_contact('11111111-1111-4111-8111-111111111111',
      'c0000000-0000-4000-8000-000000000003', 'test:manual', 'manual');
  exception when invalid_parameter_value then v := true;
  end;
  insert into smoke_checks (label, ok) values ('routing manual intake is refused outright', v);
end $$;

-- ---------------------------------------------------------------------------
-- A batch: routes only what it CREATED
-- ---------------------------------------------------------------------------
insert into public.crm_lead_batches (id, workspace_id, name, source)
values ('ba7c0000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Batch', 'lead_engine');

insert into public.crm_contacts (id, workspace_id, full_name, owner_user_id, source) values
  ('c0000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', 'K9 new',     null, 'lead_engine'),
  ('c0000000-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111', 'K10 matched', null, 'csv_import'),
  ('c0000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', 'K11 owned',  '00000000-0000-4000-8000-00000000000a', 'lead_engine');

insert into public.crm_batch_members (batch_id, workspace_id, contact_id, created_contact) values
  ('ba7c0000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000009', true),
  ('ba7c0000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000010', false),
  ('ba7c0000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000011', true);

insert into routed values ('batch',       public.crm_route_batch('11111111-1111-4111-8111-111111111111', 'ba7c0000-0000-4000-8000-000000000001'));
insert into routed values ('batch-again', public.crm_route_batch('11111111-1111-4111-8111-111111111111', 'ba7c0000-0000-4000-8000-000000000001'));

insert into smoke_checks (label, ok)
select 'a batch never routes a contact it only matched',
       not exists (select 1 from public.crm_routing_decisions
                    where contact_id = 'c0000000-0000-4000-8000-000000000010')
       and (select owner_user_id from public.crm_contacts
             where id = 'c0000000-0000-4000-8000-000000000010') is null;

insert into smoke_checks (label, ok)
select 'batch counts: one assigned (to C, least loaded), one already owned, none unassigned',
       coalesce((res ->> 'assigned')::int = 1 and (res ->> 'already_owned')::int = 1
                and (res ->> 'unassigned')::int = 0
                and (select owner_user_id from public.crm_contacts
                      where id = 'c0000000-0000-4000-8000-000000000009')
                    = '00000000-0000-4000-8000-0000000000c1', false)
  from routed where label = 'batch';

insert into smoke_checks (label, ok)
select 'the batch lists exactly the one new assignment to announce',
       coalesce(jsonb_array_length(res -> 'assignments') = 1
                and res -> 'assignments' -> 0 ->> 'contact_id' = 'c0000000-0000-4000-8000-000000000009', false)
  from routed where label = 'batch';

insert into smoke_checks (label, ok)
select 'replaying the batch assigns nothing new and lists nothing to announce',
       coalesce(jsonb_array_length(res -> 'assignments') = 0
                and (select count(id) from public.crm_activities
                      where contact_id = 'c0000000-0000-4000-8000-000000000009'
                        and activity_type = 'OWNER_ASSIGNED') = 1, false)
  from routed where label = 'batch-again';

-- ---------------------------------------------------------------------------
-- Flow round-robin now skips an owned contact
-- ---------------------------------------------------------------------------
insert into routed values ('rr-owned', public.crm_round_robin_assign('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000011',
  array['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1']::uuid[]));
insert into routed values ('rr-free', public.crm_round_robin_assign('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000010',
  array['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1']::uuid[]));

insert into smoke_checks (label, ok)
select 'round robin skips an owned contact and leaves its owner alone',
       coalesce((res ->> 'skipped')::boolean and res ->> 'reason' = 'already_owned'
                and (select owner_user_id from public.crm_contacts
                      where id = 'c0000000-0000-4000-8000-000000000011')
                    = '00000000-0000-4000-8000-00000000000a', false)
  from routed where label = 'rr-owned';

insert into smoke_checks (label, ok)
select 'round robin still assigns an unowned contact',
       coalesce((res ->> 'changed')::boolean and res ->> 'assigned_to' is not null
                and (select owner_user_id from public.crm_contacts
                      where id = 'c0000000-0000-4000-8000-000000000010') is not null, false)
  from routed where label = 'rr-free';

-- ---------------------------------------------------------------------------
-- Rules keep a version; decisions keep what they said
-- ---------------------------------------------------------------------------
update public.crm_routing_rules set name = 'Company owner (renamed)'
 where id = '7a1e0000-0000-4000-8000-000000000001';

insert into smoke_checks (label, ok)
select 'editing a rule bumps its version, and k1''s decision still cites version 1',
       coalesce(r.version = 2
                and (select rule_version from public.crm_routing_decisions where intake_key = 'test:k1') = 1
                and (select rule_snapshot ->> 'name' from public.crm_routing_decisions where intake_key = 'test:k1') = 'Company owner', false)
  from public.crm_routing_rules r where r.id = '7a1e0000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Append-only, and erasure
-- ---------------------------------------------------------------------------
do $$
declare v boolean := false;
begin
  begin
    update public.crm_routing_decisions set reason = 'rewritten' where intake_key = 'test:k1';
  exception when restrict_violation then v := true;
  end;
  insert into smoke_checks (label, ok) values ('a routing decision cannot be rewritten', v);
end $$;

do $$
declare v boolean := false;
begin
  begin
    delete from public.crm_routing_decisions where intake_key = 'test:k1';
  exception when restrict_violation then v := true;
  end;
  insert into smoke_checks (label, ok) values ('a routing decision cannot be deleted outside erasure', v);
end $$;

select public.crm_erase_contact('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000006', null, 'smoke');

insert into smoke_checks (label, ok)
select 'erasing a contact removes its routing decisions with it',
       not exists (select 1 from public.crm_routing_decisions
                    where contact_id = 'c0000000-0000-4000-8000-000000000006');

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------
insert into smoke_checks (label, ok)
select 'signed-in users cannot run routing or write decisions or rules',
       not has_function_privilege('authenticated', 'public.crm_route_contact(uuid,uuid,text,public.crm_record_source)', 'execute')
       and not has_function_privilege('authenticated', 'public.crm_route_batch(uuid,uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.crm_round_robin_assign(uuid,uuid,uuid[])', 'execute')
       and not has_table_privilege('authenticated', 'public.crm_routing_decisions', 'insert')
       and not has_table_privilege('authenticated', 'public.crm_routing_rules', 'insert');

insert into smoke_checks (label, ok)
select 'the service role may read and insert decisions but never update them',
       has_table_privilege('service_role', 'public.crm_routing_decisions', 'select')
       and has_table_privilege('service_role', 'public.crm_routing_decisions', 'insert')
       and not has_table_privilege('service_role', 'public.crm_routing_decisions', 'update')
       and not has_table_privilege('service_role', 'public.crm_routing_decisions', 'delete')
       and has_function_privilege('service_role', 'public.crm_route_batch(uuid,uuid)', 'execute');

insert into smoke_checks (label, ok)
select 'both new tables have row level security on',
       coalesce((select bool_and(c.relrowsecurity) from pg_class c
                   join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public'
                    and c.relname in ('crm_routing_rules', 'crm_routing_decisions')), false);

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 36;
  v_total    integer;
  v_failed   text;
begin
  select count(n), string_agg(label, '; ' order by n) filter (where ok is not true)
    into v_total, v_failed
    from smoke_checks;

  /*
   * ⚠️ THE COUNT IS PART OF THE TEST. A check whose query matched no rows
   * inserts nothing and would pass by being absent.
   */
  if v_total <> v_expected then
    raise exception 'SMOKE FAILED: expected % checks, recorded %', v_expected, v_total;
  end if;

  if v_failed is not null then
    raise exception 'SMOKE FAILED: %', v_failed;
  end if;

  raise notice 'SMOKE PASSED: % of % checks', v_total, v_expected;
end $$;

rollback;
