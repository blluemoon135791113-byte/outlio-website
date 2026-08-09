"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

const LINKS = [
  { label: "How it works", anchor: "#how" },
  { label: "Results", anchor: "#results" },
];

const SERVICES = [
  { name: "Outbound", tagline: "Multi-channel client acquisition" },
  { name: "Growth Accelerator", tagline: "Custom growth strategy" },
];

interface NavProps {
  homePrefix?: string;
  finalCta?: "book-call" | "sign-in";
}

export default function Nav({ homePrefix = "", finalCta = "book-call" }: NavProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const finalCtaHref = finalCta === "sign-in"
    ? "/sign-in"
    : "https://calendly.com/blluemoon135791113/30min";
  const finalCtaLabel = finalCta === "sign-in" ? "Sign In" : "Book a call";

  return (
    <header className="sticky top-0 z-50 bg-paper/90 backdrop-blur-md">
      <div className="relative flex items-stretch border-b border-ink">
        <Link
          href={homePrefix === "" ? "/" : homePrefix}
          className="relative flex items-center border-r border-ink px-5 py-3.5"
          aria-label="Outlio home"
        >
          <Image src="/outlio logo.png" alt="Outlio" width={50} height={20} priority className="object-contain rounded-lg" />
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden items-center gap-8 px-8 text-[15px] font-medium md:flex">
          {LINKS.map((l) => (
            <Link key={l.label} href={`${homePrefix}${l.anchor}`} className="transition-colors hover:text-accent">
              {l.label}
            </Link>
          ))}

          {/* Services Dropdown */}
          <div
            className="relative group"
            onMouseEnter={() => setIsDropdownOpen(true)}
            onMouseLeave={() => setIsDropdownOpen(false)}
          >
            <Link
              href={`${homePrefix}#services`}
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
                        href={`${homePrefix}#${service.name.toLowerCase().replace(/\s+/g, '-')}`}
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

          <Link href="/explainers" className="transition-colors hover:text-accent">
            Motion Graphic Ads
          </Link>
        </nav>

        {/* Desktop CTAs */}
        <div className="relative ml-auto hidden items-stretch border-l border-ink md:flex">
          <span
            aria-hidden
            className="absolute -bottom-[6px] -left-[6px] z-10 size-[10px] rotate-45 bg-ink"
          />
          {/* Product entry point. Accent-filled so it reads as the newer,
              self-serve path next to the sales-led "Book a call". */}
          <Link
            href="/leadengine"
            className="flex items-center gap-2 border-r border-ink bg-accent px-6 text-[15px] font-semibold text-cream transition-colors hover:bg-accent-deep"
          >
            Try Outlio&apos;s Lead Engine
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
          </Link>
          <Link
            href={finalCtaHref}
            {...(finalCta === "book-call"
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
            className="flex items-center px-6 text-[15px] font-semibold transition-colors hover:bg-ink hover:text-cream"
          >
            {finalCtaLabel}
          </Link>
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
              {LINKS.map((l) => (
                <Link
                  key={l.label}
                  href={`${homePrefix}${l.anchor}`}
                  className="block text-base font-medium transition-colors hover:text-accent"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {l.label}
                </Link>
              ))}

              {/* Mobile Services */}
              <div className="border-t border-ink/10 pt-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">Services</p>
                {SERVICES.map((service) => (
                  <Link
                    key={service.name}
                    href={`${homePrefix}#${service.name.toLowerCase().replace(/\s+/g, '-')}`}
                    className="block py-2 text-base font-medium transition-colors hover:text-accent"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    {service.name}
                  </Link>
                ))}
              </div>

              <Link
                href="/explainers"
                className="block text-base font-medium transition-colors hover:text-accent"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Motion Graphic Ads
              </Link>

              {/* Mobile CTAs */}
              <Link
                href="/leadengine"
                className="mt-4 block rounded-full bg-accent px-6 py-3 text-center text-base font-semibold text-cream transition-colors hover:bg-accent-deep"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Try Outlio&apos;s Lead Engine
              </Link>
              <Link
                href={finalCtaHref}
                {...(finalCta === "book-call"
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                className="mt-3 block rounded-full bg-ink px-6 py-3 text-center text-base font-semibold text-cream transition-colors hover:bg-accent"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                {finalCtaLabel}
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
