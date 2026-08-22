"use client";

import { ReactLenis } from "lenis/react";
import { usePathname } from "next/navigation";

export default function SmoothScroll() {
  const pathname = usePathname();

  // Product screens contain their own long tables, drawers and result panes.
  // Native scrolling is both faster and more predictable there; a root Lenis
  // instance can consume wheel input before a nested region receives it.
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/admin")) return null;

  return (
    <ReactLenis
      root
      options={{
        anchors: true,
        autoRaf: true,
        autoToggle: true,
        lerp: 0.085,
        smoothWheel: true,
        wheelMultiplier: 0.9,
      }}
    />
  );
}
