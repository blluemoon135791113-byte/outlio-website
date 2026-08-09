"use client";

import { useState, useEffect, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";

interface CaseStudy {
  id: string;
  name: string;
  logo: string;
  result: string;
  hasTransparency: boolean;
  paragraphs: string[];
  results: string[];
}

interface OrbitParams {
  radius: number;
  phase: number;
  duration: number;
}

const CASE_STUDIES: CaseStudy[] = [
  {
    id: "1",
    name: "Addx Studio",
    logo: "/clients/addx.png",
    result: "$100K+ MRR in 6 months",
    hasTransparency: false,
    paragraphs: [
      "Content marketing agency. No sales function. Abdullah, the founder, was doing it himself, badly, between everything else.",
      "We built the outreach from scratch: manual prospecting, then a value-first Loom method with deep research per prospect, a custom video, and no pitch. Just useful.",
      "It converted. 3–4 qualified calls a week, ~80% strong leads.",
    ],
    results: [
      "Six months in: $100K+ MRR and 53+ meetings booked. Then the explainer video we produced hit on Instagram, bringing roughly 10 booked meetings a day. Once cash flow allowed, we layered a paid Meta campaign on top.",
      "The same playbook landed several high-profile creator and personal-brand clients along the way.",
    ],
  },
  {
    id: "2",
    name: "Click Labs",
    logo: "/clients/clicklabs.png",
    result: "23 calls + $10K in 2.5 months",
    hasTransparency: true,
    paragraphs: [
      "Aamir came from a village with nothing but exceptional thumbnail design skills.",
      "We told him to package it as an agency. We built his website, ran his outreach, and put his thumbnails in front of clients who valued work that could pull massive audiences.",
    ],
    results: [
      "23 calls booked in under 2.5 months. $10,000 generated from thumbnails alone. Then we helped him hire his own backend team.",
      "Full done-for-you delivery from start to finish, with personalized outreach throughout. Clients we closed for him include Familia Diamond (13M subs), Browney (11.6M subs), Gloom (7.91M subs), and Doc Williams (50K subs).",
    ],
  },
  {
    id: "3",
    name: "Knowledge City",
    logo: "/clients/kc-logo.png",
    result: "~$500K closed revenue",
    hasTransparency: true,
    paragraphs: [
      "Knowledge City runs an LMS SaaS for whole companies, similar to Coursera or Udemy for business teams. Their buyers are mid-to-large firms with 50 to 100+ employees, mostly in manufacturing, construction, and safety management. High-ticket deals start at $50K.",
    ],
    results: [
      "Their internal target was 2–3 qualified calls a month. We beat it in month one with 4 qualified calls from the right buyers.",
      "They brought us on as their outsourced sales and business development partner. From there, they closed deals with firms like Coca-Cola and Mercedes, generating just under half a million dollars in revenue from our outreach.",
    ],
  },
  {
    id: "4",
    name: "Motionisr",
    logo: "/clients/motionisr.png",
    result: "87 calls booked in 4 months",
    hasTransparency: false,
    paragraphs: [
      "Nisar was a bank account manager in Birmingham with editing skills, a passion for motion graphics, and zero time to find clients or sell himself. No portfolio, no case studies, no leverage. Just a 9-to-5 while working hard for his family.",
      "We planned everything from scratch. We started on Upwork with low-ticket work, moved into mid-ticket projects, then took him to X where the larger opportunities were. Traction was hard at first. We got there.",
      "First client: Evie, who needed a storyboard for her AI blog-scaling SaaS. Second: Branko, founder of Fluid CRM, who wanted a motion-graphics explainer. Nisar couldn't believe he was working with companies like that.",
      "We studied the products, researched the clients, made the videos, and built his brand from zero.",
    ],
    results: [
      "$20,000 generated in 2.5 months across Upwork and X, including closing Branko of Fluid CRM, a SaaS founder with a real audience of his own.",
    ],
  },
];

const RING_RADII = [110, 180, 250, 320];

const ORBITS: OrbitParams[] = [
  { radius: RING_RADII[1], phase: 0, duration: (Math.PI * 2) / 0.045 },
  { radius: RING_RADII[1], phase: Math.PI, duration: (Math.PI * 2) / 0.045 },
  { radius: RING_RADII[2], phase: Math.PI * 0.5, duration: (Math.PI * 2) / 0.035 },
  { radius: RING_RADII[3], phase: Math.PI * 1.5, duration: (Math.PI * 2) / 0.025 },
];

const SIZE = 750;
const CX = SIZE / 2;
const CY = SIZE / 2;


export default function OrbitalCaseStudies() {
  const [hoveredCase, setHoveredCase] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCase) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedCase(null);
    };
    document.addEventListener("keydown", handleEsc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = "";
    };
  }, [selectedCase]);

  const selectedStudy = CASE_STUDIES.find((s) => s.id === selectedCase);

  return (
    <div className="relative w-full">

      {/* Centered orbital area */}
      <div className="relative mx-auto w-full max-w-[750px] py-4" style={{ aspectRatio: "1 / 1" }}>
        {/* Orbital rings SVG */}
        <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <defs>
            <linearGradient id="ring-shine" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="white" stopOpacity="0.25" />
              <stop offset="30%" stopColor="white" stopOpacity="0.03" />
              <stop offset="60%" stopColor="white" stopOpacity="0.15" />
              <stop offset="100%" stopColor="white" stopOpacity="0.02" />
            </linearGradient>
            <filter id="ring-glow">
              <feGaussianBlur stdDeviation="0.8" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {RING_RADII.map((r, i) => (
            <g key={`ring-${i}`}>
              <circle cx={CX} cy={CY} r={r} fill="none" stroke="url(#ring-shine)" strokeWidth="1.5" filter="url(#ring-glow)" />
              <circle cx={CX} cy={CY} r={r - 0.8} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.4" />
            </g>
          ))}
        </svg>

        {/* Center stat */}
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="text-center">
            <div className="text-5xl sm:text-6xl font-bold text-white">$640K+</div>
            <div className="mt-2 text-sm sm:text-base font-medium text-white/40">Total Revenue Generated</div>
            <div className="mt-3 text-xl sm:text-2xl font-semibold text-white/70">163+ Calls Booked</div>
          </div>
        </div>

        {/* Orbiting bodies */}
        {CASE_STUDIES.map((study, i) => {
          const orbit = ORBITS[i];
          const orbitStyle = {
            "--orbit-radius": `${(orbit.radius / SIZE) * 100}%`,
            "--orbit-duration": `${orbit.duration}s`,
            "--orbit-phase": `${orbit.phase}rad`,
            "--orbit-phase-inverse": `${-orbit.phase}rad`,
          } as CSSProperties;

          return (
            <div
              key={study.id + "-orbit"}
              className="orbital-track absolute inset-0 z-20 pointer-events-none"
              style={orbitStyle}
            >
              <div className="orbital-body absolute pointer-events-auto">
                <div
                  className="relative cursor-pointer transition-transform duration-300 hover:scale-110 group"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedCase(selectedCase === study.id ? null : study.id);
                  }}
                  onMouseEnter={() => setHoveredCase(study.id)}
                  onMouseLeave={() => setHoveredCase(null)}
                >
                  {/* Hover tooltip */}
                  <div
                    className={`absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-[opacity,transform] duration-200 pointer-events-none ${
                      hoveredCase === study.id ? "opacity-100 -translate-y-1" : "opacity-0 translate-y-0"
                    }`}
                    style={{
                      background: "rgba(0,0,0,0.92)",
                      border: "1px solid rgba(255,255,255,0.15)",
                    }}
                  >
                    {study.result}
                  </div>

                  {/* Selection glow */}
                  <div
                    className={`absolute -inset-3 rounded-full transition-opacity duration-300 ${
                      selectedCase === study.id ? "opacity-100" : "opacity-0"
                    }`}
                    style={{
                      background: "radial-gradient(circle, rgba(255,255,255,0.2) 0%, transparent 70%)",
                    }}
                  />

                  {/* Icon */}
                  <div
                    className={`relative w-[4rem] h-[4rem] rounded-full flex items-center justify-center overflow-hidden transition-colors duration-300 ${
                      selectedCase === study.id
                        ? "border border-white/30"
                        : "border border-white/10"
                    }`}
                    style={{
                      background: "linear-gradient(145deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)",
                      boxShadow: "0 4px 16px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.06)",
                    }}
                  >
                    <Image
                      src={study.logo}
                      alt={study.name}
                      width={64}
                      height={64}
                      className={study.id === "3" ? "w-9 h-9 object-contain" : "w-full h-full object-cover rounded-full"}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Glassmorphic modal overlay */}
      {selectedStudy && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 animate-[fadeIn_0.2s_ease-out]"
          onClick={() => setSelectedCase(null)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          {/* Modal */}
          <div
            className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-3xl p-8 sm:p-10 animate-[fadeSlideUp_0.3s_ease-out]"
            data-lenis-prevent
            style={{
              background: "linear-gradient(160deg, rgba(240,238,235,0.92) 0%, rgba(225,222,218,0.88) 100%)",
              backdropFilter: "blur(40px) saturate(180%)",
              WebkitBackdropFilter: "blur(40px) saturate(180%)",
              boxShadow: "0 25px 60px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setSelectedCase(null)}
              className="absolute top-6 right-6 w-10 h-10 rounded-full bg-ink flex items-center justify-center text-white hover:bg-ink/80 transition-colors"
            >
              <span className="text-lg">&times;</span>
            </button>

            {/* Header */}
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">Case Study</p>
            <div className="mt-3 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center bg-white/50">
                <Image
                  src={selectedStudy.logo}
                  alt={selectedStudy.name}
                  width={48}
                  height={48}
                  className="w-10 h-10 object-contain"
                />
              </div>
              <h3 className="text-3xl sm:text-4xl font-bold text-ink tracking-tight">{selectedStudy.name}</h3>
            </div>

            {/* Body paragraphs */}
            <div className="mt-8 space-y-5">
              {selectedStudy.paragraphs.map((p, i) => (
                <p key={i} className="text-base sm:text-lg leading-relaxed text-ink/70">{p}</p>
              ))}
            </div>

            {/* Results section */}
            <div className="mt-8">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">Results</p>
              <div className="mt-4 space-y-4">
                {selectedStudy.results.map((r, i) => (
                  <p key={i} className="text-base sm:text-lg leading-relaxed text-ink/85 font-medium">{r}</p>
                ))}
              </div>
            </div>

            {/* CTA */}
            <div className="mt-10">
              <Link
                href="https://calendly.com/blluemoon135791113/30min"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-ink px-8 py-4 text-base font-semibold text-cream transition-colors hover:bg-accent"
              >
                Book a call <span aria-hidden>&rarr;</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .orbital-track {
          transform: rotate(var(--orbit-phase));
          animation: orbital-rotate var(--orbit-duration) linear infinite;
          backface-visibility: hidden;
          contain: layout paint;
          transform-origin: 50% 50%;
          will-change: transform;
        }
        .orbital-body {
          left: calc(50% + var(--orbit-radius));
          top: 50%;
          transform: translate3d(-50%, -50%, 0) rotate(var(--orbit-phase-inverse));
          animation: orbital-counter-rotate var(--orbit-duration) linear infinite;
          backface-visibility: hidden;
          will-change: transform;
        }
        @keyframes orbital-rotate {
          from { transform: rotate(var(--orbit-phase)); }
          to { transform: rotate(calc(var(--orbit-phase) + 1turn)); }
        }
        @keyframes orbital-counter-rotate {
          from { transform: translate3d(-50%, -50%, 0) rotate(var(--orbit-phase-inverse)); }
          to { transform: translate3d(-50%, -50%, 0) rotate(calc(var(--orbit-phase-inverse) - 1turn)); }
        }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .orbital-track,
          .orbital-body {
            animation: none;
            will-change: auto;
          }
        }
      `}</style>
    </div>
  );
}
