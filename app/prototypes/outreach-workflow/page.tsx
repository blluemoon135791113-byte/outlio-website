'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { LedgerVariant } from './LedgerVariant'
import { ScorecardVariant } from './ScorecardVariant'
import { SignalShelfVariant } from './SignalShelfVariant'
import styles from './prototype.module.css'

const VARIANTS = [
  { name: 'Ledger', component: LedgerVariant },
  { name: 'Scorecard', component: ScorecardVariant },
  { name: 'Signal Shelf', component: SignalShelfVariant },
] as const

export default function OutreachWorkflowPrototypePage() {
  const [active, setActive] = useState(0)
  const [ready, setReady] = useState(false)
  const pickerRef = useRef<HTMLElement>(null)
  const highlightRef = useRef<HTMLSpanElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    const requested = Number.parseInt(new URLSearchParams(window.location.search).get('v') ?? '1', 10) - 1
    if (requested >= 0 && requested < VARIANTS.length) setActive(requested)
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => setReady(true)))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useLayoutEffect(() => {
    const item = itemRefs.current[active]
    const highlight = highlightRef.current
    if (!item || !highlight) return
    highlight.style.width = `${item.offsetWidth}px`
    highlight.style.transform = `translateX(${item.offsetLeft}px)`
  }, [active])

  useEffect(() => {
    const moveHighlight = () => {
      const item = itemRefs.current[active]
      const highlight = highlightRef.current
      if (!item || !highlight) return
      highlight.style.width = `${item.offsetWidth}px`
      highlight.style.transform = `translateX(${item.offsetLeft}px)`
    }
    window.addEventListener('resize', moveHighlight)
    return () => window.removeEventListener('resize', moveHighlight)
  }, [active])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const number = Number.parseInt(event.key, 10)
      if (number >= 1 && number <= VARIANTS.length) selectVariant(number - 1)
      else if (event.key === 'ArrowRight') selectVariant((active + 1) % VARIANTS.length)
      else if (event.key === 'ArrowLeft') selectVariant((active - 1 + VARIANTS.length) % VARIANTS.length)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  function selectVariant(index: number) {
    if (index < 0 || index >= VARIANTS.length) return
    setActive(index)
    const url = new URL(window.location.href)
    url.searchParams.set('v', String(index + 1))
    window.history.replaceState(null, '', url)
  }

  const ActiveVariant = VARIANTS[active].component

  return (
    <>
      <div id="stage" key={active}><ActiveVariant /></div>
      <nav
        className={styles.protoPicker}
        aria-label="Prototype variants"
        data-ready={ready ? '' : undefined}
        ref={pickerRef}
      >
        <span className={styles.protoPickerHighlight} aria-hidden="true" ref={highlightRef} />
        {VARIANTS.map((variant, index) => (
          <button
            className={styles.protoPickerItem}
            data-active={index === active ? '' : undefined}
            aria-current={index === active ? 'true' : undefined}
            key={variant.name}
            onClick={() => selectVariant(index)}
            ref={(node) => { itemRefs.current[index] = node }}
            type="button"
          >
            {variant.name}
          </button>
        ))}
      </nav>
    </>
  )
}
