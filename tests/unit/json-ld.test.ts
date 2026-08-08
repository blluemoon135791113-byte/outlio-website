import { describe, expect, it } from 'vitest'

import { serializeJsonLd } from '@/lib/json-ld'

describe('serializeJsonLd', () => {
  it('prevents a value from closing the script element', () => {
    const serialized = serializeJsonLd({ value: '</script><script>alert(1)</script>' })

    expect(serialized).not.toContain('<')
    expect(JSON.parse(serialized)).toEqual({
      value: '</script><script>alert(1)</script>',
    })
  })
})
