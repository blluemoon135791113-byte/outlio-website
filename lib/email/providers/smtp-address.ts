/**
 * Where an SMTP or IMAP connection is allowed to point — M5 Phase 12.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  SMTP HOSTS ARE CUSTOMER-SUPPLIED, WHICH MAKES THEM AN SSRF SURFACE.      ║
 * ║                                                                           ║
 * ║  "Connect to this host and port, and tell me whether it worked" is a      ║
 * ║  port scanner if the host is allowed to be internal. A customer could     ║
 * ║  point a sending account at 169.254.169.254 (the cloud metadata service), ║
 * ║  at 10.x internal services, or at localhost on the worker itself, and     ║
 * ║  read the answer out of the connection-test error message.               ║
 * ║                                                                           ║
 * ║  So the destination is checked before any socket is opened. Loopback is   ║
 * ║  permitted OUTSIDE production only, because the integration test needs a  ║
 * ║  mail server in a local container — the same carve-out the existing       ║
 * ║  Google OAuth redirect check already makes.                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THIS IS A HOSTNAME-SHAPE CHECK, NOT A COMPLETE SSRF DEFENCE. A hostname
 * that resolves to a private address defeats it, because resolution happens
 * later inside the socket layer. Closing that fully needs DNS resolution
 * pinned to the connection, which is Ledger DR19. What this does stop is the
 * direct case — a literal private IP typed into the settings form — and it
 * makes the intent explicit rather than absent.
 */

/** Ports a mail client legitimately uses. */
const SMTP_PORTS = new Set([25, 465, 587, 2525])
const IMAP_PORTS = new Set([143, 993])

export type MailEndpointKind = 'smtp' | 'imap'

export class UnsafeMailEndpointError extends Error {}

function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) return false

  const octets = parts.map((p) => Number(p))
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false

  const [a, b] = octets as [number, number, number, number]

  return (
    a === 0 || // "this network"
    a === 10 || // RFC 1918
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // RFC 1918
    (a === 192 && b === 168) || // RFC 1918
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a >= 224 // multicast and reserved
  )
}

function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    h === '::1' || // loopback
    h === '::' ||
    h.startsWith('fc') || // unique local
    h.startsWith('fd') ||
    h.startsWith('fe80') || // link-local
    h.startsWith('::ffff:') // IPv4-mapped, which would bypass the v4 check
  )
}

function isLoopbackName(host: string): boolean {
  const h = host.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost')
}

/**
 * Throws unless this host and port are a safe place to open a mail connection.
 *
 * @param allowLoopback defaults to true outside production, so the integration
 *   test can reach a mail server in a container. Never true in production.
 */
export function assertSafeMailEndpoint(
  kind: MailEndpointKind,
  host: string,
  port: number,
  allowLoopback = process.env.NODE_ENV !== 'production',
): void {
  const trimmed = host.trim().toLowerCase()

  if (!trimmed) {
    throw new UnsafeMailEndpointError('A mail server hostname is required.')
  }

  /*
   * A host carrying a scheme, path, credentials or whitespace is not a
   * hostname, and may be an attempt to smuggle one past the checks below —
   * `evil.com@10.0.0.1` and `http://10.0.0.1/` both "contain" a public-looking
   * string while pointing somewhere private.
   *
   * A colon is legal ONLY inside a bracketed IPv6 literal; anywhere else it is
   * a port glued to the host, which belongs in the port argument.
   */
  const bracketedIPv6 = trimmed.startsWith('[') && trimmed.endsWith(']')
  if (/[/@\\?#\s]/.test(trimmed) || (trimmed.includes(':') && !bracketedIPv6)) {
    throw new UnsafeMailEndpointError(
      'Enter just the server hostname, without a scheme, port or path.',
    )
  }

  const allowedPorts = kind === 'smtp' ? SMTP_PORTS : IMAP_PORTS
  if (!allowedPorts.has(port)) {
    throw new UnsafeMailEndpointError(
      `Port ${port} is not a standard ${kind.toUpperCase()} port. Use ${[...allowedPorts].join(', ')}.`,
    )
  }

  if (isLoopbackName(trimmed) || isPrivateIPv4(trimmed) || isPrivateIPv6(trimmed)) {
    if (allowLoopback && isLoopbackName(trimmed)) return

    throw new UnsafeMailEndpointError(
      'That address is on a private network. Enter your mail provider’s public hostname.',
    )
  }
}
