import { headers } from 'next/headers'

import { APP_ORIGIN, isAppHost, SITE_ORIGIN } from '@/lib/site'

/**
 * robots.txt, written by hand rather than through `MetadataRoute.Robots`.
 *
 * Two reasons:
 *
 * 1. It must be HOST-AWARE. One deployment serves outlio.io and app.outlio.io,
 *    and each has its own sitemap (see app/sitemap.ts). A single hardcoded
 *    `Sitemap:` line sent every crawler on the software domain over to the
 *    agency domain — the one thing the payment review must not see.
 * 2. The metadata API cannot emit `Content-Signal:` directives, and this site
 *    deliberately opts in to AI search, input and training.
 *
 * There was also a `public/robots.txt`. A public file SHADOWS the route of the
 * same name, so the generated one never shipped; it has been deleted. Do not
 * reintroduce it.
 */

/** Crawlers named explicitly so an intermediary cannot quietly narrow `*`. */
const ALLOWED_AGENTS = [
  // AI crawlers — maximum answer-engine visibility.
  'GPTBot',
  'ChatGPT-User',
  'Google-Extended',
  'CCBot',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'Applebot-Extended',
  'Bytespider',
  'PerplexityBot',
  'Amazonbot',
  'meta-externalagent',
  'FacebookBot',
  // Traditional search engines.
  'Googlebot',
  'Bingbot',
]

export async function GET() {
  const appSurface = isAppHost((await headers()).get('host'))
  const origin = appSurface ? APP_ORIGIN : SITE_ORIGIN
  const privatePaths = appSurface
    ? [
        '/admin', '/api', '/auth', '/crm', '/dashboard', '/email', '/extension',
        '/flows', '/join', '/linkedin', '/mfa', '/reset-password', '/sign-in',
        '/sign-up', '/verify-email', '/welcome',
      ]
    : []

  const body = [
    '# Outlio - Allow ALL bots (search engines, AI crawlers, trainers)',
    '',
    'User-agent: *',
    'Allow: /',
    ...privatePaths.map((path) => `Disallow: ${path}`),
    '',
    '# Content signals for AI systems',
    'Content-Signal: search=yes',
    'Content-Signal: ai-input=yes',
    'Content-Signal: ai-train=yes',
    'Content-Signal: use=full',
    '',
    ...ALLOWED_AGENTS.flatMap((agent) => [
      `User-agent: ${agent}`,
      'Allow: /',
      ...privatePaths.map((path) => `Disallow: ${path}`),
      '',
    ]),
    '# Sitemap',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n')

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600',
    },
  })
}
