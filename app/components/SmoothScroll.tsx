"use client";

import { ReactLenis } from "lenis/react";

export default function SmoothScroll() {
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
