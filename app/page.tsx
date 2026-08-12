"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import Nav from "./components/Nav";
import Footer from "./components/Footer";
import Reveal from "./components/Reveal";
import HeroHeadline from "./components/HeroHeadline";
import CaseStudies from "./components/CaseStudies";
import OfferModal from "./components/OfferModal";
import TestimonialFlipCard from "./components/TestimonialFlipCard";
import HeroScrollFade from "./components/HeroScrollFade";
import InteractiveWorldMap from "./components/InteractiveWorldMap";
import AnimatedArrow from "./components/AnimatedArrow";
import HeroWidgets from "./components/HeroWidgets";
import PinboardWidgetA from "./components/PinboardWidgetA";
import PinboardWidgetB from "./components/PinboardWidgetB";
import OrbitalCaseStudies from "./components/OrbitalCaseStudies";
import Starfield from "./components/Starfield";
import MeteorShower from "./components/MeteorShower";
import StarFieldCanvas from "./components/StarFieldCanvas";
import FAQSchema from "./components/FAQSchema";
import { CALENDLY_URL } from "./lib/constants";

const SERVICES = [
  {
    name: "Outbound",
    tagline: "Finding new clients shouldn't take up your entire day.",
    description: "We build and manage your outbound system so you can spend less time prospecting and more time closing deals.",
    included: [
      "Ideal Customer Profile (ICP) research",
      "Competitor research",
      "Manual lead sourcing",
      "Human-written personalized outreach",
      "LinkedIn outreach",
      "X (Twitter) outreach",
      "Instagram outreach",
      "Cold email campaigns",
      "Follow-up sequences",
      "Appointment setting",
      "Weekly reporting & optimization",
    ],
    execution: [
      "Up to 4 dedicated outreach accounts",
      "Up to 40 personalized touchpoints every day",
      "Multi-channel outreach across LinkedIn, X, Instagram, and Email",
    ],
    perfectFor: [
      "SaaS & Tech startups",
      "B2B agencies",
      "Service businesses",
      "Founders who want a predictable sales pipeline",
    ],
  },
  {
    name: "Growth Accelerator",
    badge: "Custom",
    tagline: "Building a product is only half the journey.",
    description: "Getting customers consistently is what turns a startup into a business. We'll work alongside your team to build your growth strategy, improve your sales process, execute outbound campaigns, and solve the bottlenecks stopping you from scaling. We're an outsourced operations team, not consultants who hand in PDFs and disappear.",
    included: [
      "Growth strategy",
      "Business development",
      "Go-to-market planning",
      "Sales systems",
      "Outbound infrastructure",
      "Team training",
      "Founder advisory",
      "KPI tracking",
      "Weekly optimization",
      "Tailored growth initiatives",
    ],
    perfectFor: [
      "Early-stage startups",
      "SaaS companies",
      "Tech startups",
      "B2B agencies",
      "Founder-led businesses ready to scale",
    ],
    footer: "Every Growth Accelerator engagement is built around your business. No cookie-cutter packages. No generic advice. Just practical execution that helps you grow.",
  },
];

const OFFERS = [
  {
    name: "Standard",
    tagline: "The outbound engine, run by hand.",
    features: [
      "Around 50 hand-picked prospects a day, deliberately capped",
      "Every message written by hand, A/B tested head-to-head",
      "Account health protected: email, LinkedIn, X, Instagram",
      "Reply rates we'll say out loud, 15-20% on low and mid-ticket",
      "Fresh sales strategy as your market shifts",
      "Live shared CRM, updated daily",
    ],
    featured: false,
  },
  {
    name: "Premium",
    tagline: "The whole growth engine, outbound, inbound, and creative.",
    features: [
      "Everything in Standard",
      "Inbound handled, no lead sits cold in your inbox",
      "Your socials managed: LinkedIn and X end to end, Instagram ideation",
      "SaaS explainer video, produced start to finish",
      "Motion-design ad creatives once outbound pays for itself",
    ],
    featured: true,
  },
  {
    name: "Custom",
    tagline: "Consultation and team growth, built around your stage.",
    features: [
      "Starts with a consultation, not a package",
      "Any mix of Standard and Premium, tailored to fit",
      "In-house sales training on our systems",
      "We help you hire and build your own backend team",
      "When you're ready, we hand over the keys",
    ],
    featured: false,
  },
];

const STEPS = [
  {
    n: "01",
    title: "The intro call",
    body: "Fifteen to thirty minutes. We don't pitch, we listen. The only goal is understanding your business well enough to build something real.",
  },
  {
    n: "02",
    title: "Research",
    body: "We study your brand, your market, and your competitors. Then we ask ourselves an unfashionable question: can we actually help this company? If the answer is no, we say so.",
  },
  {
    n: "03",
    title: "The proposal",
    body: "We walk you through exactly what we'd do and why. You should understand every part of it before a single message goes out.",
  },
  {
    n: "04",
    title: "Launch",
    body: "Research is already done, so execution starts immediately. Messaging and targeting get A/B tested; winners get scaled.",
  },
  {
    n: "05",
    title: "See everything",
    body: "A live, shared CRM. Every message, reply, and KPI, visible daily, not summarized in a monthly PDF. Plus weekly and monthly check-ins.",
  },
];

const STATS = [
  { value: "$100K+ MRR", label: "Addx Studio, within 6 months" },
  { value: "53+", label: "meetings booked, Addx Studio" },
  { value: "23 calls + $10K", label: "in 2.5 months, Click Labs" },
  { value: "~$500K", label: "closed revenue, Knowledge City, on $50K+ deals" },
  { value: "$20,000", label: "in 2.5 months, Motionisr, from zero" },
];

const FAQS = [
  {
    q: "We've been burned by an agency before.",
    a: "So have most of our clients. That's exactly why you pay for one week first and watch everything live in a shared CRM. We earn month two.",
  },
  {
    q: "What if you don't perform?",
    a: "You're never locked in. The first week is paid separately, months after it are month-to-month, and every message we send is visible to you live in a shared CRM. If it isn't working you stop. We don't offer refunds on work that was delivered as agreed, and we'd rather say that plainly than promise one and argue about it later.",
  },
  {
    q: "How many clients can you actually bring in?",
    a: "Honest answer: it depends on the strength of your existing presence and credibility. If yours is weak, we help build it as part of the engagement, we won't quote you a fantasy number to close you.",
  },
  {
    q: "How much of my time does this take?",
    a: "Show up to scheduled check-ins. Review what we deliver at the end of each week. That's it, the whole point is that you stay on your product.",
  },
  {
    q: "What's in the reporting?",
    a: "Everything. ICP research, winning outreach angles, response and analytics data, full conversation transcripts, all tracked in the shared CRM, updated daily.",
  },
  {
    q: "How do you find our ideal customers?",
    a: "Behavior-based targeting, not just job titles. Industry, company profile, company size, down to the right founder or decision-maker.",
  },
  {
    q: "Do you use AI to personalize outreach?",
    a: "No. AI personalization reads like AI personalization. Real people research every prospect and write every message.",
  },
  {
    q: "What industries do you work with?",
    a: "B2B services, SaaS and tech startups, agencies, and motion/animation-adjacent businesses. If you're a local blue-collar business, we're not your people, and we'll tell you that on the call.",
  },
];

const TEAM = [
  {
    name: "Husnain",
    role: "Founder",
    photo: "/team/husnain.jpg",
    // portrait shot, keep the face (upper third) in the square crop
    photoPosition: "50% 22%",
    variant: "charcoal" as const,
    socials: [
      {
        network: "Instagram",
        icon: "/social/instagram.svg",
        href: "https://www.instagram.com/husnain.outlio/?hl=en",
      },
      {
        network: "LinkedIn",
        icon: "/social/linkedin.svg",
        href: "https://www.linkedin.com/in/husnain-rafiq-343179290/",
      },
      { network: "X", icon: "/social/x.svg", href: "https://x.com/husnain_rfq" },
    ],
  },
  {
    name: "Saboor",
    role: "Co-Founder",
    photo: "/team/saboor.png",
    photoPosition: "50% 50%",
    variant: "beam" as const,
    socials: [
      { network: "X", icon: "/social/x.svg", href: "https://x.com/abdulsaboor2004" },
      {
        network: "LinkedIn",
        icon: "/social/linkedin.svg",
        href: "https://www.linkedin.com/in/abdulsaboor2004/",
      },
    ],
  },
  {
    name: "Saad",
    role: "Operations Manager",
    photo: "/team/saad.png",
    photoPosition: "50% 50%",
    variant: "frost" as const,
    socials: [
      { network: "X", icon: "/social/x.svg", href: "https://x.com/SaadRaf22" },
      {
        network: "LinkedIn",
        icon: "/social/linkedin.svg",
        href: "https://www.linkedin.com/in/saad-rafiq-a57a62335/",
      },
    ],
  },
];

export default function Home() {
  const [selectedOffer, setSelectedOffer] = useState<typeof OFFERS[0] | null>(null);
  const [isOfferModalOpen, setIsOfferModalOpen] = useState(false);

  const openOfferModal = (offer: typeof OFFERS[0]) => {
    setSelectedOffer(offer);
    setIsOfferModalOpen(true);
  };

  return (
    <>
      <FAQSchema faqs={FAQS} />
      <Nav />
      <OfferModal
        offer={selectedOffer}
        isOpen={isOfferModalOpen}
        onClose={() => {
          setIsOfferModalOpen(false);
          setSelectedOffer(null);
        }}
      />
      <main>
        {/* ========== 1. HERO ========== */}
        <section className="relative px-4 py-6 sm:px-6 lg:px-8">
          {/* Contained Hero Card */}
          <div className="relative mx-auto max-w-[1600px] overflow-hidden rounded-3xl border border-gray-200/60 bg-gradient-to-br from-gray-50 to-white shadow-xl shadow-black/5">
            {/* Subtle dot pattern texture */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: 'radial-gradient(circle, rgba(0, 0, 0, 0.10) 1.2px, transparent 1.2px)',
                backgroundSize: '14px 14px',
              }}
            />

            {/* Corner Widgets with 3D depth */}
            <HeroWidgets />

            {/* Main Content - CENTERED */}
            <div className="relative z-20 flex min-h-[700px] items-center justify-center px-8 py-24 sm:px-12 lg:min-h-[800px] lg:px-16 lg:py-32">
              <div className="mx-auto max-w-5xl text-center">
                <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
                  Outlio &middot; Hands-on growth accelerator
                </p>
                <div className="mt-3">
                  <HeroHeadline />
                </div>
                <HeroScrollFade>
                  <p className="mx-auto mt-6 max-w-3xl text-base leading-relaxed text-muted sm:text-lg">
                    Outlio isn't a consultancy. We research your market, write every message by hand, and
                    run your outbound ourselves, then show you all of it, live, in a shared CRM.
                  </p>
                </HeroScrollFade>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                  <Link
                    href={CALENDLY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full bg-ink px-8 py-4 text-base font-semibold text-cream transition-colors hover:bg-accent"
                  >
                    Book a call
                  </Link>
                  <Link
                    href="#results"
                    className="rounded-full border border-ink px-8 py-4 text-base font-semibold transition-colors hover:bg-ink hover:text-cream"
                  >
                    See the results
                  </Link>
                </div>
                <p className="mt-4 text-sm text-muted">
                  One paid week before any monthly commitment. Watch every message land in a shared
                  CRM before you commit further.
                </p>
              </div>
            </div>

            {/* Marquee strip at bottom */}
            <div className="relative border-t border-gray-200/60 bg-purple-50/50 py-6 overflow-hidden" aria-hidden="true">
              <div className="relative overflow-hidden">
                <div className="marquee-track flex w-max items-center gap-12 px-12 text-sm font-semibold uppercase tracking-[0.18em]">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <span key={i} className="flex items-center gap-12">
                      {[
                        "Research-first outbound",
                        "Every message written by hand",
                        "Live shared CRM",
                        "The one-week deal",
                        "No autopilot",
                      ].map((t) => (
                        <span key={t} className="flex items-center gap-12">
                          <span className="text-gray-800">{t}</span>
                          <span className="relative">
                            <span className="block size-1.5 rounded-full bg-accent/60" />
                          </span>
                        </span>
                      ))}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>


        {/* ========== 7. RESULTS — full dark galaxy background ========== */}
        <section id="results" className="scroll-mt-24 relative overflow-hidden"
          style={{
            background: "radial-gradient(ellipse at 50% 40%, #0d1117 0%, #010409 50%, #000000 100%)",
          }}
        >
          {/* Meteor shower layer */}
          <MeteorShower />

          {/* Dense concentrated star field across entire section */}
          <StarFieldCanvas />

          {/* Starfield with hero stars — bottom-left, feathered edges */}
          <div className="absolute bottom-[15%] left-[3%] pointer-events-none" aria-hidden="true"
            style={{
              maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
              WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
            }}
          >
            <Starfield />
          </div>

          {/* Nebula clouds — dim, realistic */}
          <div className="absolute top-[8%] right-[3%] w-[400px] h-[250px] rounded-full pointer-events-none" aria-hidden="true" style={{
            background: "radial-gradient(ellipse at 40% 50%, rgba(60,40,100,0.04) 0%, rgba(40,25,80,0.02) 40%, transparent 70%)",
            transform: "rotate(-12deg)",
            filter: "blur(30px)",
          }} />
          <div className="absolute top-[50%] left-[0%] w-[320px] h-[180px] rounded-full pointer-events-none" aria-hidden="true" style={{
            background: "radial-gradient(ellipse at 60% 40%, rgba(80,40,90,0.035) 0%, rgba(50,25,70,0.015) 50%, transparent 70%)",
            transform: "rotate(20deg)",
            filter: "blur(25px)",
          }} />
          <div className="absolute top-[25%] right-[10%] w-[220px] h-[140px] rounded-full pointer-events-none" aria-hidden="true" style={{
            background: "radial-gradient(ellipse, rgba(30,50,120,0.03) 0%, rgba(20,35,90,0.015) 50%, transparent 70%)",
            transform: "rotate(8deg)",
            filter: "blur(20px)",
          }} />
          <div className="absolute bottom-[20%] right-[5%] w-[280px] h-[160px] rounded-full pointer-events-none" aria-hidden="true" style={{
            background: "radial-gradient(ellipse at 30% 60%, rgba(50,30,80,0.03) 0%, rgba(35,20,60,0.015) 45%, transparent 70%)",
            transform: "rotate(-25deg)",
            filter: "blur(28px)",
          }} />
          <div className="absolute top-[70%] left-[15%] w-[200px] h-[120px] rounded-full pointer-events-none" aria-hidden="true" style={{
            background: "radial-gradient(ellipse, rgba(70,50,110,0.025) 0%, transparent 60%)",
            transform: "rotate(35deg)",
            filter: "blur(22px)",
          }} />

          {/* Cosmic dust — faint horizontal wisps */}
          <div className="absolute top-[18%] left-0 w-full h-[2px] pointer-events-none" aria-hidden="true" style={{
            background: "linear-gradient(to right, transparent 8%, rgba(100,80,140,0.08) 25%, rgba(60,50,100,0.04) 50%, rgba(100,80,140,0.06) 75%, transparent 92%)",
            filter: "blur(3px)",
          }} />
          <div className="absolute top-[60%] left-0 w-full h-[2px] pointer-events-none" aria-hidden="true" style={{
            background: "linear-gradient(to right, transparent 12%, rgba(80,60,120,0.06) 30%, rgba(50,40,90,0.03) 55%, rgba(80,60,120,0.05) 78%, transparent 90%)",
            filter: "blur(4px)",
          }} />
          <div className="absolute top-[85%] left-0 w-full h-[1px] pointer-events-none" aria-hidden="true" style={{
            background: "linear-gradient(to right, transparent 5%, rgba(90,70,130,0.05) 20%, rgba(60,45,100,0.03) 60%, transparent 95%)",
            filter: "blur(2px)",
          }} />

          <div className="relative z-10 mx-auto max-w-7xl px-6 pt-16 sm:px-10 sm:pt-20 pb-6 sm:pb-8">
            <Reveal>
              <h2 className="max-w-3xl text-4xl font-black uppercase leading-tight tracking-tight sm:text-5xl text-white">
                You asked for the numbers, and so the numbers have spoken
              </h2>
            </Reveal>
          </div>

          {/* Orbital Case Studies */}
          <OrbitalCaseStudies />

        </section>

        {/* ========== 2. PROBLEM ========== */}
        <section className="mx-auto max-w-7xl px-6 py-24 sm:px-10 sm:py-32">
          <Reveal>
            <h2 className="max-w-3xl text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
              You know how to build. <span className="text-accent">Nobody taught you how to sell.</span>
            </h2>
          </Reveal>
          <div className="mt-16 grid gap-12 lg:grid-cols-[1fr_1.1fr]">
            <div className="space-y-8 text-lg leading-relaxed sm:text-xl">
              {[
                "You shipped the product. Launched on Product Hunt. Got the upvotes.",
                "Then, quiet.",
                "So you start cold-DMing from your own account. It gets flagged.",
                "You look at ads. At your stage, a few hundred a month on Meta buys you approximately nothing.",
                "You think about hiring. Now you're paying a salary for a pipeline that still doesn't exist.",
              ].map((line, i) => (
                <Reveal key={line} delay={i * 90}>
                  <p className={line === "Then, quiet." ? "font-semibold text-accent" : ""}>{line}</p>
                </Reveal>
              ))}
            </div>
            <Reveal delay={200} className="lg:sticky lg:top-32 lg:self-start">
              <InteractiveWorldMap />
            </Reveal>
          </div>
        </section>


        {/* ========== SERVICES ========== */}
        <section id="services" className="scroll-mt-24 border-t border-ink/10">
          <div className="mx-auto max-w-7xl px-6 py-24 sm:px-10 sm:py-32">
            <Reveal>
              <h2 className="text-4xl font-bold uppercase tracking-tight sm:text-6xl">
                Our <span className="text-accent">Services.</span>
              </h2>
              <p className="mt-5 max-w-xl text-lg text-muted">
                Everything we do is hands-on, human-driven, and built around one goal: getting you customers.
              </p>
            </Reveal>

            {/*
              Pricing, stated before the call rather than behind it.
              Range and drivers live here so a visitor can self-qualify without
              booking — the call is for scoping, not for finding out the number.
            */}
            <Reveal delay={80}>
              <div
                id="pricing"
                className="mt-10 scroll-mt-24 rounded-2xl border border-accent/20 bg-accent-soft/40 p-6 sm:p-8"
              >
                <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
                  What it costs
                </p>
                <p className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                  $1,500 – $3,000 <span className="text-xl font-medium text-muted">/ month</span>
                </p>
                <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
                  Where you land in that range depends on four things, and we&apos;ll tell you which
                  before you book anything.
                </p>

                <dl className="mt-7 grid gap-x-10 gap-y-5 sm:grid-cols-2">
                  {[
                    ['Outreach volume', 'Around 50 prospects a day sits at the lower end. Higher daily volume and more sending accounts move it up.'],
                    ['Channels', 'Email alone is the cheapest to run. LinkedIn, X and Instagram each add manual work per prospect.'],
                    ['Research depth', 'A broad ICP is quick to source. Narrow, senior or hard-to-reach targets take real digging per lead.'],
                    ['Creative', 'Explainer video and motion-design ad creative are add-ons, not part of the baseline outbound engine.'],
                  ].map(([term, detail]) => (
                    <div key={term} className="border-t border-accent/15 pt-3">
                      <dt className="text-base font-semibold text-ink">{term}</dt>
                      <dd className="mt-1 text-sm leading-relaxed text-muted">{detail}</dd>
                    </div>
                  ))}
                </dl>

                <p className="mt-7 border-t border-accent/15 pt-5 text-sm leading-relaxed text-muted">
                  You start with one paid week at the same rate before any monthly commitment.{' '}
                  <strong className="font-semibold text-ink">Growth Accelerator</strong> is scoped
                  separately — it is an embedded team rather than a campaign, so it sits above this
                  range.
                </p>
              </div>
            </Reveal>

            {/* Full Services Display, 2 Side by Side Cards */}
            <div className="mt-16 grid gap-8 lg:grid-cols-2">
              {SERVICES.map((service, index) => (
                <Reveal key={service.name} delay={index * 150}>
                  <div
                    id={service.name.toLowerCase().replace(/\s+/g, '-')}
                    className="scroll-mt-24 rounded-2xl border border-white/30 p-6 backdrop-blur-xl transition-all duration-500 hover:border-accent/30 hover:shadow-xl hover:shadow-accent/10"
                    style={{
                      background: 'linear-gradient(160deg, rgba(255, 255, 255, 0.75) 0%, rgba(255, 255, 255, 0.45) 100%)',
                      backdropFilter: 'blur(24px) saturate(180%)',
                      WebkitBackdropFilter: 'blur(24px) saturate(180%)'
                    }}
                  >
                    {service.badge && (
                      <span className="inline-block rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-cream mb-3">
                        {service.badge}
                      </span>
                    )}

                    <h3 className="text-2xl font-bold tracking-tight">{service.name}</h3>
                    <p className="mt-2 text-base font-medium leading-relaxed text-ink">{service.tagline}</p>
                    <p className="mt-3 text-sm leading-relaxed text-muted">{service.description}</p>

                    {/* All content in one strip */}
                    <div className="mt-6 space-y-5">
                      {/* What's Included */}
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent mb-3">What's Included</h4>
                        <ul className="space-y-2">
                          {service.included.map((item) => (
                            <li key={item} className="flex gap-2 text-[13px] leading-snug">
                              <span aria-hidden className="mt-[4px] size-1 shrink-0 rounded-full bg-accent" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* How We Execute */}
                      {service.execution && (
                        <div>
                          <h4 className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent mb-3">How We Execute</h4>
                          <ul className="space-y-2">
                            {service.execution.map((item) => (
                              <li key={item} className="flex gap-2 text-[13px] leading-snug">
                                <span aria-hidden className="mt-[4px] size-1 shrink-0 rounded-full bg-accent" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Perfect For */}
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent mb-3">Perfect For</h4>
                        <ul className="space-y-2">
                          {service.perfectFor.map((item) => (
                            <li key={item} className="flex gap-2 text-[13px] leading-snug">
                              <span aria-hidden className="mt-[4px] size-1 shrink-0 rounded-full bg-accent" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {service.footer && (
                      <p className="mt-6 border-t border-ink/10 pt-4 text-xs font-medium leading-relaxed text-ink/80 italic">
                        {service.footer}
                      </p>
                    )}

                    <Link
                      href="#book"
                      className="mt-8 inline-flex items-center gap-2 rounded-full bg-ink px-7 py-3.5 text-sm font-semibold text-cream transition-all hover:bg-accent hover:scale-105"
                    >
                      Get started <span aria-hidden>&rarr;</span>
                    </Link>
                  </div>
                </Reveal>
              ))}
            </div>

            {/* signature statement */}
            <Reveal>
              <blockquote
                className="mx-auto mt-32 max-w-4xl text-center p-10 rounded-3xl backdrop-blur-xl border border-white/30 shadow-xl transition-all duration-500 hover:border-accent/40 hover:shadow-2xl hover:shadow-accent/10"
                style={{
                  background: 'linear-gradient(160deg, rgba(255, 255, 255, 0.75) 0%, rgba(255, 255, 255, 0.45) 100%)',
                  backdropFilter: 'blur(24px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(24px) saturate(180%)'
                }}
              >
                <p className="text-3xl font-bold leading-snug tracking-tight sm:text-5xl">
                  A human writing 50 personalized messages a day, will{" "}
                  <span className="text-accent">outpace, outlast, and outwin</span> an LLM writing 200
                </p>
                <p className="mt-6 text-lg text-muted">
                  That's not theory. It's a game-plan.
                </p>
              </blockquote>
            </Reveal>
          </div>
        </section>

        {/* ========== 4. HOW IT WORKS ========== */}
        <section id="how" className="scroll-mt-24 border-t border-ink/10 bg-panel/50">
          <div className="mx-auto max-w-7xl px-6 py-24 sm:px-10 sm:py-32">
            <Reveal>
              <h2 className="text-4xl font-bold uppercase tracking-tight sm:text-6xl">
                No mystery. <span className="text-accent">No 90-slide deck.</span>
              </h2>
            </Reveal>
            <ol className="mt-16 max-w-3xl">
              {STEPS.map((s, i) => (
                <Reveal key={s.n} delay={i * 80}>
                  <li className="relative grid grid-cols-[auto_1fr] gap-6 pb-14 sm:gap-10 last:pb-0">
                    {i < STEPS.length - 1 && (
                      <span aria-hidden className="absolute left-6 top-14 h-full w-px bg-ink/15 sm:left-7" />
                    )}
                    <span
                      className="grid size-12 shrink-0 place-items-center rounded-full border border-white/30 text-sm font-bold sm:size-14 backdrop-blur-xl transition-all duration-500 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10"
                      style={{
                        background: 'linear-gradient(160deg, rgba(255, 255, 255, 0.7) 0%, rgba(255, 255, 255, 0.4) 100%)',
                        backdropFilter: 'blur(20px) saturate(180%)',
                        WebkitBackdropFilter: 'blur(20px) saturate(180%)'
                      }}
                    >
                      {s.n}
                    </span>
                    <div className="pt-1.5 sm:pt-3">
                      <h3 className="text-2xl font-semibold tracking-tight">{s.title}</h3>
                      <p className="mt-3 max-w-xl leading-relaxed text-muted">{s.body}</p>
                    </div>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* ========== 6. HOW WE START — deep minimal gradient band ========== */}
        <section className="grad-band relative overflow-hidden text-cream">
          {/* soft glows so the band reads glassy, not flat */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(50% 65% at 85% 10%, rgba(124, 121, 255, 0.22), transparent 70%), radial-gradient(45% 55% at 8% 95%, rgba(79, 75, 255, 0.16), transparent 70%)",
            }}
          />
          <div className="relative mx-auto max-w-7xl px-6 py-28 sm:px-10 sm:py-40">
            <Reveal>
              <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-cream/55">
                How we start
              </p>
              <h2 className="mt-6 text-5xl font-bold uppercase tracking-tight sm:text-7xl">
                The one-week deal.
              </h2>
            </Reveal>
            <div className="mt-14 max-w-2xl space-y-6 text-2xl leading-snug sm:text-3xl">
              <Reveal delay={80}>
                <p>No monthly retainer upfront. You pay for one week.</p>
              </Reveal>
              <Reveal delay={160}>
                <p className="text-cream/85">
                  Every message we send is visible to you in a shared CRM, updated daily. You see
                  the work as it happens, not in a report afterwards.
                </p>
              </Reveal>
              <Reveal delay={240}>
                <p className="font-semibold">Then you decide whether month two happens.</p>
              </Reveal>
            </div>
            <Reveal delay={320}>
              <p className="mt-14 text-base text-cream/55">
                Most agencies ask for trust first and results later. We flipped the order.
              </p>
            </Reveal>
          </div>
        </section>
        {/* ========== 8. TESTIMONIALS ========== */}
        <section className="border-t border-ink/10 bg-panel/50">
          <div className="mx-auto max-w-7xl px-6 py-24 sm:px-10 sm:py-32">
            <Reveal>
              <h2 className="text-4xl font-bold uppercase tracking-tight sm:text-6xl">
                Don't take <span className="text-accent">our word</span> for it.
              </h2>
            </Reveal>
            <div className="mt-16 grid gap-6 md:grid-cols-2">
              {[
                {
                  quote: "Liam Ottley closed, alhamdulillah.",
                  who: "Abdullah, Founder, Addx Studio",
                  proofImage: "/testimonials/addx-proof.png"
                },
                {
                  quote: "Husnain is one of the best guys in this space.",
                  who: "Aamir, Founder, Click Labs",
                  proofImage: "/testimonials/clicklabs-proof.png"
                },
              ].map((t, i) => (
                <Reveal key={t.who} delay={i * 100} className="h-full">
                  <TestimonialFlipCard
                    quote={t.quote}
                    who={t.who}
                    proofImage={t.proofImage}
                  />
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ========== 9. FAQ ========== */}
        <section id="faq" className="mx-auto max-w-7xl scroll-mt-24 px-6 py-24 sm:px-10 sm:py-32">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
            <Reveal>
              <h2 className="text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
                The questions you're <span className="text-accent">already thinking.</span>
              </h2>
              <AnimatedArrow />
            </Reveal>
            <div className="divide-y divide-ink/10 border-y border-ink/10">
              {FAQS.map((f, i) => (
                <details key={f.q} open={i === 0} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-lg font-semibold tracking-tight sm:text-xl">
                    {f.q}
                    <span aria-hidden className="faq-mark grid size-9 shrink-0 place-items-center rounded-full border border-ink text-xl leading-none">
                      +
                    </span>
                  </summary>
                  <p className="max-w-2xl pb-7 leading-relaxed text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ========== 10. FOUNDER STORY ========== */}
        <section id="about" className="scroll-mt-24 border-t border-ink/10 bg-panel/50">
          <div className="mx-auto max-w-7xl px-6 py-24 sm:px-10 sm:py-32">
            <div className="grid gap-16 lg:grid-cols-[1.1fr_1fr]">
              <div>
                <Reveal>
                  <h2 className="text-4xl font-bold uppercase tracking-tight sm:text-6xl">
                    Built <span className="text-accent">the hard way.</span>
                  </h2>
                </Reveal>
                <div className="mt-10 max-w-xl space-y-6 text-lg leading-relaxed">
                  {[
                    "Our founder started at fifteen with nothing, no money, and at times no stable place to live.",
                    "E-commerce didn't take off. Trading the markets took a toll, but it taught him how markets, and startups, actually behave.",
                    "Then came the unglamorous part: a year and a half of studying lead generation, AI, and motion graphics. A bet on the skills that would matter for the next decade.",
                    "The first real client was Addx Studio. Six months later, it was doing $100K+ a month.",
                    "His co-founder, Saboor, spent four years doing manual factory work before the two partnered, and worked nights to get this off the ground.",
                    "Outlio is what came out the other side. Since then: Click Labs, Motionisr, Knowledge City, and more.",
                  ].map((p, i) => (
                    <Reveal key={p} delay={i * 60}>
                      <p>{p}</p>
                    </Reveal>
                  ))}
                </div>
                <div className="mt-12 space-y-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                  {["Get a life.", "Stay humble, nobody knows everything.", "Say no, including to clients who aren't a fit."].map(
                    (v, i) => (
                      <Reveal key={v} delay={i * 80}>
                        <p>
                          <span className="text-accent" aria-hidden>
                            /{" "}
                          </span>
                          {v}
                        </p>
                      </Reveal>
                    )
                  )}
                </div>
              </div>
              <Reveal delay={150} className="lg:sticky lg:top-32 lg:self-start">
                <div className="relative aspect-[4/5] overflow-hidden rounded-2xl">
                  <Image
                    src="/office picture.png"
                    alt="Outlio team office"
                    fill
                    className="object-cover"
                    sizes="(min-width: 1024px) 50vw, 100vw"
                  />
                </div>
              </Reveal>
            </div>

          </div>
        </section>

        {/* ========== TEAM ========== */}
        <section id="team" className="relative scroll-mt-24 overflow-hidden border-t border-ink/10 bg-panel/50 py-24 sm:py-32">
          <div className="relative mx-auto max-w-7xl px-6 sm:px-10">
            <Reveal>
              <h2 className="text-3xl font-bold uppercase tracking-tight sm:text-5xl text-ink">
                The people <span className="text-accent">behind the engine.</span>
              </h2>
            </Reveal>
            <div className="mt-16 grid gap-6 md:grid-cols-3">
              {TEAM.map((m, i) => {
                return (
                  <Reveal key={m.name} delay={i * 120} className="h-full">
                    <article
                      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/30 p-4 backdrop-blur-xl transition-all duration-500 hover:border-accent/40 hover:shadow-xl hover:shadow-accent/10 sm:p-5"
                      style={{
                        background: 'linear-gradient(160deg, rgba(255, 255, 255, 0.75) 0%, rgba(255, 255, 255, 0.45) 100%)',
                        backdropFilter: 'blur(24px) saturate(180%)',
                        WebkitBackdropFilter: 'blur(24px) saturate(180%)'
                      }}
                    >
                      <div className="relative flex h-full flex-col">
                        <div className="relative aspect-square overflow-hidden rounded-xl ring-1 ring-white/30 transition-all duration-300 group-hover:scale-[1.02] group-hover:ring-accent/50">
                          <Image
                            src={m.photo}
                            alt={`${m.name}, ${m.role} at Outlio`}
                            fill
                            sizes="(min-width: 768px) 33vw, 90vw"
                            className="object-cover"
                            style={{ objectPosition: m.photoPosition }}
                          />
                        </div>
                        <div className="mt-4 flex gap-2 px-1">
                          {m.socials.map((s) => (
                            <a
                              key={s.network}
                              href={s.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`${m.name} on ${s.network}`}
                              className="overflow-hidden rounded-lg ring-1 ring-white/30 backdrop-blur-sm transition-all hover:scale-110 hover:ring-accent"
                              style={{
                                background: 'rgba(255, 255, 255, 0.5)'
                              }}
                            >
                              <Image src={s.icon} alt="" width={28} height={28} className="size-[28px]" />
                            </a>
                          ))}
                        </div>
                        <h3 className="mt-4 px-1 text-2xl font-semibold tracking-tight text-ink">{m.name}</h3>
                        <p className="mb-2 mt-1 px-1 text-sm text-muted">{m.role}</p>
                      </div>
                    </article>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* ========== 11. FINAL CTA — same deep gradient band as "How we start" ========== */}
        <section id="book" className="grad-band relative scroll-mt-24 overflow-hidden text-cream">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(55% 70% at 50% 0%, rgba(124, 121, 255, 0.2), transparent 70%)",
            }}
          />
          <div className="relative mx-auto max-w-7xl px-6 py-28 text-center sm:px-10 sm:py-36">
            <Reveal>
              <h2 className="text-5xl font-bold uppercase tracking-tight sm:text-7xl">
                You've read enough.
              </h2>
              <p className="mx-auto mt-8 max-w-xl text-xl leading-relaxed text-cream/75">
                One call. Fifteen minutes. No pitch, if we can't help you, we'll say so on the call.
              </p>
              <Link
                href={CALENDLY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-10 inline-block rounded-full bg-cream px-10 py-4 text-lg font-semibold text-ink transition-all hover:scale-105 hover:bg-white"
              >
                Book a call
              </Link>
              <p className="mt-6 text-sm text-cream/55">
                First week billed before anything monthly. You'll see the results before you commit.
              </p>
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
