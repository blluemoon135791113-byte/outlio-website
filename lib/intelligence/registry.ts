/**
 * Provider routing by configuration, not by code (spec §37).
 *
 * PURE — holds provider instances and an order. Reordering a waterfall, or
 * dropping a provider that started failing, is a configuration change; no agent
 * logic moves.
 *
 * The order within a category IS the waterfall: first provider that returns an
 * acceptable answer wins and the rest are never called (spec §12).
 */
import {
  TOOL_CATEGORIES,
  type IntelligenceProvider,
  type ResearchTask,
  type ToolCategory,
} from '@/lib/intelligence/types'

export type ProviderRegistry = {
  /** Providers for a category, in the order they should be tried. */
  forCategory(category: ToolCategory): IntelligenceProvider[]
  /** Providers that both cover the category and accept this specific task. */
  forTask(task: ResearchTask): IntelligenceProvider[]
  /** Categories that have at least one provider configured. */
  availableCategories(): ToolCategory[]
  has(category: ToolCategory): boolean
}

/**
 * Builds a registry from provider instances and an optional preferred order.
 *
 * `order` names providers; anything named but not registered is ignored, and
 * anything registered but not named goes last in registration order. That means
 * a typo in configuration degrades ordering rather than silently disabling a
 * provider.
 */
export function createRegistry(
  providers: readonly IntelligenceProvider[],
  order: Partial<Record<ToolCategory, readonly string[]>> = {},
): ProviderRegistry {
  const byCategory = new Map<ToolCategory, IntelligenceProvider[]>()

  for (const category of TOOL_CATEGORIES) {
    const members = providers.filter((provider) => provider.category === category)
    if (members.length === 0) continue

    const preferred = order[category] ?? []
    const rank = new Map(preferred.map((name, index) => [name, index]))

    members.sort((a, b) => {
      const aRank = rank.get(a.name) ?? Number.MAX_SAFE_INTEGER
      const bRank = rank.get(b.name) ?? Number.MAX_SAFE_INTEGER
      return aRank - bRank
    })

    byCategory.set(category, members)
  }

  return {
    forCategory: (category) => byCategory.get(category) ?? [],
    forTask: (task) =>
      (byCategory.get(task.category) ?? []).filter((provider) => provider.canHandle(task)),
    availableCategories: () => [...byCategory.keys()],
    has: (category) => (byCategory.get(category)?.length ?? 0) > 0,
  }
}

/**
 * Parses a waterfall from an environment variable.
 *
 * Format: `funding=alpha>beta,contact_email=leadmagic>prospeo>apollo`
 *
 * Unknown categories and empty names are skipped rather than throwing — a
 * malformed override must degrade to default ordering, not take research down.
 */
export function parseProviderOrder(
  raw: string | undefined,
): Partial<Record<ToolCategory, string[]>> {
  if (!raw) return {}

  const known = new Set<string>(TOOL_CATEGORIES)
  const parsed: Partial<Record<ToolCategory, string[]>> = {}

  for (const entry of raw.split(',')) {
    const [category, list] = entry.split('=').map((part) => part.trim())
    if (!category || !list || !known.has(category)) continue

    const names = list
      .split('>')
      .map((name) => name.trim())
      .filter(Boolean)

    if (names.length > 0) parsed[category as ToolCategory] = names
  }

  return parsed
}
