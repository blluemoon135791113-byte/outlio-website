import type { PricePreviewResponse } from '@paddle/paddle-js'
import { describe, expect, it } from 'vitest'

import { pricesFromPreview } from '@/components/leadengine/PaddlePricing'

describe('pricesFromPreview', () => {
  it('returns Paddle formatted totals without frontend formatting or math', () => {
    const preview = {
      data: {
        details: {
          lineItems: [
            {
              price: { id: 'pri_starter' },
              formattedTotals: { total: '€1.234,56' },
            },
          ],
        },
      },
    } as unknown as PricePreviewResponse

    expect(pricesFromPreview(preview)).toEqual({ pri_starter: '€1.234,56' })
  })
})
