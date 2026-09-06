-- 0111 — a sender postal address, because commercial email must carry one
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PHASE 0 FINDING #2: THE STRING "postal address" DID NOT EXIST ANYWHERE  ║
-- ║  IN THIS CODEBASE.                                                       ║
-- ║                                                                           ║
-- ║  Not as a column, not as a form field, not as a TODO. CAN-SPAM            ║
-- ║  15 U.S.C. §7704(a)(5) requires a valid physical postal address in every  ║
-- ║  commercial email, and there was nowhere to put one.                      ║
-- ║                                                                           ║
-- ║  ⚠️ NOTHING NON-COMPLIANT HAS BEEN SENT. `email_accounts` held 0 rows     ║
-- ║  when Phase 0 measured it, so this is exposure ahead of us rather than    ║
-- ║  behind us — which is the only reason it is a migration and not an        ║
-- ║  incident. DECISION-04 is one app password away from changing that.       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

alter table public.workspaces
  add column if not exists sender_postal_address text
    check (sender_postal_address is null
           or length(trim(sender_postal_address)) between 10 and 500);

comment on column public.workspaces.sender_postal_address is
  'Physical postal address rendered in the footer of every bulk email. '
  'Required by CAN-SPAM 15 U.S.C. §7704(a)(5). NULLABLE at the column level '
  'so existing workspaces are not broken; enforced at CAMPAIGN LAUNCH instead '
  '— see lib/email/campaign-policy.ts. A not-null default here would have '
  'meant inventing an address, which is worse than having none.';

-- ---------------------------------------------------------------------------
-- ⚠️ NULLABLE ON PURPOSE, AND THE ALTERNATIVE WOULD HAVE BEEN WORSE.
--
-- Making this NOT NULL requires a backfill, and there is no honest value to
-- backfill with. An invented or placeholder address is not merely useless: a
-- WRONG postal address in a commercial email is its own §7704(a)(5) violation,
-- and it would look compliant to every check we could write.
--
-- So the column stays nullable and the requirement is enforced where it can be
-- enforced honestly — at the point a bulk campaign is launched, where there is
-- a human to ask. Transactional and manual mail is unaffected.
--
-- This is the same reasoning as CLAUDE.md rule 4: a missing value is NULL plus
-- a visible indicator, never a plausible guess.
-- ---------------------------------------------------------------------------

-- The owner must be able to set it. `protect_workspace_columns` pins id,
-- owner_user_id, member_limit_override and created_at on update; everything
-- else is already writable by a member with the right permission, so no change
-- to that trigger is needed. Asserted below rather than assumed.
do $$
declare
  body text;
begin
  select prosrc into body
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'protect_workspace_columns';

  if body is null then
    raise exception '0111 failed: protect_workspace_columns is missing';
  end if;

  if position('sender_postal_address' in body) > 0 then
    raise exception
      '0111 failed: protect_workspace_columns pins sender_postal_address, so an owner could never set it';
  end if;

  raise notice '0111: sender_postal_address added and is owner-writable';
end $$;
