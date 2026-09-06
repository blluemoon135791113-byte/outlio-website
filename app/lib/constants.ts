// External URLs
//
// The single source of truth for the booking link. Every "Book a call" CTA
// imports this — do not paste the URL inline again, or changing it means
// hunting through five files and missing one.
export const CALENDLY_URL = "https://calendly.com/husnain_rafiq/30min";
export const EMAIL = "husnain@outlio.io";

// Chrome Web Store listing for the Lead Capture extension.
//
// A public URL, so it lives here rather than in an environment variable —
// putting it in env meant every surface silently showed "coming soon" until
// someone remembered to set it in Vercel, for both Production AND Preview.
// NEXT_PUBLIC_EXT_STORE_CHROME still overrides this if it is set.
export const CHROME_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/outlio-lead-capture/ckmeacjknoaofagllmciibipigplkbeg";

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
