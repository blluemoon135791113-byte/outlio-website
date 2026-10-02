"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import styles from "./TechCaseStudies.module.css";

type Brand = "knowledgecity" | "mentor" | "oee" | "hirebexa";

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
  // Official KnowledgeCity brand vector (their own SVG lockup) — sharp at any DPI.
  if (brand === "knowledgecity") return <Image className={`${styles.logo} ${styles.kcLogo}`} src="/clients/kc-logo-full.svg" alt="KnowledgeCity" width={210} height={44} unoptimized />;
  // Official Mentor Global artwork, recoloured to its light-background variant
  // ("global" from white to ink) so it reads on the glass with no backing.
  if (brand === "mentor") return <Image className={`${styles.logo} ${styles.mentorLogo}`} src="/clients/mentor-global-ink.png" alt="Mentor Global" width={760} height={351} unoptimized />;
  // OEE lockup, recentred: the pie mark + "EE" form one group, with
  // "intellisuite" centred beneath it, both balanced about the viewBox centre.
  if (brand === "oee") return <svg className={`${styles.logo} ${styles.oeeLogo}`} viewBox="0 0 400 210" role="img" aria-label="OEE intellisuite"><g transform="translate(36 19) scale(0.82)"><g transform="translate(57,7)"><g fill="none" stroke="currentColor" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round"><path d="M 62 58 L 110.3 70.9 A 50 50 0 1 0 79.1 105 Z" /><path d="M 62 58 L 87 14.7" /><path d="M 68.6 64.1 L 116.9 77 A 50 50 0 0 1 85.7 111.1 Z" /></g><text x="130" y="59" fill="currentColor" fontFamily="Arial, sans-serif" fontSize="104" fontWeight="800" letterSpacing="-3" dominantBaseline="central">EE</text></g><text x="200" y="181" textAnchor="middle" fill="currentColor" fontFamily="Arial, sans-serif" fontSize="66" fontWeight="500" letterSpacing="-2" dominantBaseline="central">intellisuite</text></g></svg>;
  return <Image className={`${styles.logo} ${styles.hirebexaLogo}`} src="/clients/hirebexa-transparent.png" alt="Bexa by Corebex" width={2014} height={780} unoptimized />;
}

function Zone({ brand, name, place }: { brand: Brand; name: string; place: "tr" | "bl" }) {
  return (
    <div className={`${styles.zone} ${styles[place]}`} aria-label={`${name} case study visual`}>
      <div className={styles.logoPosition}><Logo brand={brand} /></div>
      <span className={styles.learnMore}>
        <span className={styles.linkIcon}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg></span>
        <span className={styles.learnLabel}>Learn more</span>
      </span>
    </div>
  );
}

export default function TechCaseStudies() {
  return <section id="results" className={styles.section} aria-labelledby="results-heading">
    <div className={styles.intro}><h2 id="results-heading">Four moments, two connected surfaces.</h2></div>
    <div className={styles.compositions}>
      <div className={styles.pair}><Surface />
        <div className={`${styles.copy} ${styles.tl}`}><h3>Are you an enterprise struggling to secure <span>projected annual ARR?</span></h3></div>
        <Zone brand="knowledgecity" name="KnowledgeCity" place="tr" />
        <Zone brand="mentor" name="Mentor Global" place="bl" />
        <div className={`${styles.copy} ${styles.br}`}><h3>Closed your Series A, but need sales to support <span>your valuation?</span></h3></div>
      </div>
      <div className={styles.pair}><Surface />
        <div className={`${styles.copy} ${styles.tl}`}><h3>Launching at pre-seed and looking for signups <span>within weeks?</span></h3></div>
        <Zone brand="hirebexa" name="Hirebexa.ai" place="tr" />
        <Zone brand="oee" name="EE intellisuite" place="bl" />
        <div className={`${styles.copy} ${styles.br}`}><h3>Not enough inbound traction to balance <span>outbound revenue?</span></h3></div>
      </div>
    </div>
  </section>;
}
