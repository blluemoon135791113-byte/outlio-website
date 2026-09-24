import { MetadataRoute } from 'next'
import { headers } from 'next/headers'

import { APP_ORIGIN, isAppHost, SITE_ORIGIN } from '@/lib/site'

/**
 * One deployment, two domains, two sitemaps.
 *
 * A sitemap may only list URLs on the host that serves it, so the file is
 * generated per host: app.outlio.io publishes the Lead Engine software pages,
 * outlio.io publishes the agency marketing pages. Emitting the other domain's
 * URLs here would simply be ignored — and it would also imply a cross-domain
 * relationship the payment review is meant not to see.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get('host')

  if (isAppHost(host)) {
    return [
      {
        url: APP_ORIGIN,
        changeFrequency: 'weekly',
        priority: 1,
      },
      {
        url: `${APP_ORIGIN}/pricing`,
        changeFrequency: 'weekly',
        priority: 0.9,
      },
      {
        url: `${APP_ORIGIN}/product`,
        changeFrequency: 'weekly',
        priority: 0.8,
      },
      {
        url: `${APP_ORIGIN}/how-it-works`,
        changeFrequency: 'weekly',
        priority: 0.8,
      },
      {
        url: `${APP_ORIGIN}/terms`,
        changeFrequency: 'monthly',
        priority: 0.4,
      },
      {
        url: `${APP_ORIGIN}/privacy-policy`,
        changeFrequency: 'monthly',
        priority: 0.4,
      },
      {
        url: `${APP_ORIGIN}/refund-policy`,
        changeFrequency: 'monthly',
        priority: 0.4,
      },
    ]
  }

  return [
    {
      url: SITE_ORIGIN,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${SITE_ORIGIN}/explainers`,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${SITE_ORIGIN}/terms`,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${SITE_ORIGIN}/privacy`,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ]
}
