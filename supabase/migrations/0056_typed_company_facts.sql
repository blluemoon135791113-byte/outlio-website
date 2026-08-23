/*
 * Typed facts about a company, instead of a column per possible fact.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ WHY THIS IS NOT ELEVEN MORE COLUMNS.                                 ║
 * ║                                                                          ║
 * ║  The obvious design is `github_url`, `twitter_url`, `youtube_url`,       ║
 * ║  `crunchbase_url`, `pricing_url`, `careers_url`, `partner_url`… — one    ║
 * ║  column per link we might find. Every one of them would be NULL for the  ║
 * ║  large majority of companies, because a given company has three or four  ║
 * ║  of these, not eleven.                                                   ║
 * ║                                                                          ║
 * ║  That is the wall of "Not found" this project has already had to delete  ║
 * ║  once from the results panel, rebuilt in the schema where it is harder   ║
 * ║  to remove. It also means every new link kind is a migration.            ║
 * ║                                                                          ║
 * ║  A TYPE plus a VALUE holds only what exists. A company with a GitHub     ║
 * ║  org has a github row; one without has no row at all — not a NULL. New   ║
 * ║  kinds need no schema change, and the export can emit only the kinds     ║
 * ║  actually present in a given batch.                                      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

create table if not exists public.company_links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,

  /*
   * What KIND of link this is. Deliberately text with a check rather than an
   * enum: adding a kind to an enum requires a migration and a deploy, and the
   * whole point of this table is that a new kind should not.
   */
  kind        text not null check (kind in (
    -- Owned web presence
    'website', 'landing', 'product', 'pricing', 'careers', 'about', 'blog',
    -- Distribution and community
    'github', 'x', 'youtube', 'instagram', 'facebook', 'app_store', 'play_store',
    -- Third-party references
    'crunchbase', 'partner', 'press', 'other'
  )),

  url         text not null,
  /** Registrable host, so links can be grouped and deduped by site. */
  host        text not null,

  /*
   * ⚠️ HOW WE KNOW. A link read off a page the user opened is not the same
   * claim as one a provider asserted, and a reader deciding whether to trust
   * it needs to be able to tell.
   */
  source      text not null check (source in ('company_page', 'website', 'provider', 'derived')),
  source_url  text,

  observed_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

/* One row per link per company. Re-observing updates, never duplicates. */
create unique index if not exists company_links_unique
  on public.company_links (company_id, url);

create index if not exists company_links_lookup
  on public.company_links (user_id, company_id, kind);

/* "Every company with a GitHub org" must not be a full scan. */
create index if not exists company_links_kind
  on public.company_links (user_id, kind);

/*
 * Typed signals — the same argument, for facts that are not links.
 *
 * Headcount growth, open job count, follower count, founded year: each is
 * present for some companies and absent for most. A column each would be a
 * second wall of NULLs, and every new signal another migration.
 */
create table if not exists public.company_signals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,

  kind        text not null,

  /*
   * ⚠️ ONE OF THESE IS SET, NEVER BOTH. A numeric signal must stay numeric so
   * it can be summed, ranged and sorted in SQL — storing "1,200 employees" as
   * text is how a total becomes a string concatenation.
   */
  value_number  numeric,
  value_text    text,
  unit          text,

  source      text not null check (source in ('company_page', 'account_list', 'website', 'provider', 'derived')),
  source_url  text,

  /*
   * ⚠️ THE SAME SIGNAL AT TWO TIMES IS A TREND. Growth cannot be computed
   * from a single observation, so history is kept rather than overwritten —
   * which is why the unique index includes the observation date.
   */
  observed_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),

  constraint company_signals_has_a_value
    check (value_number is not null or value_text is not null)
);

create unique index if not exists company_signals_unique
  on public.company_signals (company_id, kind, (observed_at::date));

create index if not exists company_signals_lookup
  on public.company_signals (user_id, company_id, kind, observed_at desc);

/* ------------------------------------------------------------------------- *
 * RLS. CLAUDE.md rule 9: every table, no exceptions.
 * ------------------------------------------------------------------------- */

alter table public.company_links   enable row level security;
alter table public.company_signals enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['company_links', 'company_signals'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    /*
     * Read-only to the owner. Writes go through the service role, which
     * bypasses RLS and MUST scope by user_id in code — the same contract
     * every other service-role query in this codebase follows.
     */
    execute format(
      'create policy %I on public.%I for select using (auth.uid() = user_id)',
      t || '_owner', t
    );
  end loop;
end $$;

comment on table public.company_links is
  'Typed links for a company. A kind plus a value, so a company holds only '
  'the links it actually has — not eleven columns of which nine are NULL.';

comment on table public.company_signals is
  'Typed numeric or text signals. History is kept, not overwritten: the same '
  'signal at two dates is what makes a trend computable.';
