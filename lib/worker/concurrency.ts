export const DEFAULT_FILE_CONCURRENCY = 8
export const MAX_FILE_CONCURRENCY = 8

export function resolveFileConcurrency(raw: string | undefined) {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_FILE_CONCURRENCY
  return Math.min(parsed, MAX_FILE_CONCURRENCY)
}

type BatchHooks<R> = {
  onBatchStart?: (startIndex: number, endIndex: number) => Promise<void> | void
  onBatchComplete?: (results: R[], completed: number) => Promise<void> | void
}

/**
 * Runs a bounded number of items in parallel while preserving input order.
 * Batching caps memory use for large saved pages and gives callers a stable
 * point at which to persist progress.
 */
export async function mapInConcurrentBatches<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  hooks: BatchHooks<R> = {},
) {
  const width = Math.max(1, Math.min(Math.floor(concurrency), MAX_FILE_CONCURRENCY))
  const allResults: R[] = []

  for (let start = 0; start < items.length; start += width) {
    const end = Math.min(start + width, items.length)
    await hooks.onBatchStart?.(start, end)

    const batchResults = await Promise.all(
      items.slice(start, end).map((item, offset) => worker(item, start + offset)),
    )

    allResults.push(...batchResults)
    await hooks.onBatchComplete?.(batchResults, end)
  }

  return allResults
}
