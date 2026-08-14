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

const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com"
  : "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com";

/*
  Turbopack's hot-reload channel is a WebSocket to the dev server. `'self'` does
  not cover the ws: scheme, so under the shipped policy every HMR connection was
  refused and edits only appeared after a manual reload. Dev only; production
  talks to Supabase over wss: and nothing else.
*/
const connectSrc = isDev
  ? "connect-src 'self' ws: wss: https://*.supabase.co wss://*.supabase.co https://www.googletagmanager.com https://*.google-analytics.com"
  : "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.googletagmanager.com https://*.google-analytics.com";

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      /*
        The Calendly scheduler is embedded as an iframe (components/leadengine/
        BookingModal.tsx). Without this it falls back to default-src 'self' and
        the modal renders empty. Framing only — Calendly runs no script on our
        origin, so script-src stays closed.
      */
      'frame-src https://calendly.com https://*.calendly.com https://www.googletagmanager.com',
      "object-src 'none'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: blob: https://*.supabase.co https://www.googletagmanager.com https://*.google-analytics.com",
      connectSrc,
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      'upgrade-insecure-requests',
    ].join('; '),
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
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

  /* config options here */
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
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
    return [
      // Add any necessary redirects here
    ];
  },
};

export default nextConfig;
