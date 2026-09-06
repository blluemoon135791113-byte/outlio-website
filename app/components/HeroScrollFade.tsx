"use client";

import { useEffect, useState, useRef, type ReactNode } from "react";

interface HeroScrollFadeProps {
  children: ReactNode;
  className?: string;
}

export default function HeroScrollFade({ children, className = "" }: HeroScrollFadeProps) {
  const [scrollOpacity, setScrollOpacity] = useState(1);
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const compactViewport = window.matchMedia("(max-width: 1023px)").matches;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (compactViewport || reducedMotion) return;

    const handleScroll = () => {
      if (!elementRef.current) return;

      const scrollY = window.scrollY;
      const fadeStart = 0;
      const fadeEnd = 300;

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
    <div
      ref={elementRef}
      className={`transition-all duration-200 ${className}`}
      style={{
        opacity: scrollOpacity,
        filter: `blur(${(1 - scrollOpacity) * 3}px)`,
        transform: `translateY(${(1 - scrollOpacity) * -15}px)`
      }}
    >
      {children}
    </div>
  );
}
