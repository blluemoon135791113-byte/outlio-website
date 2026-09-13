-- ---------------------------------------------------------------------------
-- 0121 — do-not-contact as a fact about a PERSON, and the recipient's timezone.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  A CONTACT WITH NO EMAIL ADDRESS COULD NOT BE SUPPRESSED AT ALL.          ║
-- ║                                                                           ║
-- ║  `email_suppressions.email` is `not null`, so every do-not-contact in the  ║
-- ║  product had to be expressed as an address. A LinkedIn-only contact —      ║
-- ║  which is most of what the Lead Engine produces before enrichment — has    ║
-- ║  no address, so "do not contact this person" was unrecordable.            ║
-- ║                                                                           ║
-- ║  That blocks §4.11's `Mark DNC` control outright: the one thing an         ║
-- ║  operator must always be able to do after a hostile reply is the one thing ║
-- ║  the schema could not represent.                                          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ A SECOND TABLE, NOT A SECOND SOURCE OF TRUTH. `email_suppressions` stays
-- and is still authoritative for ADDRESSES — a one-click unsubscribe arrives
-- for an address that may resolve to no contact at all, or to an ambiguous
-- shared inbox, and that fact has to be storable exactly as observed. This
-- table is authoritative for PEOPLE. They answer different questions and
-- neither can express the other's case.
--
-- The rule that keeps them from diverging is on the read side, not the write
-- side: `lib/crm/contact-stop.ts` is the ONE predicate both channels call, and
-- it consults both. Nothing else may ask this question.
--
-- ⚠️ CHANNEL, NOT BRAND. §4.15 wants an opt-out's scope "respected exactly",
-- and it describes two axes: channel and brand/program. Only channel is
-- modelled here, because the program configurations that would give "brand" a
-- meaning (§4.3) do not exist yet, and a column whose values nothing can
-- produce is the kind of promise this codebase keeps having to withdraw. When
-- programs land, a brand scope is an additive column and a widened unique
-- index.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_contact_dnc_scope') then
    create type public.crm_contact_dnc_scope as enum ('all', 'email', 'linkedin');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_contact_dnc_reason') then
    -- Deliberately distinct values. §4.11 separates R06 "not interested" from
    -- R07 "explicit stop / removal request": the first suppresses prospecting,
    -- the second routes into the privacy process, and collapsing them would
    -- lose the distinction that decides which.
    create type public.crm_contact_dnc_reason as enum (
      'unsubscribed',
      'not_interested',
      'explicit_request',
      'hostile',
      'privacy_request',
      'manual'
    );
  end if;
end
$$;

create table if not exists public.crm_contact_suppressions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id   uuid not null references public.crm_contacts(id) on delete cascade,

  -- `all` is the default on purpose. §4.15: an ambiguous "do not contact me"
  -- defaults to workspace-wide proactive suppression pending review. The safe
  -- reading of an unclear request is the broader one.
  scope        public.crm_contact_dnc_scope   not null default 'all',
  reason       public.crm_contact_dnc_reason  not null,

  -- Free-text provenance: the reply it came from, the operator who recorded
  -- it, the campaign. Never the message body — CLAUDE.md forbids logging
  -- contact content, and the same reasoning applies to storing it here.
  source       text,

  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null
);

-- ⚠️ ONE ROW PER (CONTACT, SCOPE), AND THE FIRST REASON WINS ON CONFLICT.
-- Mirrors `email_suppressions_workspace_email_idx`'s reasoning: if somebody
-- asked to be removed and later a bounce arrives, "explicit_request" is the
-- fact that matters — it is a stated wish, not a delivery accident, and
-- overwriting it would lose consent provenance.
create unique index if not exists crm_contact_suppressions_contact_scope_idx
  on public.crm_contact_suppressions (workspace_id, contact_id, scope);

-- The predicate the send path scans on: "is this person stopped for email?"
create index if not exists crm_contact_suppressions_lookup_idx
  on public.crm_contact_suppressions (workspace_id, contact_id, scope, created_at desc);

alter table public.crm_contact_suppressions enable row level security;

drop policy if exists crm_contact_suppressions_select_member
  on public.crm_contact_suppressions;

create policy crm_contact_suppressions_select_member
  on public.crm_contact_suppressions
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

revoke all on table public.crm_contact_suppressions from public, anon, authenticated;
grant select on table public.crm_contact_suppressions to authenticated;
grant select, insert, update, delete on table public.crm_contact_suppressions to service_role;

-- ---------------------------------------------------------------------------
-- The recipient's timezone — DECISION-20, and §4.8's timing table.
--
-- ⚠️ THE FIRST LINK OF A FALLBACK CHAIN THAT HAD NOWHERE TO READ FROM. §5.7
-- specifies "contact.timezone when known, else campaign timezone, else
-- workspace timezone", and `lib/email/schedule.ts` already implements careful
-- IANA/DST-correct window maths against the MAILBOX's zone. This column is the
-- only missing input.
--
-- Nullable, and nullable means *unknown* rather than UTC. §4.8 requires the
-- campaign fallback to be shown explicitly when the recipient's zone is not
-- known; defaulting to a zone would make an assumption look like a fact.
-- ---------------------------------------------------------------------------
alter table public.crm_contacts
  add column if not exists timezone text;

-- A cheap sanity check, not a full IANA validation: Postgres cannot know the
-- tz database without an extension, and a CHECK that rejected a legitimate new
-- zone would be worse than one that lets a typo through to the application's
-- own validation.
alter table public.crm_contacts
  drop constraint if exists crm_contacts_timezone_shape;

alter table public.crm_contacts
  add constraint crm_contacts_timezone_shape
  check (timezone is null or timezone ~ '^[A-Za-z][A-Za-z0-9+_/-]{1,63}$');

comment on table public.crm_contact_suppressions is
  'Do-not-contact recorded against a PERSON. email_suppressions remains '
  'authoritative for addresses; lib/crm/contact-stop.ts is the one predicate '
  'that reads both (0121).';

comment on column public.crm_contacts.timezone is
  'IANA zone for the recipient, or null for unknown. Never defaulted — an '
  'assumed zone would look like an observed one (0121).';
