-- Smoke test for 0122 — does the tenancy boundary actually hold?
--
-- ⚠️ THE DESIGN'S WHOLE RISK IS HERE AND NOWHERE ELSE. A budget that spans
-- workspaces, on a schema where every other table is workspace-scoped, is an
-- invitation to leak. "Applies cleanly" proves nothing about it: RLS policies
-- and a security-definer body are exactly the things Postgres will create
-- happily and enforce differently than you expected.
--
-- Two workspaces, one shared sender, and three questions:
--   1. does the budget count the OTHER workspace's actions?     (it must)
--   2. can a member READ the other workspace's action rows?     (it must not)
--   3. can a stranger ask about a sender they have no link to?  (it must not)

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'ada@example.com'),
  ('b0000000-0000-0000-0000-000000000002', 'ben@example.com'),
  ('c0000000-0000-0000-0000-000000000003', 'cleo@example.com');

insert into public.workspaces (id, name, owner_user_id) values
  ('11111111-1111-1111-1111-111111111111', 'Workspace A', 'a0000000-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222', 'Workspace B', 'b0000000-0000-0000-0000-000000000002'),
  ('33333333-3333-3333-3333-333333333333', 'Workspace C', 'c0000000-0000-0000-0000-000000000003');

-- Ada belongs to A and B — the case §4.10 describes: one human, two customers.
-- Ben belongs to B ONLY, and he is the one isolation is tested with: Ada can
-- legitimately read both workspaces' rows because she is in both, so asserting
-- against her would have measured nothing.
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000001', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'b0000000-0000-0000-0000-000000000002', 'manager'),
  ('33333333-3333-3333-3333-333333333333', 'c0000000-0000-0000-0000-000000000003', 'owner');

insert into public.linkedin_senders (id, identity_key, owner_user_id, display_label, stage, status)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd',
        'linkedin.com/in/ada-okonkwo',
        'a0000000-0000-0000-0000-000000000001',
        'Ada Okonkwo', 2, 'owner_reviewed');

insert into public.linkedin_sender_links (workspace_id, sender_id, linked_by_user_id) values
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'a0000000-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'a0000000-0000-0000-0000-000000000001');

-- Three invitations from workspace A, four from workspace B.
insert into public.linkedin_sender_actions
  (sender_id, workspace_id, kind, lifecycle, logical_action_id)
select 'dddddddd-dddd-dddd-dddd-dddddddddddd',
       '11111111-1111-1111-1111-111111111111',
       'invitation', 'performed', 'a-' || g
  from generate_series(1, 3) g;

insert into public.linkedin_sender_actions
  (sender_id, workspace_id, kind, lifecycle, logical_action_id)
select 'dddddddd-dddd-dddd-dddd-dddddddddddd',
       '22222222-2222-2222-2222-222222222222',
       'invitation', 'performed', 'b-' || g
  from generate_series(1, 4) g;

-- One skipped and one unknown, to pin which lifecycles count.
insert into public.linkedin_sender_actions
  (sender_id, workspace_id, kind, lifecycle, logical_action_id) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111',
   'invitation', 'skipped', 'a-skipped'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111',
   'invitation', 'unknown', 'a-unknown');

do $$
declare
  v_used integer;
  v_rows integer;
  v_denied boolean := false;
begin
  -- ---------------------------------------------------------------------
  -- 1. BEN sees the shared total, and Ben is only in workspace B.
  --
  -- ⚠️ ASKED AS BEN, NOT ADA, AND THE FIRST VERSION GOT THIS WRONG. Ada
  -- belongs to both workspaces, so a budget that had been quietly scoped to
  -- the caller's own memberships would still have returned 8 for her — the
  -- assertion passed against a mutation that broke the whole design. Ben is in
  -- B alone, so 8 can only mean the count crossed the boundary.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"b0000000-0000-0000-0000-000000000002"}', true);

  v_used := public.linkedin_sender_used(
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'invitation', interval '7 days');

  -- A's 3 performed + B's 4 performed + A's 1 unknown = 8. Ben can see rows for
  -- only 4 of those. The skipped one released its slot.
  if v_used <> 8 then
    raise exception
      'FAIL: a member of workspace B alone got a budget of %, expected the shared 8', v_used;
  end if;

  -- ---------------------------------------------------------------------
  -- 2. Ben, who is in B only, reads B's rows and none of A's.
  --
  -- ⚠️ TESTED WITH BEN RATHER THAN ADA ON PURPOSE. Ada is a member of both
  -- workspaces, so reading both sets is CORRECT for her — asserting against
  -- her would have proved nothing, which is exactly how the first version of
  -- this test failed and was right to.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"b0000000-0000-0000-0000-000000000002"}', true);

  set local role authenticated;
  select count(*) into v_rows from public.linkedin_sender_actions;
  reset role;

  -- B's four rows, never A's five.
  if v_rows <> 4 then
    raise exception
      'FAIL: a member of workspace B read % action rows; B has 4 and must see no others',
      v_rows;
  end if;

  -- ---------------------------------------------------------------------
  -- 3. Cleo has no link to this sender and must not be able to probe it.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"c0000000-0000-0000-0000-000000000003"}', true);

  begin
    perform public.linkedin_sender_used(
      'dddddddd-dddd-dddd-dddd-dddddddddddd', 'invitation', interval '7 days');
  exception when insufficient_privilege then
    v_denied := true;
  end;

  if not v_denied then
    raise exception
      'FAIL: a user with no link to this sender learned its budget';
  end if;

  raise notice
    'PASS: budget shared across workspaces (8), rows isolated to B (4), stranger denied';
end
$$;

rollback;
