# Architecture Decision Record — Phase 2

**Status:** decided. Phases 3+ implement this without re-opening it.
**Date:** 2026-08-06

---

## 1. The central decision: where extraction runs

### Decision

**A dedicated long-running Node worker in its own container, fed by a Postgres
job queue.** Extraction never runs inside a request handler.

```
Browser
  │ upload (multipart, streamed)
  ▼
Next.js Route Handler ──────────► Supabase Storage  (private bucket "uploads")
  │                                server-generated key: {user_id}/{job_id}/{uuid}.html
  │ ONE transaction
  ▼
Postgres:  extraction_jobs + uploaded_files + job_queue
  │
  │ SELECT ... FOR UPDATE SKIP LOCKED   (poll, JOB_POLL_INTERVAL_MS)
  ▼
Node worker  (own container, no public inbound HTTP)
  │  claim → download → parse (cheerio) → normalize → dedupe
  │  → bulk insert leads → update progress → build export → cleanup
  ▼
Postgres: extracted_leads, job status, usage_counters
  │
  ▼
Browser polls the job row (or subscribes via Realtime)
```

### Why the worker is Node, not Python

Phase 1 established the original scraper is obsolete and is being **rewritten in
TypeScript with cheerio** (`docs/SCRAPER_AUDIT.md` §J). There is no Python in the
extraction path, so there is no reason to run a Python runtime.

**Consequences — spec sections that no longer apply:**

- §11.4 (subprocess wrapper contract) — **void**. No subprocess is spawned.
- The "separate Python worker service" default in §5.1.J — **void**.
- No second container image, no `spawn` argument-array hardening, no minimal-env
  construction, no non-root subprocess user.

The worker still runs as a **separate long-lived container**. Collapsing it into
Vercel is not permitted regardless of language — see rejected alternatives.

### Rejected alternatives

| Option | Why rejected |
|---|---|
| **In-process on Vercel** | Hard execution ceiling (~60 s Hobby / 300 s Pro). A 25-file job exceeds it. Jobs would die when the function is killed. |
| **Vercel background functions** | Ceiling still applies. No durable queue semantics, no retry/claim model. |
| **Inngest / Trigger.dev** | Genuinely viable. Adds a vendor, a second billing relationship, and moves job state out of Postgres where it can no longer be transactional with application data. **Recorded as the fallback** if self-hosting the worker becomes unacceptable. |
| **Redis + BullMQ** | Extra infrastructure and a second source of truth for job state, for no gain at this scale (tens of jobs/day). |
| **Supabase Edge Functions** | Deno runtime, execution limits, and no long-lived process. Unsuitable for multi-minute batch work. |
| **Cron polling from Vercel** | Cold starts, no claim semantics, and still bounded by the function ceiling. |

### Why a Postgres queue rather than a broker

- **Transactional with application data.** Creating a job and enqueuing it is one
  `BEGIN…COMMIT`. A broker makes that two systems and an inconsistency window.
- **Inspectable with plain SQL.** Debugging a stuck job is a `SELECT`.
- **No new vendor**, no new credential, no new failure domain.
- `FOR UPDATE SKIP LOCKED` is the standard, correct primitive for competing
  consumers and is safe under concurrent workers.

At tens of thousands of jobs/day this would warrant revisiting. It does not now.

---

## 2. Components and trust boundaries

| Component | Runs on | Holds service-role key | Public inbound |
|---|---|---|---|
| Next.js app | Vercel | **only in server-only modules** | yes (HTTPS) |
| Node worker | Railway / Fly.io / Render | **yes** | **no** |
| Postgres + Storage | Supabase | n/a | via Supabase API only |
| Browser | user device | **never** | n/a |

### Key handling

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — safe in the
  client bundle by design. RLS is the enforcement layer.
- `SUPABASE_SERVICE_ROLE_KEY` — **bypasses RLS entirely.** Lives only in
  `lib/supabase/admin.ts` (imported exclusively by server code) and the worker.
  Never `NEXT_PUBLIC_`. Never imported by anything reachable from a client
  component.

> **Every service-role query must scope by `user_id` in application code.** RLS is
> not protecting you there. This warning is repeated at the top of `admin.ts`.

### Trust boundaries

1. **Browser → Next.js** — everything from the browser is untrusted. Zod on every
   body. Client-side validation is UX only.
2. **Uploaded file → parser** — untrusted content. Never rendered as HTML
   anywhere. Parsed server-side only, in the worker.
3. **Parser output → database** — untrusted. Validated against a Zod schema and an
   allow-list before insert (`docs/SELECTOR_MAP.md` §3 defines the allowed keys).
4. **Next.js ↔ worker** — no direct network path. They communicate only through
   Postgres rows. The worker exposes nothing but an internal `/healthz`.

---

## 3. Request lifecycle

```
sign-up
  → server reserves a keyed hash of the client network (10-minute one-time token)
  → auth.users trigger consumes the reservation; direct Auth API bypasses fail
  → email verification required
  → profiles row created by on-auth.users-insert trigger, role = registered_user
access request
  → POST /api/access  → access_requests row (status = pending)
  → admin approves    → profiles.role = approved_user, access_expires_at set,
                        admin_audit_logs row written IN THE SAME TRANSACTION
upload
  → getAccessContext() → canUseScraper must be true
  → per-file: streamed byte count, content sniff, sha256
  → storage key generated server-side
  → ONE transaction: extraction_jobs + uploaded_files + job_queue + usage_counters
job
  → worker claims (FOR UPDATE SKIP LOCKED)
  → status: queued → processing
  → per file: download → parse → normalize → accumulate
  → dedupe → bulk insert → export artifact
  → status: completed | partially_completed | failed
results
  → server-side paginated/sorted/filtered reads from extracted_leads
export
  → ownership re-verified → signed URL, TTL 60 s
```

**Progress steps, verbatim** (spec §11.3): `Uploading files` → `Waiting in queue` →
`Processing file {n} of {total}` → `Cleaning data` → `Removing duplicates` →
`Generating export` → `Completed` / `Completed with errors` / `Failed`.

Persisted on the job row so a browser refresh shows accurate state. The UI polls;
it never holds an open request for the job's duration.

---

## 4. Failure modes and recovery

| Failure | Behaviour |
|---|---|
| **Worker crashes mid-job** | Claim goes stale. Reaper returns jobs whose `claimed_at` is older than `JOB_TIMEOUT_MS` to `pending`, increments `attempts`. Past `max_attempts` → `failed` with a dead-letter reason. |
| **Poison-pill file** | Per-file `try/catch`. File marked `failed` with an error code; loop continues. One bad file never fails the batch. |
| **All files fail** | Job status `failed`. **Zero leads is never a silent success** — surfaced as `ERR_FILE_FORMAT`. |
| **Some files fail** | `partially_completed`, with per-file errors visible in the UI. |
| **Storage unavailable** | File marked failed, job retried with backoff via `next_attempt_at`. |
| **DB connection loss** | Worker retries with backoff; unclaimed jobs stay `pending`. Claim is transactional, so a lost connection releases the lock. |
| **Duplicate job submission** | `uploaded_files` unique index on `(user_id, content_sha256)`. Surfaced as a **warning**, not a hard error — reprocessing can be intentional. |
| **Orphaned storage objects** | Startup sweep in the worker plus a retention job. |
| **Vercel down** | Queued jobs still process. Results appear when the app returns. |
| **Worker down** | Uploads still succeed and queue. `ERR_WORKER_DOWN` shown: "your job is queued and will run automatically." |

### Idempotency

Three independent guarantees:

1. **Job claiming** — `FOR UPDATE SKIP LOCKED` means exactly one worker holds a job.
2. **Per-file processing** — files are keyed by `content_sha256`; reprocessing the
   same file produces the same rows.
3. **Lead insertion** — retrying a job runs **delete-then-insert scoped to
   `extraction_job_id`, inside one transaction**. Re-running never duplicates.

---

## 5. Data retention and deletion

- Retention comes from `plans.limits.retention_days`. Never hardcoded.
- **Deleting a job** deletes: `extracted_leads` rows (FK cascade),
  `uploaded_files` rows, **the storage objects**, and any export artifacts.
  Storage deletion is explicit — the database cascade does not reach it.
- **Deleting an account** removes all of the above plus the `profiles` row.
  `auth.users` cascade handles the rest.
- Export artifacts expire on the same retention clock.
- `admin_audit_logs` are **append-only and never deleted** — enforced by a trigger
  that raises on `UPDATE`/`DELETE`.

---

## 6. Observability

Structured JSON logs. Correlation via `request_id` (generated at the edge,
propagated onto the job row) and `job_id`.

Every log line carries whichever apply: `request_id`, `job_id`, `user_id`,
`file_id`, `step`, `error_code`, `duration_ms`.

**Never logged:** full lead records, file contents, access tokens, signed URLs,
session cookies, email bodies. Enforced by `lib/logging/redact.ts` — not by
convention.

`system_events` holds structured error/event rows queryable from the admin panel.
Sentry DSN is a placeholder until provided.

---

## 7. Environments

| Environment | Next.js | Worker | Database |
|---|---|---|---|
| **Local** | `npm run dev` | `npm run worker:dev` (plain Node process) | Supabase local (`supabase start`) or the hosted project |
| **Staging** | Vercel preview | worker instance, staging env | separate Supabase project *(not yet created)* |
| **Production** | Vercel | Railway/Fly/Render | `ptewhpmxzenbmxlizxhu` |

The worker runs locally as an ordinary Node process — no container required for
development. The Dockerfile exists for deployment only.

> **Open:** no staging Supabase project exists. Recommend creating one before
> Phase 12 so migrations are rehearsed against a real remote before production.

---

## 8. Phase 2 acceptance

- [x] Extraction-location decision stated unambiguously
- [x] Rejected alternatives recorded with reasons
- [x] Decision consistent with Phase 1's finding (TypeScript port → Node worker)
- [x] Component diagram and trust boundaries defined
- [x] Full request lifecycle documented
- [x] Failure modes and recovery documented
- [x] Idempotency strategy defined at all three layers
- [x] Retention and deletion flow defined
- [x] Observability and correlation scheme defined
- [x] Environments defined
- [x] `docs/FILE_TREE.md` written
- [x] No architectural questions block Phase 3
