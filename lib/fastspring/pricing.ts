import 'server-only'

import { unstable_cache } from 'next/cache'

import { fastSpringApi } from '@/lib/fastspring/server'

type PriceEntry = { currency?: string; display?: string }

type ProductPriceResponse = {
  products?: {
    product?: string
    result?: string
    pricing?: Record<string, PriceEntry>
  }[]
}

/** Formatted price strings keyed by FastSpring product path. */
export type PriceDisplayMap = Record<string, string>

/**
 * Prices are public catalogue data, never user or workspace data. Caching each
 * product/country pair for 15 minutes removes repeated third-party calls while
 * keeping checkout itself authoritative for the final amount.
 */
const cachedProductPrice = unstable_cache(
  async (path: string, countryCode?: string) =>
    fastSpringApi<ProductPriceResponse>(
      `/products/price/${encodeURIComponent(path)}`,
      { search: countryCode ? { country: countryCode } : {} },
    ),
  ['fastspring-product-price-v1'],
  { revalidate: 900, tags: ['fastspring-product-prices'] },
)

/**
 * Localized display prices straight from FastSpring.
 *
 * Only FastSpring's own `display` string is used — never a locally formatted
 * number — so the figure on the pricing page is the figure its checkout will
 * charge. A product whose price cannot be read is simply absent from the map;
 * the popup remains authoritative and still quotes the correct amount.
 */
export async function getProductPrices(
  productPaths: string[],
  countryCode?: string,
): Promise<PriceDisplayMap> {
  const unique = [...new Set(productPaths)]

  const results = await Promise.allSettled(
    unique.map((path) => cachedProductPrice(path, countryCode)),
  )

  const prices: PriceDisplayMap = {}

  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') return

    const product = result.value.products?.[0]
    if (!product || product.result === 'error') return

    const pricing = product.pricing ?? {}
    // FastSpring keys the pricing object by region. Prefer the region we asked
    // for and fall back to the store default it returned instead.
    const entry = (countryCode ? pricing[countryCode] : undefined) ?? Object.values(pricing)[0]
    const display = entry?.display?.trim()

    if (display) prices[unique[index]!] = display
  })

  return prices
}
