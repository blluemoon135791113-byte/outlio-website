"use client";

import { type ButtonHTMLAttributes } from "react";

export interface FloatingDotsCtaProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
}

export default function FloatingDotsCta({
  label = "Sign Up",
  className,
  ...props
}: FloatingDotsCtaProps) {
  return (
    <button
      type="button"
      className={["fdc-button", className].filter(Boolean).join(" ")}
      {...props}
    >
      <span className="fdc-points_wrapper" aria-hidden="true">
        {Array.from({ length: 10 }).map((_, i) => (
          <i key={i} className="fdc-point" />
        ))}
      </span>

      <span className="fdc-inner">
        {label}
        <svg
          className="fdc-icon"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      </span>
    </button>
  );
}
