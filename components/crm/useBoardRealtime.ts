'use client'

import { useEffect } from 'react'

import { createClient } from '@/lib/supabase/client'
import type { BoardColumn } from '@/lib/crm/opportunities'

/**
 * Keeps a pipeline board in step with everyone else looking at it.
 *
 * ⚠️ RLS IS WHAT MAKES THIS SAFE. Supabase Realtime evaluates the same
 * `crm_opportunities_select_member` policy per subscriber, so a member of one
 * workspace can never receive another workspace's deals — the `workspace_id`
 * filter below is a bandwidth optimisation, not the security boundary.
 *
 * ⚠️ EVERY UPDATE IS IDEMPOTENT, because this client also receives the echo of
 * its OWN move. Re-applying a move that already landed must be a no-op, or the
 * card would be removed from a column it is no longer in and the counts would
 * drift on every drag.
 *
 * The optimistic lock still exists and still matters: realtime is best-effort
 * (a dropped socket, a backgrounded tab), so a stale card is always possible
 * and the server refusing the write remains the actual guarantee.
 */
export function useBoardRealtime(
  workspaceId: string,
  pipelineId: string,
  apply: (update: (columns: BoardColumn[]) => BoardColumn[]) => void,
): void {
  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`crm-board:${pipelineId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'crm_opportunities',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          const next = payload.new as Record<string, unknown> | null
          const previous = payload.old as Record<string, unknown> | null

          const id = (next?.id ?? previous?.id) as string | undefined
          if (!id) return

          // Another pipeline's deal is not this board's business.
          const pipeline = (next?.pipeline_id ?? previous?.pipeline_id) as string | undefined
          if (pipeline && pipeline !== pipelineId) return

          apply((columns) => {
            // Remove first, everywhere. That is what makes re-applying an echo
            // harmless: the card ends up in exactly one column whether or not
            // it was already there.
            const without = columns.map((column) => {
              const had = column.cards.some((c) => c.id === id)
              if (!had) return column
              return {
                ...column,
                cards: column.cards.filter((c) => c.id !== id),
                totalCards: Math.max(0, column.totalCards - 1),
              }
            })

            const removed =
              payload.eventType === 'DELETE' ||
              !next ||
              next.deleted_at !== null ||
              next.status !== 'open'

            // A won, lost or deleted deal leaves the board — the board shows
            // open deals only.
            if (removed) return without

            const stageId = next.stage_id as string
            const target = without.find((c) => c.stageId === stageId)
            if (!target) return without

            const card = {
              id,
              title: (next.title as string) ?? '',
              version: (next.version as number) ?? 1,
              valueAmount: (next.value_amount as number | null) ?? null,
              currency: (next.currency as string) ?? 'USD',
              ownerUserId: (next.owner_user_id as string | null) ?? null,
              contactId: (next.contact_id as string | null) ?? null,
              updatedAt: (next.updated_at as string) ?? new Date().toISOString(),
              // Recomputed on the next full load. A card that just moved is by
              // definition not rotting, so claiming otherwise would be wrong.
              isStale: false,
            }

            return without.map((column) =>
              column.stageId === stageId
                ? {
                    ...column,
                    cards: [card, ...column.cards],
                    totalCards: column.totalCards + 1,
                  }
                : column,
            )
          })
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [workspaceId, pipelineId, apply])
}
