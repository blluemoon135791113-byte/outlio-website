'use client'

import { useCallback, useState, useTransition } from 'react'

import { useBoardRealtime } from '@/components/crm/useBoardRealtime'
import { moveCardAction, type MoveCardState } from '@/lib/crm/board-actions'
import type { BoardColumn } from '@/lib/crm/opportunities'

/**
 * The pipeline board.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  TWO WAYS TO MOVE A CARD, AND THAT IS NOT REDUNDANCY.                    ║
 * ║                                                                          ║
 * ║  Drag-and-drop is a mouse gesture. It is invisible to a keyboard, all    ║
 * ║  but unusable with a screen reader, and does not exist on touch — HTML5  ║
 * ║  drag events simply never fire on a phone.                               ║
 * ║                                                                          ║
 * ║  So every card also carries a stage <select>. It is the accessible path, ║
 * ║  the touch path, and the one that satisfies M9's mobile requirement — a  ║
 * ║  stage picker rather than a drag target.                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ The version travels with the card and back to the server. A card the
 * browser has not re-read is a card that may have moved; the server refuses
 * the write and the UI puts it back.
 */
export function PipelineBoard({
  columns,
  canMove,
  workspaceId,
  pipelineId,
}: {
  columns: BoardColumn[]
  canMove: boolean
  workspaceId: string
  pipelineId: string
}) {
  const [board, setBoard] = useState(columns)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<MoveCardState>({ status: 'idle' })
  const [pending, startTransition] = useTransition()

  // Everyone looking at this pipeline sees each other's moves. Best-effort by
  // nature — a dropped socket or a backgrounded tab means a stale card is
  // always possible, which is why the optimistic lock remains the actual
  // guarantee rather than a backstop.
  useBoardRealtime(
    workspaceId,
    pipelineId,
    useCallback((update: (c: BoardColumn[]) => BoardColumn[]) => setBoard(update), []),
  )

  function move(opportunityId: string, toStageId: string) {
    const from = board.find((c) => c.cards.some((card) => card.id === opportunityId))
    const card = from?.cards.find((c) => c.id === opportunityId)
    if (!from || !card || from.stageId === toStageId) return

    const target = board.find((c) => c.stageId === toStageId)
    if (!target) return

    // A lost deal needs a reason, and the server refuses without one. Ask
    // BEFORE moving the card so a cancel leaves the board untouched.
    let lostReason = ''
    if (target.kind === 'lost') {
      lostReason = window.prompt('Why was this deal lost?')?.trim() ?? ''
      if (!lostReason) return
    }

    // Optimistic: move it now, put it back if the server disagrees.
    const previous = board
    setBoard((current) =>
      current.map((column) => {
        if (column.stageId === from.stageId) {
          return {
            ...column,
            cards: column.cards.filter((c) => c.id !== opportunityId),
            totalCards: Math.max(0, column.totalCards - 1),
          }
        }
        if (column.stageId === toStageId) {
          return {
            ...column,
            cards: [card, ...column.cards],
            totalCards: column.totalCards + 1,
          }
        }
        return column
      }),
    )
    setFeedback({ status: 'idle' })

    const payload = new FormData()
    payload.set('opportunity_id', opportunityId)
    payload.set('to_stage_id', toStageId)
    payload.set('version', String(card.version))
    if (lostReason) payload.set('lost_reason', lostReason)

    startTransition(async () => {
      const result = await moveCardAction({ status: 'idle' }, payload)

      if (result.status === 'error') {
        // Snap back. Showing the card where it is NOT is worse than the move
        // failing, because the next drag would send a stale version again.
        setBoard(previous)
        setFeedback(result)
        return
      }

      if (result.status === 'success') {
        // Keep the returned version, or the next move from this card sends a
        // stale one and is refused.
        setBoard((current) =>
          current.map((column) => ({
            ...column,
            cards: column.cards.map((c) =>
              c.id === result.opportunityId ? { ...c, version: result.version } : c,
            ),
          })),
        )
      }
    })
  }

  const totalCards = board.reduce((n, c) => n + c.totalCards, 0)

  if (totalCards === 0) {
    return (
      <div className="clay p-10 text-center">
        <h2 className="text-base font-semibold text-ink">No deals yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          Opportunities you create from a contact appear here, one column per stage.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {feedback.status === 'error' ? (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] bg-danger-soft px-3 py-2.5 text-sm text-danger"
        >
          {feedback.message}
          {feedback.stale ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="ml-2 font-semibold underline underline-offset-2"
            >
              Refresh
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Horizontal scroll, not a wrap: columns keep their identity as the
          pipeline grows, and each column scrolls its own cards. */}
      <div className="flex gap-3 overflow-x-auto pb-2" aria-busy={pending}>
        {board.map((column) => (
          <section
            key={column.stageId}
            aria-label={column.stageName}
            onDragOver={(event) => {
              if (!canMove || !dragging) return
              event.preventDefault()
              setOver(column.stageId)
            }}
            onDragLeave={() => setOver((s) => (s === column.stageId ? null : s))}
            onDrop={(event) => {
              event.preventDefault()
              setOver(null)
              if (canMove && dragging) move(dragging, column.stageId)
              setDragging(null)
            }}
            className={`flex w-[280px] shrink-0 flex-col rounded-[var(--radius-lg)] p-2 transition-colors duration-150 ${
              over === column.stageId ? 'bg-accent-soft' : 'bg-surface-muted'
            }`}
          >
            <header className="flex items-baseline justify-between px-2 py-1.5">
              <h2 className="text-[13px] font-semibold text-ink">{column.stageName}</h2>
              <span className="text-[11px] font-medium text-muted">{column.totalCards}</span>
            </header>

            <ul className="space-y-2">
              {column.cards.map((card) => (
                <li
                  key={card.id}
                  draggable={canMove}
                  onDragStart={() => setDragging(card.id)}
                  onDragEnd={() => {
                    setDragging(null)
                    setOver(null)
                  }}
                  className={`rounded-[var(--radius-md)] bg-panel p-3 shadow-[var(--shadow-sm)] ${
                    canMove ? 'cursor-grab active:cursor-grabbing' : ''
                  } ${dragging === card.id ? 'opacity-50' : ''}`}
                >
                  <p className="text-sm font-semibold leading-snug text-ink">{card.title}</p>

                  <div className="mt-1.5 flex items-center gap-2">
                    {card.valueAmount !== null ? (
                      <span className="text-xs font-medium text-muted">
                        {formatMoney(card.valueAmount, card.currency)}
                      </span>
                    ) : null}
                    {card.isStale ? (
                      <span className="rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                        Stale
                      </span>
                    ) : null}
                  </div>

                  {canMove ? (
                    <label className="mt-2.5 block">
                      <span className="sr-only">Move {card.title} to another stage</span>
                      <select
                        value={column.stageId}
                        onChange={(event) => move(card.id, event.target.value)}
                        className="field w-full px-2 py-1.5 text-xs text-ink focus:outline-none"
                      >
                        {board.map((option) => (
                          <option key={option.stageId} value={option.stageId}>
                            {option.stageName}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </li>
              ))}

              {column.cards.length === 0 ? (
                <li className="px-2 py-6 text-center text-xs text-muted">Nothing here</li>
              ) : null}

              {column.totalCards > column.cards.length ? (
                // The board is paginated per column (A6: never load unbounded
                // lists). Say so rather than implying the column is complete.
                <li className="px-2 py-2 text-center text-[11px] text-muted">
                  Showing {column.cards.length} of {column.totalCards}
                </li>
              ) : null}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

/**
 * ⚠️ FORMATS ONE VALUE. Never add the values up here — see the note on
 * `Opportunity.valueAmount`: what arrives from PostgREST is a double, and a
 * pipeline total has to be summed in SQL.
 */
function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    // An unknown currency code must not blank the card.
    return `${amount} ${currency}`
  }
}
