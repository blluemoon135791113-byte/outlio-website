"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { CALENDLY_URL } from "../lib/constants";

/**
 * Surface-aware navigation.
 *
 * Outlio runs three products with three different buyers. One shared nav meant
 * a visitor on the Lead Engine page was offered "Motion Graphic Ads" and had no
 * link to the pricing sitting further down the page they were already reading.
 *
 * Each surface therefore declares its own links and CTAs below. The logo always
 * returns to the main site, so a product page is never a dead end.
 *
 * Anchors are REAL ids on each page — see the `id=` attributes in
 * app/page.tsx, app/leadengine/page.tsx and app/explainers/page.tsx. A link
 * here that points at a missing anchor silently does nothing, so check the
 * target exists before adding one.
 */
export type NavSurface = "agency" | "leadengine" | "motion";

type NavLink = { label: string; href: string };

type NavCta = {
  label: string;
  href: string;
  /** Accent-filled. One per surface at most. */
  primary?: boolean;
  external?: boolean;
};

type SurfaceConfig = {
  links: NavLink[];
  /** The agency surface alone has enough services to warrant a dropdown. */
  servicesDropdown: boolean;
  ctas: NavCta[];
};

const SERVICES = [
  { name: "Outbound", tagline: "Multi-channel client acquisition" },
  { name: "Growth Accelerator", tagline: "Custom growth strategy" },
];

const SURFACES: Record<NavSurface, SurfaceConfig> = {
  /* The hub. Keeps cross-links to both products. */
  agency: {
    links: [
      { label: "How it works", href: "/#how" },
      { label: "Results", href: "/#results" },
      { label: "Pricing", href: "/#pricing" },
      { label: "Motion Graphic Ads", href: "/explainers" },
    ],
    servicesDropdown: true,
    ctas: [
      { label: "Try Outlio's Lead Engine", href: "/leadengine", primary: true },
      { label: "Book a call", href: CALENDLY_URL, external: true },
    ],
  },

  /* Self-serve SaaS. Its buyer wants price and proof, not agency services. */
  leadengine: {
    links: [
      { label: "How it works", href: "/leadengine#how-it-works" },
      { label: "Product", href: "/leadengine#product-preview" },
      { label: "Pricing", href: "/leadengine#pricing" },
    ],
    servicesDropdown: false,
    ctas: [
      { label: "Start free trial", href: "/sign-up", primary: true },
      { label: "Sign In", href: "/sign-in" },
    ],
  },

  /* Project work. One page, so one link plus a route back to outbound. */
  motion: {
    links: [
      { label: "Our work", href: "/explainers#work" },
      { label: "Outbound", href: "/#services" },
    ],
    servicesDropdown: false,
    ctas: [{ label: "Book a call", href: CALENDLY_URL, external: true, primary: true }],
  },
};

interface NavProps {
  /** Which product's navigation to render. */
  surface?: NavSurface;
}

export default function Nav({ surface = "agency" }: NavProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const config = SURFACES[surface];
  const closeMobile = () => setIsMobileMenuOpen(false);

  const externalProps = (cta: NavCta) =>
    cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {};

  return (
    <header className="sticky top-0 z-50 bg-paper/90 backdrop-blur-md">
      <div className="relative flex items-stretch border-b border-ink">
        <Link
          href="/"
          className="relative flex items-center border-r border-ink px-5 py-3.5"
          aria-label="Outlio home"
        >
          <Image src="/outlio logo.png" alt="Outlio" width={50} height={20} priority className="object-contain rounded-lg" />
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden items-center gap-8 px-8 text-[15px] font-medium md:flex">
          {config.links.map((l) => (
            <Link key={l.label} href={l.href} className="transition-colors hover:text-accent">
              {l.label}
            </Link>
          ))}

          {config.servicesDropdown && (
            <div
              className="relative group"
              onMouseEnter={() => setIsDropdownOpen(true)}
              onMouseLeave={() => setIsDropdownOpen(false)}
            >
              <Link
                href="/#services"
                className="flex items-center gap-1 transition-colors hover:text-accent"
              >
                Services
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </Link>

              {isDropdownOpen && (
                <div className="absolute left-0 top-full pt-2">
                  <div
                    className="w-72 rounded-2xl border border-white/30 shadow-xl backdrop-blur-xl"
                    style={{
                      background: 'linear-gradient(160deg, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0.65) 100%)',
                      backdropFilter: 'blur(24px) saturate(180%)',
                      WebkitBackdropFilter: 'blur(24px) saturate(180%)'
                    }}
                  >
                    <div className="p-2">
                      {SERVICES.map((service) => (
                        <Link
                          key={service.name}
                          href={`/#${service.name.toLowerCase().replace(/\s+/g, '-')}`}
                          onClick={() => setIsDropdownOpen(false)}
                          className="block w-full text-left rounded-xl p-4 transition-all hover:bg-white/40"
                        >
                          <div className="font-semibold text-ink">{service.name}</div>
                          <div className="mt-1 text-xs text-muted">{service.tagline}</div>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Desktop CTAs */}
        <div className="relative ml-auto hidden items-stretch border-l border-ink md:flex">
          <span
            aria-hidden
            className="absolute -bottom-[6px] -left-[6px] z-10 size-[10px] rotate-45 bg-ink"
          />
          {config.ctas.map((cta, i) => (
            <Link
              key={cta.label}
              href={cta.href}
              {...externalProps(cta)}
              className={
                cta.primary
                  ? "flex items-center gap-2 border-r border-ink bg-accent px-6 text-[15px] font-semibold text-cream transition-colors hover:bg-accent-deep"
                  : "flex items-center px-6 text-[15px] font-semibold transition-colors hover:bg-ink hover:text-cream"
              }
              style={
                // The last CTA never needs a right border; the header edge is it.
                cta.primary && i === config.ctas.length - 1 ? { borderRight: 0 } : undefined
              }
            >
              {cta.label}
              {cta.primary && (
                <svg
                  aria-hidden
                  viewBox="0 0 20 20"
                  className="size-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 10h11M11 5l5 5-5 5" />
                </svg>
              )}
            </Link>
          ))}
        </div>

        {/* Mobile Hamburger Button */}
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="ml-auto flex items-center px-5 py-3.5 md:hidden"
          aria-label="Toggle menu"
        >
          <div className="flex flex-col gap-1.5">
            <span className={`block h-0.5 w-6 bg-ink transition-transform ${isMobileMenuOpen ? 'rotate-45 translate-y-2' : ''}`} />
            <span className={`block h-0.5 w-6 bg-ink transition-opacity ${isMobileMenuOpen ? 'opacity-0' : ''}`} />
            <span className={`block h-0.5 w-6 bg-ink transition-transform ${isMobileMenuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
          </div>
        </button>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="border-b border-ink bg-paper md:hidden">
          <nav className="mx-auto max-w-7xl px-6 py-6">
            <div className="space-y-4">
              {config.links.map((l) => (
                <Link
                  key={l.label}
                  href={l.href}
                  className="block text-base font-medium transition-colors hover:text-accent"
                  onClick={closeMobile}
                >
                  {l.label}
                </Link>
              ))}

              {config.servicesDropdown && (
                <div className="border-t border-ink/10 pt-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">Services</p>
                  {SERVICES.map((service) => (
                    <Link
                      key={service.name}
                      href={`/#${service.name.toLowerCase().replace(/\s+/g, '-')}`}
                      className="block py-2 text-base font-medium transition-colors hover:text-accent"
                      onClick={closeMobile}
                    >
                      {service.name}
                    </Link>
                  ))}
                </div>
              )}

              {config.ctas.map((cta) => (
                <Link
                  key={cta.label}
                  href={cta.href}
                  {...externalProps(cta)}
                  className={
                    cta.primary
                      ? "mt-4 block rounded-full bg-accent px-6 py-3 text-center text-base font-semibold text-cream transition-colors hover:bg-accent-deep"
                      : "mt-3 block rounded-full bg-ink px-6 py-3 text-center text-base font-semibold text-cream transition-colors hover:bg-accent"
                  }
                  onClick={closeMobile}
                >
                  {cta.label}
                </Link>
              ))}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
