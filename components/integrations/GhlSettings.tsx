'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { ConnectorLogo } from '@/components/integrations/ConnectorLogo'
import type { IntegrationConnectionStatus } from '@/types/database'

type Feedback = { tone: 'error' | 'success'; message: string } | null

export function GhlSettings({ status, accountLabel }: { status: IntegrationConnectionStatus | null; accountLabel: string | null }) {
  const router = useRouter()
  const connected = status === 'connected'
  const [token, setToken] = useState('')
  const [locationId, setLocationId] = useState('')
  const [pending, setPending] = useState<'test' | 'connect' | 'disconnect' | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)

  async function request(action: 'test' | 'connect' | 'disconnect') {
    setPending(action)
    setFeedback(null)
    try {
      const response = await fetch(`/api/integrations/ghl/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'disconnect' ? '{}' : JSON.stringify(token && locationId ? { token, locationId } : {}),
      })
      const body = await response.json().catch(() => null) as { ok?: boolean; error?: string; accountName?: string } | null
      if (!response.ok || !body?.ok) throw new Error(body?.error ?? 'HighLevel could not complete this request.')
      setFeedback({ tone: 'success', message: action === 'test' ? `Connection verified${body.accountName ? ` for ${body.accountName}` : ''}.` : action === 'disconnect' ? 'HighLevel disconnected.' : connected ? 'HighLevel token updated.' : 'HighLevel connected.' })
      if (action !== 'test') {
        setToken('')
        setLocationId('')
        router.refresh()
      }
    } catch (error) {
      setFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'HighLevel could not complete this request.' })
    } finally {
      setPending(null)
    }
  }

  const inputClass = 'w-full field px-3 py-2.5 text-base text-ink placeholder:text-muted focus:outline-none'

  return (
    <div className="rounded-xl border border-border bg-app/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-panel"><ConnectorLogo name="ghl" className="size-6" /></span>
          <div><h3 className="text-sm font-semibold text-ink">GoHighLevel</h3><p className="text-sm text-muted">Export leads to your own HighLevel sub-account.</p></div>
        </div>
        <span className={connected ? 'rounded-full border border-success/25 bg-success-soft px-2.5 py-1 text-xs font-semibold text-success' : status === 'error' || status === 'reconnect_required' ? 'rounded-full border border-warning/25 bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning' : 'rounded-full border border-border bg-panel px-2.5 py-1 text-xs font-semibold text-muted'}>{connected ? '● Connected' : status === 'reconnect_required' ? '⚠ Update token' : '○ Not connected'}</span>
      </div>

      {connected ? <div className="mt-5 rounded-lg border border-border bg-panel px-3 py-2.5"><p className="text-xs font-medium text-muted">Connected location</p><p className="mt-1 text-sm font-semibold text-ink">{accountLabel ?? 'HighLevel sub-account'}</p><p className="mt-1 text-xs text-muted">The Private Integration Token is encrypted server-side and is never displayed again.</p></div> : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5"><span className="text-sm font-medium text-ink">Private Integration Token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} className={inputClass} autoComplete="new-password" maxLength={4096} placeholder={connected ? 'Paste a replacement token' : 'Paste your HighLevel token'} /></label>
        <label className="block space-y-1.5"><span className="text-sm font-medium text-ink">Location / Sub-account ID</span><input value={locationId} onChange={(event) => setLocationId(event.target.value)} className={inputClass} autoComplete="off" maxLength={128} placeholder="Your HighLevel Location ID" /></label>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted">Required scopes: contacts.write, contacts.readonly, locations.readonly. Add locations/customFields.readonly and locations/customFields.write to include Outlio profile URLs.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={Boolean(pending) || (!connected && (!token || !locationId))} onClick={() => void request('test')} className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-4 text-sm font-semibold text-ink transition-[border-color,transform] duration-150 hover:border-accent/35 hover:text-accent active:scale-[0.97] disabled:opacity-50">{pending === 'test' ? 'Testing…' : 'Test connection'}</button>
        <button type="button" disabled={Boolean(pending) || !token || !locationId} onClick={() => void request('connect')} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-md)] bg-accent px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.97] disabled:opacity-50"><ConnectorLogo name="ghl" className="size-4" />{pending === 'connect' ? 'Saving…' : connected ? 'Update token' : 'Connect'}</button>
        {connected || status === 'reconnect_required' ? <button type="button" disabled={Boolean(pending)} onClick={() => void request('disconnect')} className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-4 text-sm font-semibold text-ink transition-[border-color,color,transform] duration-150 hover:border-danger/35 hover:text-danger active:scale-[0.97] disabled:opacity-50">{pending === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</button> : null}
      </div>
      {feedback ? <p role={feedback.tone === 'error' ? 'alert' : 'status'} className={feedback.tone === 'error' ? 'mt-3 text-sm text-danger' : 'mt-3 text-sm text-success'}>{feedback.message}</p> : null}
    </div>
  )
}
