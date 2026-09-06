/*
 * Ask Hubble — the retrieval layer.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS SITS ON TOP OF WHAT ALREADY EXISTS. IT REPLACES NOTHING.           ║
 * ║                                                                          ║
 * ║  `research_evidence` (0044) still owns FIELD-SHAPED facts — the ones the ║
 * ║  fixed provider catalog fills. These tables own the open-ended half: the ║
 * ║  pages Hubble read, the passages it retrieved, and the answers it gave.  ║
 * ║  A question about funding should still be served by the provider that    ║
 * ║  already answers it; only a question no field covers reaches here.       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

/*
 * A page Hubble fetched, cleaned, and kept.
 *
 * ⚠️ KEYED BY COMPANY, NOT BY LEAD. Ten leads at the same company must not
 * cause ten fetches of the same about page. `company_id` is the dedup axis and
 * `companies` is already normalised by domain (lib/companies/normalize.ts), so
 * this inherits that dedup for free.
 */
create table if not exists public.hubble_pages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  /* NULL for a page found while researching a person with no known company. */
  company_id    uuid references public.companies(id) on delete cascade,

  url           text not null,
  /* Host kept separately so a domain's pages can be swept without a LIKE. */
  host          text not null,
  title         text,
  /* Readable text after boilerplate removal. Never raw HTML — see below. */
  content       text not null,
  /*
   * ⚠️ RAW HTML IS DELIBERATELY NOT STORED.
   *
   * CLAUDE.md rule 3 forbids ever rendering fetched HTML. Keeping only the
   * extracted text means there is no stored markup for a future careless
   * `dangerouslySetInnerHTML` to find.
   */
  content_chars integer not null check (content_chars >= 0),

  /* What deterministic code pulled out before any model ran: JSON-LD, emails,
   * social links, headings. Code first, model second. */
  structured    jsonb not null default '{}'::jsonb,

  /* 'fetch' or 'browser' — which fetcher was needed. Playwright is expensive
   * and its use should be visible, not silent. */
  fetch_method  text not null default 'fetch'
                  check (fetch_method in ('fetch', 'browser')),
  http_status   integer,

  fetched_at    timestamptz not null default now(),
  /* Cache horizon. A page past this is refetched rather than reused. */
  expires_at    timestamptz,

  created_at    timestamptz not null default now()
);

/* One row per URL per user: the cache lookup, and the dedup constraint. */
create unique index if not exists hubble_pages_user_url_key
  on public.hubble_pages (user_id, url);

create index if not exists hubble_pages_company_idx
  on public.hubble_pages (user_id, company_id, fetched_at desc);

/*
 * A passage of a page, with its embedding.
 *
 * ⚠️ THE WHOLE POINT IS THAT THE MODEL NEVER SEES THE WHOLE PAGE. Retrieval
 * selects a handful of these; only they reach the LLM. Sending a full site
 * would be slower, costlier, and no more accurate.
 */
create table if not exists public.hubble_chunks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  page_id     uuid not null references public.hubble_pages(id) on delete cascade,
  company_id  uuid references public.companies(id) on delete cascade,

  /* Position in the page, so retrieved passages can be shown in order. */
  ordinal     integer not null check (ordinal >= 0),
  content     text not null,

  /*
   * ⚠️ NULLABLE ON PURPOSE — EMBEDDINGS ARE AN UPGRADE, NOT A REQUIREMENT.
   *
   * Ollama may not be installed. When it is absent this stays NULL and
   * retrieval falls back to lexical scoring, which needs no service and no
   * model. Hubble degrades to a worse ranker, never to no answer.
   *
   * Stored as float array rather than `vector` so the table works whether or
   * not pgvector is present; 0056 can add a typed column and an ANN index
   * once availability is confirmed.
   */
  embedding   double precision[],
  /* Which model produced `embedding`. Mixing models in one index silently
   * ruins similarity, so a change of model must be detectable. */
  embed_model text,

  created_at  timestamptz not null default now()
);

create index if not exists hubble_chunks_page_idx
  on public.hubble_chunks (page_id, ordinal);

create index if not exists hubble_chunks_company_idx
  on public.hubble_chunks (user_id, company_id);

/* Lexical retrieval's index — the fallback path when there is no embedding. */
create index if not exists hubble_chunks_fts_idx
  on public.hubble_chunks using gin (to_tsvector('english', content));

/*
 * An answer Hubble gave, kept so the next question can reuse it.
 *
 * ⚠️ THE CACHE THE SPEC ASKS FOR. Before any research runs, this is consulted:
 * a question already answered for this company is answered from here.
 */
create table if not exists public.hubble_answers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  lead_id       uuid,
  company_id    uuid references public.companies(id) on delete cascade,

  question      text not null,
  /* Normalised question, for cache lookup: lowercased, collapsed, stripped. */
  question_key  text not null,
  answer        text not null,

  /*
   * ⚠️ EVERY ANSWER CARRIES ITS EPISTEMIC STATUS.
   *
   * verified    = a retrieved source states it outright
   * corroborated= two independent sources agree
   * estimated   = derived or inferred, and must be shown as such
   * unknown     = research ran and found nothing. NOT an error, and NOT absence
   *               of an answer — "we looked and could not confirm" is a result.
   */
  status        text not null default 'unknown'
                  check (status in ('verified', 'corroborated', 'estimated', 'unknown')),
  confidence    numeric(4, 3) not null default 0.500
                  check (confidence >= 0 and confidence <= 1),

  /* [{url, title, quote}] — what the answer was built from. */
  sources       jsonb not null default '[]'::jsonb,
  /* Budget actually consumed: searches, fetches, llm calls, ms. */
  usage         jsonb not null default '{}'::jsonb,

  research_run_id uuid references public.research_runs(id) on delete set null,

  created_at    timestamptz not null default now(),
  expires_at    timestamptz
);

create index if not exists hubble_answers_cache_idx
  on public.hubble_answers (user_id, company_id, question_key, created_at desc);

create index if not exists hubble_answers_lead_idx
  on public.hubble_answers (user_id, lead_id, created_at desc);

/* ------------------------------------------------------------------------- *
 * RLS. CLAUDE.md rule 9: every table, no exceptions.
 * ------------------------------------------------------------------------- */

alter table public.hubble_pages   enable row level security;
alter table public.hubble_chunks  enable row level security;
alter table public.hubble_answers enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['hubble_pages', 'hubble_chunks', 'hubble_answers'] loop
    execute format(
      'drop policy if exists %I on public.%I', t || '_owner', t
    );
    /*
     * Read-only to the owner. Writes go through the service role, which
     * bypasses RLS and MUST scope by user_id in code — the same contract every
     * other service-role query in this codebase follows.
     */
    execute format(
      'create policy %I on public.%I for select using (auth.uid() = user_id)',
      t || '_owner', t
    );
  end loop;
end $$;

comment on table public.hubble_pages is
  'Pages Ask Hubble fetched and cleaned. Keyed by company so leads at the '
  'same company share one cache. Extracted text only — never raw HTML.';

comment on table public.hubble_answers is
  'Answered questions, reused before any new research runs. status records '
  'whether a claim is verified, corroborated, estimated, or unknown.';
