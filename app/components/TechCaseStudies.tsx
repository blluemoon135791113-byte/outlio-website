"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import styles from "./TechCaseStudies.module.css";

type Brand = "knowledgecity" | "mentor" | "oee" | "hirebexa";
type Kpi = { prefix?: string; target: number; suffix?: string; dec?: number; anim?: number; label: string };

// One connected glass surface per pair, drawn at the pair's real pixel size so
// every corner is a true circular radius (no non-uniform SVG stretching).
function Surface() {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    const pair = svg?.parentElement;
    const mass = svg?.querySelector<SVGPathElement>("path");
    if (!svg || !pair || !mass) return;

    const draw = () => {
      const W = pair.clientWidth;
      const H = pair.clientHeight;
      if (!W || !H) return;
      const i = 1; // keep the stroke inside the box
      const a = W * 0.457, b = W * 0.543, y1 = H * 0.467, y2 = H * 0.53;
      const R = Math.min(40, W * 0.06, (b - a) * 0.75);
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      mass.setAttribute(
        "d",
        `M ${a + R} ${i} H ${W - i - R} Q ${W - i} ${i} ${W - i} ${i + R} V ${y1 - R} Q ${W - i} ${y1} ${W - i - R} ${y1} H ${b + R} Q ${b} ${y1} ${b} ${y1 + R} V ${H - i - R} Q ${b} ${H - i} ${b - R} ${H - i} H ${i + R} Q ${i} ${H - i} ${i} ${H - i - R} V ${y2 + R} Q ${i} ${y2} ${i + R} ${y2} H ${a - R} Q ${a} ${y2} ${a} ${y2 - R} V ${i + R} Q ${a} ${i} ${a + R} ${i} Z`,
      );
    };

    const ro = new ResizeObserver(draw);
    ro.observe(pair);
    draw();
    return () => ro.disconnect();
  }, []);

  return (
    <svg ref={ref} className={styles.surface} aria-hidden="true">
      <path className={styles.mass} />
    </svg>
  );
}

function Logo({ brand }: { brand: Brand }) {
  // KnowledgeCity shown by its own "kc" badge (the square mark cropped from the
  // official logo file) so every logo can sit at a matched, larger height.
  if (brand === "knowledgecity") return <span className={`${styles.logo} ${styles.kcBadge}`} role="img" aria-label="KnowledgeCity"><Image src="/clients/kc-logo-full.svg" alt="" width={210} height={44} unoptimized /></span>;
  // Official Mentor Global artwork, recoloured to its light-background variant.
  if (brand === "mentor") return <Image className={`${styles.logo} ${styles.mentorLogo}`} src="/clients/mentor-global-ink.png" alt="Mentor Global" width={760} height={351} unoptimized />;
  // OEE lockup, recentred about the viewBox centre.
  if (brand === "oee") return <svg className={`${styles.logo} ${styles.oeeLogo}`} viewBox="0 0 400 210" role="img" aria-label="OEE intellisuite"><g transform="translate(36 19) scale(0.82)"><g transform="translate(57,7)"><g fill="none" stroke="currentColor" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round"><path d="M 62 58 L 110.3 70.9 A 50 50 0 1 0 79.1 105 Z" /><path d="M 62 58 L 87 14.7" /><path d="M 68.6 64.1 L 116.9 77 A 50 50 0 0 1 85.7 111.1 Z" /></g><text x="130" y="59" fill="currentColor" fontFamily="Arial, sans-serif" fontSize="104" fontWeight="800" letterSpacing="-3" dominantBaseline="central">EE</text></g><text x="200" y="181" textAnchor="middle" fill="currentColor" fontFamily="Arial, sans-serif" fontSize="66" fontWeight="500" letterSpacing="-2" dominantBaseline="central">intellisuite</text></g></svg>;
  return <Image className={`${styles.logo} ${styles.bexaLogo}`} src="/clients/hirebexa-transparent.png" alt="Bexa by Corebex" width={2014} height={780} unoptimized />;
}

function Zone({ brand, name, place, kpis }: { brand: Brand; name: string; place: "tr" | "bl"; kpis?: Kpi[] }) {
  return (
    <div className={`${styles.zone} ${styles[place]}`} aria-label={`${name} case study visual`} {...(kpis ? { "data-kpi-zone": "" } : {})}>
      <div className={styles.logoPosition}><Logo brand={brand} /></div>
      {kpis && (
        <div className={styles.kpis}>
          {kpis.map((k) => (
            <div className={styles.kpi} key={k.label}>
              <div
                className={styles.num}
                data-num
                data-prefix={k.prefix ?? ""}
                data-target={k.target}
                data-suffix={k.suffix ?? ""}
                data-dec={k.dec ?? 0}
                data-anim={k.anim ?? k.dec ?? 0}
              >{`${k.prefix ?? ""}0${k.suffix ?? ""}`}</div>
              <div className={styles.lbl}>{k.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Metrics per client, matched to their stage. Input rates are never shown bare;
// only the outcomes they produced appear here.
const KC: Kpi[] = [
  { target: 12, suffix: "+", label: "meetings booked" },
  { prefix: "$", target: 500, suffix: "K+", label: "expansion revenue" },
];
const BEXA: Kpi[] = [
  { target: 30, suffix: "+", label: "demos booked" },
  { prefix: "$", target: 6500, suffix: "/m", label: "ROI" },
];
const OEE: Kpi[] = [
  { target: 40, suffix: "+", label: "meetings booked" },
  { prefix: "$", target: 240, suffix: "K+", label: "qualified pipeline" },
];

export default function TechCaseStudies() {
  const rootRef = useRef<HTMLElement>(null);

  // Slot-machine count-up that steps one modal at a time, once it scrolls in.
  useEffect(() => {
    const root = rootRef.current;
    const comp = root?.querySelector<HTMLElement>("[data-compositions]");
    if (!root || !comp) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    const fmt = (v: number, dec: number, prefix: string, suffix: string) =>
      prefix + Number(v).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suffix;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    function roll(el: HTMLElement) {
      const target = parseFloat(el.dataset.target || "0");
      const dec = +(el.dataset.dec || 0);
      const animDec = +(el.dataset.anim || dec);
      const prefix = el.dataset.prefix || "";
      const suffix = el.dataset.suffix || "";
      if (reduce) { el.textContent = fmt(target, dec, prefix, suffix); return; }
      const dur = 1700 + Math.random() * 400;
      el.textContent = fmt(0, animDec, prefix, suffix);
      const start = performance.now();
      const frame = (now: number) => {
        const p = Math.min(1, (now - start) / dur);
        el.textContent = p < 1 ? fmt(target * easeOut(p), animDec, prefix, suffix) : fmt(target, dec, prefix, suffix);
        if (p < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }

    const zones = [...root.querySelectorAll<HTMLElement>("[data-kpi-zone]")];
    let started = false;
    let cancelled = false;
    async function cascade() {
      if (started) return;
      started = true;
      for (const z of zones) {
        if (cancelled) return;
        z.querySelectorAll<HTMLElement>("[data-num]").forEach((n, i) => setTimeout(() => roll(n), i * 140));
        await wait(1600);
      }
    }

    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) cascade(); }),
      { threshold: 0.2 },
    );
    io.observe(comp);

    // Reveal each question once as it scrolls in. Copy already on screen at
    // mount is never hidden, so there is no flash and no-JS stays readable.
    const reveal = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const copy = e.target.parentElement;
        if (copy) copy.dataset.reveal = "in";
        reveal.unobserve(e.target);
      }),
      { rootMargin: "0px 0px -15% 0px" },
    );
    if (!reduce) {
      for (const c of root.querySelectorAll<HTMLElement>("[data-copy]")) {
        const h3 = c.querySelector("h3");
        if (!h3 || h3.getBoundingClientRect().top < window.innerHeight) continue;
        c.dataset.reveal = "pending";
        reveal.observe(h3);
      }
    }
    return () => { cancelled = true; io.disconnect(); reveal.disconnect(); };
  }, []);

  return <section ref={rootRef} id="results" className={styles.section} aria-labelledby="results-heading">
    <div className={styles.intro}><h2 id="results-heading">Four moments, two connected surfaces.</h2></div>
    <div className={styles.compositions} data-compositions>
      <div className={styles.pair}><Surface />
        <div className={`${styles.copy} ${styles.tl}`} data-copy><h3>Are you an enterprise struggling to secure <span>projected annual ARR?</span></h3></div>
        <Zone brand="knowledgecity" name="KnowledgeCity" place="tr" kpis={KC} />
        <Zone brand="mentor" name="Mentor Global" place="bl" />
        <div className={`${styles.copy} ${styles.br}`} data-copy><h3>Closed your Series A, but need sales to support <span>your valuation?</span></h3></div>
      </div>
      <div className={styles.pair}><Surface />
        <div className={`${styles.copy} ${styles.tl}`} data-copy><h3>Launching at pre-seed and looking for signups <span>within weeks?</span></h3></div>
        <Zone brand="hirebexa" name="Hirebexa.ai" place="tr" kpis={BEXA} />
        <Zone brand="oee" name="EE intellisuite" place="bl" kpis={OEE} />
        <div className={`${styles.copy} ${styles.br}`} data-copy><h3>Not enough inbound traction to balance <span>outbound revenue?</span></h3></div>
      </div>
    </div>
  </section>;
}
