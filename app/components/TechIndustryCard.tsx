"use client";

import { useEffect, useRef, useState } from "react";
import { gameshellDocument } from "./gameshell-document";
import styles from "./TechIndustryCard.module.css";

export default function TechIndustryCard() {
  const root = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setReady(true); observer.disconnect(); }
    }, {rootMargin: "200px"});
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
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
