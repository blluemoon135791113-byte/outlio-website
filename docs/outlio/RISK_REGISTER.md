# RISK REGISTER — LinkedIn

Mandated by build contract §6.3: *"`/docs/outlio/RISK_REGISTER.md` is mandatory
before any LinkedIn code."* Written 2026-09-08, Phase 15.

**This document is a gate.** Phases 16–20 (account connection, safety engine,
campaigns, reply sync) may not begin until the owner has read it and recorded a
decision in `04_DECISIONS_NEEDED.md`.

---

## 1. The risk, stated plainly

Third-party LinkedIn automation generally operates **against LinkedIn's User
Agreement**, regardless of how a vendor packages it. The consequence does not
land on Outlio. It lands on **the customer**, as restriction or permanent loss
of the LinkedIn account they have spent years building.

That asymmetry is the whole reason this file exists. A customer cannot evaluate
a risk they were not told about, and "the vendor said it was safe" is not a
disclosure.

⚠️ **Nothing below is a recommendation to proceed.** §6.3 requires the risk to
be named, not managed away.

## 2. Where Outlio stands today — `VERIFIED` 2026-09-08

| | |
|---|---|
| LinkedIn accounts connected | **none — no such feature exists** |
| Messages/invites sent by Outlio | **none — no send path exists** |
| Credentials or cookies held | **none** (CLAUDE.md rule 2, unrevised) |
| Third-party automation vendor integrated | **none** — no `unipile`, `phantombuster`, `expandi`, `dripify`, `heyreach` or equivalent appears anywhere in the source |

The only LinkedIn surface that exists is the browser extension, and it reads:

```
host_permissions:  https://www.linkedin.com/sales/*
permissions:       storage, activeTab
```

`activeTab` and `storage` only — no `cookies`, no `webRequest`, no `scripting`,
no `tabs`. It parses pages **the user has opened themselves**, during a session
they explicitly started, through three adapters (`salesnav.ts`,
`salesnav-company.ts`, `salesnav-account-list.ts`). It does not navigate, click,
paginate, connect or message.

**So Outlio today is an observer, and every phase from 16 onward changes that.**
That is the decision, and it is a product decision, not a technical one.

## 3. Capability matrix by access method

Assessed as categories, because the posture follows the access method rather
than the vendor's name.

| # | Access method | How access is obtained | ToS posture | Who bears the failure | Outlio's position |
|---|---|---|---|---|---|
| A | **Browser extension, read-only** (today) | The user opens a page; the extension parses the DOM in their own authenticated session | Grey. No automated navigation and no credential handling, but automated *reading* of pages is still contested by LinkedIn's UA | Customer, mildly — the pattern is indistinguishable from ordinary use at ordinary volume | **In use.** Rule 1 permits it: "the extension observes; the user navigates" |
| B | **Official LinkedIn APIs** (Marketing Developer Platform, Sales Navigator partner APIs) | Approved partner programme, OAuth | **Compliant.** The only compliant option | LinkedIn, contractually | **Not held.** Requires partner approval; messaging/invite scope is generally unavailable to a product like this |
| C | **Third-party "unofficial API" vendors** | Vendor holds the customer's LinkedIn **session cookie** server-side and acts as them | Against the UA. Cookie custody by a third party is also a credential-custody problem in its own right | Customer — restriction risk, plus exposure of a live session to a vendor | **Forbidden by rule 2.** Holding or brokering a customer's LinkedIn session is a breach liability with no upside |
| D | **Local agent / desktop automation** | Software on the customer's machine drives their own logged-in browser | Against the UA for automated action, though it originates from the customer's real device | Customer | **Not adopted.** No installed-agent product exists, and it re-introduces automated navigation that rule 1 forbids |
| E | **Cloud automation behind residential proxies** | Vendor runs a browser in the cloud and presents it as the customer's usual location | Against the UA, and the proxying exists to defeat detection | Customer, severely | **Forbidden.** This is rate-limit evasion and fingerprint spoofing, both named in §6.3 |

⚠️ **B is the only compliant row, and Outlio does not have it.** Any of the
others means telling the customer their account is at risk. A register that
implied otherwise would be the "dressing it up" §6.3 forbids.

## 4. Absolutely forbidden — restates §6.3, unrevised

Regardless of phase, vendor, customer request or commercial pressure:

- credential capture (**CLAUDE.md rule 2**)
- cookie harvesting or brokering
- CAPTCHA solving or bypass
- fingerprint spoofing, stealth or anti-detection tooling
- rate-limit evasion of any kind

⚠️ **The reason is commercial as well as ethical, and the commercial one is
load-bearing.** CLAUDE.md's 2026-09-03 revision widened what Outlio may fetch
and left this list untouched, with the argument written down: anti-detection is
what gets an IP range and a **sending domain** blocklisted, and Outlio sells
email deliverability. Losing it would break the product that pays for
everything else.

**Scale by adding authorized senders, never by evading one sender's limits.**

## 5. Failure modes to design against

Ordered by how badly the customer finds out.

| Failure | What the customer sees | Control required before Live |
|---|---|---|
| Account restricted or banned | Their LinkedIn is gone. Not recoverable by us | Server-side caps; acknowledgement; emergency stop |
| Invite limit hit silently | Campaign appears to run; nothing is delivered | Capacity check before enqueue, not after failure |
| Two campaigns target one person | The prospect receives duplicate outreach from one company | Collision detection across campaigns and channels |
| Session expires mid-campaign | Steps fail one by one, looking like a product fault | Per-account pause + a visible connection state |
| A stopped campaign keeps sending | The control lied | Emergency stop verified by test, not by button |
| Vendor outage | Silent partial delivery | Async operation ledger (Phase 18), reconciled |

## 6. Controls that must exist and be `VERIFIED` before Live mode

Per §6.3, all of these are preconditions, not follow-ups:

1. **Server-side per-account daily and weekly caps.** Provider caps are a
   ceiling, not a target. Enforced server-side — a client-side cap is not a cap.
2. **Workspace emergency stop, per-account pause, per-campaign pause**, each
   proven by a test that shows sending actually ceases.
3. **In-product risk acknowledgement** recorded per workspace before Live can be
   enabled, naming the account-restriction risk in the customer's own words.
4. **Dry run before Live exists at all** (Phase 17 precedes 18 deliberately).

⚠️ **These are exactly the shape of control this codebase has historically
shipped broken.** The project's own record: a suppression list with every write
path and no read path; a sequence sender that did not exist while the UI said
mail was going out; gated actions with no callers. An emergency stop that has
never been proven to stop anything would be the same defect with a far worse
blast radius — and unlike those, the person harmed is the customer, not us.

Every control above therefore needs the treatment the memory file describes:
**break it and re-run**. A stop button whose test cannot fail is not a stop
button.

## 7. GDPR / data-protection exposure, carried forward

Recorded 2026-09-03 when rule 1 was widened, and unchanged:

- **Article 14** requires notifying a person whose personal data was collected
  without their knowledge, within one month. Outlio collects contact data from
  public sources without the subject's knowledge. No notification path exists.
- **Target-site ToS** for the broader fetching permitted under the revised rule 1.

The owner was shown both and accepted them. They are restated here rather than
re-litigated, because a LinkedIn phase increases the volume of personal data
collected and does not change the obligation.

## 8. Recommendation

**Do not start Phase 16.** Not on ToS grounds alone — on the same evidence every
recent phase has hit.

The product has **28 workspaces, 50 contacts, 2 emails ever sent, 0 flow runs
and 0 opportunities**. Phases 4, 5, 6, 11, 13 and 14 are all deferred because
the engineering is ahead of the usage. LinkedIn is the most expensive phase in
the plan, the only one whose failure mode is *the customer loses an asset we
cannot give back*, and the one where the compliant access method (row B) is not
available to us.

Building it now would mean accepting an irreversible customer risk to serve a
population that is not yet using the channel the product already has.

**If the owner decides to proceed anyway**, the order is not negotiable:
Phase 15 (this file, acknowledged) → 16 connection → **17 dry-run and safety
engine, complete and verified** → 18 campaigns. Live mode does not exist before
17 is `VERIFIED`.

## 9. Owner decision required

→ **DECISION-17** in `04_DECISIONS_NEEDED.md`.
