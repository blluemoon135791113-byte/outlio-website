import { ValueProvenance } from '@/components/crm/ValueProvenance'
import type { CompanyDetails, DetailItem } from '@/lib/crm/company-details'

/**
 * The micro detail — funding, tech stack, socials, news — kept out of the way.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ A `<details>` ELEMENT, NOT A `useState` DISCLOSURE. It collapses with  ║
 * ║  no JavaScript, it is keyboard-operable and screen-reader-announced for    ║
 * ║  free, and it renders collapsed on the server — so nothing here can push   ║
 * ║  the fields somebody actually came for below the fold while React boots.  ║
 * ║                                                                           ║
 * ║  ⚠️ AND IT IS THE REASON THE MAIN FIELDS STAY SHORT. Tech stack alone can  ║
 * ║  be forty vendor names; inlining it would bury the email address under a  ║
 * ║  wall of CDN trivia. Two tiers exist so the first one can be answered at  ║
 * ║  a glance.                                                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

function Item({ item }: { item: DetailItem }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.08em] text-muted">{item.label}</dt>
      <dd className="mt-0.5 text-sm leading-relaxed text-ink">
        {item.links ? (
          <ul className="space-y-1">
            {item.links.map((link) => (
              <li key={link.url}>
                <a
                  href={link.url}
                  /*
                   * ⚠️ EVERY ONE OF THESE URLS CAME OFF A CRAWLED PAGE.
                   * `safeSourceUrl` has already rejected anything that is not
                   * http(s); `noopener noreferrer` stops the opened tab reaching
                   * back into ours and stops the target learning which customer
                   * looked at it, and `nofollow` keeps us from endorsing it.
                   */
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="underline decoration-border decoration-dotted underline-offset-2 transition-colors duration-150 hover:text-accent hover:decoration-accent"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          item.text
        )}
      </dd>
      {/*
        ⚠️ EVERY ITEM CARRIES ITS CITATION, exactly as the main fields do.
        These values are RESEARCHED — a funding round or a detected vendor is a
        third party's claim about a company, and it is worth less to the reader
        without the provider and date beside it. Rule 4's point is that a stored
        value can be checked.
      */}
      <dd className="mt-0.5">
        <ValueProvenance provenance={item.provenance} />
      </dd>
    </div>
  )
}

function Group({ title, items }: { title: string; items: DetailItem[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <h4 className="text-xs font-semibold tracking-[-0.01em] text-ink">{title}</h4>
      <dl className="mt-2 grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <Item key={`${title}:${item.label}`} item={item} />
        ))}
      </dl>
    </div>
  )
}

export function MoreDetails({ details }: { details: CompanyDetails }) {
  const count = Object.values(details).reduce((n, group) => n + group.length, 0)

  /*
   * ⚠️ NOTHING TO SHOW MEANS NOTHING IS SHOWN. An empty "More details" that
   * opens onto blank space teaches people not to open it again — and it makes a
   * claim we cannot support, that we looked and found nothing, when in fact this
   * company was never researched.
   */
  if (count === 0) return null

  return (
    <details className="clay group p-4 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">More details</span>
        <span className="text-xs text-muted">
          {count} {count === 1 ? 'detail' : 'details'}
          {/* Rotates on open. 150ms — the motion ceiling for product surfaces. */}
          <span
            aria-hidden="true"
            className="ml-2 inline-block transition-transform duration-150 group-open:rotate-90"
          >
            ›
          </span>
        </span>
      </summary>

      <div className="mt-4 space-y-4 border-t border-line pt-4">
        <Group title="Funding" items={details.funding} />
        <Group title="Tech stack" items={details.techStack} />
        <Group title="Recent news" items={details.news} />
        <Group title="Social profiles" items={details.social} />
        <Group title="Other" items={details.other} />
      </div>
    </details>
  )
}
