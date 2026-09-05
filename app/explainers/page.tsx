import type { Metadata } from "next";
import Link from "next/link";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import Reveal from "../components/Reveal";
import VideoShowcase from "../components/VideoShowcase";
import ServiceWordCycle from "../components/ServiceWordCycle";
import Breadcrumbs from "../components/Breadcrumbs";
import { CALENDLY_URL } from "../lib/constants";

export const metadata: Metadata = {
  title: "SaaS Explainer Videos & Motion Graphics | Outlio",
  description: "Motion-graphic ads and explainer videos for SaaS and tech startups. Turn 'wait, what does it do?' into 'where do I sign up?' - 60-second videos that convert.",
  keywords: [
    "SaaS explainer video",
    "motion graphics",
    "explainer video production",
    "SaaS video marketing",
    "tech startup videos",
    "product demo video",
    "animated explainer video",
    "B2B video marketing",
    "software explainer video"
  ],
  alternates: {
    canonical: 'https://outlio.io/explainers',
  },
  openGraph: {
    title: 'SaaS Explainer Videos & Motion Graphics | Outlio',
    description: 'Motion-graphic ads and explainer videos for SaaS and tech startups',
    url: 'https://outlio.io/explainers',
    type: 'website',
  },
};

const PROCESS = [
  {
    n: "1",
    title: "Discovery & Strategy",
    body: "We start by getting to know your product inside and out. One simple intake form tells us how it works, who it's for, and what makes it stand out. From there, we lock in the creative direction and map out exactly what we're building together.",
  },
  {
    n: "2",
    title: "Production",
    body: "Our creative team dives deep into Reddit threads, competitor content, and real user feedback to find what actually makes your buyers care. Script first. Your approval next. Storyboard after that. Then our motion designers get to work, turning it all into a polished launch or demo video.",
  },
  {
    n: "3",
    title: "Influencer Management",
    body: "While production is underway, our influencer team is already moving. We find, vet, and lock in creators whose audience matches your exact buyer. By the time your video is ready, your distribution network is already in place, no scrambling, no delays.",
    note: "(Organic Launch Campaign clients only)",
  },
  {
    n: "4",
    title: "Launch Day",
    body: "This is where it all comes together. Your video, your influencer network, your personal circle, investors, teammates, early users, all drop at once. That synchronized moment creates a spike, and it's the spike the algorithm notices. That's what separates a good video from a viral one.",
    note: "(Organic Launch Campaign clients only)",
  },
];

export default function Explainers() {
  return (
    <>
      <Nav surface="motion" />
      <Breadcrumbs />
      <main>
        {/* ========== E1. HERO ========== */}
        <section className="grad-halo relative overflow-hidden">
          <div className="mx-auto max-w-7xl px-6 pb-24 pt-20 sm:px-10 sm:pt-28">
            <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
              Outlio &middot; Motion Graphic Ads
            </p>
            <h1 className="mt-6 max-w-4xl text-[clamp(2.6rem,7vw,5.8rem)] font-bold uppercase leading-[0.98] tracking-tight">
              Your product, explained in <span className="text-accent">60 seconds.</span>
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-relaxed text-muted sm:text-xl">
              Motion-graphic ads for SaaS and tech startups — the kind that turn &ldquo;wait,
              what does it do?&rdquo; into &ldquo;where do I sign up?&rdquo;
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              {/* SUPPLIED SEPARATELY: founder's scheduling link */}
              <Link
                href="#book"
                className="rounded-full bg-ink px-8 py-4 text-base font-semibold text-cream transition-colors hover:bg-accent"
              >
                Book a call
              </Link>
              <Link
                href="#work"
                className="rounded-full border border-ink px-8 py-4 text-base font-semibold transition-colors hover:bg-ink hover:text-cream"
              >
                Watch the work
              </Link>
            </div>
          </div>
        </section>

        {/* ========== E2. WHY EXPLAINERS ========== */}
        <section className="border-t border-ink/10 bg-panel/50">
          <div className="mx-auto max-w-7xl px-6 py-24 sm:px-10 sm:py-32">
            <Reveal>
              <p className="text-4xl font-semibold leading-snug sm:text-5xl">
                A product demo takes fifteen minutes and assumes they've already decided. A motion
                explainer gives them the reason to decide — <span className="text-accent">in sixty seconds.</span>
              </p>
            </Reveal>
          </div>
        </section>

        {/* ========== E3. HOW IT WORKS WITH OUTBOUND/INBOUND ========== */}
        <section className="border-t border-ink/10">
          <div className="mx-auto max-w-7xl px-6 py-24 sm:px-10 sm:py-32">
            <Reveal>
              <h2 className="text-4xl font-bold uppercase tracking-tight sm:text-6xl">
                Pair it with <ServiceWordCycle />
              </h2>
            </Reveal>
            <Reveal>
              <p className="mt-6 max-w-3xl text-lg leading-relaxed text-muted sm:text-xl">
                A motion graphic ad gets attention. Outbound turns that attention into booked meetings.
                The video shows what you do. Our outreach gets them on a call. Together, they're the full pipeline.
              </p>
            </Reveal>
            <Reveal>
              <div className="mt-10">
                <Link
                  href="/#how"
                  className="inline-block rounded-full border-2 border-accent px-8 py-4 text-base font-semibold text-accent transition-all hover:bg-accent hover:text-white"
                >
                  See how we do it
                </Link>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ========== E4. PROCESS ========== */}
        <section className="border-t border-ink/10 bg-panel/50">
          <div className="mx-auto max-w-7xl px-6 py-24 sm:px-10 sm:py-32">
            <Reveal>
              <h2 className="text-4xl font-bold uppercase tracking-tight sm:text-6xl">
                Our <span className="text-accent">Process</span>
              </h2>
            </Reveal>
            <div className="mt-16 grid gap-6 md:grid-cols-2">
              {PROCESS.map((step, i) => (
                <Reveal key={step.n} delay={i * 80}>
                  <div
                    className="flex h-full flex-col p-8 backdrop-blur-xl border border-white/30 rounded-2xl transition-all duration-500 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10"
                    style={{
                      background: 'linear-gradient(160deg, rgba(255, 255, 255, 0.75) 0%, rgba(255, 255, 255, 0.45) 100%)',
                      backdropFilter: 'blur(24px) saturate(180%)',
                      WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                    }}
                  >
                    <div className="flex items-start gap-4">
                      <div className="shrink-0 flex items-center justify-center w-12 h-12 rounded-full bg-accent text-white font-bold text-xl">
                        {step.n}
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-bold sm:text-2xl">{step.title}</h3>
                        {step.note && (
                          <p className="mt-1 text-xs text-accent font-medium">{step.note}</p>
                        )}
                      </div>
                    </div>
                    <p className="mt-4 text-base leading-relaxed text-muted">{step.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ========== E5. WORK ========== */}
        <section id="work" className="scroll-mt-24 border-t border-ink/10">
          <div className="mx-auto max-w-7xl px-6 py-24 sm:px-10 sm:py-32">
            <Reveal>
              <h2 className="text-4xl font-bold uppercase tracking-tight sm:text-6xl">
                Watch the <span className="text-accent">work.</span>
              </h2>
            </Reveal>
            <Reveal>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted sm:text-xl">
                Motion-graphic explainers and ad creatives that turned scroll into signal.
              </p>
            </Reveal>

            <div className="mt-16">
              <VideoShowcase
                videos={[
                  {
                    id: "landscape-1",
                    youtubeId: "vLjzcfrmrZw",
                    label: "SaaS Explainer",
                    aspectRatio: "landscape"
                  },
                  {
                    id: "portrait-1",
                    youtubeId: "_Foj2lAtjGY",
                    label: "SaaS Explainer",
                    aspectRatio: "portrait"
                  },
                  {
                    id: "portrait-2",
                    youtubeId: "DMV0yLgm3m4",
                    label: "Ad Creative",
                    aspectRatio: "portrait"
                  },
                  {
                    id: "portrait-3",
                    youtubeId: "6dkwmYRf3YY",
                    label: "Ad Creative",
                    aspectRatio: "portrait"
                  }
                ]}
              />
            </div>
          </div>
        </section>

        {/* ========== E6. CTA ========== */}
        <section id="book" className="scroll-mt-24 border-t border-ink/10">
          <div className="mx-auto max-w-7xl px-6 py-24 text-center sm:px-10 sm:py-32">
            <Reveal>
              <h2 className="text-4xl font-bold uppercase tracking-tight sm:text-6xl">
                Ready to turn <span className="text-accent">scroll into signal?</span>
              </h2>
            </Reveal>
            <Reveal>
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted sm:text-xl">
                Book a call. We'll build the explainer that turns &ldquo;wait, what is it?&rdquo; into
                &ldquo;where do I sign up?&rdquo;
              </p>
            </Reveal>
            <Reveal>
              <Link
                href={CALENDLY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-10 inline-block rounded-full bg-ink px-8 py-4 text-base font-semibold text-cream transition-colors hover:bg-accent"
              >
                Book a call
              </Link>
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
