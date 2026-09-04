'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { EditorialRowVariant } from './EditorialRowVariant'
import { SoftGalleryVariant } from './SoftGalleryVariant'
import { SystemLedgerVariant } from './SystemLedgerVariant'

const VARIANTS = [
  { name: 'Color Field', render: EditorialRowVariant },
  { name: 'Split Signal', render: SystemLedgerVariant },
  { name: 'Accent Rail', render: SoftGalleryVariant },
] as const

export function PrototypeHarness({ initialIndex }: { initialIndex: number }) {
  const [current, setCurrent] = useState(initialIndex)
  const [ready, setReady] = useState(false)
  const pickerRef = useRef<HTMLElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const highlightRef = useRef<HTMLSpanElement>(null)

  const moveHighlight = useCallback(() => {
    const item = itemRefs.current[current]
    const highlight = highlightRef.current
    if (!item || !highlight) return
    highlight.style.width = `${item.offsetWidth}px`
    highlight.style.transform = `translateX(${item.offsetLeft}px)`
  }, [current])

  const select = useCallback((index: number) => {
    if (index < 0 || index >= VARIANTS.length) return
    setCurrent(index)
    const url = new URL(window.location.href)
    url.searchParams.set('v', String(index + 1))
    window.history.replaceState(null, '', url)
  }, [])

  useEffect(() => {
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setReady(true))
    })
    return () => window.cancelAnimationFrame(firstFrame)
  }, [])

  useLayoutEffect(() => {
    moveHighlight()
  }, [moveHighlight])

  useEffect(() => {
    const onResize = () => moveHighlight()
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const number = Number.parseInt(event.key, 10)
      if (number >= 1 && number <= VARIANTS.length) select(number - 1)
      else if (event.key === 'ArrowRight') select((current + 1) % VARIANTS.length)
      else if (event.key === 'ArrowLeft') select((current - 1 + VARIANTS.length) % VARIANTS.length)
    }
    window.addEventListener('resize', onResize)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('resize', onResize)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [current, moveHighlight, select])

  const Variant = VARIANTS[current].render

  return (
    <>
      <Variant key={current} />
      <nav className="proto-picker" aria-label="Prototype variants" ref={pickerRef} data-ready={ready ? '' : undefined}>
        <span className="proto-picker-highlight" aria-hidden="true" ref={highlightRef} />
        {VARIANTS.map((variant, index) => (
          <button
            className="proto-picker-item"
            data-active={index === current ? '' : undefined}
            aria-current={index === current ? 'true' : undefined}
            onClick={() => select(index)}
            ref={(node) => { itemRefs.current[index] = node }}
            type="button"
            key={variant.name}
          >
            {variant.name}
          </button>
        ))}
      </nav>
    </>
  )
}
