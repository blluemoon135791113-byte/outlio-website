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

## What to tell me

Just the letter — **A**, **B**, or **C** — and anything in the workflow above
that does not match what you thought you were buying. The second half is more
useful than the first.
