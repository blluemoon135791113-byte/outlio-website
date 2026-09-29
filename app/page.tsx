import Image from "next/image";
import Link from "next/link";
import Nav from "./components/Nav";
import Footer from "./components/Footer";
import Reveal from "./components/Reveal";
import OrbitalCaseStudies from "./components/OrbitalCaseStudies";
import Starfield from "./components/Starfield";
import MeteorShower from "./components/MeteorShower";
import StarFieldCanvas from "./components/StarFieldCanvas";
import FAQSchema from "./components/FAQSchema";
import FAQAccordion from "./components/FAQAccordion";
import FinalCta from "./components/FinalCta";
import TeamAccordion from "./components/TeamAccordion";
import InteractiveGtmHero from "./components/InteractiveGtmHero";
import UseModes from "./components/UseModes";
import SalesStrategies from "./components/SalesStrategies";
import { CALENDLY_URL } from "./lib/constants";
import pricingStyles from "./components/PricingSection.module.css";
import faqStyles from "./components/FAQSection.module.css";

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
    q: "How do you find our ideal customers?",
    a: "Behavior-based targeting, not just job titles. Industry, company profile, company size, down to the right founder or decision-maker.",
  },
  {
    q: "What industries do you work with?",
    a: "B2B services, SaaS and tech startups, agencies, and motion/animation-adjacent businesses. If you're a local blue-collar business, we're not your people, and we'll tell you that on the call.",
  },
];

export default function Home() {
  return (
    <>
      <FAQSchema faqs={FAQS} />
      <Nav />
      <main id="main-content" tabIndex={-1}>
        {/* ========== 1. HERO ========== */}
        <InteractiveGtmHero />

        {/* ========== 2. USE MODES — Afflatus ========== */}
        <UseModes />

        {/* ========== 3. BUILDING ON YOUR PROGRESS — strategy modules ========== */}
        <SalesStrategies />


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

        {/* ========== OUTBOUND OFFERS ========== */}
        <section id="offers" className={pricingStyles.section}>
          <div className={pricingStyles.container}>
            <Reveal className={pricingStyles.heading}>
              <h2>Pick the plan that fits your startup</h2>
              <p>Three clear ways to build an outbound engine with Outlio.</p>
            </Reveal>

            <div className={pricingStyles.grid}>
              {OUTBOUND_OFFERS.map((offer, index) => (
                <Reveal
                  key={offer.name}
                  delay={index * 70}
                  className={`${pricingStyles.slot} ${pricingStyles[`slot${index + 1}`]}`}
                >
                  <article className={`${pricingStyles.card} ${offer.featured ? pricingStyles.featured : pricingStyles.compact}`}>
                    <div className={pricingStyles.planInfo}>
                      <span className={pricingStyles.badge}>
                        {offer.tier}{offer.featured ? " · Full service" : ""}
                      </span>
                      <h3>{offer.name}</h3>
                      <p className={pricingStyles.description}>{offer.description}</p>
                    </div>
                    <div className={pricingStyles.features}>
                      <h4>At a glance</h4>
                      <ul>
                        {offer.highlights.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                    <div className={pricingStyles.purchase}>
                      <p className={pricingStyles.price}>
                        {offer.price === "Custom" ? "Custom" : <>{offer.price.replace("/mo", "")}<small>/month</small></>}
                      </p>
                      <Link href={CALENDLY_URL} target="_blank" rel="noopener noreferrer" className={pricingStyles.cta}>
                        <span className={pricingStyles.ctaLabel}>Discuss this plan</span>
                        <span className={pricingStyles.ctaIcon} aria-hidden>↗</span>
                      </Link>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
        {/* ========== FAQ ========== */}
        <section id="faq" className={faqStyles.section}>
          <div className={faqStyles.container}>
            <div className={faqStyles.left}>
              <h2>Frequently asked<br />questions</h2>
              <Image
                src="/faq/network-pixel.png"
                alt=""
                width={160}
                height={152}
                unoptimized
                className={faqStyles.network}
              />
            </div>
            <FAQAccordion faqs={FAQS} />
          </div>
        </section>

        {/* ========== TEAM ========== */}
        <TeamAccordion />

        {/* ========== FINAL CTA ========== */}
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
