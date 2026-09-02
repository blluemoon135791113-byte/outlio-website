'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

import { LeadLibraryScene } from './LeadLibraryScene'
import styles from './LeadLibrary.module.css'

type LeadInsight = {
  id: string
  initials: string
  name: string
  role: string
  company: string
  email: string
  phone: string
  linkedin: string
  website: string
  portraitUrl: string
  summary: string
}

type Book = {
  color: string
  height: number
  tilt?: number
  leadId?: string
}

const LEADS: LeadInsight[] = [
  {
    id: 'maya-chen',
    initials: 'MC',
    name: 'Maya Chen',
    role: 'VP, Revenue Operations',
    company: 'Northstar Labs',
    email: 'maya.chen@northstarlabs.example',
    phone: '+1 (415) 555-0184',
    linkedin: 'linkedin.com/in/maya-chen',
    website: 'northstarlabs.example',
    portraitUrl: 'https://cdn.jsdelivr.net/gh/faker-js/assets-person-portrait/female/256/90.jpg',
    summary:
      'Maya leads revenue operations for a growing analytics company. Recent hiring across sales operations and enablement suggests the team is standardizing its pipeline systems and may value cleaner, source-backed account data.',
  },
  {
    id: 'elias-morgan',
    initials: 'EM',
    name: 'Elias Morgan',
    role: 'Director of Partnerships',
    company: 'Quarry AI',
    email: 'elias@quarryai.example',
    phone: '+44 20 0000 0184',
    linkedin: 'linkedin.com/in/elias-morgan',
    website: 'quarryai.example',
    portraitUrl: 'https://cdn.jsdelivr.net/gh/faker-js/assets-person-portrait/male/256/54.jpg',
    summary:
      'Elias owns strategic partnerships at an applied-AI platform expanding into Europe. Public launch activity points to a need for precise partner mapping and faster identification of technical decision-makers.',
  },
  {
    id: 'priya-raman',
    initials: 'PR',
    name: 'Priya Raman',
    role: 'Head of Growth',
    company: 'AtlasGrid',
    email: 'priya.raman@atlasgrid.example',
    phone: '+65 0000 9074',
    linkedin: 'linkedin.com/in/priya-raman',
    website: 'atlasgrid.example',
    portraitUrl: 'https://cdn.jsdelivr.net/gh/faker-js/assets-person-portrait/female/256/17.jpg',
    summary:
      'Priya runs growth for a distributed infrastructure business. The company is entering new APAC markets, making verified regional contacts, expansion signals, and locally relevant personalization especially useful.',
  },
  {
    id: 'noah-williams',
    initials: 'NW',
    name: 'Noah Williams',
    role: 'Chief Commercial Officer',
    company: 'Sable Systems',
    email: 'noah@sablesystems.example',
    phone: '+1 (646) 555-0127',
    linkedin: 'linkedin.com/in/noah-williams',
    website: 'sablesystems.example',
    portraitUrl: 'https://cdn.jsdelivr.net/gh/faker-js/assets-person-portrait/male/256/24.jpg',
    summary:
      'Noah oversees commercial strategy at a security software company preparing its next enterprise push. New channel roles and product launches indicate active territory planning and a likely appetite for richer account intelligence.',
  },
  {
    id: 'sofia-patel',
    initials: 'SC',
    name: 'Sophia Carter',
    role: 'VP, Demand Generation',
    company: 'Meridian Cloud',
    email: 'sophia@meridiancloud.example',
    phone: '+1 (312) 555-0168',
    linkedin: 'linkedin.com/in/sophia-carter',
    website: 'meridiancloud.example',
    portraitUrl: 'https://cdn.jsdelivr.net/gh/faker-js/assets-person-portrait/female/256/49.jpg',
    summary:
      'Sophia leads global demand generation for a cloud operations platform. A growing field-marketing team and new enterprise campaigns suggest an active need for cleaner account segmentation and higher-confidence contact data.',
  },
  {
    id: 'luca-bennett',
    initials: 'LB',
    name: 'Luca Bennett',
    role: 'Director, Enterprise Sales',
    company: 'Evernorth Systems',
    email: 'luca.bennett@evernorth.example',
    phone: '+44 20 0000 0249',
    linkedin: 'linkedin.com/in/luca-bennett',
    website: 'evernorth.example',
    portraitUrl: 'https://cdn.jsdelivr.net/gh/faker-js/assets-person-portrait/male/256/46.jpg',
    summary:
      'Luca manages enterprise sales for a workflow automation company. Recent expansion into regulated industries points to longer buying committees and a stronger need for verified stakeholder mapping.',
  },
  {
    id: 'amina-yusuf',
    initials: 'AY',
    name: 'Amina Yusuf',
    role: 'Head of Partnerships',
    company: 'Cinder Labs',
    email: 'amina@cinderlabs.example',
    phone: '+971 4 000 0173',
    linkedin: 'linkedin.com/in/amina-yusuf',
    website: 'cinderlabs.example',
    portraitUrl: 'https://cdn.jsdelivr.net/gh/faker-js/assets-person-portrait/female/256/43.jpg',
    summary:
      'Amina is building the partner ecosystem for an infrastructure startup. New integration announcements indicate an opportunity to identify adjacent platforms, technical champions, and regional channel partners.',
  },
  {
    id: 'theo-laurent',
    initials: 'TL',
    name: 'Theo Laurent',
    role: 'Chief Operating Officer',
    company: 'VantageWorks',
    email: 'theo@vantageworks.example',
    phone: '+33 1 00 00 18 62',
    linkedin: 'linkedin.com/in/theo-laurent',
    website: 'vantageworks.example',
    portraitUrl: 'https://cdn.jsdelivr.net/gh/faker-js/assets-person-portrait/male/256/13.jpg',
    summary:
      'Theo oversees operations at a distributed professional-services platform. Multi-market hiring and new delivery partnerships signal a priority around repeatable go-to-market processes and reliable account research.',
  },
  {
    id: 'elena-rossi',
    initials: 'ER',
    name: 'Elena Rossi',
    role: 'VP, Go-to-Market',
    company: 'Fluxera',
    email: 'elena.rossi@fluxera.example',
    phone: '+39 02 0000 5194',
    linkedin: 'linkedin.com/in/elena-rossi',
    website: 'fluxera.example',
    portraitUrl: 'https://cdn.jsdelivr.net/gh/faker-js/assets-person-portrait/female/256/45.jpg',
    summary:
      'Elena owns go-to-market strategy for a product analytics business. Recent leadership hires and packaging changes suggest active positioning work and a need for precise competitive and buyer intelligence.',
  },
  {
    id: 'marcus-lee',
    initials: 'ML',
    name: 'Marcus Lee',
    role: 'Head of Revenue',
    company: 'CanopyStack',
    email: 'marcus@canopystack.example',
    phone: '+61 2 0000 7185',
    linkedin: 'linkedin.com/in/marcus-lee',
    website: 'canopystack.example',
    portraitUrl: 'https://cdn.jsdelivr.net/gh/faker-js/assets-person-portrait/male/256/95.jpg',
    summary:
      'Marcus leads revenue for a developer tooling company expanding across APAC. New account-executive roles and solution partnerships point to active territory planning and demand for better buying-signal coverage.',
  },
]

const BOOK_ROWS: Book[][] = [
  [
    { color: '#c9775d', height: 83, tilt: -4 },
    { color: '#e7ad72', height: 70, tilt: 11 },
    { color: '#eee6da', height: 80 },
    { color: '#a8beb5', height: 84 },
    { color: '#d99a79', height: 76 },
    { color: '#e8c28b', height: 86, leadId: 'maya-chen' },
    { color: '#cfd9d4', height: 72, tilt: -11 },
    { color: '#d2694b', height: 79, tilt: -7 },
    { color: '#efe5d7', height: 88, tilt: -8 },
    { color: '#a5b9b1', height: 70 },
    { color: '#d98b69', height: 82, tilt: 9, leadId: 'sofia-patel' },
    { color: '#e4b172', height: 75 },
  ],
  [
    { color: '#b2c5bf', height: 65 },
    { color: '#eee5d8', height: 53, tilt: -8, leadId: 'luca-bennett' },
    { color: '#e8ad68', height: 68 },
    { color: '#cf7c5e', height: 60, tilt: 7 },
    { color: '#ded5c8', height: 73 },
    { color: '#93aea6', height: 69, leadId: 'elias-morgan' },
    { color: '#e9b078', height: 58, tilt: 10 },
    { color: '#efe7dc', height: 76 },
    { color: '#d9795e', height: 65, tilt: 12 },
    { color: '#e6bd80', height: 57 },
  ],
  [
    { color: '#e7b36d', height: 58, tilt: -12 },
    { color: '#b0c2ba', height: 71 },
    { color: '#d9795d', height: 69 },
    { color: '#c9d4cf', height: 74, leadId: 'priya-raman' },
    { color: '#eac28a', height: 70 },
    { color: '#df8c66', height: 68, tilt: -4 },
    { color: '#ece1d2', height: 55, tilt: 10 },
    { color: '#9db6ae', height: 66 },
    { color: '#db7d60', height: 73, tilt: -8, leadId: 'amina-yusuf' },
    { color: '#e7ad65', height: 61, tilt: 9 },
  ],
  [
    { color: '#d6b18c', height: 70 },
    { color: '#aebfba', height: 73 },
    { color: '#ead8c3', height: 65, tilt: 12 },
    { color: '#cb775a', height: 77 },
    { color: '#e8bb83', height: 68 },
    { color: '#d7ddd8', height: 79, leadId: 'noah-williams' },
    { color: '#e09b70', height: 65, tilt: -10 },
    { color: '#9fb5ae', height: 71 },
    { color: '#eddfcc', height: 67, tilt: 8 },
    { color: '#d37d60', height: 74, leadId: 'theo-laurent' },
    { color: '#e6b977', height: 69 },
  ],
  [
    { color: '#e5bd89', height: 76 },
    { color: '#d9c9ba', height: 63 },
    { color: '#a7bbb5', height: 70 },
    { color: '#d67452', height: 84, leadId: 'elena-rossi' },
    { color: '#edc98f', height: 66, tilt: 12 },
    { color: '#e9dfd2', height: 72 },
    { color: '#cf8062', height: 62 },
    { color: '#9db2ab', height: 78 },
    { color: '#e4a96f', height: 69, tilt: -10 },
    { color: '#eee4d6', height: 75, leadId: 'marcus-lee' },
    { color: '#d78064', height: 67 },
    { color: '#b0c1bb', height: 80 },
  ],
]

const ROW_BOOK_TARGETS = [27, 27, 27, 27, 27]

const DENSE_BOOK_ROWS: Book[][] = BOOK_ROWS.map((row, rowIndex) => {
  const target = ROW_BOOK_TARGETS[rowIndex] ?? row.length
  const decorativeBooks = row.filter((book) => !book.leadId)
  const originalSlots = new Set(
    row.map((_, bookIndex) => Math.round((bookIndex * (target - 1)) / Math.max(row.length - 1, 1))),
  )
  let originalIndex = 0
  let decorativeIndex = 0

  return Array.from({ length: target }, (_, slotIndex) => {
    if (originalSlots.has(slotIndex) && originalIndex < row.length) {
      const book = row[originalIndex]
      originalIndex += 1
      return book
    }

    const source = decorativeBooks[(decorativeIndex * 2 + rowIndex) % decorativeBooks.length]
    const heightOffset = ((decorativeIndex % 3) - 1) * 4
    const tilt = decorativeIndex % 4 === 0 ? -4 : decorativeIndex % 5 === 0 ? 5 : 0
    decorativeIndex += 1

    return {
      color: source.color,
      height: Math.max(52, Math.min(88, source.height + heightOffset)),
      tilt,
    }
  })
})

const BOOK_BAYS = DENSE_BOOK_ROWS.map((row) => {
  const minimumBaySize = Math.floor(row.length / 3)
  const remainder = row.length % 3
  let cursor = 0

  return Array.from({ length: 3 }, (_, bayIndex) => {
    const baySize = minimumBaySize + (bayIndex < remainder ? 1 : 0)
    const bay = row.slice(cursor, cursor + baySize)
    cursor += baySize
    return bay
  })
})

const leadById = new Map(LEADS.map((lead) => [lead.id, lead]))
const SCENE_LEADS = LEADS.map(({ id, initials, name }) => ({ id, initials, name }))

function FieldIcon({ type }: { type: 'company' | 'email' | 'linkedin' | 'phone' | 'role' | 'website' }) {
  const paths = {
    company: <path d="M4.5 20.5v-15h10v15m0-10h5v10M8 9h3M8 13h3M8 17h3M17.5 14h.1M17.5 17.5h.1M3 20.5h18" />,
    email: <path d="M3.5 6.5h17v11h-17zM4 7l8 6 8-6" />,
    phone: <path d="M8.1 3.5 5.4 5.2c-.7.5-.9 1.4-.5 2.2 2.7 5.3 6.5 9.1 11.8 11.8.8.4 1.7.2 2.2-.5l1.7-2.7-4.5-2.1-1.4 1.8a15.8 15.8 0 0 1-6.4-6.4l1.8-1.4z" />,
    linkedin: <path d="M6.2 9.4v8.4M6.2 6.2v.1M10.1 17.8v-8.4m0 3.7c.8-2.1 5.8-2.5 5.8 1.5v3.2" />,
    role: <path d="M8 7V5.5c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2V7M3.5 8h17v11.5h-17zM3.5 12.5c4.4 2 12.6 2 17 0M10 13.5h4" />,
    website: <path d="M3.5 12h17M12 3.5c3.4 3.6 3.4 13.4 0 17m0-17c-3.4 3.6-3.4 13.4 0 17M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Z" />,
  }

  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[type]}
    </svg>
  )
}

export function LeadLibrary() {
  const [activeLead, setActiveLead] = useState<LeadInsight | null>(null)
  const [sceneReady, setSceneReady] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const lastTriggerRef = useRef<HTMLElement | null>(null)

  const closeLead = useCallback(() => {
    const trigger = lastTriggerRef.current
    setActiveLead(null)
    requestAnimationFrame(() => trigger?.focus())
  }, [])

  const openSceneLead = useCallback((leadId: string, trigger: HTMLElement) => {
    const lead = leadById.get(leadId)
    if (!lead) return
    lastTriggerRef.current = trigger
    setActiveLead(lead)
  }, [])

  useEffect(() => {
    if (!activeLead) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    requestAnimationFrame(() => closeButtonRef.current?.focus())

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeLead()
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      )
      const first = focusable[0]
      const last = focusable.at(-1)

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeLead, closeLead])

  return (
    <section className={styles.section} aria-labelledby="lead-library-title">
      <div className={styles.headingWrap}>
        <p className={styles.eyebrow}>Hubble Intelligence</p>
        <h2 id="lead-library-title" className={styles.heading}>
          It&apos;s not that big. Just know where to look.
        </h2>
        <p className={styles.instruction}>Move through the shelf. A few records are ready to open.</p>
      </div>

      <div className={styles.libraryLayout}>
        <div className={styles.libraryPerspective}>
          <div
            className={styles.libraryStage}
            data-scene-ready={sceneReady ? 'true' : 'false'}
          >
            <LeadLibraryScene
              leads={SCENE_LEADS}
              activeLeadId={activeLead?.id}
              onActivate={openSceneLead}
              onReadyChange={setSceneReady}
            />

          <div
            className={styles.fallbackScene}
            data-hidden={sceneReady ? 'true' : 'false'}
            aria-hidden={sceneReady}
          >
          <div className={styles.shelfFrame} aria-label="Interactive lead intelligence library">
          <div className={styles.shelfInterior}>
            <span className={`${styles.divider} ${styles.dividerOne}`} aria-hidden />
            <span className={`${styles.divider} ${styles.dividerTwo}`} aria-hidden />

            {BOOK_BAYS.map((row, rowIndex) => (
              <div className={styles.shelfRow} key={`row-${rowIndex}`}>
                {row.map((bay, bayIndex) => (
                  <div className={styles.shelfBay} key={`bay-${rowIndex}-${bayIndex}`}>
                    <div className={styles.books}>
                      {bay.map((book, bookIndex) => {
                        const lead = book.leadId ? leadById.get(book.leadId) : undefined
                        const bookStyle = {
                          '--book-color': book.color,
                          '--book-height': `${book.height}%`,
                          '--book-tilt': `${Math.max(-7, Math.min(7, book.tilt ?? 0))}deg`,
                        } as CSSProperties

                        if (!lead) {
                          return (
                            <span
                              aria-hidden
                              className={styles.book}
                              key={`book-${rowIndex}-${bayIndex}-${bookIndex}`}
                              style={bookStyle}
                            />
                          )
                        }

                        return (
                          <button
                            type="button"
                            className={`${styles.book} ${styles.interactiveBook}`}
                            key={lead.id}
                            style={bookStyle}
                            aria-label={`Open lead insight for ${lead.name}`}
                            aria-haspopup="dialog"
                            tabIndex={sceneReady ? -1 : undefined}
                            onClick={(event) => {
                              lastTriggerRef.current = event.currentTarget
                              setActiveLead(lead)
                            }}
                          >
                            <span>{lead.initials}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className={styles.humanoid} aria-hidden>
          <span className={styles.head} />
          <span className={styles.body} />
          <span className={`${styles.arm} ${styles.armLeft}`} />
          <span className={`${styles.arm} ${styles.armRight}`} />
          <span className={`${styles.leg} ${styles.legLeft}`} />
          <span className={`${styles.leg} ${styles.legRight}`} />
        </div>
          </div>

          </div>
        </div>

      </div>

      {activeLead ? (
        <div
          className={styles.modalLayer}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeLead()
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="lead-insight-name"
            aria-describedby="lead-insight-summary"
            className={styles.modal}
          >
            <button ref={closeButtonRef} type="button" onClick={closeLead} className={styles.closeButton} aria-label="Close lead insight">
              <span aria-hidden>×</span>
            </button>

            <div className={styles.profileHeader}>
              <div className={styles.avatar} aria-hidden>
                <span className={styles.avatarFallback}>{activeLead.initials}</span>
                <Image
                  src={activeLead.portraitUrl}
                  alt=""
                  width={256}
                  height={256}
                  sizes="(max-width: 640px) 77px, 117px"
                  className={styles.avatarImage}
                />
              </div>
              <div className={styles.profileCopy}>
                <h3 id="lead-insight-name">{activeLead.name}</h3>
                <div className={styles.identityRow}>
                  <span className={styles.identityIcon}><FieldIcon type="role" /></span>
                  <span><small>Role</small>{activeLead.role}</span>
                </div>
                <div className={styles.identityRow}>
                  <span className={styles.identityIcon}><FieldIcon type="company" /></span>
                  <span><small>Company</small>{activeLead.company}</span>
                </div>
              </div>
            </div>

            <dl className={styles.fields}>
              <div className={styles.field}>
                <dt><FieldIcon type="email" />Email</dt>
                <dd>{activeLead.email}</dd>
              </div>
              <div className={styles.field}>
                <dt><FieldIcon type="phone" />Phone</dt>
                <dd>{activeLead.phone}</dd>
              </div>
              <div className={styles.field}>
                <dt><FieldIcon type="linkedin" />LinkedIn</dt>
                <dd>{activeLead.linkedin}</dd>
              </div>
              <div className={styles.field}>
                <dt><FieldIcon type="website" />Website</dt>
                <dd>{activeLead.website}</dd>
              </div>
            </dl>

            <div className={styles.summary}>
              <p>Summary</p>
              <div id="lead-insight-summary">{activeLead.summary}</div>
            </div>
          </div>
        </div>
      ) : null}

      <div className={styles.libraryActions}>
        <Link href="/sign-in" className={`${styles.libraryAction} ${styles.signIn}`}>
          Sign In
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17 17 7" />
            <path d="M8 7h9v9" />
          </svg>
        </Link>
        <Link href="/sign-up" className={`${styles.libraryAction} ${styles.freeTrial}`}>
          Start your Free Trial
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17 17 7" />
            <path d="M8 7h9v9" />
          </svg>
        </Link>
      </div>
    </section>
  )
}
