/**
 * Popup UI.
 *
 * Renders whatever the background worker reports and nothing else. It holds no
 * state, makes no API calls and decides no entitlement — a popup that decided
 * for itself whether the user may capture would be trivially bypassed by
 * editing it, and it is public code.
 *
 * DOM is built with createElement rather than innerHTML: extension pages run
 * with elevated privileges, so string-built markup is a habit worth not having.
 */
import type { DedupeMode, ExtensionMessage, ExtensionState, SessionTotals } from '../../core/types'

declare const chrome: {
  runtime: { sendMessage(message: ExtensionMessage): Promise<unknown> }
}

const root = document.getElementById('root')!
const connection = document.getElementById('connection')!

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function button(
  label: string,
  variant: 'primary' | 'secondary',
  onClick: () => void,
): HTMLButtonElement {
  const node = el('button', `btn btn--${variant}`, label)
  node.type = 'button'
  node.addEventListener('click', onClick)
  return node
}

function statusLine(dot: 'ok' | 'idle' | 'live', text: string): HTMLElement {
  const wrap = el('p', 'status')
  wrap.appendChild(el('span', `dot dot--${dot}`))
  wrap.appendChild(el('span', undefined, text))
  return wrap
}

function companyWebsiteOption(): HTMLLabelElement {
  const label = el('label', 'capture-option')
  const input = el('input')
  input.type = 'checkbox'
  input.id = 'include-company-websites'
  label.append(input, el('span', undefined, 'Find company websites (slower)'))
  return label
}

function duplicateHandlingOption(): HTMLLabelElement {
  const label = el('label', 'field-option')
  label.appendChild(el('span', 'field-option__label', 'Duplicate handling'))
  const select = el('select', 'field-option__select')
  select.id = 'dedupe-mode'
  for (const [value, text] of [
    ['remove_exact', 'Remove exact duplicates'],
    ['remove_likely', 'Remove likely duplicates'],
    ['review', 'Flag duplicates for review'],
    ['keep_all', 'Keep everything'],
  ] as const) {
    const option = el('option', undefined, text)
    option.value = value
    select.appendChild(option)
  }
  label.appendChild(select)
  return label
}

function stats(session: SessionTotals): HTMLElement {
  const grid = el('div', 'stats')

  const entries: Array<[number, string]> = [
    [session.pagesProcessed, 'Pages'],
    [session.leadsImported, 'Leads'],
    [session.duplicatesSkipped, 'Duplicates'],
  ]

  for (const [value, label] of entries) {
    const cell = el('div', 'stat')
    cell.appendChild(el('div', 'stat__value', String(value)))
    cell.appendChild(el('div', 'stat__label', label))
    grid.appendChild(cell)
  }

  return grid
}

function accountBlock(email: string | null, plan: string | null): HTMLElement {
  const wrap = el('div', 'account')
  wrap.appendChild(el('div', 'account__email', email ?? 'Signed in'))
  wrap.appendChild(el('div', 'account__plan', plan ? `${plan} plan` : 'Active'))
  return wrap
}

async function send(message: ExtensionMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message)
}

async function refresh(): Promise<void> {
  const state = (await send({ type: 'GET_STATE' })) as ExtensionState
  render(state)
}

function setPill(text: string, variant: 'ok' | 'muted' | 'warn'): void {
  connection.textContent = text
  connection.className = `pill pill--${variant}`
}

function render(state: ExtensionState): void {
  root.replaceChildren()

  switch (state.kind) {
    case 'loading':
      setPill('Checking…', 'muted')
      root.appendChild(el('p', 'note', 'Loading…'))
      return

    case 'not_connected':
      setPill('Not connected', 'muted')
      root.appendChild(
        el('p', 'note', 'Connect your Outlio account to start capturing leads from search results.'),
      )
      root.appendChild(
        button('Connect Account', 'primary', () => {
          void send({ type: 'CONNECT' })
          window.close()
        }),
      )
      return

    case 'no_subscription':
      setPill('Inactive', 'warn')
      root.appendChild(el('p', 'error', state.message))
      root.appendChild(
        el('p', 'note', 'Your account does not currently have access to Lead Capture.'),
      )
      root.appendChild(
        button('Manage Subscription', 'primary', () => {
          void send({ type: 'OPEN_DASHBOARD' })
          window.close()
        }),
      )
      return

    case 'disabled':
      setPill('Disabled', 'warn')
      root.appendChild(el('p', 'error', state.message))
      root.appendChild(el('p', 'note', 'Contact support if you think this is a mistake.'))
      return

    case 'ready': {
      setPill('Connected', 'ok')
      root.appendChild(accountBlock(state.account.email, state.account.plan))
      root.appendChild(el('p', 'section-label', 'Current page'))

      if (!state.supported) {
        root.appendChild(statusLine('idle', 'No supported page detected'))
        root.appendChild(
          el('p', 'note', 'Open a lead search-results page to start capturing.'),
        )
        const disabled = button('Start Capture', 'primary', () => {})
        disabled.disabled = true
        root.appendChild(disabled)
        return
      }

      root.appendChild(statusLine('ok', 'Supported page detected'))
      root.appendChild(duplicateHandlingOption())
      root.appendChild(companyWebsiteOption())
      root.appendChild(
        button('Start Capture', 'primary', () => {
          const includeCompanyWebsites = (
            document.getElementById('include-company-websites') as HTMLInputElement | null
          )?.checked === true
          const dedupeMode = (
            document.getElementById('dedupe-mode') as HTMLSelectElement | null
          )?.value as DedupeMode | undefined
          void send({
            type: 'START_CAPTURE',
            includeCompanyWebsites,
            dedupeMode: dedupeMode ?? 'remove_exact',
          }).then(refresh)
        }),
      )
      return
    }

    case 'capturing':
      setPill('Capturing', 'ok')
      root.appendChild(accountBlock(state.account.email, state.account.plan))
      root.appendChild(el('p', 'section-label', 'Capture session active'))
      root.appendChild(stats(state.session))
      root.appendChild(
        el(
          'p',
          'hint',
          state.supported
            ? 'Navigate manually to the next page. Each page is captured as you arrive.'
            : 'Open a results page to continue capturing. The session stays active.',
        ),
      )
      root.appendChild(
        button('Finish Capture', 'primary', () => {
          void send({ type: 'FINISH_CAPTURE' }).then(refresh)
        }),
      )
      root.appendChild(
        button('Open Dashboard', 'secondary', () => {
          void send({ type: 'OPEN_DASHBOARD' })
        }),
      )
      return

    case 'processing':
      setPill('Working', 'muted')
      root.appendChild(statusLine('live', 'Processing page…'))
      root.appendChild(stats(state.session))
      return

    case 'complete':
      setPill('Connected', 'ok')
      root.appendChild(el('p', 'section-label', 'Capture complete'))
      root.appendChild(stats(state.session))
      root.appendChild(
        button('View Leads', 'primary', () => {
          void send({ type: 'OPEN_DASHBOARD' })
        }),
      )
      return

    case 'error':
      setPill('Problem', 'warn')
      root.appendChild(el('p', 'error', state.message))
      if (state.retryable) {
        root.appendChild(
          button('Retry', 'primary', () => {
            void send({ type: 'RETRY' }).then(refresh)
          }),
        )
      } else {
        root.appendChild(
          button('Open Dashboard', 'secondary', () => {
            void send({ type: 'OPEN_DASHBOARD' })
          }),
        )
      }
      return
  }
}

// Poll while open so counts move as pages are processed. The popup is only
// alive for seconds at a time, so this is cheap and stops the moment it closes.
void refresh()
const timer = setInterval(() => void refresh(), 2000)
window.addEventListener('unload', () => clearInterval(timer))
