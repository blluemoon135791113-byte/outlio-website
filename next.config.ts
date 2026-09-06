import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

/*
  Turbopack infers the workspace root by walking up for a lockfile. There is a
  stray package-lock.json in the user's home directory (an accidental install),
  so it was selecting ~ as the root — which broadened filesystem watching and
  emitted a warning on every dev/build.

  Pinning root to this directory is the documented fix.
*/
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/*
  React's DEVELOPMENT build calls eval() for debugging features such as
  reconstructing callstacks across environments, so `next dev` throws a console
  error under a policy without 'unsafe-eval'. React never calls eval() in
  production, so the relaxation is scoped to dev and the shipped policy is
  unchanged — do not lift this out of the conditional.
*/
const isDev = process.env.NODE_ENV !== 'production';

/*
  FastSpring is the merchant of record. Checkout needs three separate grants:
  the Store Builder Library loads from a fixed CDN host, the popup renders as an
  iframe on the storefront host, and the library calls its store over XHR.
  Without all three the Subscribe button is dead — CSP blocks the script before
  any of our code runs.
*/
const FASTSPRING_SBL = 'https://sbl.onfastspring.com';
const FASTSPRING_STORE = 'https://*.onfastspring.com';

/*
  Payment Request (Apple Pay, Google Pay) is delegated to the FastSpring popup
  by exact origin — the Permissions-Policy allowlist takes no wildcards. Derived
  from the configured storefront so only the store we actually use is granted;
  with no storefront configured the feature stays fully disabled.
*/
const storefrontHost = process.env.NEXT_PUBLIC_FASTSPRING_STOREFRONT?.trim().split('/')[0];
const paymentPolicy = storefrontHost
  ? `payment=(self "https://${storefrontHost}")`
  : 'payment=()';

const scriptSrc = isDev
  ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com ${FASTSPRING_SBL}`
  : `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com ${FASTSPRING_SBL}`;

/*
  Turbopack's hot-reload channel is a WebSocket to the dev server. `'self'` does
  not cover the ws: scheme, so under the shipped policy every HMR connection was
  refused and edits only appeared after a manual reload. Dev only; production
  talks to Supabase over wss: and nothing else.
*/
const connectSrc = isDev
  ? `connect-src 'self' ws: wss: https://*.supabase.co wss://*.supabase.co https://www.googletagmanager.com https://*.google-analytics.com ${FASTSPRING_SBL} ${FASTSPRING_STORE}`
  : `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.googletagmanager.com https://*.google-analytics.com ${FASTSPRING_SBL} ${FASTSPRING_STORE}`;

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      `form-action 'self' ${FASTSPRING_STORE}`,
      "frame-ancestors 'none'",
      /*
        The Calendly scheduler is embedded as an iframe (components/leadengine/
        BookingModal.tsx). Without this it falls back to default-src 'self' and
        the modal renders empty. Framing only — Calendly runs no script on our
        origin, so script-src stays closed.
      */
      `frame-src https://calendly.com https://*.calendly.com https://www.googletagmanager.com ${FASTSPRING_STORE}`,
      "object-src 'none'",
      scriptSrc,
      `style-src 'self' 'unsafe-inline' ${FASTSPRING_STORE}`,
      "font-src 'self' data:",
      `img-src 'self' data: blob: https://*.supabase.co https://www.googletagmanager.com https://*.google-analytics.com ${FASTSPRING_STORE}`,
      connectSrc,
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      'upgrade-insecure-requests',
    ].join('; '),
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Permissions-Policy', value: `camera=(), microphone=(), geolocation=(), ${paymentPolicy}, usb=()` },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },

  /*
    DEV ONLY — Next refuses cross-origin requests for dev assets, so opening the
    dev server on 127.0.0.1 rather than localhost returns 403 for every client
    chunk. The page still renders (server components, and forms degrade to a
    native POST), which makes the failure quietly misleading: it looks like a
    working page whose client-side behaviour has silently vanished.

    Both names point at this machine. Allowing the other one lets the signed-out
    auth screens be exercised on 127.0.0.1 while a dev session stays signed in
    on localhost — two origins, two cookie jars, one server.

    Has no effect on `next build`.
  */
  allowedDevOrigins: ['127.0.0.1'],

  /* config options here */
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.jsdelivr.net',
        port: '',
        pathname: '/gh/faker-js/assets-person-portrait/**',
        search: '',
      },
    ],
  },
  compress: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '3mb',
    },
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        source: '/:all*(svg|jpg|jpeg|png|gif|ico|webp|avif)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },

  async redirects() {
    /*
      The Lead Engine product used to live under a `/leadengine` segment. It is
      now the app.outlio.io domain itself, with its supporting pages directly
      beneath it, so every old path moves permanently to its replacement.

      ⚠️ NO `/leadengine/:path*` CATCH-ALL. next.config redirects are evaluated
      before filesystem routes, so a wildcard here would also swallow
      `public/leadengine/*` — the hero artwork among it. List the pages.
    */
    return [
      { source: '/leadengine', destination: 'https://app.outlio.io', permanent: true },
      { source: '/leadengine/pricing', destination: 'https://app.outlio.io/pricing', permanent: true },
      { source: '/leadengine/product', destination: 'https://app.outlio.io/product', permanent: true },
      { source: '/leadengine/how-it-works', destination: 'https://app.outlio.io/how-it-works', permanent: true },
      { source: '/leadengine/terms', destination: 'https://app.outlio.io/terms', permanent: true },
      { source: '/leadengine/privacy', destination: 'https://app.outlio.io/privacy-policy', permanent: true },
      { source: '/leadengine/privacy-policy', destination: 'https://app.outlio.io/privacy-policy', permanent: true },
      {
        source: '/leadengine/refund-policy',
        destination: 'https://app.outlio.io/refund-policy',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
