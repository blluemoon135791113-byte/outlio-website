"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CALENDLY_URL, CHROME_EXTENSION_URL } from "../lib/constants";
import { APP_ORIGIN } from "@/lib/site";
import styles from "./AgencySplitNav.module.css";

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
 * app/page.tsx, app/app-home/page.tsx and app/explainers/page.tsx. A link
 * here that points at a missing anchor silently does nothing, so check the
 * target exists before adding one.
 *
 * The Lead Engine links are all root-relative because that surface only ever
 * renders on app.outlio.io, where the product lives at `/`. The agency surface
 * reaches it with one absolute link to APP_ORIGIN and nothing else — visitors
 * are never bounced back and forth between the two domains.
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
      { label: "Try Outlio's Lead Engine", href: APP_ORIGIN, primary: true },
      { label: "Book a call", href: CALENDLY_URL, external: true },
    ],
  },

  /* Self-serve SaaS. Its buyer wants price and proof, not agency services. */
  leadengine: {
    links: [
      { label: "How it works", href: "/how-it-works" },
      { label: "Product", href: "/product" },
      { label: "Pricing", href: "/pricing" },
      { label: "Download the extension", href: CHROME_EXTENSION_URL, external: true },
    ],
    ctas: [
      { label: "Get started", href: "/sign-up", primary: true },
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
  const [agencyNavAppearance, setAgencyNavAppearance] = useState<"top" | "compact">("top");
  const [isAgencyNavHidden, setIsAgencyNavHidden] = useState(false);
  const agencyHeaderRef = useRef<HTMLElement>(null);
  const agencyMenuButtonRef = useRef<HTMLButtonElement>(null);
  const isMobileMenuOpenRef = useRef(isMobileMenuOpen);

  const config = SURFACES[surface];
  const closeMobile = () => {
    isMobileMenuOpenRef.current = false;
    setIsMobileMenuOpen(false);
  };

  const externalProps = (item: { external?: boolean }) =>
    item.external ? { target: "_blank", rel: "noopener noreferrer" } : {};

  useEffect(() => {
    if (surface !== "agency") return;

    const topThreshold = 40;
    const hideThreshold = 100;
    const movementThreshold = 14;
    let lastScrollY = Math.max(0, window.scrollY);
    let direction: "up" | "down" | null = null;
    let accumulatedMovement = 0;
    let frameId: number | null = null;
    const initializationFrameId = window.requestAnimationFrame(() => {
      setAgencyNavAppearance(lastScrollY <= topThreshold ? "top" : "compact");
      setIsAgencyNavHidden(false);
    });

    const updateNavigation = () => {
      frameId = null;
      const scrollY = Math.max(0, window.scrollY);
      const delta = scrollY - lastScrollY;
      lastScrollY = scrollY;

      if (scrollY <= topThreshold) {
        direction = null;
        accumulatedMovement = 0;
        setAgencyNavAppearance("top");
        setIsAgencyNavHidden(false);
        return;
      }

      const hasProtectedInteraction =
        isMobileMenuOpenRef.current ||
        agencyHeaderRef.current?.contains(document.activeElement) === true;

      if (hasProtectedInteraction) {
        direction = null;
        accumulatedMovement = 0;
        setAgencyNavAppearance("compact");
        setIsAgencyNavHidden(false);
        return;
      }

      if (Math.abs(delta) < 1) return;

      const nextDirection = delta > 0 ? "down" : "up";
      if (direction !== nextDirection) {
        direction = nextDirection;
        accumulatedMovement = Math.abs(delta);
      } else {
        accumulatedMovement += Math.abs(delta);
      }

      if (accumulatedMovement < movementThreshold) return;

      if (nextDirection === "down" && scrollY > hideThreshold) {
        setIsAgencyNavHidden(true);
        accumulatedMovement = 0;
      } else if (nextDirection === "up") {
        setAgencyNavAppearance("compact");
        setIsAgencyNavHidden(false);
        accumulatedMovement = 0;
      }
    };

    const scheduleUpdate = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(updateNavigation);
    };

    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.cancelAnimationFrame(initializationFrameId);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [surface]);

  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      isMobileMenuOpenRef.current = false;
      setIsMobileMenuOpen(false);
      agencyMenuButtonRef.current?.focus();
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isMobileMenuOpen]);

  if (surface === "leadengine") {
    const glassLinks: NavLink[] = [
      { label: "Platform", href: "/product" },
      { label: "Pricing", href: "/pricing" },
      { label: "Get Extension", href: CHROME_EXTENSION_URL, external: true },
    ];

    return (
      <header className="pointer-events-none fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
        <div className="pointer-events-auto relative mx-auto flex min-h-16 w-full max-w-[1800px] items-center rounded-[2rem] border border-white/[0.14] bg-black/70 px-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_18px_55px_rgba(0,0,0,0.38)] backdrop-blur-2xl supports-[backdrop-filter]:bg-black/55 sm:px-3">
          <Link
            href="/"
            className="flex shrink-0 items-center rounded-[1.35rem] p-1 transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
            aria-label="Outlio home"
          >
            <span className="relative flex size-12">
              <Image
                src="/outlio logo.png"
                alt="Outlio"
                width={48}
                height={48}
                preload
                className="object-cover [clip-path:circle(32.8%_at_50%_50%)]"
              />
            </span>
          </Link>

          <nav
            aria-label="Lead Engine navigation"
            className="ml-2 hidden items-center gap-1 md:flex lg:ml-4 lg:gap-2"
          >
            {glassLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                {...externalProps(link)}
                className="rounded-full border border-transparent px-4 py-2.5 text-sm font-semibold text-white transition-[transform,background-color,border-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-white/[0.14] hover:bg-white/[0.07] active:scale-[0.97] lg:px-5"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <Link
            href={CALENDLY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex min-h-11 items-center rounded-full border border-white/20 bg-white/[0.08] px-4 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.10)] transition-[transform,background-color,border-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-white/35 hover:bg-white/[0.14] active:scale-[0.97] sm:px-5"
          >
            Book a Demo
          </Link>

          <button
            type="button"
            onClick={() => setIsMobileMenuOpen((open) => !open)}
            className="ml-1 flex size-11 shrink-0 items-center justify-center rounded-full text-white transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-white/[0.08] active:scale-[0.97] md:hidden"
            aria-label="Toggle navigation"
            aria-expanded={isMobileMenuOpen}
            aria-controls="lead-engine-mobile-navigation"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              className="size-5"
            >
              {isMobileMenuOpen ? (
                <>
                  <path d="m6 6 12 12" />
                  <path d="M18 6 6 18" />
                </>
              ) : (
                <>
                  <path d="M5 8h14" />
                  <path d="M5 16h14" />
                </>
              )}
            </svg>
          </button>

          {isMobileMenuOpen && (
            <nav
              id="lead-engine-mobile-navigation"
              aria-label="Lead Engine mobile navigation"
              className="absolute inset-x-0 top-[calc(100%+0.5rem)] rounded-[1.65rem] border border-white/[0.14] bg-black/85 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_20px_55px_rgba(0,0,0,0.45)] backdrop-blur-2xl md:hidden"
            >
              {glassLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  {...externalProps(link)}
                  onClick={closeMobile}
                  className="block rounded-full px-5 py-3 text-sm font-semibold text-white transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-white/[0.08] active:scale-[0.98]"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </header>
    );
  }

  if (surface === "agency") {
    const agencyHeaderClassName = [
      styles.header,
      agencyNavAppearance === "top" ? styles.topState : styles.compactState,
      isAgencyNavHidden ? styles.hiddenState : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <header
        ref={agencyHeaderRef}
        className={agencyHeaderClassName}
        onFocusCapture={() => {
          const scrollY = Math.max(0, window.scrollY);
          setAgencyNavAppearance(scrollY <= 40 ? "top" : "compact");
          setIsAgencyNavHidden(false);
        }}
      >
        <div className={styles.container}>
          <Link href="/" className={styles.logoLink} aria-label="Outlio home">
            <Image
              src="/outlio logo.png"
              alt=""
              width={44}
              height={44}
              preload
              className={styles.logo}
            />
          </Link>

          <nav className={styles.desktopNav} aria-label="Primary navigation">
            {config.links.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                {...externalProps(link)}
                className={styles.navLink}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className={styles.desktopActions}>
            <Link
              href={config.ctas[0].href}
              {...externalProps(config.ctas[0])}
              className={`${styles.action} ${styles.leadEngineAction}`}
            >
              <span>{config.ctas[0].label}</span>
              <span aria-hidden>→</span>
            </Link>
            <Link
              href={config.ctas[1].href}
              {...externalProps(config.ctas[1])}
              className={`${styles.action} ${styles.bookAction}`}
            >
              {config.ctas[1].label}
            </Link>
          </div>

          <button
            ref={agencyMenuButtonRef}
            type="button"
            className={styles.menuButton}
            onClick={() => {
              const nextOpen = !isMobileMenuOpen;
              isMobileMenuOpenRef.current = nextOpen;
              if (nextOpen) {
                const scrollY = Math.max(0, window.scrollY);
                setAgencyNavAppearance(scrollY <= 40 ? "top" : "compact");
                setIsAgencyNavHidden(false);
              }
              setIsMobileMenuOpen(nextOpen);
            }}
            aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={isMobileMenuOpen}
            aria-controls="agency-mobile-navigation"
          >
            <span className={styles.menuIcon} aria-hidden>
              <span className={isMobileMenuOpen ? styles.menuLineOpenFirst : styles.menuLine} />
              <span className={isMobileMenuOpen ? styles.menuLineOpenSecond : styles.menuLine} />
            </span>
          </button>

          {isMobileMenuOpen && (
            <nav
              id="agency-mobile-navigation"
              className={styles.mobileMenu}
              aria-label="Mobile navigation"
            >
              <div className={styles.mobileLinks}>
                {config.links.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    {...externalProps(link)}
                    className={styles.mobileLink}
                    onClick={closeMobile}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>

              <div className={styles.mobileActions}>
                <Link
                  href={config.ctas[0].href}
                  {...externalProps(config.ctas[0])}
                  className={`${styles.mobileAction} ${styles.leadEngineAction}`}
                  onClick={closeMobile}
                >
                  <span>{config.ctas[0].label}</span>
                  <span aria-hidden>→</span>
                </Link>
                <Link
                  href={config.ctas[1].href}
                  {...externalProps(config.ctas[1])}
                  className={`${styles.mobileAction} ${styles.bookAction}`}
                  onClick={closeMobile}
                >
                  {config.ctas[1].label}
                </Link>
              </div>
            </nav>
          )}
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-50 bg-paper/90 backdrop-blur-md">
      <div className="relative flex items-stretch border-b border-ink">
        <Link
          href="/"
          className="relative flex items-center border-r border-ink px-5 py-3.5"
          aria-label="Outlio home"
        >
          <Image
            src="/outlio logo.png"
            alt="Outlio"
            width={48}
            height={48}
            preload
            className="size-10 rounded-lg object-contain sm:size-12"
          />
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
