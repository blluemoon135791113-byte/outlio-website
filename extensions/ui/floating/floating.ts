/**
 * Compact, movable in-page capture control.
 *
 * The native browser panel remains available from the toolbar. This surface is
 * deliberately mounted in a closed shadow root so LinkedIn styles cannot turn
 * it into a quarter-width strip, and the page cannot accidentally style it.
 * It reads no page content; all state comes from the background worker.
 */
import type { DedupeMode, ExtensionMessage, ExtensionState, SessionTotals } from '../../core/types'

const STYLE = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
button, input, select { font: inherit; }
.shell { color: #172033; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; }
.launcher {
  position: fixed; right: 20px; bottom: 20px; width: 48px; height: 48px;
  display: grid; place-items: center; border: 1px solid rgba(255,255,255,.8);
  border-radius: 16px; background: #2563eb; color: white; cursor: grab;
  box-shadow: 0 12px 32px rgba(15,23,42,.24), 0 2px 7px rgba(15,23,42,.16);
  transition: transform 160ms cubic-bezier(.23,1,.32,1), box-shadow 160ms ease, opacity 150ms ease;
  touch-action: none; user-select: none; pointer-events: auto;
}
.launcher:hover { transform: translateY(-2px); box-shadow: 0 16px 36px rgba(15,23,42,.28), 0 3px 9px rgba(15,23,42,.18); }
.launcher:active { cursor: grabbing; transform: scale(.96); }
.launcher[hidden] { display: none; }
.launcher__mark { width: 22px; height: 22px; display: grid; place-items: center; border: 2px solid currentColor; border-radius: 8px; font-size: 12px; font-weight: 800; letter-spacing: -.08em; }
.launcher__badge { position: absolute; top: -3px; right: -3px; width: 12px; height: 12px; border: 2px solid white; border-radius: 50%; background: #22c55e; }
.launcher__badge[data-active="false"] { display: none; }
.backdrop { position: fixed; inset: 0; display: grid; place-items: center; padding: 16px; background: rgba(15,23,42,.12); opacity: 0; pointer-events: none; transition: opacity 180ms ease-out; }
.backdrop[data-open="true"] { opacity: 1; pointer-events: auto; }
.modal {
  position: fixed; left: 50%; top: 50%; width: min(400px, calc(100vw - 32px)); max-height: min(620px, calc(100vh - 32px));
  display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(148,163,184,.35);
  border-radius: 20px; background: #fff; box-shadow: 0 28px 80px rgba(15,23,42,.25), 0 6px 20px rgba(15,23,42,.14);
  opacity: 0; transform: translate(-50%, -50%) scale(.96); pointer-events: none;
  transition: opacity 180ms ease-out, transform 180ms cubic-bezier(.23,1,.32,1);
}
.backdrop[data-open="true"] .modal { opacity: 1; transform: translate(-50%, -50%) scale(1); pointer-events: auto; }
.modal[data-moved="true"] { transform: scale(.96); }
.backdrop[data-open="true"] .modal[data-moved="true"] { transform: scale(1); }
.modal__bar { display: flex; align-items: center; gap: 10px; min-height: 58px; padding: 12px 14px 12px 18px; border-bottom: 1px solid #e8edf4; cursor: grab; user-select: none; touch-action: none; }
.modal__bar:active { cursor: grabbing; }
.modal__brand { display: flex; align-items: center; gap: 9px; min-width: 0; flex: 1; }
.modal__logo { display: grid; place-items: center; width: 27px; height: 27px; border-radius: 9px; background: #eff6ff; color: #2563eb; font-weight: 800; font-size: 12px; }
.modal__title { overflow: hidden; color: #172033; font-size: 14px; font-weight: 750; letter-spacing: -.01em; text-overflow: ellipsis; white-space: nowrap; }
.modal__close { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border: 0; border-radius: 9px; background: transparent; color: #64748b; cursor: pointer; font-size: 21px; line-height: 1; }
.modal__close:hover { background: #f1f5f9; color: #172033; }
.body { overflow: auto; padding: 18px; }
.account { display: flex; flex-direction: column; gap: 2px; padding-bottom: 14px; margin-bottom: 17px; border-bottom: 1px solid #e8edf4; }
.account__email { overflow: hidden; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.account__plan, .muted, .note, .after-note { color: #64748b; }
.account__plan { font-size: 12px; }
.title { margin: 0 0 9px; color: #172033; font-size: 22px; line-height: 1.16; letter-spacing: -.04em; }
.section-label { margin: 0 0 7px; color: #64748b; font-size: 10px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
.note, .after-note { margin: 0 0 15px; font-size: 12px; line-height: 1.5; }
.status { display: flex; align-items: center; gap: 7px; margin: 0 0 16px; color: #334155; font-size: 12px; }
.dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #94a3b8; }
.dot--ok { background: #16a34a; }.dot--live { background: #2563eb; animation: pulse 1.4s ease-in-out infinite; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 0 0 16px; }
.stat { min-width: 0; padding: 10px; border-radius: 11px; background: #f8fafc; }
.stat__value { color: #172033; font-size: 18px; font-weight: 750; font-variant-numeric: tabular-nums; line-height: 1.1; }
.stat__label { margin-top: 4px; color: #64748b; font-size: 10px; }
.hint { margin: 0 0 14px; padding: 10px 11px; border-radius: 11px; background: #eff6ff; color: #1e3a8a; font-size: 12px; line-height: 1.45; }
.field { display: block; margin: 0 0 13px; }.field__label { display: block; margin: 0 0 5px; color: #64748b; font-size: 11px; font-weight: 700; }
.select { width: 100%; padding: 9px 10px; border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; color: #172033; }
.check { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 15px; color: #475569; cursor: pointer; font-size: 12px; line-height: 1.35; }.check input { margin-top: 2px; accent-color: #2563eb; }
.error { margin: 0 0 15px; padding: 10px 11px; border-radius: 11px; background: #fef2f2; color: #b91c1c; font-size: 12px; line-height: 1.45; }
.btn { width: 100%; min-height: 38px; padding: 9px 12px; border: 0; border-radius: 10px; cursor: pointer; font-size: 13px; font-weight: 700; transition: transform 140ms ease-out, background-color 140ms ease-out, opacity 140ms ease-out; }.btn:active { transform: scale(.98); }.btn:disabled { cursor: default; opacity: .48; }
.btn--primary { background: #2563eb; color: #fff; }.btn--primary:hover:not(:disabled) { background: #1d4ed8; }.btn--secondary { border: 1px solid #cbd5e1; background: #fff; color: #172033; }.btn--secondary:hover:not(:disabled) { background: #f8fafc; }.btn + .btn { margin-top: 8px; }
.privacy { padding-top: 14px; margin: 17px 0 0; border-top: 1px solid #e8edf4; color: #64748b; font-size: 11px; line-height: 1.45; }
.btn:focus-visible, .select:focus-visible, .check input:focus-visible, .modal__close:focus-visible, .launcher:focus-visible { outline: 2px solid #2563eb; outline-offset: 3px; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .backdrop, .modal, .launcher, .btn { transition: none; }.dot--live { animation: none; } }
`

type Position = { x: number; y: number }
type Drag = { pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean }

declare const chrome: {
  runtime: { sendMessage(message: ExtensionMessage): Promise<unknown> }
}

const DEDUPE_OPTIONS: Array<[DedupeMode, string]> = [
  ['remove_exact', 'Remove exact duplicates'], ['remove_likely', 'Remove likely duplicates'],
  ['review', 'Flag duplicates for review'], ['keep_all', 'Keep everything'],
]

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}
function send(message: ExtensionMessage): Promise<unknown> { return chrome.runtime.sendMessage(message) }
function button(label: string, variant: 'primary' | 'secondary', message: ExtensionMessage, action: (message: ExtensionMessage) => void) {
  const element = node('button', `btn btn--${variant}`, label)
  element.type = 'button'; element.addEventListener('click', () => action(message)); return element
}
function stats(session: SessionTotals): HTMLElement {
  const grid = node('div', 'stats')
  for (const [value, label] of [[session.pagesProcessed, 'Pages'], [session.leadsImported, 'Records'], [session.duplicatesSkipped, 'Skipped']] as const) {
    const stat = node('div', 'stat'); stat.append(node('div', 'stat__value', String(value)), node('div', 'stat__label', label)); grid.append(stat)
  }
  return grid
}

export function mountFloatingCapture(): void {
  if (document.documentElement.dataset.outlioFloatingMounted === 'true') return
  document.documentElement.dataset.outlioFloatingMounted = 'true'

  const host = document.createElement('div')
  host.id = 'outlio-floating-capture'
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;'
  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style'); style.textContent = STYLE; shadow.append(style)
  const shell = node('div', 'shell'); shadow.append(shell)
  const launcher = node('button', 'launcher'); launcher.type = 'button'; launcher.setAttribute('aria-label', 'Open Outlio capture'); launcher.title = 'Open Outlio capture'
  const mark = node('span', 'launcher__mark', 'O'); const badge = node('span', 'launcher__badge'); badge.dataset.active = 'false'; badge.setAttribute('aria-hidden', 'true'); launcher.append(mark, badge); shell.append(launcher)
  const backdrop = node('div', 'backdrop'); backdrop.dataset.open = 'false'; backdrop.setAttribute('role', 'presentation')
  const modal = node('section', 'modal'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'outlio-floating-title')
  const bar = node('header', 'modal__bar'); const brand = node('div', 'modal__brand'); brand.append(node('span', 'modal__logo', 'O'), node('span', 'modal__title', 'Outlio Capture')); bar.append(brand)
  const close = node('button', 'modal__close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close Outlio capture'); bar.append(close)
  const body = node('div', 'body'); modal.append(bar, body); backdrop.append(modal); shell.append(backdrop)

  let position: Position = { x: window.innerWidth - 68, y: window.innerHeight - 68 }
  let launcherDrag: Drag | null = null
  let modalDrag: Drag | null = null
  let suppressClick = false
  let open = false
  let state: ExtensionState | null = null
  let stateSignature = ''
  let dedupeMode: DedupeMode = 'remove_exact'
  let includeCompanyWebsites = false
  let busy = false

  function clampPosition(x: number, y: number, width: number, height: number): Position {
    return { x: Math.max(8, Math.min(window.innerWidth - width - 8, x)), y: Math.max(8, Math.min(window.innerHeight - height - 8, y)) }
  }
  function setLauncherPosition(x: number, y: number) {
    position = clampPosition(x, y, 48, 48); launcher.style.left = `${position.x}px`; launcher.style.top = `${position.y}px`; launcher.style.right = 'auto'; launcher.style.bottom = 'auto'
  }
  function centerModal() { if (!modal.dataset.moved) { modal.style.left = '50%'; modal.style.top = '50%'; } }
  function closeModal() { open = false; backdrop.dataset.open = 'false'; launcher.hidden = false; launcher.focus({ preventScroll: true }); }
  function openModal() { open = true; launcher.hidden = true; backdrop.dataset.open = 'true'; centerModal(); void refresh(); window.setTimeout(() => body.querySelector<HTMLElement>('button,select,input')?.focus({ preventScroll: true }), 0) }
  function setBusy(value: boolean) { busy = value; body.setAttribute('aria-busy', String(value)); body.querySelectorAll<HTMLButtonElement>('button').forEach((item) => { item.disabled = value }) }

  async function refresh() {
    if (!open || busy) return
    try {
      const next = await send({ type: 'GET_STATE' }) as ExtensionState
      if (!next || typeof next.kind !== 'string') throw new Error('state unavailable')
      state = next; badge.dataset.active = next.kind === 'capturing' || next.kind === 'processing' ? 'true' : 'false'
      const nextSignature = JSON.stringify(next)
      if (nextSignature !== stateSignature) { stateSignature = nextSignature; render(next) }
    } catch {
      state = { kind: 'error', message: 'The capture control is unavailable. Reload the extension and refresh this tab.', retryable: true }
      stateSignature = ''; render(state)
    }
  }
  async function act(message: ExtensionMessage) {
    if (busy) return
    setBusy(true)
    try {
      const request = message.type === 'START_CAPTURE' ? { ...message, dedupeMode, includeCompanyWebsites } : message
      await send(request)
      stateSignature = ''
      await refresh()
    } catch {
      state = { kind: 'error', message: 'Outlio could not complete that action. Try again.', retryable: true }; stateSignature = ''; render(state)
    } finally { setBusy(false) }
  }
  function render(next: ExtensionState) {
    body.replaceChildren()
    const add = (...items: Node[]) => body.append(...items)
    switch (next.kind) {
      case 'loading': add(node('p', 'note', 'Checking Outlio…')); break
      case 'not_connected': add(node('h1', 'title', 'Capture from this page'), node('p', 'note', 'Move this compact control anywhere on the page. Start with an Outlio account.'), button('Connect account', 'primary', { type: 'CONNECT' }, act)); break
      case 'no_subscription': case 'disabled': add(node('p', 'error', next.message), button('Open dashboard', 'secondary', { type: 'OPEN_DASHBOARD' }, act)); break
      case 'ready': {
        add(node('h1', 'title', 'Capture from this page'))
        if (next.account) add(node('p', 'muted', next.account.email ?? 'Signed in'))
        add(node('p', 'section-label', 'Current page'), node('p', 'status'), node('p', 'note', next.supported && next.ready ? 'List ready. Capture the loaded rows, then continue browsing manually.' : next.supported ? 'Waiting for list rows to load…' : 'Open a Sales Navigator lead or account list.'))
        const status = body.querySelector('.status')!; status.append(node('span', `dot ${next.supported && next.ready ? 'dot--ok' : ''}`), node('span', next.supported && next.ready ? 'Ready to capture' : 'Not ready'))
        const field = node('label', 'field'); field.append(node('span', 'field__label', 'Lead duplicate handling')); const select = node('select', 'select'); select.setAttribute('aria-label', 'Lead duplicate handling'); DEDUPE_OPTIONS.forEach(([value, label]) => { const option = node('option', undefined, label); option.value = value; select.append(option) }); select.value = dedupeMode; select.addEventListener('change', () => { dedupeMode = select.value as DedupeMode }); field.append(select); add(field)
        const check = node('label', 'check'); const input = node('input'); input.type = 'checkbox'; input.checked = includeCompanyWebsites; input.addEventListener('change', () => { includeCompanyWebsites = input.checked }); check.append(input, node('span', undefined, 'Include details already visible on the page')); add(check)
        const start = button('Start capture', 'primary', { type: 'START_CAPTURE' }, act); start.disabled = !(next.supported && next.ready); add(start, node('p', 'after-note', 'Drag the Outlio button or this header to move it.'))
        break
      }
      case 'capturing': case 'processing': {
        add(node('h1', 'title', next.kind === 'processing' ? 'Sending this page…' : 'Capture is active'), stats(next.session))
        add(node('p', 'hint', next.kind === 'capturing' && !next.supported ? 'Open a lead or account list to continue. The session stays active.' : 'Browse to the next page yourself. Loaded rows are captured as you arrive.'))
        if (next.kind === 'capturing') { const capture = button('Capture this page', 'secondary', { type: 'CAPTURE_PAGE' }, act); capture.disabled = !(next.supported && next.ready); add(capture) }
        add(button('Finish capture', 'primary', { type: 'FINISH_CAPTURE' }, act), button('Open dashboard', 'secondary', { type: 'OPEN_DASHBOARD' }, act), node('p', 'privacy', 'Closing this modal does not stop capture. Choose Finish capture to stop.'))
        break
      }
      case 'complete': add(node('h1', 'title', 'Capture finished'), stats(next.session), button('Open dashboard', 'primary', { type: 'OPEN_DASHBOARD' }, act)); break
      case 'error': add(node('p', 'error', next.message), next.retryable ? button('Retry', 'primary', { type: 'RETRY' }, act) : button('Connect account', 'primary', { type: 'CONNECT' }, act), next.sessionActive ? button('Finish capture', 'secondary', { type: 'FINISH_CAPTURE' }, act) : node('span'), button('Open dashboard', 'secondary', { type: 'OPEN_DASHBOARD' }, act)); break
    }
    const privacy = node('p', 'privacy', 'You browse. Outlio captures only during a session you start and never opens profiles or turns pages for you.')
    if (!body.querySelector('.privacy')) add(privacy)
  }

  function beginDrag(event: PointerEvent, target: 'launcher' | 'modal') {
    if (target === 'modal' && (event.target as Element).closest('button')) return
    const element = target === 'launcher' ? launcher : modal
    const rect = element.getBoundingClientRect()
    if (target === 'modal' && !modal.dataset.moved) { modal.dataset.moved = 'true'; modal.style.transform = 'none'; modal.style.left = `${rect.left}px`; modal.style.top = `${rect.top}px` }
    const next = target === 'launcher' ? position : { x: rect.left, y: rect.top }
    const drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: next.x, originY: next.y, moved: false }
    if (target === 'launcher') launcherDrag = drag; else modalDrag = drag
    element.setPointerCapture?.(event.pointerId); event.preventDefault()
  }
  function moveDrag(event: PointerEvent, target: 'launcher' | 'modal') {
    const drag = target === 'launcher' ? launcherDrag : modalDrag
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX; const dy = event.clientY - drag.startY
    if (Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; suppressClick = target === 'launcher' }
    const next = clampPosition(drag.originX + dx, drag.originY + dy, target === 'launcher' ? 48 : modal.offsetWidth, target === 'launcher' ? 48 : modal.offsetHeight)
    if (target === 'launcher') setLauncherPosition(next.x, next.y); else { modal.style.left = `${next.x}px`; modal.style.top = `${next.y}px` }
  }
  function endDrag(target: 'launcher' | 'modal') { if (target === 'launcher') launcherDrag = null; else modalDrag = null }

  launcher.addEventListener('pointerdown', (event) => beginDrag(event, 'launcher'))
  launcher.addEventListener('pointermove', (event) => moveDrag(event, 'launcher'))
  launcher.addEventListener('pointerup', () => endDrag('launcher'))
  launcher.addEventListener('click', (event) => { if (suppressClick) { suppressClick = false; event.preventDefault(); return } openModal() })
  bar.addEventListener('pointerdown', (event) => beginDrag(event, 'modal'))
  bar.addEventListener('pointermove', (event) => moveDrag(event, 'modal'))
  bar.addEventListener('pointerup', () => endDrag('modal'))
  close.addEventListener('click', closeModal)
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeModal() })
  shell.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); closeModal(); return }
    if (event.key !== 'Tab' || !open) return
    const focusable = Array.from(body.querySelectorAll<HTMLElement>('button,select,input')).filter((item) => !item.hidden && !item.hasAttribute('disabled'))
    focusable.push(close)
    if (!focusable.length) return
    const index = focusable.indexOf(document.activeElement as HTMLElement)
    const next = focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length]!
    event.preventDefault(); next.focus()
  })
  window.addEventListener('resize', () => { setLauncherPosition(position.x, position.y); if (!modal.dataset.moved) centerModal() })
  host.addEventListener('wheel', (event) => { if (open) event.stopPropagation() }, { passive: true })
  document.documentElement.append(host)
}
