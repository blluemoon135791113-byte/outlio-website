'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { ChannelRowVariant } from './ChannelRowVariant'
import { InboxRailVariant } from './InboxRailVariant'
import { ReviewRouteVariant } from './ReviewRouteVariant'
import styles from './prototype.module.css'

const VARIANTS = [
  { name: 'Channel Row', component: ChannelRowVariant },
  { name: 'Inbox Rail', component: InboxRailVariant },
  { name: 'Review Route', component: ReviewRouteVariant },
] as const

export function PrototypeHarness({ initialActive }: { initialActive: number }) {
  const [active, setActive] = useState(initialActive)
  const [ready, setReady] = useState(false)
  const highlightRef = useRef<HTMLSpanElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    const first = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)))
    return () => cancelAnimationFrame(first)
  }, [])

  useLayoutEffect(() => {
    const item = itemRefs.current[active]
    const highlight = highlightRef.current
    if (!item || !highlight) return
    highlight.style.width = `${item.offsetWidth}px`
    highlight.style.transform = `translateX(${item.offsetLeft}px)`
  }, [active])

  useEffect(() => {
    const move = () => {
      const item = itemRefs.current[active]
      const highlight = highlightRef.current
      if (!item || !highlight) return
      highlight.style.width = `${item.offsetWidth}px`
      highlight.style.transform = `translateX(${item.offsetLeft}px)`
    }
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const number = Number.parseInt(event.key, 10)
      if (number >= 1 && number <= VARIANTS.length) select(number - 1)
      else if (event.key === 'ArrowRight') select((active + 1) % VARIANTS.length)
      else if (event.key === 'ArrowLeft') select((active - 1 + VARIANTS.length) % VARIANTS.length)
    }
    addEventListener('resize', move)
    document.addEventListener('keydown', keydown)
    return () => {
      removeEventListener('resize', move)
      document.removeEventListener('keydown', keydown)
    }
  })

  function select(index: number) {
    if (index < 0 || index >= VARIANTS.length) return
    setActive(index)
    const url = new URL(location.href)
    url.searchParams.set('v', String(index + 1))
    history.replaceState(null, '', url)
  }

  const ActiveVariant = VARIANTS[active].component

  return (
    <>
      <div id="stage" key={active}><ActiveVariant /></div>
      <nav className={styles.protoPicker} aria-label="Prototype variants" data-ready={ready ? '' : undefined}>
        <span className={styles.protoPickerHighlight} aria-hidden="true" ref={highlightRef} />
        {VARIANTS.map((variant, index) => (
          <button
            className={styles.protoPickerItem}
            data-active={index === active ? '' : undefined}
            aria-current={index === active ? 'true' : undefined}
            key={variant.name}
            onClick={() => select(index)}
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
