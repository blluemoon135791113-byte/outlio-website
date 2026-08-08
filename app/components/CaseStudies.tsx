"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

type CaseStudy = {
  name: string;
  logo: string;
  teaser: string;
  story: string[];
  resultsHeading: string;
  results: string[];
};

const CASES: CaseStudy[] = [
  {
    name: "Addx Studio",
    logo: "/clients/addx.png",
    teaser: "Content agency → $100K+ MRR in six months.",
    story: [
      "Content marketing agency. No sales function. Abdullah, the founder, was doing it himself, badly, between everything else.",
      "We built the outreach from scratch: manual prospecting, then a value-first Loom method with deep research per prospect, a custom video, and no pitch. Just useful.",
      "It converted. 3–4 qualified calls a week, ~80% strong leads.",
    ],
    resultsHeading: "Results",
    results: [
      "Six months in: $100K+ MRR and 53+ meetings booked. Then the explainer video we produced hit on Instagram, bringing roughly 10 booked meetings a day. Once cash flow allowed, we layered a paid Meta campaign on top.",
      "The same playbook landed several high-profile creator and personal-brand clients along the way.",
    ],
  },
  {
    name: "Click Labs",
    logo: "/clients/clicklabs.png",
    teaser: "A village guy grew his YouTube agency from scratch.",
    story: [
      "Aamir came from a village with nothing but exceptional thumbnail design skills.",
      "We told him to package it as an agency. We built his website, ran his outreach, and put his thumbnails in front of clients who valued work that could pull massive audiences.",
    ],
    resultsHeading: "Results",
    results: [
      "23 calls booked in under 2.5 months. $10,000 generated from thumbnails alone. Then we helped him hire his own backend team.",
      "Full done-for-you delivery from start to finish, with personalized outreach throughout. Clients we closed for him include Familia Diamond (13M subs), Browney (11.6M subs), Gloom (7.91M subs), and Doc Williams (50K subs).",
    ],
  },
  {
    name: "Motionisr",
    logo: "/clients/motionisr.png",
    teaser: "From bank account manager to £100K-track motion studio.",
    story: [
      "Nisar was a bank account manager in Birmingham with editing skills, a passion for motion graphics, and zero time to find clients or sell himself. No portfolio, no case studies, no leverage. Just a 9-to-5 while working hard for his family.",
      "We planned everything from scratch. We started on Upwork with low-ticket work, moved into mid-ticket projects, then took him to X where the larger opportunities were. Traction was hard at first. We got there.",
      "First client: Evie, who needed a storyboard for her AI blog-scaling SaaS. Second: Branko, founder of Fluid CRM, who wanted a motion-graphics explainer. Nisar couldn't believe he was working with companies like that.",
      "We studied the products, researched the clients, made the videos, and built his brand from zero.",
    ],
    resultsHeading: "Results",
    results: [
      "$20,000 generated in 2.5 months across Upwork and X, including closing Branko of Fluid CRM, a SaaS founder with a real audience of his own.",
    ],
  },
  {
    name: "Knowledge City",
    logo: "/clients/knowledgecity.png",
    teaser: "Why a big company came to us for BD support.",
    story: [
      "Knowledge City runs an LMS SaaS for whole companies, similar to Coursera or Udemy for business teams. Their buyers are mid-to-large firms with 50 to 100+ employees, mostly in manufacturing, construction, and safety management. High-ticket deals start at $50K.",
    ],
    resultsHeading: "Results",
    results: [
      "Their internal target was 2–3 qualified calls a month. We beat it in month one with 4 qualified calls from the right buyers.",
      "They brought us on as their outsourced sales and business development partner. From there, they closed deals with firms like Coca-Cola and Mercedes, generating just under half a million dollars in revenue from our outreach.",
    ],
  },
];

export default function CaseStudies() {
  const [open, setOpen] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {
    if (open === null) return;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("button")?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab" && panel) {
        const focusables = panel.querySelectorAll<HTMLElement>("button, a[href]");
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const activeCase = open !== null ? CASES[open] : null;

  return (
    <>
      <div className="grid gap-px overflow-hidden border border-ink/10 bg-ink/10 sm:grid-cols-2">
        {CASES.map((c, i) => (
          <button
            key={c.name}
            type="button"
            onClick={() => setOpen(i)}
            className={`group p-8 text-left transition-all duration-500 backdrop-blur-xl border border-white/30 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10 sm:p-10 ${
              i === 0 ? "sm:col-span-2" : ""
            }`}
            style={{
              background: 'linear-gradient(160deg, rgba(255, 255, 255, 0.7) 0%, rgba(255, 255, 255, 0.4) 100%)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)'
            }}
          >
            {i === 0 && (
              <span className="mb-4 inline-block rounded-full bg-accent px-3 py-1 text-xs font-semibold uppercase tracking-widest text-cream">
                Featured
              </span>
            )}
            <span className="flex items-center gap-4">
              <Image
                src={c.logo}
                alt=""
                width={48}
                height={48}
                className="max-h-12 w-auto rounded-lg object-contain"
              />
              <span className="block text-2xl font-semibold tracking-tight sm:text-3xl">{c.name}</span>
            </span>
            <span className="mt-3 block max-w-xl text-lg text-muted">{c.teaser}</span>
            <span className="mt-6 inline-flex items-center gap-2 font-medium text-accent">
              Read the story
              <span aria-hidden className="transition-transform group-hover:translate-x-1">
                &rarr;
              </span>
            </span>
          </button>
        ))}
      </div>

      {activeCase && (
        <div
          className="modal-backdrop fixed inset-0 z-[60] grid place-items-center bg-ink/40 p-4 backdrop-blur-md sm:p-8"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label={`${activeCase.name} case study`}
        >
          <div
            ref={panelRef}
            onClick={(e) => e.stopPropagation()}
            className="modal-panel max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/60 p-8 shadow-2xl backdrop-blur-2xl sm:p-12"
            style={{
              background: 'linear-gradient(160deg, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0.65) 100%)',
              backdropFilter: 'blur(30px) saturate(180%)',
              WebkitBackdropFilter: 'blur(30px) saturate(180%)'
            }}
          >
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-accent">Case study</p>
                <h3 className="mt-2 flex items-center gap-4 text-3xl font-bold tracking-tight sm:text-4xl">
                  <Image
                    src={activeCase.logo}
                    alt=""
                    width={44}
                    height={44}
                    className="max-h-11 w-auto rounded-lg object-contain"
                  />
                  {activeCase.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-cream transition-colors hover:bg-accent"
              >
                <span aria-hidden>&times;</span>
              </button>
            </div>

            <div className="mt-8 space-y-4 text-[17px] leading-relaxed text-ink/80">
              {activeCase.story.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>

            <p className="mt-8 text-sm font-semibold uppercase tracking-widest text-accent">
              {activeCase.resultsHeading}
            </p>
            <div className="mt-3 space-y-4 text-[17px] leading-relaxed">
              {activeCase.results.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>

            {/* SUPPLIED SEPARATELY: founder's scheduling link */}
            <a
              href="#book"
              onClick={close}
              className="mt-10 inline-flex items-center gap-2 rounded-full bg-ink px-7 py-3.5 font-semibold text-cream transition-colors hover:bg-accent"
            >
              Book a call <span aria-hidden>&rarr;</span>
            </a>
          </div>
        </div>
      )}
    </>
  );
}
