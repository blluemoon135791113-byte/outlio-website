'use client'

import { useState } from 'react'

import { createPairingAction } from '@/app/(product)/extension/connect/actions'

/**
 * Pairing consent, and the handover point.
 *
 * On success the code is written into a `data-outlio-pairing-code` attribute
 * rather than a URL. The extension's content script — which has host access to
 * this domain only — reads it from the DOM and exchanges it for tokens.
 *
 * Keeping it out of the URL keeps it out of browser history, out of referer
 * headers, and out of any log that records query strings. It is single use and
 * lives 60 seconds regardless, but there is no reason to leak it at all.
 */
export function ConnectPanel({
  state,
  browser,
  platform,
  email,
  planName,
  eligible,
}: {
  state: string | null
  browser: string | null
  platform: string | null
  email: string | null
  planName: string | null
  eligible: boolean
}) {
  const [status, setStatus] = useState<'idle' | 'working' | 'issued' | 'error'>('idle')
  const [code, setCode] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const label = browser ? `${browser}${platform ? ` — ${platform}` : ''}` : 'Browser extension'

  async function connect() {
    setStatus('working')
    setMessage(null)

    const result = await createPairingAction({
      state: state ?? '',
      label,
      browser,
      platform,
    })

    if (result.ok) {
      setCode(result.code)
      setStatus('issued')
      return
    }

    setMessage(result.message)
    setStatus('error')
  }

  // Opened directly rather than by the extension: there is nothing to pair.
  if (!state) {
    return (
      <section className="mt-8 rounded-[var(--radius-xl)] border border-border bg-panel p-6">
        <h2 className="text-sm font-semibold text-ink">Open this from the extension</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Click <strong className="font-semibold text-ink">Connect Account</strong> in the Outlio
          extension to start. This page cannot link a browser on its own.
        </p>
      </section>
    )
  }

  if (!eligible) {
    return (
      <section className="mt-8 rounded-[var(--radius-xl)] border border-border bg-panel p-6">
        <h2 className="text-sm font-semibold text-ink">Active subscription required</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Your account does not currently have access to Lead Capture, so this browser cannot be
          connected yet.
        </p>
        <a
          href="/dashboard/settings#subscription-and-billing"
          className="product-gradient mt-5 inline-flex h-9 items-center rounded-[var(--radius-md)] px-3.5 text-xs font-semibold text-white hover:brightness-95"
        >
          Manage subscription
        </a>
      </section>
    )
  }

  if (status === 'issued' && code) {
    return (
      <section
        className="mt-8 rounded-[var(--radius-xl)] border border-accent/20 bg-accent-soft/50 p-6"
        // Read by the extension content script, then cleared by it.
        data-outlio-pairing-code={code}
        data-outlio-pairing-state={state}
      >
        <h2 className="text-sm font-semibold text-ink">Browser connected</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          You can close this tab and return to the extension. If it still shows as disconnected,
          reopen the extension and try again — the link expires after a minute.
        </p>
      </section>
    )
  }

  return (
    <section className="mt-8 rounded-[var(--radius-xl)] border border-border bg-panel p-6">
      <dl className="space-y-3 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">Account</dt>
          <dd className="font-medium text-ink">{email ?? 'Signed in'}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">Plan</dt>
          <dd className="font-medium text-ink">{planName ?? 'Active'}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">Browser</dt>
          <dd className="font-medium text-ink">{label}</dd>
        </div>
      </dl>

      <p className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted">
        The extension will be able to send pages you capture to your account. It cannot read any
        other site, and it captures nothing unless you start a session. You can disconnect this
        browser at any time from Settings.
      </p>

      {message ? (
        <p className="mt-4 text-xs font-medium text-danger">{message}</p>
      ) : null}

      <button
        type="button"
        onClick={connect}
        disabled={status === 'working'}
        className="product-gradient mt-5 inline-flex h-10 w-full items-center justify-center rounded-[var(--radius-md)] px-4 text-sm font-semibold text-white transition-[filter] duration-150 hover:brightness-95 disabled:opacity-60"
      >
        {status === 'working' ? 'Connecting…' : 'Connect this browser'}
      </button>
    </section>
  )
}
