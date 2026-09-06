import { PrototypeHarness } from './PrototypeHarness'

export default async function OutreachWorkflowPrototypePage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>
}) {
  const requested = Number.parseInt((await searchParams).v ?? '1', 10) - 1
  return <PrototypeHarness initialActive={requested >= 0 && requested < 3 ? requested : 0} />
}
