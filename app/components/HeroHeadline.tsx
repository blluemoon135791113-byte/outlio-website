"use client";

import { useEffect, useState, useRef } from "react";

const WORDS = ["tech startups", "SaaS startups", "agencies"];
const WORD_MS = 2500;

export default function HeroHeadline() {
  const [index, setIndex] = useState(0);
  const [scrollOpacity, setScrollOpacity] = useState(1);
  const headlineRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const timer = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % WORDS.length);
    }, WORD_MS);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      if (!headlineRef.current) return;

      const scrollY = window.scrollY;
      const fadeStart = 0;
      const fadeEnd = 400;

      let opacity = 1;
      if (scrollY > fadeStart) {
        opacity = 1 - Math.min((scrollY - fadeStart) / (fadeEnd - fadeStart), 1);
      }

      setScrollOpacity(opacity);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <h1
      ref={headlineRef}
      className="text-[clamp(2.6rem,7.2vw,6.2rem)] font-bold uppercase leading-[0.98] tracking-tight transition-all duration-300"
      style={{
        opacity: scrollOpacity,
        filter: `blur(${(1 - scrollOpacity) * 4}px)`,
        transform: `translateY(${(1 - scrollOpacity) * -20}px)`
      }}
    >
      <span className="hero-main block">
        <span className="inline-block hero-text-slide">We</span>{" "}
        <span className="inline-block hero-text-slide" style={{ animationDelay: "0.1s" }}>
          book
        </span>{" "}
        <span className="inline-block hero-text-slide" style={{ animationDelay: "0.2s" }}>
          the
        </span>{" "}
        <span className="inline-block hero-text-slide" style={{ animationDelay: "0.3s" }}>
          meetings
        </span>{" "}
        <span className="inline-block hero-text-slide" style={{ animationDelay: "0.4s" }}>
          for
        </span>{" "}
        {/*
          Width is reserved by `.hero-word-slot::before` in globals.css, NOT by
          a hidden span. A hidden span kept its text in the DOM, so the headline
          was copied and indexed as "…for tech startups.tech startups." — only
          one word may exist here.
        */}
        <span className="hero-word-slot whitespace-nowrap">
          <span key={index} className="text-accent hero-word-fade">
            {WORDS[index]}.
          </span>
        </span>
      </span>
    </h1>
  );
}
