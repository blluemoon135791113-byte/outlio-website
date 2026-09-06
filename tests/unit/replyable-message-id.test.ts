/**
 * Which stored message ids are safe to put in In-Reply-To — R11.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `reply-sync` STORES A FALLBACK WHEN A MESSAGE HAS NO Message-ID.        ║
 * ║                                                                           ║
 * ║  `providerMessageId: parsed.messageId ?? \`uid-${msg.uid}\`` — so the      ║
 * ║  column holds either a real RFC Message-ID or something like `uid-42`.    ║
 * ║  Putting the fallback in a header produces `In-Reply-To: uid-42`, which   ║
 * ║  is malformed and which some servers reject outright — losing the whole   ║
 * ║  reply, not just its threading.                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import { replyableMessageId } from '@/lib/email/inbox'

describe('replyableMessageId', () => {
  it('accepts a real Message-ID and keeps its angle brackets', () => {
    expect(replyableMessageId('<abc123@mail.example>')).toBe('<abc123@mail.example>')
  })

  it('adds the angle brackets when the stored value lacks them', () => {
    // ⚠️ REQUIRED BY RFC 5322. A bare addr-spec is not a valid msg-id.
    expect(replyableMessageId('abc123@mail.example')).toBe('<abc123@mail.example>')
  })

  it('REFUSES the uid fallback, which is the whole reason this exists', () => {
    expect(replyableMessageId('uid-42')).toBeNull()
    expect(replyableMessageId('uid-0')).toBeNull()
  })

  it('refuses null, empty and whitespace', () => {
    expect(replyableMessageId(null)).toBeNull()
    expect(replyableMessageId('')).toBeNull()
    expect(replyableMessageId('   ')).toBeNull()
  })

  it('refuses anything without an @, since a msg-id must have a domain part', () => {
    expect(replyableMessageId('not-a-message-id')).toBeNull()
    expect(replyableMessageId('<no-at-sign>')).toBeNull()
  })
})
