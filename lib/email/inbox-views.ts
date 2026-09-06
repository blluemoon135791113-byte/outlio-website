/**
 * Inbox view names and row shapes — M8 Phase 26.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  SPLIT OUT OF `inbox.ts` BECAUSE A CLIENT COMPONENT NEEDS IT.            ║
 * ║                                                                           ║
 * ║  `lib/email/inbox.ts` is `server-only` and imports the SERVICE-ROLE       ║
 * ║  Supabase client. `InboxList.tsx` is a client component and needs the     ║
 * ║  view names and the row type — importing them from there pulled the       ║
 * ║  service-role client into the browser bundle's module graph.              ║
 * ║                                                                           ║
 * ║  ⚠️ TYPECHECK CANNOT CATCH THIS. Types are erased, but `INBOX_VIEWS` is a ║
 * ║  real value, so the import survives to the bundler. Only `next build`     ║
 * ║  sees it — which is why the build is a gate and not a formality.          ║
 * ║                                                                           ║
 * ║  Nothing here touches a database. Keep it that way.                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

export const INBOX_VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'mine', label: 'Mine' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'needs_reply', label: 'Needs reply' },
  { value: 'resolved', label: 'Resolved' },
] as const

export type InboxView = (typeof INBOX_VIEWS)[number]['value']

export function isInboxView(value: string): value is InboxView {
  return INBOX_VIEWS.some((v) => v.value === value)
}

export type InboxThread = {
  id: string
  subject: string | null
  contactId: string | null
  contactName: string | null
  assignedTo: string | null
  status: 'open' | 'resolved'
  lastMessageAt: string
  lastDirection: 'inbound' | 'outbound'
  messageCount: number
  isRead: boolean
  /** First line of the latest inbound message, for the list preview. */
  preview: string | null
}
