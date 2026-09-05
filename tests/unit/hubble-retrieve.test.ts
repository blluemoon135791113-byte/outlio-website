/**
 * Chunking and retrieval.
 *
 * ⚠️ EVERYTHING HERE RUNS WITH NOTHING INSTALLED. No Ollama, no vector
 * database, no network. That is the point: embeddings are an upgrade to the
 * ranker, never a dependency of it.
 */
import { describe, expect, it } from 'vitest'

import {
  chunkText,
  cosineSimilarity,
  diversify,
  hasReusableEvidence,
  retrieve,
  scoreLexical,
  tokenize,
} from '@/lib/hubble/retrieve'

function chunk(id: string, content: string, embedding?: number[]) {
  return { pageId: id, url: `https://${id}.example/`, title: id, ordinal: 0, content, embedding }
}

describe('chunkText', () => {
  it('keeps short text as one chunk', () => {
    expect(chunkText('A short paragraph about the company.')).toHaveLength(1)
  })

  it('splits long text and keeps every chunk substantial', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} about funding and hiring at the company.`).join('\n\n')
    const chunks = chunkText(text)

    expect(chunks.length).toBeGreaterThan(1)
    for (const value of chunks) expect(value.length).toBeGreaterThan(100)
  })

  it('splits a single huge paragraph on sentences', () => {
    const text = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} describes something.`).join(' ')
    const chunks = chunkText(text)

    expect(chunks.length).toBeGreaterThan(1)
    // Sentence boundaries, not mid-word.
    for (const value of chunks) expect(value).not.toMatch(/\bSent$|\bnumbe$/)
  })

  it('returns nothing for empty text', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   \n\n  ')).toEqual([])
  })
})

describe('tokenize', () => {
  it('drops stopwords, which carry no topical signal', () => {
    expect(tokenize('what is the funding of the company')).toEqual(['funding', 'company'])
  })

  it('keeps numbers and hyphenated product names', () => {
    expect(tokenize('raised $12m in 2024 for go-to-market')).toContain('12m')
    expect(tokenize('raised $12m in 2024 for go-to-market')).toContain('go-to-market')
  })
})

describe('scoreLexical', () => {
  it('ranks the chunk that answers the question first', () => {
    const results = scoreLexical('how much funding did they raise', [
      chunk('a', 'Our office has a great kitchen and a table tennis table for staff.'),
      chunk('b', 'The company raised a $12m Series A funding round led by an investor.'),
      chunk('c', 'We are hiring engineers across the platform team this quarter.'),
    ]).sort((x, y) => y.score - x.score)

    expect(results[0]!.pageId).toBe('b')
  })

  it('DISCOUNTS a term every chunk contains', () => {
    /*
     * Every page on a company site says the company's name. If that term
     * scored, retrieval would rank by verbosity rather than relevance.
     */
    const chunks = [
      chunk('a', 'Acme Acme Acme Acme Acme is a company that makes things.'),
      chunk('b', 'Acme announced Series B funding of forty million dollars today.'),
    ]
    const results = scoreLexical('acme funding', chunks).sort((x, y) => y.score - x.score)

    expect(results[0]!.pageId).toBe('b')
  })

  it('scores zero when nothing matches', () => {
    const results = scoreLexical('quantum cryptography', [chunk('a', 'We sell gardening tools online.')])
    expect(results[0]!.score).toBe(0)
  })
})

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors and 0 for orthogonal ones', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('is 0 for mismatched or empty vectors rather than throwing', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0)
    expect(cosineSimilarity([], [])).toBe(0)
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0)
  })
})

describe('retrieve', () => {
  it('WORKS WITH NO EMBEDDINGS AT ALL', () => {
    // The whole fallback contract: Ollama absent, retrieval still ranks.
    const results = retrieve('funding round', [
      chunk('a', 'We make gardening tools for the home.'),
      chunk('b', 'The funding round closed at twelve million dollars.'),
    ], null, 5)

    expect(results).toHaveLength(1)
    expect(results[0]!.pageId).toBe('b')
  })

  it('blends vector and lexical scores when embeddings exist', () => {
    const results = retrieve('funding', [
      chunk('a', 'Gardening tools for the home.', [0, 1]),
      chunk('b', 'The funding round closed.', [1, 0]),
    ], [1, 0], 5)

    expect(results[0]!.pageId).toBe('b')
  })

  it('respects the limit', () => {
    const chunks = Array.from({ length: 20 }, (_, i) => chunk(`p${i}`, `funding round number ${i} closed`))
    expect(retrieve('funding', chunks, null, 3)).toHaveLength(3)
  })
})

describe('hasReusableEvidence', () => {
  it('reuses relevant evidence from two independent pages', () => {
    expect(
      hasReusableEvidence('Series A funding', [
        chunk('a', 'The company announced its Series A funding round.'),
        chunk('b', 'Investors participated in the Series A funding round.'),
      ]),
    ).toBe(true)
  })

  it('does not let one matching page suppress fresh research', () => {
    expect(
      hasReusableEvidence('Series A funding', [
        chunk('a', 'The company announced its Series A funding round.'),
        { ...chunk('a', 'More details about the same Series A funding event.'), ordinal: 1 },
      ]),
    ).toBe(false)
  })
})

describe('diversify', () => {
  it('STOPS ONE PAGE FROM FILLING EVERY SLOT', () => {
    /*
     * Without this, one verbose page answers every question: corroboration
     * becomes impossible because a second source can never get in.
     */
    const scored = [
      { ...chunk('same', 'one'), score: 0.9 },
      { ...chunk('same', 'two'), score: 0.8 },
      { ...chunk('same', 'three'), score: 0.7 },
      { ...chunk('other', 'four'), score: 0.6 },
    ]

    const kept = diversify(scored, 2, 10)
    expect(kept).toHaveLength(3)
    expect(kept.filter((c) => c.pageId === 'same')).toHaveLength(2)
    expect(kept.some((c) => c.pageId === 'other')).toBe(true)
  })
})

describe('chunk overlap starts on a word boundary', () => {
  it('⚠️ never begins a chunk mid-word', () => {
    /*
     * THE REGRESSION THIS GUARDS. The overlap was `slice(-OVERLAP_CHARS)`,
     * which cuts wherever the character count lands. A retrieved passage began
     * "gical Principles Make Educational Content Effective" and that fragment
     * was quoted back to the user as evidence. A citation that starts mid-word
     * reads as corruption and defeats the point of citing at all.
     */
    const sentence =
      'Psychological principles make educational content effective for the reader. '
    const text = sentence.repeat(60)

    const chunks = chunkText(text)
    expect(chunks.length).toBeGreaterThan(1)

    const words = new Set(text.split(/\s+/).filter(Boolean))
    for (const chunk of chunks) {
      const first = chunk.trim().split(/\s+/)[0]!
      // Every chunk must open with a whole word from the source.
      expect(words.has(first)).toBe(true)
    }
  })

  it('keeps a single unbroken token rather than cutting it', () => {
    // No whitespace to snap to; truncating would lose the token entirely.
    const chunks = chunkText('x'.repeat(4000))
    expect(chunks.join('')).toContain('x'.repeat(100))
  })

  it('returns one chunk for short text and none for empty', () => {
    expect(chunkText('Short passage.')).toEqual(['Short passage.'])
    expect(chunkText('   ')).toEqual([])
  })
})
