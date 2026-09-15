# LinkedIn outreach in Outlio — how it works, and what it is not

**Written 2026-09-15 for the owner to verify.** Every claim here was checked
against the code, not recalled. Where something does not exist, it says so.

---

## The one sentence that matters

**Outlio never sends anything on LinkedIn. It never opens linkedin.com at all.**

It prepares the work — who to contact, from which of your accounts, what to say
— and then **you** perform every action inside LinkedIn yourself and come back
to record what happened.

If you were expecting software that logs in and sends connection requests while
you sleep, **this is not that**, and it was never built to be.

### Why, in the product's own words

`CLAUDE.md` rule 1, unchanged since the project started:

> No requests to `linkedin.com` from our servers, no headless browser, no
> Playwright/Puppeteer/Selenium, **no automated navigation of any kind** — no
> clicking Next, opening profiles, messaging, connecting or changing filters.

Rule 2 adds that Outlio holds **no LinkedIn credentials** — no password, no
cookie, no session — ever.

`DECISION-17` asked whether to build the channel at all and was answered **"build
it, manual execution only."**

⚠️ **The profile URL you entered in settings is not a login.** It records *which
of your accounts* a task belongs to, so daily limits can be counted per account.
Nothing uses it to act.

---

## So what does it actually do for you?

Four things, and they are worth naming precisely because the value is real even
though the sending is not automated.

### 1. It decides who to approach, and refuses the ones it should

Before any task is created, Outlio checks the person against your CRM: are they
on a do-not-contact list, have they already replied, are they already in another
sequence, has someone else on your team got them. That check
(`lib/crm/contact-stop.ts`) is shared with the email channel and **fails
closed** — if it cannot reach the database, it stops rather than proceeds.

**The benefit:** you do not message somebody who asked you not to, or who a
colleague spoke to last week.

### 2. It drafts the message from evidence, or refuses to

There are eight message templates — connection note, first DM, follow-up, final
follow-up, InMail, and so on. Each is filled from what Outlio can actually prove
about the person from your own CRM records.

⚠️ **It refuses to invent familiarity.** `buildLinkedInContext` will not split a
full name into a first name it is not sure of, will not guess someone's role
area from a job title, and holds no relationship data — so when the evidence is
thin it hands the task back and asks **you** to write the note.

**The benefit:** no "Hi {FirstName}" disasters, and no invented common ground.
The honest outcome is often "write this one yourself", which is the point.

### 3. It enforces account-safety limits you would not track by hand

Each of your LinkedIn accounts has a warm-up stage with hard daily and weekly
caps:

| Stage | Invitations/day | DMs/day | InMail/day | Profile views/day |
|---|---|---|---|---|
| **0** — newly linked, unreviewed | **0** | **0** | **0** | **0** |
| **1** — first five working days | 5 | 10 | 1 | 10 |
| **2** — after explicit review | 10 | 15 | 1 | 15 |

⚠️ **A stage never advances on a timer.** `budget.ts`: *"IT NEVER ADVANCES
ITSELF… Do not advance automatically on a timer."* A human decides, and Outlio
records who decided.

**The benefit:** this is the part that actually protects your account. Most
LinkedIn tools get people restricted by sending too much too early. Outlio
refuses to release the task at all.

### 4. It keeps an honest record of what happened

Every task ends with you recording one of: sent, skipped, failed, or **"I cannot
say"**. That last one is deliberate and is treated as *possibly delivered* —
because the thing you cannot rule out is that the person already received it.

Separately, you record what you later **saw**: they replied, they accepted, they
booked a meeting.

⚠️ **A reply cannot be recorded for somebody Outlio has no record of contacting.**
This is the one rule verified live on 2026-09-15. The email side of the product
still carries **254 false "replied" events** — an entire mailbox counted as
prospect replies against two messages ever sent, which would render a reply rate
of 12,700%. That cannot happen here.

**The benefit:** your reply rate is a number you can trust.

---

## The workflow, end to end, as it exists today

```
1. SETTINGS → link your LinkedIn account
   You enter: profile URL + a label.        (never a password)
   Status: owner_reviewed, stage 1.

2. CONTACT PAGE → "Start a LinkedIn sequence…"
   Pick the account. Outlio checks DNC, duplicates, and prior contact.
   Creates ONE task: REVIEW_PROFILE.

3. /linkedin → the Action Inbox
   The card shows who, from which account, and what to do.
   You press Release — Outlio checks the budget and reserves a slot.

4. YOU open LinkedIn and do it yourself.
   For REVIEW_PROFILE that is: look at their profile. Nothing else.

5. BACK IN OUTLIO → record the outcome
   Sent / skipped / failed / cannot say.

6. LATER → record what you saw
   On the contact page: they replied, they accepted, they booked.
```

---

## ⚠️ What does NOT exist, and you should know before deciding

I verified each of these in the code today.

### There is no sequence

`enrollContact` creates **exactly one** task — `REVIEW_PROFILE` — and **no code
anywhere advances an enrollment to a second step.** The eight templates are
individual message texts, not a chain.

So "do this, wait three days, then follow up" **cannot be built by you today,
and cannot be run by Outlio.** There is no screen to define one because the
capability is absent.

### Nothing runs on a schedule

`lib/workers/tick.ts` — the background worker that drives email sending, flows
and reporting — contains **zero** references to LinkedIn. Nothing wakes up and
moves a LinkedIn sequence forward, because there is no sequence and nothing to
move.

### Nothing is sent

Restating it because it is the thing most easily misread: **no message, no
connection request, no InMail leaves Outlio.** The templates produce text for
you to paste.

---

## Three options. This is the decision I need from you.

### Option A — Finish the manual product

Build the missing **multi-step sequence**: several tasks per person with waits
between them, so one enrolment produces "review profile → connect → wait 3 days
→ DM → wait 5 days → follow up" as a queue of tasks that appear when they are
due.

- **You still perform every action.** Outlio queues and times them.
- Breaks no rule; needs design plus one migration.
- **This is what Phases 18 and 19 were building toward**, and without it they
  group and measure a channel that only ever produces one task per person.

### Option B — Make it actually send

Requires overturning rules 1 and 2: a LinkedIn login, a stored session, or an
unofficial API.

⚠️ **State the cost honestly.** `CLAUDE.md` keeps the no-evasion line for a
commercial reason, not a moral one: *"Those are what get an IP range and a
sending domain blocklisted, and Outlio sells email deliverability. Losing it
would break the product that pays for the scraping."* Automated LinkedIn sending
also risks the customer's own account being restricted, and that account is
theirs, not ours.

This is a decision about risk to the business, not a feature request. It is
yours to make, but it should be made deliberately and written down.

### Option C — Park it

Stop LinkedIn work. `crm_contact_suppressions`, the shared do-not-contact and
the sender model already earn their place on the email side. Phases 18–19 stay
as built and unused.

---

## What I got wrong, recorded here rather than buried

I built Phase 18 (campaigns) and Phase 19 (reply attribution) **on top of a
channel that performs no outreach and has no sequence**, and I never put that
plainly in front of you. I described the gap repeatedly as "nothing has been
exercised against a real contact" — which framed it as missing testing, when the
real issue was that you expected a product that sends and schedules.

I also asked you to apply two migrations for that work without first checking we
agreed on what the channel is. That was the mistake, and it is why this document
exists before any more is built.

---

## ✅ DECIDED 2026-09-15 — Option A, with a shape the options did not offer

The owner chose **manual execution**, and went further than A as written:

> "keep it manual but the user can create own workflow for their campaigns that
> they initiate and then add users into that campaign and create a customizable
> workflow for that campaign… once its saved then they have the option on
> actions they added only, not fixed actions like sent connection, booked a
> meeting, etc."

**Outlio still never logs in and never sends.** That half is settled and closed.

What changes is who designs the sequence. A does not mean "Outlio ships a fixed
ladder of steps" — it means **the customer builds their own**, per campaign:

1. Create a campaign.
2. Build its workflow — the steps, in their order, with the waits between them.
3. Add people to it.
4. Tasks appear when they are due; the operator performs each in LinkedIn.

### ⚠️ The requirement that changes existing code

> "they have the option on actions they added only, not fixed actions"

Today `allowedOutcomes(kind)` returns a **fixed vocabulary per task kind**, and
the result form offers it. The owner wants the recordable outcomes to follow the
workflow the customer built: if their campaign has no InMail step, "InMail sent"
must not be offered.

That is a genuine improvement and not a small one — it makes the result form a
function of the campaign rather than a constant. It does **not** relax the
`TaskOutcome` / `Observation` separation (§4.13), which stays: what you did and
what you later saw remain different questions.

### ✅ BUILT 2026-09-15 — Phase 20, linear. Migrations 0130 and 0131 applied.

The owner supplied screenshots of a reference tool and answered the open
questions. What follows is what was decided and what shipped.

#### The correction that reshaped the model

> "outlio does not prepare the note text or the message it will be written
> manually and will give the option to get it written from ai but for that the
> user has to give input into ai on how he wants it written"

**Outlio composes nothing.** This is narrower than Phase 9 built, and it makes
the product safer rather than weaker. `templates.ts` renders eight
Outlio-authored messages from CRM evidence and refuses when the evidence is thin
— so the common path was a refusal, which `enroll.ts` admits in its own comment.
Now the operator's own words are the *first* path, and the only machine-filled
parts are three placeholders resolved from literally-observed CRM values.

The templates are not deleted. They are a starting point to paste and edit, not
what a step contains.

> "outlio does not prepares the comment draft it would just be marked as
> comments/engagement done"

`COMMENT_POST` prepares **nothing** — and 0130's `linkedin_workflow_steps_bodyless`
CHECK makes that physically true, not merely intended. Which is the right answer
on the evidence: a comment has to respond to what the post actually says, and
Outlio has never seen the post.

#### Every step declares two halves

The model that came out of this. Tools holding a LinkedIn session collapse
"prepare" and "perform" because they do both. Outlio cannot, so each step names
both — and `performs` is on the face of every builder card, in the place a
competitor would print "automated".

| Step | Outlio prepares | You perform |
|---|---|---|
| Visit profile | the validated profile link | open and read it |
| Connection request | your note (optional) | send it |
| Message / InMail | your message | paste and send |
| Like recent post | the profile link | → Recent activity, like the top post |
| Comment on post | **nothing** | read it and comment in your own words |
| Add tag | everything | nothing — runs in Outlio |
| Wait | everything | nothing |

#### "How will Outlio fetch the recent post URL?" — it cannot

Asked by the owner, and the answer is a hard limit rather than a gap. Rule 1
forbids any request to `linkedin.com`, and LinkedIn gates post feeds behind a
session — reaching one needs exactly the credential login and bot-detection
evasion that the 2026-09-03 widening explicitly did **not** cover.

So the card carries the profile link Outlio does hold, validated, and the
operator makes the one hop themselves. The honest upgrade later is the
**browser extension**, which already observes pages during a session the user
starts; it could record the top post URL from an activity page they open. That
is inside the existing rule. It is circular for *finding* a post, but good for
re-finding one.

⚠️ **Engagement steps produce tasks that cannot release today.** §4.10 caps the
`engagement` budget at **0/day at every warm-up stage** — a decision made before
the customer had any way to put a like in a workflow. They map to that bucket
rather than to `profile_review`, because picking a cheaper bucket would overturn
a safety limit by choosing rather than by deciding. The builder says so on the
card at the moment the step is added.

#### Linear, and the pointer is a step ID

> "OK ship lenier" · "people can entre at diff points"

Those two together are why `linkedin_enrollments.current_step_id` is a **step
id, never a position number**. A live campaign routinely has people standing on
several steps at once; positions renumber when a step is inserted. An integer
pointer would silently move everybody standing on old-5 onto a step they had
already done — no error, no log line, just the wrong message from a real account
to a real stranger.

`entry_step_id` is stored separately and never updated, because `current_step_id`
stops answering "where did they come in" the moment they advance — and that
comparison is what the DM analysis below will need.

Deleting a step somebody is standing on is the one edit an id pointer does not
make safe, so it is refused by `on delete restrict` and the UI names how many
people are affected. Verified against real Postgres: refused when occupied,
allowed when not.

#### The CRM fix, and a security bug found beside it

> "i need navigator url there as well and linkedin profile url as well"

Cause: one line in `lib/crm/ingest.ts` — `lead.linkedin_url ?? lead.sales_navigator_url`.
`extracted_leads` holds both; `crm_contacts` held one. On a Sales Navigator save
`linkedin_url` is usually NULL, so the contact stored a `/sales/lead/…` address
in a column named `linkedin_url` and the other was discarded. §4.5 forbids
deriving either from the other, so it was gone for good.

0131 adds the column; ingest writes both, filling a gap and never overwriting.
**No backfill** — the data to split existing rows exists only for lead-engine
contacts, and a fix covering some rows while leaving others, with nobody able to
tell which, is worse than one covering none. The contact page therefore buckets
by *what the URL is* (`profileReference().kind`), not which column held it.

⚠️ **The page was rendering `href={contact.linkedInUrl}` raw** — the unvalidated
column straight into an href, while the company URL 190 lines above went through
a validator. That column is written by importers from uploaded HTML, so a
`javascript:` value there was stored XSS on a page every rep opens. The file's
own comment said exactly that, about the other link. Both now go through
`profileReference`, the read-only allowlist §4.13 requires.

### Still not built, and not started

- **Opener / pitch DM per prospect** in the pipeline section.
- **The DM & strategy analysis** — the owner's "smartest feature we can build":
  analyse openers and follow-ups, report what is working per assigned user and
  overall. **Premium plans and admin only.** It needs the two items above to
  exist before it has anything to analyse.
- **AI drafting from the user's own instruction**, applied to all or selected
  leads. The placeholders it must emit already exist and are enforced.
- **Voice notes** — ElevenLabs cloning and TTS, downloaded as mp3 and sent by
  hand as a file. Explicitly deferred by the owner: "KEEP IT FOR LATER".
- **Task generation from the workflow**: enrolment at a chosen step, and the
  worker that releases the next step when a wait elapses. The schema for it
  landed in 0130; nothing walks it yet.
