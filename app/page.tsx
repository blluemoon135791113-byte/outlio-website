import Image from "next/image";
import Link from "next/link";
import Nav from "./components/Nav";
import Footer from "./components/Footer";
import Reveal from "./components/Reveal";
import TechCaseStudies from "./components/TechCaseStudies";
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


        {/* ========== TECH CASE STUDIES ========== */}
        <TechCaseStudies />

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
