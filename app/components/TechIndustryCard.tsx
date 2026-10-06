"use client";

import { useEffect, useRef, useState } from "react";
import { gameshellDocument } from "./gameshell-document";
import styles from "./TechIndustryCard.module.css";

export default function TechIndustryCard() {
  const root = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // The scene builds on the page's main thread, so start it early and in an
    // idle slot rather than mid-scroll right as the card arrives.
    let idle = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      const mount = () => setReady(true);
      if ("requestIdleCallback" in window) idle = window.requestIdleCallback(mount, { timeout: 1200 });
      else mount();
    }, {rootMargin: "900px 0px"});
    if (root.current) observer.observe(root.current);
    return () => { observer.disconnect(); if (idle) window.cancelIdleCallback(idle); };
  }, []);
  return (
    <div ref={root} className={styles.grid}>
      <div className={styles.visual}>
        {ready && <iframe title="Outlio GameShell — hover or focus to assemble" srcDoc={gameshellDocument} className={styles.frame} />}
      </div>
      <div className={styles.copy}>
        <h2>Tech/SaaS Industry</h2>
        <p>Turn your ICP into qualified demos. Outlio finds the right accounts, runs targeted outreach, and qualifies replies to build your SaaS sales pipeline.</p>
      </div>
    </div>
  );
}
