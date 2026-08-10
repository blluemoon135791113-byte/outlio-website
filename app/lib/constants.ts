// External URLs
//
// The single source of truth for the booking link. Every "Book a call" CTA
// imports this — do not paste the URL inline again, or changing it means
// hunting through five files and missing one.
export const CALENDLY_URL = "https://calendly.com/husnain_rafiq/30min";
export const EMAIL = "husnain@outlio.io";

// Social Media
export const SOCIAL_LINKS = {
  twitter: "https://x.com/OutlioLeadGen",
  linkedin: "https://www.linkedin.com/company/outlio/?viewAsMember=true",
  instagram: "https://www.instagram.com/outlio.io/?hl=en",
} as const;

// Animation Timings
export const ANIMATION = {
  wordCycleMs: 2500,
  scrollFadeEnd: 400,
  revealDelay: 100,
} as const;
