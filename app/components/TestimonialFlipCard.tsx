"use client";

import { useState } from "react";
import Image from "next/image";

interface TestimonialFlipCardProps {
  quote: string;
  who: string;
  proofImage: string;
}

export default function TestimonialFlipCard({ quote, who, proofImage }: TestimonialFlipCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);

  return (
    <div
      className="perspective-1000 relative w-full"
      style={{
        minHeight: "220px",
        height: "100%"
      }}
      onMouseEnter={() => setIsFlipped(true)}
      onMouseLeave={() => setIsFlipped(false)}
    >
      <button
        type="button"
        aria-pressed={isFlipped}
        aria-label={
          isFlipped
            ? `Proof from ${who} is shown. Return to testimonial.`
            : `${quote} — ${who}. View proof.`
        }
        onClick={() => setIsFlipped((current) => !current)}
        className="absolute inset-0 z-20 cursor-pointer appearance-none rounded-2xl border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
      />
      <div
        aria-hidden="true"
        className="relative transition-transform duration-700 preserve-3d"
        style={{
          transformStyle: "preserve-3d",
          transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
          minHeight: "220px",
          height: "100%"
        }}
      >
        {/* Front Side */}
        <figure
          className="absolute inset-0 flex h-full flex-col justify-between rounded-2xl border border-white/30 p-5 backdrop-blur-xl transition-all duration-500 backface-hidden hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10 sm:p-6"
          style={{
            background: 'linear-gradient(160deg, rgba(255, 255, 255, 0.75) 0%, rgba(255, 255, 255, 0.45) 100%)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            backfaceVisibility: 'hidden',
          }}
        >
          <blockquote className="text-lg font-medium leading-snug tracking-tight sm:text-xl">
            &ldquo;{quote}&rdquo;
          </blockquote>
          <figcaption className="mt-6 text-sm text-muted">- {who}</figcaption>
          <div className="mt-3 text-xs text-accent uppercase tracking-wider">
            View proof
          </div>
        </figure>

        {/* Back Side */}
        <div
          className="absolute inset-0 flex h-full items-center justify-center p-4 backdrop-blur-xl border border-accent/40 rounded-2xl overflow-hidden"
          style={{
            background: 'linear-gradient(160deg, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0.65) 100%)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          <div className="relative w-full h-full rounded-lg overflow-hidden">
            <Image
              src={proofImage}
              alt={`Proof from ${who}`}
              fill
              className="object-contain rounded-lg"
              sizes="(max-width: 768px) 100vw, 50vw"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
