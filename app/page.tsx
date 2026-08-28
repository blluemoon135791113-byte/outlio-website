import Image from "next/image";
import Link from "next/link";
import Nav from "./components/Nav";
import Footer from "./components/Footer";
import Reveal from "./components/Reveal";
import HeroHeadline from "./components/HeroHeadline";
import TestimonialFlipCard from "./components/TestimonialFlipCard";
import HeroScrollFade from "./components/HeroScrollFade";
import InteractiveWorldMap from "./components/InteractiveWorldMap";
import AnimatedArrow from "./components/AnimatedArrow";
import HeroWidgets from "./components/HeroWidgets";
import OrbitalCaseStudies from "./components/OrbitalCaseStudies";
import Starfield from "./components/Starfield";
import MeteorShower from "./components/MeteorShower";
import StarFieldCanvas from "./components/StarFieldCanvas";
import FAQSchema from "./components/FAQSchema";
import { CALENDLY_URL } from "./lib/constants";

const OUTBOUND_OFFERS = [
  {
    tier: "Tier 1",
    name: "Contained Outreach",
    price: "$1,000/mo",
    description: "A focused, human-led outbound operation across four channels.",
    highlights: [
      "40 touchpoints per day",
      "200–240 weekly interactions",
      "5 follow-ups per lead",
      "2 dedicated sales reps",
    ],
    clientProvides: [
      "Qualified lead lists with verified contact data, including Instagram, LinkedIn, X, and email.",
      "Personal brand operations, including regular posting and engagement, running in-house to support outbound.",
    ],
    included: [
      "Personalized engagement across LinkedIn, Instagram, X, and email.",
      "40 custom touchpoints per day across all four channels.",
      "5 follow-ups per lead.",
      "200–240 lead interactions per week.",
      "15% average reply rate.",
      "2 dedicated sales reps working exclusively on your operations.",
    ],
    featured: false,
  },
  {
    tier: "Tier 2",
    name: "Research-Led Outbound",
    price: "$1,700/mo",
    description: "Deeper research, higher volume, and personal-brand support built into execution.",
    highlights: [
      "60 qualified leads per day",
      "300 weekly interactions",
      "8 follow-ups per lead",
      "4 dedicated sales reps",
    ],
    clientProvides: [
      "Marketing and brand material for personal brand build-up.",
    ],
    included: [
      "Deep ICP research by Outlio's client research department.",
      "60 qualified leads sourced per day across LinkedIn, Instagram, email, and X.",
      "A 2-day warm-up engagement cycle with each prospect before outreach begins.",
      "60 tailored touchpoints per day across all channels, including email.",
      "8 follow-ups per lead, sequenced across channels.",
      "300 leads researched, engaged, and interacted with per week.",
      "Personal brand building optimized to channel inbound attention toward closing.",
      "2 outbound strategies shipped every 15 days for A/B testing and review with you.",
      "15% average reply rate maintained.",
      "4 dedicated sales reps working exclusively on your operations.",
    ],
    featured: true,
  },
  {
    tier: "Tier 3",
    name: "Custom Plan",
    price: "Custom",
    description: "A scaled lead-generation and closing operation designed around your product and volume.",
    highlights: [
      "Lead engine and custom CRM",
      "Uncapped follow-ups",
      "5-day lead warm-up",
      "Lead generation and closing team",
    ],
    clientProvides: [],
    included: [
      "Everything in Tiers 1 and 2.",
      "ICP research and lead generation at scale, powered by Outlio's in-house lead engine.",
      "Access to our lead engine dashboard and a custom CRM to track performance and refine strategy using past data.",
      "Product launch and demo assets made for your startup.",
      "Uncapped follow-ups, with every lead assessed and updated against your qualification criteria.",
      "A 5-day engagement period per lead before outreach begins.",
      "Closing support handled by our team of specialized closers.",
      "A team of dedicated sales reps covering both lead generation and closing operations.",
      "Deep product research feeding new outbound strategies and different weekly volumes for A/B testing.",
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

const FAQS = [
  {
    q: "We've been burned by an agency before.",
    a: "So have most of our clients. That's why every message, reply, and KPI stays visible to you in a shared CRM. You can see the operation as it happens instead of waiting for a polished report.",
  },
  {
    q: "What if you don't perform?",
    a: "We agree the scope and success criteria before work starts, then keep every message and KPI visible in the shared CRM. If something is underperforming, you see it early and we adjust the targeting, messaging, or channel strategy with you.",
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
  return (
    <>
      <FAQSchema faqs={FAQS} />
      <Nav />
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
            <div className="relative z-20 flex min-h-[590px] items-center justify-center px-5 py-20 sm:min-h-[660px] sm:px-10 sm:py-24 lg:min-h-[760px] lg:px-16 lg:py-28 xl:min-h-[800px] xl:py-32">
              <div className="mx-auto max-w-5xl text-center">
                {/*
                  ⚠️ A SECOND <h1> USED TO SIT HERE, above `HeroHeadline` —
                  which renders its own. Two competing headings, and the
                  paragraph beneath it restated the concise one further down
                  almost word for word. `HeroHeadline` is the hero; this block
                  was crowding it.
                */}
                <HeroHeadline />
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
                <p className="mx-auto mt-4 max-w-xl text-sm text-muted">
                  Choose a contained, research-led, or custom outbound operation—and watch every
                  message and KPI in a shared CRM.
                </p>
              </div>
            </div>

            {/* Marquee strip at bottom */}
            <div className="relative hidden overflow-hidden border-t border-gray-200/60 bg-purple-50/50 py-6 sm:block" aria-hidden="true">
              <div className="relative overflow-hidden">
                <div className="marquee-track flex w-max items-center gap-12 px-12 text-sm font-semibold uppercase tracking-[0.18em]">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <span key={i} className="flex items-center gap-12">
                      {[
                        "Research-first outbound",
                        "Every message written by hand",
                        "Live shared CRM",
                        "Three ways to scale",
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
          <div className="absolute bottom-[15%] left-[3%] hidden pointer-events-none md:block" aria-hidden="true"
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

          <div className="relative z-10 mx-auto max-w-7xl px-6 pb-2 pt-10 sm:px-10 sm:pt-12">
            <Reveal>
              <h2 className="max-w-3xl text-3xl font-black uppercase leading-tight tracking-tight text-white sm:text-4xl">
                You asked for the numbers, and so the numbers have spoken
              </h2>
            </Reveal>
          </div>

          {/* Orbital Case Studies */}
          <OrbitalCaseStudies />

        </section>

        {/* ========== 2. PROBLEM ========== */}
        <section className="mx-auto max-w-7xl px-6 py-14 sm:px-10 sm:py-16">
          <Reveal>
            <h2 className="max-w-3xl text-3xl font-bold uppercase leading-tight tracking-tight sm:text-4xl">
              You know how to build. <span className="text-accent">Nobody taught you how to sell.</span>
            </h2>
          </Reveal>
          <div className="mt-9 grid items-center gap-8 lg:grid-cols-[1fr_1.05fr]">
            <div className="space-y-4 text-base leading-relaxed sm:text-lg">
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
            <Reveal delay={200}>
              <InteractiveWorldMap />
            </Reveal>
          </div>
        </section>


        {/* ========== 4. HOW IT WORKS ========== */}
        <section id="how" className="scroll-mt-24 border-t border-ink/10 bg-panel/50">
          <div className="mx-auto max-w-7xl px-6 py-14 sm:px-10 sm:py-16">
            <Reveal>
              <h2 className="text-3xl font-bold uppercase tracking-tight sm:text-4xl">
                No mystery. <span className="text-accent">No 90-slide deck.</span>
              </h2>
            </Reveal>
            <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {STEPS.map((s, i) => (
                <Reveal key={s.n} delay={i * 60} className="h-full">
                  <li className="h-full rounded-2xl border border-ink/10 bg-white/55 p-4">
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-full border border-white/30 text-xs font-bold backdrop-blur-xl transition-all duration-500 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10"
                      style={{
                        background: 'linear-gradient(160deg, rgba(255, 255, 255, 0.7) 0%, rgba(255, 255, 255, 0.4) 100%)',
                        backdropFilter: 'blur(20px) saturate(180%)',
                        WebkitBackdropFilter: 'blur(20px) saturate(180%)'
                      }}
                    >
                      {s.n}
                    </span>
                    <div className="mt-4">
                      <h3 className="text-lg font-semibold tracking-tight">{s.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
                    </div>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* ========== OUTBOUND OFFERS ========== */}
        <section id="offers" className="scroll-mt-24 border-y border-ink/10 bg-white font-sans text-ink [&_h2]:font-sans [&_h3]:font-sans [&_h4]:font-sans">
          <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-16 lg:px-10">
            <Reveal>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                Outbound offers
              </p>
              <h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
                Choose the support your team needs.
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
                Three straightforward ways to run outbound with Outlio.
              </p>
            </Reveal>

            <div className="mt-9 grid items-stretch gap-4 md:grid-cols-2 lg:grid-cols-3">
              {OUTBOUND_OFFERS.map((offer, index) => (
                <Reveal
                  key={offer.name}
                  delay={index * 70}
                  className={`h-full ${index === 2 ? "md:col-span-2 lg:col-span-1" : ""}`}
                >
                  <article
                    className={`offer-card flex h-full flex-col rounded-2xl border bg-transparent p-5 sm:p-6 ${
                      offer.featured
                        ? "border-accent/35"
                        : "border-ink/12"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted">
                        {offer.tier}
                      </p>
                      {offer.featured && (
                        <span className="rounded-full border border-accent/25 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-accent">
                          Full-service
                        </span>
                      )}
                    </div>

                    <h3 className="mt-4 text-xl font-bold tracking-tight sm:text-2xl">
                      {offer.name}
                    </h3>
                    <p className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
                      {offer.price}
                    </p>
                    <p className="mt-3 text-sm leading-relaxed text-muted">
                      {offer.description}
                    </p>

                    <div className="mt-5 border-t border-ink/10 pt-5">
                      <h4 className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
                        At a glance
                      </h4>
                      <ul className="mt-3 space-y-2.5">
                        {offer.highlights.map((item) => (
                          <li key={item} className="flex gap-2.5 text-sm leading-snug text-ink/80">
                            <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <details className="group mt-5 border-t border-ink/10 pt-4">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-ink">
                        Full plan details
                        <span aria-hidden className="text-lg font-normal text-muted transition-transform group-open:rotate-45">+</span>
                      </summary>
                      <div className="pt-4">
                        {offer.clientProvides.length > 0 && (
                          <div>
                            <h4 className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                              What you provide
                            </h4>
                            <ul className="mt-3 space-y-2">
                              {offer.clientProvides.map((item) => (
                                <li key={item} className="text-[13px] leading-relaxed text-muted">
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className={offer.clientProvides.length > 0 ? "mt-5" : ""}>
                          <h4 className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                            What&apos;s included
                          </h4>
                          <ul className="mt-3 space-y-2">
                            {offer.included.map((item) => (
                              <li key={item} className="flex gap-2 text-[13px] leading-relaxed text-muted">
                                <span aria-hidden className="text-accent">—</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </details>

                    <div className="mt-auto pt-6">
                      <Link
                        href={CALENDLY_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent"
                      >
                        Discuss this plan <span aria-hidden className="ml-2">&rarr;</span>
                      </Link>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
        {/* ========== 8. TESTIMONIALS ========== */}
        <section className="border-t border-ink/10 bg-panel/50">
          <div className="mx-auto max-w-7xl px-6 py-14 sm:px-10 sm:py-16">
            <Reveal>
              <h2 className="text-3xl font-bold uppercase tracking-tight sm:text-4xl">
                Don't take <span className="text-accent">our word</span> for it.
              </h2>
            </Reveal>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
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
        <section id="faq" className="mx-auto max-w-7xl scroll-mt-24 px-6 py-14 sm:px-10 sm:py-16">
          <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
            <Reveal>
              <h2 className="text-3xl font-bold uppercase leading-tight tracking-tight sm:text-4xl">
                The questions you're <span className="text-accent">already thinking.</span>
              </h2>
              <AnimatedArrow />
            </Reveal>
            <div className="divide-y divide-ink/10 border-y border-ink/10">
              {FAQS.map((f, i) => (
                <details key={f.q} open={i === 0} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-5 py-4 text-base font-semibold tracking-tight sm:text-lg">
                    {f.q}
                    <span aria-hidden className="faq-mark grid size-9 shrink-0 place-items-center rounded-full border border-ink text-xl leading-none">
                      +
                    </span>
                  </summary>
                  <p className="max-w-2xl pb-5 text-sm leading-relaxed text-muted sm:text-base">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ========== 10. FOUNDER STORY ========== */}
        <section id="about" className="scroll-mt-24 border-t border-ink/10 bg-panel/50">
          <div className="mx-auto max-w-7xl px-6 py-14 sm:px-10 sm:py-16">
            <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-10">
              <div>
                <Reveal>
                  <h2 className="text-3xl font-bold uppercase tracking-tight sm:text-4xl">
                    Built <span className="text-accent">the hard way.</span>
                  </h2>
                </Reveal>
                <div className="mt-6 max-w-xl space-y-3 text-base leading-relaxed">
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
                <div className="mt-6 space-y-2 text-xl font-semibold tracking-tight sm:text-2xl">
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
              <Reveal delay={150}>
                <div className="relative mx-auto aspect-[4/5] w-full max-w-[390px] overflow-hidden rounded-2xl">
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
        <section id="team" className="relative scroll-mt-24 overflow-hidden border-t border-ink/10 bg-panel/50 py-14 sm:py-16">
          <div className="relative mx-auto max-w-7xl px-6 sm:px-10">
            <Reveal>
              <h2 className="text-3xl font-bold uppercase tracking-tight text-ink sm:text-4xl">
                The people <span className="text-accent">behind the engine.</span>
              </h2>
            </Reveal>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
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
                        <h3 className="mt-3 px-1 text-xl font-semibold tracking-tight text-ink">{m.name}</h3>
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
          <div className="relative mx-auto max-w-7xl px-6 py-16 text-center sm:px-10 sm:py-20">
            <Reveal>
              <h2 className="text-4xl font-bold uppercase tracking-tight sm:text-5xl">
                You've read enough.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-cream/75 sm:text-lg">
                One call. Fifteen minutes. No pitch, if we can't help you, we'll say so on the call.
              </p>
              <Link
                href={CALENDLY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-block rounded-full bg-cream px-8 py-3.5 text-base font-semibold text-ink transition-all hover:scale-105 hover:bg-white"
              >
                Book a call
              </Link>
              <p className="mt-4 text-sm text-cream/55">
                Clear scope, visible execution, and a shared CRM from day one.
              </p>
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
