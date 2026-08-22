"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { CALENDLY_URL, CHROME_EXTENSION_URL } from "../lib/constants";

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

type NavLink = { label: string; href: string; external?: boolean };

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
  ctas: NavCta[];
};

const SURFACES: Record<NavSurface, SurfaceConfig> = {
  /* The hub. Keeps cross-links to both products. */
  agency: {
    links: [
      { label: "How it works", href: "/#how" },
      { label: "Results", href: "/#results" },
      { label: "Offers", href: "/#offers" },
      { label: "Motion Graphic Ads", href: "/explainers" },
    ],
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
      { label: "Pricing", href: "/leadengine/pricing" },
      { label: "Download the extension", href: CHROME_EXTENSION_URL, external: true },
    ],
    ctas: [
      { label: "Start free trial", href: "/leadengine/pricing", primary: true },
      { label: "Sign In", href: "/sign-in" },
    ],
  },

  /* Project work. One page, so one link plus a route back to outbound. */
  motion: {
    links: [
      { label: "Our work", href: "/explainers#work" },
    ],
    ctas: [{ label: "Book a call", href: CALENDLY_URL, external: true, primary: true }],
  },
};

interface NavProps {
  /** Which product's navigation to render. */
  surface?: NavSurface;
}

export default function Nav({ surface = "agency" }: NavProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const config = SURFACES[surface];
  const closeMobile = () => setIsMobileMenuOpen(false);

  const externalProps = (item: { external?: boolean }) =>
    item.external ? { target: "_blank", rel: "noopener noreferrer" } : {};

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
            <Link
              key={l.label}
              href={l.href}
              {...externalProps(l)}
              className="transition-colors hover:text-accent"
            >
              {l.label}
            </Link>
          ))}

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
                  {...externalProps(l)}
                  className="block text-base font-medium transition-colors hover:text-accent"
                  onClick={closeMobile}
                >
                  {l.label}
                </Link>
              ))}


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
