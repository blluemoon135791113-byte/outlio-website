"use client";

import { useEffect, useState } from "react";

const WORDS = ["OUTBOUND", "INBOUND"];
const WORD_MS = 2500;

export default function ServiceWordCycle() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const timer = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % WORDS.length);
    }, WORD_MS);

    return () => window.clearInterval(timer);
  }, []);

  /*
   * Width is reserved by `.service-word-slot::before` in globals.css, NOT by a
   * hidden span. A hidden span keeps its text in the DOM, so it is copied,
   * crawled and shown in search snippets — the same defect that had the hero
   * reading "tech startups.tech startups.". Only one word may exist here.
   */
  return (
    <span className="service-word-slot whitespace-nowrap text-left">
      <span key={index} className="text-accent hero-word-fade">
        {WORDS[index]}.
      </span>
    </span>
  );
}
