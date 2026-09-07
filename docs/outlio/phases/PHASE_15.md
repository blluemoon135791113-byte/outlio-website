# Phase 15 — LinkedIn provider capability matrix + RISK_REGISTER

Per §9. Status: **DELIVERED 2026-09-08. The deliverable is a gate, and it is now
closed pending DECISION-17.**

---

## WHY THIS PHASE COULD PROCEED WHEN 13 AND 14 COULD NOT

Phases 4, 5, 6, 11, 13 and 14 are all deferred on the same fact: the engineering
is ahead of the usage. Phase 15 is the first phase since 12 whose deliverable has
**no data dependency at all** — a capability matrix and a risk register are
answerable at 28 workspaces or 28,000.

It is also the only remaining phase that is *itself* a precondition. §6.3:

> `/docs/outlio/RISK_REGISTER.md` is mandatory before any LinkedIn code.

Phases 16–20 were blocked on a file that did not exist. That is now fixed.

## WHAT WAS DELIVERED

**[`RISK_REGISTER.md`](../RISK_REGISTER.md)** — the four things §6.3 names, per
access method rather than per vendor, because posture follows the access method
and vendor names change:

| | Contents |
|---|---|
| Access method | Five categories, A–E, from the current read-only extension to cloud automation behind residential proxies |
| ToS posture | One row is compliant — the official partner APIs — and Outlio does not have it |
| Failure modes | Six, ordered by how badly the customer finds out |
| Customer-facing risk | Named as account restriction: not recoverable by us |

Plus the controls §6.3 requires before Live exists, and the forbidden list
restated unrevised.

## THE POSITION IT RECORDS — `VERIFIED`, not asserted

| | |
|---|---|
| LinkedIn accounts connected | none — no such feature exists |
| Messages or invites ever sent | none — no send path exists |
| Credentials or cookies held | none |
| Automation vendor integrated | none — no `unipile`, `phantombuster`, `expandi`, `dripify` or `heyreach` anywhere in source |

The whole LinkedIn surface is an extension holding `storage` and `activeTab`
against `https://www.linkedin.com/sales/*`. No `cookies`, no `webRequest`, no
`scripting`, no `tabs`. It parses pages the user opened themselves.

⚠️ **Outlio is an observer today, and every phase from 16 onward changes that.**
Writing the register made that the plainest sentence in the document, which is
what a register is for.

## THE ARGUMENT THIS PHASE ADDS

The register recommends **not starting Phase 16**, and the reason is not
primarily the ToS.

LinkedIn is the most expensive phase in the plan; it is the only one whose
failure mode is *the customer loses an asset we cannot give back*; and the
compliant access method is unavailable to us. Meanwhile the product has 2 emails
ever sent and 0 flow runs. Building an irreversible customer risk to serve a
population not yet using the channel that already exists is the population-of-zero
argument with a consequence attached.

⚠️ **The controls are the part this codebase is historically worst at.** An
emergency stop, a per-account pause, a server-side cap — every one is the same
shape as the suppression list that had every write path and no read path, and
the sequence sender that did not exist while the UI reported sending. Those cost
us credibility. A stop button that has never been proven to stop anything costs
the customer their account.

## COST IMPACT

**NONE.** Documentation only; no code, no schema, no dependency.

## LIMITATIONS — mandatory per §10

- **No vendor is named per row.** The matrix is by access method deliberately:
  vendors change category (and name) faster than a document is revised, and a
  named-vendor list would be stale and read as an approved-supplier list.
- **The ToS reading is not legal advice.** It states the widely-documented
  position that third-party automation operates against LinkedIn's User
  Agreement. If the owner intends to proceed, that is a question for a lawyer,
  and this file is the brief to hand them.
- **Nothing here is enforced by a test.** It is a decision document. The controls
  in §6 become testable in Phase 17 and must be verified there by breaking them,
  not by reading them.
- **Partner API availability was not confirmed by application.** Row B is
  recorded as unavailable on the strength of the programme's published scope,
  not a rejection letter. If the owner wants that closed properly, applying is
  the way.

## OPEN QUESTION → `04_DECISIONS_NEEDED.md`

**DECISION-17: does Outlio enter the LinkedIn channel at all?**
