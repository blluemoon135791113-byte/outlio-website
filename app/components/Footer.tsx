import Image from "next/image";
import Link from "next/link";

const FOOTER_NAV = [
  { label: "Offers", href: "/#offers" },
  { label: "How it works", href: "/#how" },
  { label: "Results", href: "/#results" },
  { label: "Motion Graphic Ads", href: "/explainers" },
  { label: "Lead Engine Pricing", href: "/leadengine/pricing" },
  { label: "About", href: "/#about" },
  { label: "FAQ", href: "/#faq" },
  { label: "Book a call", href: "#book" },
];

const LEGAL_NAV = [
  { label: "Terms and Conditions", href: "/terms" },
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Lead Engine Terms", href: "/leadengine/terms" },
  { label: "Lead Engine Privacy", href: "/leadengine/privacy" },
  { label: "Refund Policy", href: "/leadengine/refund-policy" },
];

const LEAD_ENGINE_LEGAL_NAV = [
  { label: "Lead Engine Terms", href: "/leadengine/terms" },
  { label: "Lead Engine Privacy", href: "/leadengine/privacy" },
  { label: "Refund Policy", href: "/leadengine/refund-policy" },
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

type FooterProps = {
  surface?: "main" | "leadengine";
};

const LEAD_ENGINE_NAV = [
  { label: "Product", href: "/leadengine" },
  { label: "How it works", href: "/leadengine#how-it-works" },
  { label: "Pricing", href: "/leadengine/pricing" },
  { label: "Sign in", href: "/sign-in" },
];

export default function Footer({ surface = "main" }: FooterProps) {
  const productLinks = surface === "leadengine" ? LEAD_ENGINE_NAV : FOOTER_NAV.slice(0, 6);
  const moreLinks = surface === "leadengine" ? [] : FOOTER_NAV.slice(6);
  const legalLinks = surface === "leadengine" ? LEAD_ENGINE_LEGAL_NAV : LEGAL_NAV;

  return (
    <footer className="bg-panel">
      <div className="mx-auto max-w-7xl px-6 pb-8 pt-12 sm:px-10 sm:pt-16">
        <a href="mailto:husnain@outlio.io" className="flex w-fit items-center gap-3">
          <Image src="/outlio logo.png" alt="Outlio" width={50} height={20} className="object-contain rounded-lg" />
          <span className="text-xl font-semibold tracking-tight sm:text-2xl">husnain@outlio.io</span>
        </a>

        <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest">
              {surface === "leadengine" ? "Lead Engine software" : "Outlio"}
            </p>
            <ul className="mt-4 space-y-2 text-sm text-muted">
              {productLinks.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="transition-colors hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            {moreLinks.length ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-widest">More</p>
                <ul className="mt-4 space-y-2 text-sm text-muted">
                  {moreLinks.map((l) => (
                    <li key={l.label}>
                      <Link href={l.href} className="transition-colors hover:text-ink">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <p className={moreLinks.length ? "mt-6 text-xs font-semibold uppercase tracking-widest" : "text-xs font-semibold uppercase tracking-widest"}>Legal</p>
            <ul className="mt-4 space-y-2 text-sm text-muted">
              {legalLinks.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="transition-colors hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            {surface === "leadengine" ? (
              <p className="max-w-sm text-sm leading-6 text-muted">
                Lead Engine is self-serve software. Paddle checkout is used only
                for software subscriptions and never for Outlio&apos;s separately
                contracted human services.
              </p>
            ) : (
              <p className="text-sm text-muted">Growth, done by hand.</p>
            )}
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-ink/10 pt-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p>&copy; Outlio. All rights reserved.</p>
            <p className="mt-0.5">
              {surface === "leadengine"
                ? "Self-serve software subscriptions. No managed outreach included."
                : "Human-written outreach since day one. No autopilot."}
            </p>
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
