import Image from "next/image";
import Link from "next/link";

const FOOTER_NAV = [
  { label: "Services", href: "/#services" },
  { label: "Offers", href: "/#offers" },
  { label: "How it works", href: "/#how" },
  { label: "Results", href: "/#results" },
  { label: "Motion Graphic Ads", href: "/explainers" },
  { label: "About", href: "/#about" },
  { label: "FAQ", href: "/#faq" },
  { label: "Book a call", href: "#book" },
];

const LEGAL_NAV = [
  { label: "Terms and Conditions", href: "/terms" },
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Lead Engine Terms", href: "/leadengine/terms" },
  { label: "Lead Engine Privacy", href: "/leadengine/privacy" },
];

const SOCIALS = [
  { network: "X", icon: "/social/x.svg", href: "https://x.com/OutlioLeadGen" },
  {
    network: "LinkedIn",
    icon: "/social/linkedin.svg",
    href: "https://www.linkedin.com/company/outlio/?viewAsMember=true",
  },
  {
    network: "Instagram",
    icon: "/social/instagram.svg",
    href: "https://www.instagram.com/outlio.io/?hl=en",
  },
];

export default function Footer() {
  return (
    <footer className="bg-panel">
      <div className="mx-auto max-w-7xl px-6 pb-8 pt-12 sm:px-10 sm:pt-16">
        <a href="mailto:husnain@outlio.io" className="flex w-fit items-center gap-3">
          <Image src="/outlio logo.png" alt="Outlio" width={50} height={20} className="object-contain rounded-lg" />
          <span className="text-xl font-semibold tracking-tight sm:text-2xl">husnain@outlio.io</span>
        </a>

        <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest">Outlio</p>
            <ul className="mt-4 space-y-2 text-sm text-muted">
              {FOOTER_NAV.slice(0, 5).map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="transition-colors hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest">More</p>
            <ul className="mt-4 space-y-2 text-sm text-muted">
              {FOOTER_NAV.slice(5).map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="transition-colors hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-xs font-semibold uppercase tracking-widest">Legal</p>
            <ul className="mt-4 space-y-2 text-sm text-muted">
              {LEGAL_NAV.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="transition-colors hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm text-muted">Growth, done by hand.</p>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-ink/10 pt-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p>&copy; Outlio. All rights reserved.</p>
            <p className="mt-0.5">Human-written outreach since day one. No autopilot.</p>
          </div>
          <div className="flex gap-2.5">
            {SOCIALS.map((s) => (
              <a
                key={s.network}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Outlio on ${s.network}`}
                className="overflow-hidden rounded-full ring-1 ring-ink/15 transition-transform hover:scale-110 hover:ring-accent"
              >
                <Image src={s.icon} alt={`${s.network} icon`} width={40} height={40} className="size-10" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
