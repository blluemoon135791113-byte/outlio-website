/**
 * Cloudflare email-obfuscation decoding.
 *
 * PURE. No I/O, no clock, no environment.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WHAT THIS IS, AND WHY IT IS NOT A RULE-1 PROBLEM.                       ║
 * ║                                                                          ║
 * ║  Cloudflare's "Email Address Obfuscation" rewrites addresses that the    ║
 * ║  site OWNER chose to publish:                                            ║
 * ║                                                                          ║
 * ║    <a class="__cf_email__" data-cfemail="a1c4d9…">[email protected]</a>  ║
 * ║                                                                          ║
 * ║  Cloudflare then ships a script that decodes it in every visitor's       ║
 * ║  browser. The address is public; the scramble is a speed bump for naive  ║
 * ║  address harvesters, applied to content already served to anyone.        ║
 * ║                                                                          ║
 * ║  Decoding it is equivalent to RENDERING THE PAGE — which is exactly what ║
 * ║  a human reader's browser does, automatically, on every visit. It is not ║
 * ║  a CAPTCHA bypass, not an anti-detection measure, and not a bot-         ║
 * ║  detection defeat: nothing here disguises who is asking, and the same    ║
 * ║  bytes are returned to every client. CLAUDE.md rule 1 forbids evading    ║
 * ║  systems that decide WHETHER to serve us. This decodes what was already  ║
 * ║  served.                                                                 ║
 * ║                                                                          ║
 * ║  Nor is it rule 4: the address is deterministically recovered from bytes ║
 * ║  literally present in the response. Nothing is inferred, guessed, or     ║
 * ║  assembled from a name.                                                  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Why it matters: Scout reads company `/contact` and `/about` pages, which are
 * the pages most likely to carry a real published address — and are also the
 * pages most likely to have this protection switched on. Today those come back
 * EMPTY. That is a silent recall loss, not an error, which is the worst kind.
 *
 * The scheme: the payload is hex. The first byte is an XOR key; every
 * subsequent byte is a character of the address XORed with it.
 */

/** Cloudflare's own link form, used when it rewrites a `mailto:`. */
const CF_LINK = /\/cdn-cgi\/l\/email-protection#([0-9a-fA-F]+)/

/**
 * A sane ceiling. Real payloads are twice the length of an email address plus
 * two; anything vastly longer is not an address and is not worth decoding.
 */
const MAX_HEX = 512

/** Matches the whole string, unlike the scanning patterns used elsewhere. */
const EMAIL_SHAPE = /^[^\s@<>()[\],;:"\\]+@[a-z0-9.-]+\.[a-z]{2,}$/i

/**
 * Decodes one `data-cfemail` payload.
 *
 * Returns `null` rather than a partial or implausible result. A decoder that
 * guesses would manufacture addresses, which is precisely the failure rule 4
 * exists to prevent — so every byte must land in printable ASCII and the
 * result must have the shape of an address.
 */
export function decodeCfEmail(payload: string | null | undefined): string | null {
  const hex = (payload ?? '').trim()
  if (hex.length < 4 || hex.length > MAX_HEX) return null
  if (hex.length % 2 !== 0) return null
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null

  const key = Number.parseInt(hex.slice(0, 2), 16)
  let decoded = ''
  for (let index = 2; index < hex.length; index += 2) {
    const code = Number.parseInt(hex.slice(index, index + 2), 16) ^ key
    // A wrong key yields control characters and high bytes. Refuse, don't
    // salvage — a mangled address is worse than no address.
    if (code < 0x20 || code > 0x7e) return null
    decoded += String.fromCharCode(code)
  }

  const address = decoded.toLowerCase()
  return EMAIL_SHAPE.test(address) ? address : null
}

/**
 * Pulls the payload out of Cloudflare's rewritten link form.
 *
 * `<a href="/cdn-cgi/l/email-protection#a1c4d9…">` is what a `mailto:` becomes
 * when the feature is on, so this is the same fact in a second shape.
 */
export function decodeCfEmailHref(href: string | null | undefined): string | null {
  const match = CF_LINK.exec(href ?? '')
  return match ? decodeCfEmail(match[1]) : null
}
