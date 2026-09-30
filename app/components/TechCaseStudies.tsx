"use client";

import type { PointerEvent, ReactNode } from "react";
import styles from "./TechCaseStudies.module.css";

function Bridge() {
  return (
    <svg className={styles.bridge} viewBox="0 0 700 700" preserveAspectRatio="none" aria-hidden="true">
      <path className={styles.mass} d="M 360 2 H 659 Q 698 2 698 41 V 287 Q 698 327 659 327 H 419 Q 380 327 380 367 V 659 Q 380 698 341 698 H 41 Q 2 698 2 659 V 411 Q 2 371 42 371 H 280 Q 320 371 320 331 V 42 Q 320 2 360 2 Z" />
      <path className={styles.shine} d="M 360 2 H 659 Q 698 2 698 41 V 287 Q 698 327 659 327 H 419" />
    </svg>
  );
}

function Stage({ type, label, children }: { type: string; label: string; children: ReactNode }) {
  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const stage = event.currentTarget;
    const rect = stage.getBoundingClientRect();
    stage.style.setProperty("--ry", `${((event.clientX - rect.left) / rect.width - 0.5) * 8}deg`);
    stage.style.setProperty("--rx", `${(0.5 - (event.clientY - rect.top) / rect.height) * 8}deg`);
  }

  function resetTilt(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.style.setProperty("--rx", "0deg");
    event.currentTarget.style.setProperty("--ry", "0deg");
  }

  return (
    <div className={`${styles.stage} ${type}`} tabIndex={0} role="img" aria-label={label} onPointerMove={handlePointerMove} onPointerLeave={resetTilt}>
      <div className={styles.visual}>{children}</div>
    </div>
  );
}

function ProfileArtwork() {
  return <><div className={`${styles.sheet} ${styles.back}`} /><div className={`${styles.sheet} ${styles.middle}`} /><div className={`${styles.sheet} ${styles.front}`}><div className={styles.brand}><span className={styles.brandMark}>✳</span> abc <span className={styles.email}>hello@abc.com</span></div><p className={styles.tiny}>ABC is a dynamic and innovative company founded in 2022, committed to creating unique and impactful experiences. With a team of specialists across digital, strategy, and design, we help ambitious teams take ideas to market. Our work brings together clear thinking, craft, and long-term partnerships.</p></div></>;
}

function IcpArtwork() {
  return <><div className={`${styles.sheet} ${styles.back}`} /><div className={`${styles.sheet} ${styles.middle}`} /><div className={`${styles.sheet} ${styles.front}`}><h4>Sales Management</h4><dl><dt>Level</dt><dd>Manager</dd><dt>Range</dt><dd>10M–50M</dd><dt>Employees</dt><dd>25–100</dd></dl><div className={styles.tags}><i>Founder</i><i>CEO</i><i>+2</i></div></div></>;
}

const integrationRows = [["Y", "▣"], ["↗", "✳", "A"], ["☁", "M"], ["◉", "A"]];

function IntegrationsArtwork() {
  return <>{integrationRows.map((row, rowIndex) => <div className={styles.row} key={rowIndex}>{row.map((symbol, index) => <span className={`${styles.pill} ${rowIndex === 1 && index === 1 ? styles.selected : ""}`} key={`${symbol}-${index}`}><span className={styles.icon}>{symbol}</span><b /></span>)}</div>)}</>;
}

const people = [["MS", "Michael Smith", "Digital Marketing Specialist"], ["DB", "David Brown", "Tech Innovator"], ["ER", "Emily Roberts", "Business Development"]];

function ConnectionsArtwork() {
  return <><span className={styles.linked}>in</span><div className={styles.contactList}>{people.map(([initials, name, title]) => <div className={styles.person} key={name}><span className={styles.avatar}>{initials}</span><span><strong>{name}</strong><small>{title}</small></span><span className={styles.check}>✓</span></div>)}</div><span className={styles.linkDisc}>↗</span></>;
}

export default function TechCaseStudies() {
  return (
    <section id="results" className={styles.section} aria-labelledby="results-heading">
      <div className={styles.intro}><p>Outlio / Connected systems</p><h2 id="results-heading">Four moments, two connected surfaces.</h2></div>
      <div className={styles.compositions}>
        <div className={styles.pair}>
          <Bridge />
          <div className={styles.copy}><h3>Setup your company<br />profile with <span>important information.</span></h3></div>
          <Stage type={styles.profile} label="Layered company profile cards"><ProfileArtwork /></Stage>
          <Stage type={styles.icp} label="Layered ideal customer profile cards"><IcpArtwork /></Stage>
          <div className={`${styles.copy} ${styles.bottom}`}><h3>Create your ideal ICP <span>based on the target criteria.</span></h3></div>
        </div>
        <div className={styles.pair}>
          <Bridge />
          <div className={styles.copy}><h3>Connect or get email from Outlio <span>to increase the reach.</span></h3></div>
          <Stage type={styles.integrations} label="Floating integration rows"><IntegrationsArtwork /></Stage>
          <Stage type={styles.connections} label="Floating prospect list and connection icon"><ConnectionsArtwork /></Stage>
          <div className={`${styles.copy} ${styles.bottom}`}><h3>Connect your LinkedIn <span>to reach out to new prospects directly.</span></h3></div>
        </div>
      </div>
    </section>
  );
}
