import { PrototypeHarness } from './PrototypeHarness'

export default async function OutlioPlatformCardsPrototypePage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string | string[] }>
}) {
  const requested = (await searchParams).v
  const parsed = Number.parseInt(Array.isArray(requested) ? requested[0] : requested ?? '1', 10) - 1
  const initialIndex = parsed >= 0 && parsed < 3 ? parsed : 0
  return <PrototypeHarness initialIndex={initialIndex} />
}
