/**
 * Where an outbound webhook is allowed to point — M8 Phase 25.5.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A WEBHOOK URL IS CUSTOMER-CONTROLLED, WHICH MAKES IT AN SSRF VECTOR.    ║
 * ║                                                                           ║
 * ║  "POST this payload wherever I say" means our servers make requests on a  ║
 * ║  customer's behalf. Pointed at 169.254.169.254 it reaches the cloud       ║
 * ║  metadata service; pointed at 10.x it reaches whatever internal service   ║
 * ║  sits there. We never return the response body, so this is a blind SSRF   ║
 * ║  rather than a read primitive — but a blind POST to an internal admin     ║
 * ║  endpoint is still a real attack, and the delivery LOG leaks the status   ║
 * ║  code back to the customer.                                              ║
 * ║                                                                           ║
 * ║  Same reasoning and same shape as `assertSafeMailEndpoint` (Phase 12).    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ A HOSTNAME-SHAPE CHECK, NOT A COMPLETE DEFENCE. A hostname that RESOLVES
 * to a private address defeats it, because resolution happens inside the socket
 * layer. Closing that needs DNS pinned to the connection — Ledger DR19, the
 * same gap the mail endpoints have.
 */

export class UnsafeWebhookUrlError extends Error {}

function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map(Number)
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false

  const [a, b] = octets as [number, number, number, number]
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||          // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a >= 224                              // multicast and reserved
  )
}

function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    h === '::1' || h === '::' ||
    h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') ||
    h.startsWith('::ffff:')  // IPv4-mapped, which bypasses the v4 check
  )
}

function isLoopbackName(host: string): boolean {
  const h = host.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost')
}

/**
 * Throws unless this URL is a safe delivery target.
 *
 * @param allowLoopback defaults to true outside production, so a developer can
 *   point a subscription at their own machine. Never true in production — the
 *   same carve-out the mail endpoints make, for the same reason.
 */
export function assertSafeWebhookUrl(
  raw: string,
  allowLoopback = process.env.NODE_ENV !== 'production',
): void {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UnsafeWebhookUrlError('That is not a valid URL.')
  }

  const loopback = isLoopbackName(url.hostname)

  /*
   * ⚠️ HTTPS IS REQUIRED. The payload contains a customer's own CRM data, and
   * the signature proves who sent it — not that nobody read it in transit.
   * Plain http is permitted ONLY for loopback in development, where there is
   * no network to intercept.
   */
  if (url.protocol !== 'https:') {
    if (!(allowLoopback && loopback && url.protocol === 'http:')) {
      throw new UnsafeWebhookUrlError('A webhook URL must use https.')
    }
  }

  if (loopback) {
    if (allowLoopback) return
    throw new UnsafeWebhookUrlError('A webhook cannot point at localhost.')
  }

  if (isPrivateIPv4(url.hostname) || isPrivateIPv6(url.hostname)) {
    throw new UnsafeWebhookUrlError(
      'That address is on a private network. Use a publicly reachable https URL.',
    )
  }

  // Credentials in the URL would be sent on every delivery and stored in
  // plaintext in the subscription row.
  if (url.username || url.password) {
    throw new UnsafeWebhookUrlError('Remove the username and password from the URL.')
  }
}
