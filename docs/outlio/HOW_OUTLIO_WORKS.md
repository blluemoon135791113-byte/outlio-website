# How Outlio works, A to Z

**Written 2026-09-16.** Every claim was checked against the code, the live
schema or a running instance. Where something does not exist, it says so and
says what exists instead.

This is the reference for the whole product: what each screen does, what runs by
itself, and how the pieces connect. It supersedes nothing — `CLAUDE.md` holds
the rules, `docs/PROGRESS.md` holds the history — but it is the one file that
answers "what IS this software".

---

## 0. The shape of it in one page

Outlio is four products sharing one contact database.

```
            ┌──────────────── LEAD ENGINE ────────────────┐
            │  You save a Sales Navigator page.           │
            │  Outlio parses it into leads.               │
            └──────────────────────┬─────────────────────┘
                                   │ promoted
                                   ▼
        ╔══════════════════════ THE CRM ══════════════════════╗
        ║  Contacts · Companies · Deals · Tasks · Lists       ║
        ║  Everything below reads and writes THIS.            ║
        ╚══╦═══════════════╦═══════════════╦═════════════════╝
           │               │               │
           ▼               ▼               ▼
      ┌─────────┐   ┌────────────┐   ┌───────────┐
      │  EMAIL  │   │  LINKEDIN  │   │   FLOWS   │
      │ Outlio  │   │  YOU send  │   │ automation│
      │  sends  │   │  by hand   │   │  engine   │
      └─────────┘   └────────────┘   └───────────┘
           │               │               │
           └───────────────┴───────────────┘
                           ▼
                  ┌─────────────────┐
                  │    REPORTING    │
                  └─────────────────┘
```

**The single most important distinction in the product:**

| | Email | LinkedIn |
|---|---|---|
| Who sends | **Outlio**, on a schedule | **You**, by hand, in LinkedIn |
| Credentials held | Your mailbox (SMTP/IMAP, encrypted) | **None, ever** |
| What the worker does | Actually sends the message | Creates a card telling you to |

Outlio never signs in to LinkedIn and never will. `CLAUDE.md` rules 1 and 2.
Everything on the LinkedIn side is built around that.

---

## 1. The sidebar, and what each section is for

`components/product/ProductNav.tsx`. Sections appear only when the workspace's
plan entitles the module — and every page refuses independently, because hiding
a nav item is not access control.

| Section | Label shown | Routes | Module |
|---|---|---|---|
| Overview | — | `/dashboard` | always |
| **Pipeline** | (the CRM) | `/crm/*` | `crm` |
| **Outreach** | (email) | `/email/*` | `email` |
| **LinkedIn** | | `/linkedin/*` | `linkedin` |
| **Automations** | (flows) | `/flows/*` | `flows` |
| Settings | | `/dashboard/settings/*` | always |
| User admin | | `/admin` | platform staff only |

⚠️ **The labels are deliberately not the engineering words.** "CRM" is what the
software is; "Pipeline" is what you are doing. "Flows" is jargon until you have
used one; "Automations" says what it is. LinkedIn keeps its own section rather
than sitting under Outreach **because the work is different in kind** — email
outreach is something Outlio does for you, a LinkedIn task is something you do.

---

## 2. Overview (`/dashboard`)

The home screen. Three bands:

1. **Your activity** — contacts added, emails sent, replies, calls booked, over
   30 days with the comparison window named rather than implied.
2. **Team activity** — workspace pipeline and overdue tasks. Only for managers
   (`report.team.view`), gated on the **fetch** so the figures never reach the
   browser payload for anyone else.
3. **Usage this period** — credits, and what they buy.

⚠️ **A manager's home shows their own activity AND the team's, side by side,
never one replacing the other.** Two panels of similar figures is how a manager
starts reading their own pipeline as the company's.

---

## 3. Lead Engine — where contacts come from

**Outlio is a file processor, not a crawler.**

1. You open a Sales Navigator search in your own browser and save the page.
2. `/dashboard/extract/new` — upload the HTML.
3. The file goes to private storage under a **server-generated** key
   (`{user_id}/{job_id}/{uuid}.html`); a path is never derived from your
   filename.
4. A job is queued. The worker claims it with `FOR UPDATE SKIP LOCKED`, parses
   it server-side with `cheerio`, and never renders it in a browser.
5. Leads are de-duplicated and land in `extracted_leads`.
6. Promotion into the CRM resolves identity, merges duplicates and links
   companies.

⚠️ **A zero-lead result is a loud error (`ERR_FILE_FORMAT`), never a silent
empty success.** LinkedIn has broken this parser once already.

⚠️ **Two addresses per person, and neither is derivable from the other.** A
public `/in/…` profile and a Sales Navigator `/sales/lead/…` link. Until
migration 0131 the promotion step kept only one — see §10.

**The browser extension** (`/extension/connect`) is the second input. It
observes pages during a session you explicitly start. Outside that session it
reads nothing. You navigate; it watches.

---

## 4. The CRM — the spine everything else reads

| Screen | What it is for |
|---|---|
| `/crm/contacts` | People. Filter, sort, saved views, bulk actions. |
| `/crm/contacts/[id]` | One person: fields with **provenance**, timeline, email threads, LinkedIn panel, notes, ownership, do-not-contact. |
| `/crm/companies` | Organisations, with researched detail (funding, tech, news). |
| `/crm/pipeline` | Deals on a board. |
| `/crm/tasks` | Manual follow-ups. |
| `/crm/lists` | Static segments. |
| `/crm/duplicates` | Merge review. |
| `/crm/import` | CSV, with a preview you approve before anything is written. |
| `/crm/reports` | Metrics, dashboards. |

### Provenance is the CRM's actual product

Every value on a contact can say **where it came from**. A researched value
carries a citation to the evidence row that produced it. A value with no
provenance says so rather than implying it was verified.

⚠️ **Rule 4: nothing is ever fabricated.** A missing value is NULL plus a
missing-data indicator. Enrichment from external sources is permitted (owner
decision 2026-09-03), but a value may only be stored if it was **literally
observed**, with the provider and URL kept as its citation. Synthesising
`first.last@company.com` from a name and a domain is forbidden — it looks right,
it is often right, and when it is wrong nobody can tell.

### Do-not-contact is shared and fails closed

One predicate (`lib/crm/contact-stop.ts`) answers "may we approach this person"
for **both** channels, and it is **scoped**: someone who said "stop emailing me"
has not said "stop connecting". If it cannot reach the database it stops rather
than proceeds.

---

## 5. Email — the channel Outlio actually sends

### Setup

`/email` → connect a mailbox (SMTP/IMAP). Credentials are encrypted at rest.
`/dashboard/settings/email` holds sending settings, sender address, warm-up ramp
and DNS readiness (SPF/DKIM/DMARC).

### A campaign, end to end

1. `/email/campaigns` → **New campaign**.
2. Open it → the **sequence builder** authors steps: subject, body, and the wait
   before each one. Steps can be added, removed and reordered.
3. Enrol contacts.
4. Launch. `assertLaunchable` refuses a campaign missing steps, a mailbox or
   recipients — it lists the requirements on the page as you meet them.
5. The worker sends on schedule, respecting the recipient's timezone, the
   mailbox's ramp, and the shared suppression list.
6. Replies sync back; a reply **stops** the sequence for that person.

⚠️ **An auto-reply is never counted as a reply.** Out-of-office would otherwise
stop sequences and inflate reply rate at the same time.

### ⚠️ What the owner reported, and what is actually true

The report was: *"the email campaign is f'd up because user cannot create
sequence and cannot add the text of emails, signatures etc, no placeholders, no
personalization, nothing."*

**Verified against the code. It is partly right, and the split matters:**

| Claim | Reality |
|---|---|
| Cannot create a sequence | **Exists.** `components/email/SequenceBuilder.tsx` — add, remove, reorder steps. |
| Cannot add email text | **Exists.** The builder edits subject and body per step. |
| No placeholders | **Exists.** `lib/email/template.ts` — an allowlist of variables, plus `{{custom.slug}}` for custom fields, with "did you mean `{{first_name}}`?" on a typo. |
| No personalization | **Exists**, same module. |
| **No signatures** | ⚠️ **TRUE. Completely absent.** The only "signature" in the codebase is webhook HMAC. There is no signature field, no per-mailbox signature, nothing appended to a send. |

**So why did none of it appear?** Three real causes, in order of likelihood:

1. ⚠️ **The builder is manager-gated.** It renders only behind
   `email.template.manage`, whose `minRole` is **manager**. A setter opens a
   campaign and sees the stats, the requirements checklist and **no builder at
   all** — which is exactly "cannot create sequence".
2. ⚠️ **There is no variable picker.** The LinkedIn builder has one ("Insert:
   First name · Company name · Location"). The email builder has a single
   `{{first_name}}` hint inside the subject *placeholder attribute*. You have to
   know the syntax and the variable names from memory, and `{{custom.slug}}` is
   undiscoverable. **The feature exists and is invisible**, which from the
   operator's seat is the same thing as missing.
3. **Signatures genuinely do not exist**, so any email that needs one has to
   have it typed into every step's body by hand.

**What to build, in order:** the variable picker (small, and it is what makes
the existing feature findable) → signatures, per mailbox, appended at render →
then reconsider whether the builder should be manager-only.

---

## 6. LinkedIn — the channel YOU send

**Outlio never signs in and never sends.** It decides who, when and what to say;
you perform every action in LinkedIn's own interface and come back to record
what happened.

⚠️ **The profile URL in settings is not a login.** It records which of your
accounts a task belongs to, so daily limits can be counted per account.

### Accounts and warm-up

`/dashboard/settings/linkedin`. Each account carries a stage with hard caps:

| Stage | Invites/day | DMs/day | InMail/day | Profile views/day | Engagement |
|---|---|---|---|---|---|
| 0 — newly linked | 0 | 0 | 0 | 0 | 0 |
| 1 — first five days | 5 | 10 | 1 | 10 | **0** |
| 2 — after review | 10 | 15 | 1 | 15 | **0** |
| 3 — after review | 15 | 20 | 1 | 20 | **0** |

⚠️ **A stage never advances on a timer.** A human decides, and Outlio records
who decided. This is the part that actually protects the account.

⚠️ **Engagement is capped at zero at every stage.** Likes and comments therefore
produce tasks that **cannot release** until somebody raises it deliberately. The
builder says so on the card at the moment you add such a step.

### Campaigns and the workflow builder

`/linkedin/campaigns` → create → open → **build the workflow**.

The steps available, and the split that defines them:

| Step | Outlio prepares | You perform |
|---|---|---|
| Visit profile | the validated profile link | open and read it |
| Connection request | your note (optional, 300 chars) | send it |
| Send message | your message | paste and send |
| InMail | your message | send it |
| Like recent post | the profile link | → Recent activity, like the top post |
| Comment on post | **nothing** | read it and comment in your own words |
| Add tag | everything | nothing — runs in Outlio |
| Wait | everything | nothing |

⚠️ **Every card says "You do this:" on its face** — in the place a competitor
would print "automated".

⚠️ **Outlio writes none of the copy.** You write it. Three placeholders
(`{{first_name}}`, `{{company}}`, `{{location}}`) are filled from what Outlio
literally observed, and a value it cannot fill **holds that person's task back**
rather than sending a gap.

⚠️ **Outlio cannot fetch a post's URL.** Rule 1 forbids requests to
linkedin.com, and post feeds need a session. The card gets you one click away.

### Enrolment and the walk

Add a person → they land on a step → a card appears → you do it → you record the
outcome → the next step arrives, or a wait parks them until the worker releases
it.

⚠️ **People can enter at any step, and the pointer is a step ID, never a
position.** Positions renumber when you insert a step; an integer pointer would
silently move everyone standing on old-5 onto a step they had already done. No
error — just the wrong message, from a real account, to a real stranger.

⚠️ **Deleting a step somebody is standing on is refused**, and the UI names how
many people it would strand.

⚠️ **Do-not-contact is re-checked at every step**, not only at enrolment. Days
pass between steps.

### Recording what happened — two vocabularies that never mix

| **Task outcome** — what you did | **Observation** — what you later saw |
|---|---|
| Request marked sent | They replied |
| Message marked sent | They accepted the connection |
| Profile review recorded | They booked a meeting |
| Engaged with the post | The meeting happened |
| Skipped / Failed / **Not sure whether it went** | |

⚠️ **"Mark request sent" cannot mark acceptance.** Acceptance gates the first
DM, so collapsing them sends a message into a connection that was never made.

⚠️ **"Not sure whether it went" is a first-class answer**, treated as *possibly
delivered*: it keeps its quota slot, because the thing you cannot rule out is
that a stranger already received it.

⚠️ **A reply cannot be recorded for somebody Outlio has no record of
contacting.** The email side still carries 254 false "replied" events — a whole
mailbox counted as prospect replies against two messages ever sent, which
renders a reply rate of 12,700%. That cannot happen here.

### Per-prospect strategy, and the analysis

On each contact: an **opener** and a **pitch** — what *you* would say to *this*
person. Distinct from the campaign's copy and from what was actually sent.

**Write with AI** drafts from *your* instruction ("short and casual, lead with
their city"). ⚠️ **The model is never shown the prospect.** Not privacy — the
anti-fabrication control. A model shown "VP Engineering at Acme, Berlin" writes
"loved what you're building on the payments side": plausible, specific,
invented. It writes a *template*; Outlio fills it from observed values. The draft
lands in the textarea for you to edit — it is never saved on your behalf,
because the analysis groups by author.

`/linkedin/analysis` — **premium plans and platform admin only**. Reads the
openers and pitches alongside what was recorded as sent and replied.

⚠️ **The model does no arithmetic.** Every number is computed in code:

- No reply rate below **20 recorded actions**. Two sends and one reply is not 50%.
- `null` renders as **"not enough data"**, never 0%. Zero means thirty were sent
  and nobody answered — a finding. Null means it has not been tried.
- A rate above 100% is **refused**, not printed. That is the 12,700% shape.
- Unconfirmed sends sit in the denominator **and** are disclosed separately.

---

## 7. Flows — the automation engine

`/flows`. Trigger → conditions → actions, over CRM facts.

- **33 fact keys** across 7 domains drive conditions.
- Actions cover CRM writes, email, tasks, notifications, webhooks and sequence
  control. Only implemented actions appear in the picker.
- A credit quote is shown **before** publish.
- **AI Copilot** drafts a flow from a description.

⚠️ **The copilot was shipped broken and could never have worked.** Its response
schema declared `config: { type: 'object' }` with no properties, so structured
output stripped everything inside it and every generated ACTION step was
refused. No unit test could see it — they all fed the compiler hand-written
JSON, the one input the schema never touches. Found by an eval scoring 2/42;
now 42/42.

---

## 8. What runs by itself — the worker

`pg_cron` → `/api/cron` **every 5 minutes**. One tick runs ten jobs:

| Job | What it does |
|---|---|
| `reap_email_claims` | Releases stale claims so a crashed send retries. |
| `advance_sequences` | Moves email enrolments to their next step. |
| `send_email` | **Actually sends.** |
| `sync_replies` | Pulls replies; a reply stops the sequence. |
| `advance_flows` | Resumes flows parked on a WAIT. |
| `release_linkedin_waits` | Releases LinkedIn waits that have elapsed. |
| `deliver_webhooks` | Outbound webhooks, with circuit breaking. |
| `sync_contact_evidence` | Copies research evidence into the CRM. |
| `drain_extraction_queue` | Parses uploaded pages. |
| `rollup_reporting` | Recomputes reporting aggregates. |

⚠️ **Three of these were added because the feature underneath them was
unreachable.** `rollup_reporting` had no trigger at all until 2026-09-12, so
every report read zero. `release_linkedin_waits` did not exist until 2026-09-16,
so a workflow containing "wait 3 days" parked a person forever —
indistinguishable, from outside, from a sequence that had quietly stopped. The
pattern is worth naming: **a feature with no caller looks exactly like a feature
that is working and has nothing to do.**

⚠️ **The LinkedIn job releases waits and nothing else.** Every other transition
is driven by a person recording an outcome — the moment the enrolment stops
waiting on a human *is* the moment they answer.

---

## 9. How it all links

**One contact, seen from every side:**

```
  Lead Engine parses a page
        └─► extracted_leads ──promote──► crm_contacts ◄── CSV import
                                             │              ◄── extension
                    ┌────────────────────────┼────────────────────────┐
                    ▼                        ▼                        ▼
            email_enrollments        linkedin_enrollments        flow_runs
                    │                        │                        │
                    ▼                        ▼                        ▼
             email_messages          linkedin_tasks  ──►  YOU, in LinkedIn
                    │                        │
                    ▼                        ▼
               email_events          linkedin_observations
                    └────────────┬───────────┘
                                 ▼
                       crm_reporting_daily
```

**The shared rules, enforced once and read everywhere:**

- **Do-not-contact** — one predicate, both channels, scoped, fails closed.
- **Provenance** — a value carries where it came from, or says it cannot.
- **Tags** — one implementation (`lib/crm/tags.ts`), used by both the flow
  engine and the LinkedIn walker.
- **Plan limits** — read from `plans.limits` at runtime, never hardcoded.
- **Tenant scoping** — the service role bypasses RLS, so every query scopes by
  `workspace_id` in code.

---

## 10. Known gaps, stated plainly

| Gap | Status |
|---|---|
| **Email signatures** | Do not exist at all. |
| **Email variable picker** | Absent — personalization exists but is invisible. |
| **LinkedIn voice notes** | Deferred by the owner. Design settled: ElevenLabs render → mp3 → **paperclip attachment**, because LinkedIn has no "upload audio as a voice note". Generate on release, never on enrolment. |
| **Engagement steps** | Produce tasks that cannot release until the §4.10 cap is raised. |
| **CRM URL backfill** | Contacts created before 0131 keep one of their two LinkedIn addresses. No backfill: the data to split them exists only for lead-engine contacts, and a fix covering some rows with nobody able to tell which is worse than none. |
| **Deployed AI vendors** | `LLM_ALLOWED_VENDORS` is not set in Vercel, so production is Gemini-only. Three paid vendor keys (Groq, Cerebras, Backboard) name models their APIs reject. |
| **`agency` plan** | Its `limits` blob is malformed — missing `credits_per_month`, which makes `getPlanById` throw. |
| **Slack / Teams delivery** | Built, never verified against a real workspace. |
| **Button vocabulary** | 148 distinct definitions collapsed to three primitives; three surfaces migrated, the rest still inline. |

---

## 11. The recurring defect class, because it explains most of the above

**One question, two implementations.** Nearly every serious bug in this
product's history is the same shape:

- Two `Record<TaskKind, …>` maps that had to agree, and did not.
- A tag implementation in the flow engine and another in the LinkedIn walker.
- A `Stat` component written twice, an hour apart.
- `plans.limits` read directly in one place and through a bypass in three
  others — which is how the strategy analysis refused 27 of 33 workspaces.

**The second shape: a feature with no caller.** The erasure function was
unreachable its entire life. The reporting rollup had no trigger. The copilot's
schema made it incapable of its one job. Twelve webhook events were offered and
none ever fired.

Both are invisible to typecheck, to lint and to review. The only things that
catch them are **exhaustive types** (a `Record` keyed by a database enum breaks
when the enum grows) and **tests that assert a thing is CALLED**, not merely
that it exists.
