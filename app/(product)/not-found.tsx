import Link from 'next/link'

/**
 * The designed not-found state for every authenticated screen.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  SIX PRODUCT PAGES CALL `notFound()` AND THE ONLY FALLBACK WAS THE         ║
 * ║  MARKETING 404.                                                           ║
 * ║                                                                           ║
 * ║  A contact, a company, a campaign, a thread, a flow and a saved dashboard  ║
 * ║  all end in `notFound()` when the id does not resolve. With no            ║
 * ║  `not-found.tsx` under `(product)`, Next walked all the way to             ║
 * ║  `app/not-found.tsx` — a full-viewport marketing page with its own         ║
 * ║  background, no product navigation, and links to Pricing, Terms and        ║
 * ║  Privacy.                                                                 ║
 * ║                                                                           ║
 * ║  So a setter who opened a contact a colleague had just deleted was thrown  ║
 * ║  out of the product and offered the pricing page. Signed in, mid-task,     ║
 * ║  looking at marketing.                                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ IT DOES NOT CLAIM THE RECORD WAS DELETED, AND IT MUST NOT.
 *
 * Every one of those six pages scopes its lookup to the caller's workspace —
 * and a setter's to their own assigned records — so `notFound()` fires for two
 * different reasons that the server deliberately does not distinguish: the row
 * is gone, or it exists and is not theirs to see. Saying "this was deleted"
 * would be a fabricated fact in the first sense of CLAUDE.md rule 4, and saying
 * "you do not have access to this record" would confirm that a record exists —
 * which is the leak the shared 404 is there to prevent.
 *
 * Naming both possibilities without choosing between them is the only honest
 * copy available, and it happens to be the most useful too: both readings tell
 * the reader to go ask someone.
 */
export default function ProductNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <section className="clay w-full max-w-md space-y-4 p-6 text-center">
        <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink">
          We could not find that
        </h1>

        <p className="text-sm leading-relaxed text-muted">
          That record is not in your workspace. It may have been deleted, or it may
          belong to a workspace or a colleague you do not have access to. Nothing is
          wrong with your account.
        </p>

        {/*
          ⚠️ PRODUCT DESTINATIONS, NOT MARKETING ONES. The reader is signed in and
          halfway through a task; "Pricing" is not a recovery. These are the two
          places a lost lookup most plausibly came from.
        */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/crm/contacts"
            className="rounded-[var(--radius-md)] bg-accent px-4 py-2 text-sm font-semibold text-cream shadow-[var(--shadow-button)] transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.98]"
          >
            Back to contacts
          </Link>
          <Link
            href="/dashboard"
            className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-semibold text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink"
          >
            Overview
          </Link>
        </div>
      </section>
    </div>
  )
}
