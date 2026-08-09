'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { createClient } from '@/lib/supabase/client'

export function MfaChallengeForm({ next }: { next: string }) {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setBusy(true)
    setError('')
    const supabase = createClient()
    const { data: factors } = await supabase.auth.mfa.listFactors()
    const factor = factors?.totp[0]
    if (!factor) {
      setError('No authenticator is enrolled for this account.')
      setBusy(false)
      return
    }
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code })
    if (verifyError) {
      setError('That code was not accepted. Wait for a new code and try again.')
      setBusy(false)
      return
    }
    router.replace(next)
    router.refresh()
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-ink">Authentication code</span>
        <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus required className="w-full rounded-[var(--radius-md)] border border-border bg-paper px-3 py-2.5 text-center font-mono text-xl tracking-[0.3em] text-ink outline-none focus:border-accent/60 focus:shadow-[0_0_0_3px_rgba(139,92,246,0.12)]" />
      </label>
      <button disabled={busy} className="inline-flex h-11 w-full items-center justify-center rounded-[var(--radius-md)] bg-accent px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.98] disabled:opacity-60">{busy ? 'Verifying…' : 'Verify and continue'}</button>
    </form>
  )
}
