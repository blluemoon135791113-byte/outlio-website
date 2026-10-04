/** Shared sidebar/fallback popup. Account and capture state come from the worker. */
import type { DedupeMode, ExtensionMessage, ExtensionState, SessionTotals } from '../../core/types'

declare const chrome: { runtime: { sendMessage(message: ExtensionMessage): Promise<unknown> } }
const root = document.getElementById('root')!
const connection = document.getElementById('connection')!
let pending = false
let refreshing = false
let rendered = ''
let dedupeMode: DedupeMode = 'remove_exact'
let includeCompanyWebsites = false

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
function button(label: string, variant: 'primary' | 'secondary', message: ExtensionMessage): HTMLButtonElement {
  const node = el('button', `btn btn--${variant}`, label)
  node.type = 'button'
  node.id = `action-${message.type.toLowerCase()}`
  node.addEventListener('click', () => { void act(message) })
  return node
}
function statusLine(dot: 'ok' | 'idle' | 'live', text: string) {
  const wrap = el('p', 'status')
  wrap.append(el('span', `dot dot--${dot}`), el('span', undefined, text))
  return wrap
}
function options() {
  const label = el('label', 'field-option')
  label.append(el('span', 'field-option__label', 'Lead duplicate handling'))
  const select = el('select', 'field-option__select')
  select.id = 'dedupe-mode'
  for (const [value, text] of [
    ['remove_exact', 'Remove exact duplicates'], ['remove_likely', 'Remove likely duplicates'],
    ['review', 'Flag duplicates for review'], ['keep_all', 'Keep everything'],
  ]) {
    const option = el('option', undefined, text)
    option.value = value; select.append(option)
  }
  select.value = dedupeMode
  select.addEventListener('change', () => { dedupeMode = select.value as DedupeMode })
  label.append(select)
  const websites = el('label', 'capture-option')
  const input = el('input')
  input.type = 'checkbox'; input.id = 'include-company-websites'; input.checked = includeCompanyWebsites
  input.addEventListener('change', () => { includeCompanyWebsites = input.checked })
  websites.append(input, el('span', undefined, 'Include company details already visible on the page'))
  root.append(label, websites)
}
function stats(session: SessionTotals) {
  const grid = el('div', 'stats')
  for (const [value, label] of [[session.pagesProcessed, 'Pages'], [session.leadsImported, 'Records'], [session.duplicatesSkipped, 'Skipped']] as const) {
    const cell = el('div', 'stat')
    cell.append(el('div', 'stat__value', String(value)), el('div', 'stat__label', label))
    grid.append(cell)
  }
  return grid
}
function account(email: string | null, plan: string | null) {
  const wrap = el('div', 'account')
  wrap.append(el('div', 'account__email', email ?? 'Signed in'), el('div', 'account__plan', plan ? `${plan} plan` : 'Active'))
  return wrap
}
async function act(message: ExtensionMessage) {
  if (pending) return
  pending = true
  root.setAttribute('aria-busy', 'true')
  root.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { b.disabled = true })
  try {
    const request = message.type === 'START_CAPTURE' ? { ...message, dedupeMode, includeCompanyWebsites } : message
    await chrome.runtime.sendMessage(request)
  } catch {
    rendered = ''
    render({ kind: 'error', message: 'The extension was reloaded or is unavailable. Close and reopen Outlio, then refresh your Sales Navigator tab.', retryable: true })
    return
  } finally {
    pending = false; root.removeAttribute('aria-busy')
    rendered = ''
  }
  await refresh()
}
async function refresh() {
  if (pending || refreshing) return
  refreshing = true
  try {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' }) as ExtensionState
    if (!state?.kind) throw new Error('No state')
    if (!pending) render(state)
  } catch {
    if (!pending) render({ kind: 'error', message: 'Cannot reach the extension. Close and reopen the panel, or reload Outlio in your browser extensions page.', retryable: true })
  } finally { refreshing = false }
}
function setPill(text: string, variant: 'ok' | 'muted' | 'warn') {
  connection.textContent = text; connection.className = `pill pill--${variant}`
}
function render(state: ExtensionState) {
  const signature = JSON.stringify(state)
  if (signature === rendered) return // Polls must not reset controls, focus or scroll.
  rendered = signature
  const focusId = (document.activeElement as HTMLElement | null)?.id
  const scrollTop = document.documentElement.scrollTop
  root.replaceChildren()
  renderState(state)
  root.append(el('p', 'privacy-note', 'You browse. Outlio captures only during a session you start. It never opens profiles or turns pages for you.'))
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true })
  document.documentElement.scrollTop = scrollTop
}
function renderState(state: ExtensionState) {
  switch (state.kind) {
    case 'loading': setPill('Checking…', 'muted'); root.append(el('p', 'note', 'Loading…')); return
    case 'not_connected':
      setPill('Not connected', 'muted')
      root.append(el('h1', 'title', 'Your lists, in Outlio'), el('p', 'note', 'Capture Sales Navigator saved Lead Lists, Account Lists and search results you open yourself.'), button('Connect account', 'primary', { type: 'CONNECT' }))
      return
    case 'no_subscription':
    case 'disabled':
      setPill('Unavailable', 'warn')
      root.append(el('p', 'error', state.message), button('Open dashboard', 'secondary', { type: 'OPEN_DASHBOARD' }))
      return
    case 'ready': {
      setPill('Connected', 'ok')
      root.append(account(state.account.email, state.account.plan), el('h1', 'title', 'Capture leads & accounts'), el('p', 'section-label', 'Current tab'))
      const ready = state.supported && state.ready
      root.append(statusLine(ready ? 'ok' : 'idle', ready ? 'List ready to capture' : state.supported ? 'Waiting for list rows…' : 'Open a Sales Navigator list'))
      if (!ready) root.append(el('p', 'note', 'Open a saved Lead List, Account List or search results and wait for the rows to load. Just installed or updated? Refresh that tab once.'))
      options()
      const start = button('Start capture', 'primary', { type: 'START_CAPTURE' })
      start.disabled = !ready
      root.append(start, el('p', 'after-note', 'Captures the current page, then pages you visit manually. Accounts are matched by company identity.'))
      return
    }
    case 'capturing':
    case 'processing': {
      setPill(state.kind === 'processing' ? 'Sending' : 'Capturing', 'ok')
      root.append(account(state.account.email, state.account.plan), el('h1', 'title', 'Capture is active'), stats(state.session))
      if (state.kind === 'processing') root.append(statusLine('live', 'Sending this page to Outlio…'))
      root.append(el('p', 'hint', state.kind === 'capturing' && !state.supported
        ? 'Open a Sales Navigator lead or account list to continue. Your session stays active.'
        : 'Open the next page yourself. Outlio captures loaded rows as you browse. Totals update after processing.'))
      if (state.kind === 'capturing') {
        const capture = button('Capture this page', 'secondary', { type: 'CAPTURE_PAGE' })
        capture.disabled = !state.supported || !state.ready
        root.append(capture)
      }
      root.append(button('Finish capture', 'primary', { type: 'FINISH_CAPTURE' }), button('View captures in Outlio', 'secondary', { type: 'OPEN_DASHBOARD' }), el('p', 'after-note', 'Closing this panel does not stop capture. Choose Finish capture to stop. Records may still be processing; add them to CRM from the dashboard.'))
      return
    }
    case 'complete':
      setPill('Connected', 'ok')
      root.append(el('h1', 'title', 'Capture finished'), stats(state.session), button('View captures in Outlio', 'primary', { type: 'OPEN_DASHBOARD' }))
      return
    case 'error':
      setPill('Needs attention', 'warn')
      root.append(el('p', 'error', state.message))
      if (state.retryable) root.append(button('Retry', 'primary', { type: 'RETRY' }))
      else root.append(button('Connect account', 'primary', { type: 'CONNECT' }))
      if (state.sessionActive) root.append(button('Finish capture', 'secondary', { type: 'FINISH_CAPTURE' }))
      root.append(button('Open dashboard', 'secondary', { type: 'OPEN_DASHBOARD' }))
  }
}
connection.setAttribute('role', 'status')
void refresh()
const timer = setInterval(() => { if (!document.hidden) void refresh() }, 2000)
window.addEventListener('focus', () => { void refresh() })
window.addEventListener('unload', () => clearInterval(timer))
