/**
 * Content script for outlio.io/extension/connect only.
 *
 * Picks up the one-time pairing code the page rendered into the DOM and hands
 * it to the background worker, which exchanges it for tokens.
 *
 * Reading from the DOM rather than a URL keeps the code out of browser
 * history, out of referer headers and out of any log that records query
 * strings. It is single-use and expires in 60 seconds regardless, but there is
 * no reason to leak it at all.
 *
 * The attribute is cleared immediately after reading so a code cannot be
 * scraped from a tab left open.
 */
declare const chrome: {
  runtime: { sendMessage(message: unknown): Promise<unknown> }
}

const ATTR_CODE = 'data-outlio-pairing-code'
const ATTR_STATE = 'data-outlio-pairing-state'

let handled = false

async function handOff(node: Element): Promise<void> {
  if (handled) return

  const code = node.getAttribute(ATTR_CODE)
  const state = node.getAttribute(ATTR_STATE)
  if (!code || !state) return

  handled = true

  // Clear before the network call: even if pairing fails, the code must not
  // sit in the DOM waiting to be read again.
  node.removeAttribute(ATTR_CODE)
  node.removeAttribute(ATTR_STATE)

  await chrome.runtime.sendMessage({ type: 'PAIRING_CODE', code, state })
}

function scan(): void {
  const node = document.querySelector(`[${ATTR_CODE}]`)
  if (node) void handOff(node)
}

// The code appears after the user clicks Connect, so the panel is not present
// on first paint. Watch for it, then stop.
const observer = new MutationObserver(() => {
  scan()
  if (handled) observer.disconnect()
})

observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true })
scan()
