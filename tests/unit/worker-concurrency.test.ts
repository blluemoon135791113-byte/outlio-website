import { describe, expect, it } from 'vitest'

import {
  mapInConcurrentBatches,
  resolveFileConcurrency,
} from '@/lib/worker/concurrency'

describe('worker file concurrency', () => {
  it('uses a safe default and clamps configuration', () => {
    expect(resolveFileConcurrency(undefined)).toBe(8)
    expect(resolveFileConcurrency('garbage')).toBe(8)
    expect(resolveFileConcurrency('0')).toBe(8)
    expect(resolveFileConcurrency('3')).toBe(3)
    expect(resolveFileConcurrency('99')).toBe(8)
  })

  it('processes concurrently, preserves order, and reports batch progress', async () => {
    let active = 0
    let peak = 0
    const completed: number[] = []

    const results = await mapInConcurrentBatches(
      [1, 2, 3, 4, 5, 6, 7],
      3,
      async (value) => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, (8 - value) * 2))
        active -= 1
        return value * 10
      },
      {
        onBatchComplete: (_batch, count) => {
          completed.push(count)
        },
      },
    )

    expect(peak).toBe(3)
    expect(results).toEqual([10, 20, 30, 40, 50, 60, 70])
    expect(completed).toEqual([3, 6, 7])
  })
})
