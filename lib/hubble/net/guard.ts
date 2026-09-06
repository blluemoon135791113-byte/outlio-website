import 'server-only'

/**
 * Which URLs the server is allowed to fetch.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS IS THE SHARPEST EDGE IN ASK HUBBLE. READ BEFORE CHANGING.       ║
 * ║                                                                          ║
 * ║  Hubble fetches URLs chosen by a SEARCH ENGINE and an LLM — neither of   ║
 * ║  which is trusted input. Without this guard, a poisoned search result    ║
 * ║  pointing at `http://169.254.169.254/` makes our own server read cloud   ║
 * ║  credentials and hand them to a model. That is server-side request       ║
 * ║  forgery, and the fetcher is exactly the shape that suffers from it.     ║
 * ║                                                                          ║
 * ║  DENY BY DEFAULT. A URL is fetchable only if it is public http(s) on a   ║
 * ║  public IP. Everything else is refused without a request being made.     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export type GuardVerdict =
  | { allowed: true; url: string; host: string }
  | { allowed: false; reason: string }

/**
 * Hosts that are never a research target.
 *
 * `metadata.google.internal` and the link-local address are the classic cloud
 * credential endpoints; `localhost` and friends reach our own services.
 */
const DENIED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
])

/** Reserved ranges. A public URL never resolves into one of these. */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true

  const [a, b] = parts as [number, number, number, number]

  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true // private
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // ⚠️ link-local: cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a === 192 && b === 0) return true // IETF protocol assignments
  if (a >= 224) return true // multicast, reserved, broadcast

  return false
}

function isPrivateIpv6(ip: string): boolean {
  const value = ip.toLowerCase().replace(/^\[|\]$/g, '')

  if (value === '::' || value === '::1') return true // unspecified, loopback
  if (value.startsWith('fe80')) return true // link-local
  if (/^f[cd]/.test(value)) return true // unique local

  // ⚠️ IPv4-mapped (`::ffff:169.254.169.254`) reaches the same metadata
  // endpoint by another spelling. Unwrap and re-check rather than trust it.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value)
  if (mapped?.[1]) return isPrivateIpv4(mapped[1])

  return false
}

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return isPrivateIpv4(ip)
  if (version === 6) return isPrivateIpv6(ip)
  // Not an IP literal at all — the caller must resolve it first.
  return true
}

/**
 * Everything that can be decided without a DNS lookup.
 *
 * PURE, so every rejection is testable without a network. `assertFetchable`
 * adds the resolution check on top.
 */
export function screenUrl(raw: string): GuardVerdict {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { allowed: false, reason: 'not a URL' }
  }

  // ⚠️ `file:`, `data:`, `gopher:` and friends are not research targets.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { allowed: false, reason: `scheme ${url.protocol} is not fetchable` }
  }

  // Credentials in a URL are a redirect-laundering trick, never a real source.
  if (url.username || url.password) {
    return { allowed: false, reason: 'URL carries credentials' }
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '')

  if (!host || DENIED_HOSTS.has(host)) {
    return { allowed: false, reason: `host ${host || '(empty)'} is not fetchable` }
  }

  // `.local`, `.internal` and bare hostnames are not on the public web.
  if (!host.includes('.') || /\.(local|internal|localdomain|home|lan)$/.test(host)) {
    return { allowed: false, reason: `host ${host} is not a public domain` }
  }

  // An IP literal can be screened immediately; a name needs resolution.
  if (isIP(host) && isPrivateAddress(host)) {
    return { allowed: false, reason: `address ${host} is reserved` }
  }

  // Non-standard ports are usually internal services, not published pages.
  if (url.port && url.port !== '80' && url.port !== '443') {
    return { allowed: false, reason: `port ${url.port} is not fetchable` }
  }

  return { allowed: true, url: url.toString(), host }
}

/**
 * The full check, including where the hostname actually resolves.
 *
 * ⚠️ THE DNS STEP IS NOT OPTIONAL. `screenUrl` alone is defeated by a hostname
 * the attacker controls that resolves to 127.0.0.1 — the URL looks entirely
 * public and the request still lands on our own machine. Every resolved
 * address must be public, not merely the first one.
 */
export async function assertFetchable(raw: string): Promise<GuardVerdict> {
  const screened = screenUrl(raw)
  if (!screened.allowed) return screened

  // An IP literal was already screened above; no name to resolve.
  if (isIP(screened.host)) return screened

  try {
    const addresses = await lookup(screened.host, { all: true })
    if (addresses.length === 0) {
      return { allowed: false, reason: `${screened.host} does not resolve` }
    }

    for (const address of addresses) {
      if (isPrivateAddress(address.address)) {
        return {
          allowed: false,
          reason: `${screened.host} resolves to reserved address ${address.address}`,
        }
      }
    }

    return screened
  } catch {
    return { allowed: false, reason: `${screened.host} does not resolve` }
  }
}
