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
        <div>
          <p>
            More than 500+ SaaS launches every day. most of<br />
            them nail the launch but get carried away by the<br />
            hype, and fail to build a Sign-Up funnel around it.<br />
            They struggle to get consistent paying users and<br />
            see a huge churn-rate for their product.
          </p>
          <p>That’s where Outlio comes in.</p>
        </div>
      </div>
    </div>
  );
}
