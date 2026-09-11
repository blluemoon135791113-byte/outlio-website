'use client'

import { useState, type ReactNode } from 'react'
import styles from './preview.module.css'

export function ScalePreview({ children, initialVariant }: {
  children: ReactNode
  initialVariant: 'clay' | 'compact'
}) {
  const [variant, setVariant] = useState(initialVariant)
  function select(next: 'clay' | 'compact') {
    setVariant(next)
    const url = new URL(window.location.href)
    url.searchParams.set('v', next === 'clay' ? '1' : '2')
    window.history.replaceState(null, '', url)
  }
  return (
    <div className={`leadengine-surface ${styles.preview}`} data-density={variant}>
      <header className={styles.toolbar}>
        <a href="http://app.localhost:3000/" className={styles.home}>Outlio / size studies</a>
        <div role="group" aria-label="Module size sample" className={styles.switcher}>
          <button aria-pressed={variant === 'clay'} onClick={() => select('clay')}>1 · Clay Scale</button>
          <button aria-pressed={variant === 'compact'} onClick={() => select('compact')}>2 · Compact</button>
        </div>
        <span className={styles.badge}>Preview only · Responsive</span>
      </header>
      <div className={styles.notes}>
        <p className={styles.kicker}>MODULE SCALE STUDY</p>
        <h1>{variant === 'clay' ? 'Clay-scale modules with the original Outlio finish.' : 'A tighter comparison scale.'}</h1>
        <p>The approved Clay Scale uses a 1280px maximum width, 44px headings, and smaller rounded CTAs while preserving the original artwork and surface treatments.</p>
        <nav aria-label="Preview sections" className={styles.jumps}>
          {['overview', 'extraction', 'hubble', 'outbound', 'pricing', 'library'].map((name, i) => (
            <a key={name} href={`#sample-${name}`}>{String(i + 2).padStart(2, '0')} {name}</a>
          ))}
        </nav>
        <details className={styles.measurements}>
          <summary>Measured reference and scope</summary>
          <p>Clay at 1440px: outer feature card 1280 × 652px; graphic 620 × 620px; card radius 30px; padding 16px vertically / 32px horizontally; headings 44px / 48.4px; body 16px / 22.4px; demo CTA 142 × 42px with 12px corners; top cards approximately 400 × 278px with 16px gaps. Its enclosing feature sections include 96px top and bottom spacing.</p>
          <p>These samples preserve the original content, artwork, surface treatments, and interactions. Only the module dimensions, spacing, typography scale, and CTA proportions change. Hero and navigation remain outside this preview.</p>
          <a href="https://www.clay.com/use-cases/outbound" target="_blank" rel="noreferrer">View measured Clay reference ↗</a>
          <a href="https://www.clay.com/use-cases/crm-enrichment" target="_blank" rel="noreferrer">View matte surface reference ↗</a>
        </details>
      </div>
      <main className={styles.modules}>{children}</main>
      <p className={styles.end}>End of sample · No changes applied to the main landing page.</p>
    </div>
  )
}
