'use client'

import { useActionState, useState } from 'react'

import {
  createApiKey,
  createWebhook,
  deleteWebhook,
  revokeApiKey,
  setWebhookActive,
  type DeveloperActionState,
} from '@/app/(product)/dashboard/settings/developers/actions'
import { WEBHOOK_EVENTS } from '@/lib/api/signing'

const SCOPE_GROUPS = [
  { resource: 'contacts', label: 'Contacts' },
  { resource: 'companies', label: 'Companies' },
  { resource: 'opportunities', label: 'Deals' },
  { resource: 'activities', label: 'Activities' },
  { resource: 'tasks', label: 'Tasks' },
  { resource: 'lists', label: 'Lists' },
] as const

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE SECRET IS SHOWN ONCE, AND THE UI HAS TO MAKE THAT UNMISSABLE.       ║
 * ║                                                                           ║
 * ║  A key or signing secret that a customer skims past is one they cannot    ║
 * ║  recover — we store only a hash, deliberately. So the reveal is a         ║
 * ║  full-width panel with a copy button that stays until dismissed, rather   ║
 * ║  than a toast that disappears while they are reaching for the mouse.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
function SecretReveal({ secret, onDismiss }: { secret: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="clay space-y-3 border border-accent p-4">
      <div>
        <p className="text-sm font-semibold text-ink">Copy this now — it is shown once</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Outlio stores only a hash of it, so nobody here can look it up for you later. If you
          lose it, revoke it and make a new one.
        </p>
      </div>

      <code className="block break-all rounded-[var(--radius-md)] bg-surface-muted px-3 py-2 font-mono text-xs text-ink">
        {secret}
      </code>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(secret)
            setCopied(true)
          }}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
        >
          {/* Deliberately says what dismissing costs. */}
          I have saved it
        </button>
      </div>
    </div>
  )
}

export function ApiKeys({
  keys,
  canManage,
}: {
  keys: {
    id: string
    name: string
    keyPrefix: string
    scopes: string[]
    lastUsedAt: string | null
    createdAt: string
    revokedAt: string | null
  }[]
  canManage: boolean
}) {
  const [state, action, pending] = useActionState<DeveloperActionState, FormData>(createApiKey, null)
  const [revokeState, revoke] = useActionState<DeveloperActionState, FormData>(revokeApiKey, null)
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const secret = state?.ok && state.secret && !dismissed ? state.secret : null

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">API keys</h2>
          <p className="mt-0.5 max-w-lg text-xs leading-relaxed text-muted">
            For reading your workspace from your own tools. A key only reaches the workspace it
            was made in, and only the things you tick below.
          </p>
        </div>
        {canManage && !open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90"
          >
            New key
          </button>
        ) : null}
      </div>

      {secret ? <SecretReveal secret={secret} onDismiss={() => { setDismissed(true); setOpen(false) }} /> : null}

      {open && !secret ? (
        <form action={action} className="clay space-y-4 p-4">
          <div>
            <label htmlFor="keyName" className="block text-xs font-semibold text-ink">Name</label>
            <input
              id="keyName" name="name" required placeholder="Zapier — production"
              className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus-visible:border-accent"
            />
            <p className="mt-1 text-xs text-muted">So you can tell it apart later.</p>
          </div>

          <fieldset>
            <legend className="text-xs font-semibold text-ink">What it may access</legend>
            {/*
              ⚠️ READ AND WRITE ARE SEPARATE CHECKBOXES, per resource. One
              "access" toggle would mean an integration that only needs to read
              contacts could also delete them — and most only ever read.
            */}
            <div className="mt-2 space-y-1.5">
              {SCOPE_GROUPS.map((group) => (
                <div key={group.resource} className="flex items-center gap-4 text-sm">
                  <span className="w-32 text-muted">{group.label}</span>
                  {(['read', 'write'] as const).map((mode) => (
                    <label key={mode} className="flex items-center gap-1.5 text-xs text-ink">
                      <input
                        type="checkbox" name="scopes"
                        value={`${group.resource}:${mode}`}
                        className="accent-[var(--accent)]"
                      />
                      {mode}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </fieldset>

          {state && !state.ok ? (
            <p role="alert" className="rounded-[var(--radius-md)] bg-danger-soft px-3 py-2 text-xs text-danger">
              {state.error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="submit" disabled={pending}
              className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
            >
              {pending ? 'Creating…' : 'Create key'}
            </button>
            <button
              type="button" onClick={() => setOpen(false)}
              className="rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {keys.length === 0 ? (
        <p className="text-sm text-muted">No keys yet.</p>
      ) : (
        <div className="clay overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted">
                <th scope="col" className="px-4 py-3 font-semibold">Name</th>
                <th scope="col" className="px-4 py-3 font-semibold">Key</th>
                <th scope="col" className="px-4 py-3 font-semibold">Access</th>
                <th scope="col" className="px-4 py-3 font-semibold">Last used</th>
                <th scope="col" className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 font-semibold text-ink">
                    {key.name}
                    {key.revokedAt ? (
                      <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                        revoked
                      </span>
                    ) : null}
                  </td>
                  {/* Enough to identify, nowhere near enough to reconstruct. */}
                  <td className="px-4 py-3 font-mono text-xs text-muted">{key.keyPrefix}…</td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {key.scopes.length === 0 ? 'nothing' : key.scopes.join(', ')}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {/* "Never" is the useful answer: an unused key is one to revoke. */}
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canManage && !key.revokedAt ? (
                      <form action={revoke}>
                        <input type="hidden" name="keyId" value={key.id} />
                        <button
                          type="submit"
                          className="rounded-[var(--radius-md)] px-2 py-1 text-xs font-semibold text-danger transition-colors duration-150 hover:bg-danger-soft"
                        >
                          Revoke
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {revokeState ? (
        <p className={revokeState.ok ? 'text-xs text-success' : 'text-xs text-danger'}>
          {revokeState.ok ? revokeState.message : revokeState.error}
        </p>
      ) : null}
    </section>
  )
}

export function Webhooks({
  subscriptions,
  deliveries,
  canManage,
}: {
  subscriptions: {
    id: string
    name: string
    url: string
    events: string[]
    isActive: boolean
    failureCount: number
    disabledReason: string | null
  }[]
  deliveries: {
    id: string
    eventType: string
    status: string
    attempts: number
    lastStatusCode: number | null
    lastError: string | null
    createdAt: string
  }[]
  canManage: boolean
}) {
  const [state, action, pending] = useActionState<DeveloperActionState, FormData>(createWebhook, null)
  const [toggleState, toggle] = useActionState<DeveloperActionState, FormData>(setWebhookActive, null)
  const [removeState, remove] = useActionState<DeveloperActionState, FormData>(deleteWebhook, null)
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const secret = state?.ok && state.secret && !dismissed ? state.secret : null
  const notice = toggleState ?? removeState

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">Webhooks</h2>
          <p className="mt-0.5 max-w-lg text-xs leading-relaxed text-muted">
            Outlio posts to your endpoint when something happens. Every delivery is signed, and
            retried with a growing gap if your endpoint is down.
          </p>
        </div>
        {canManage && !open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90"
          >
            Add endpoint
          </button>
        ) : null}
      </div>

      {secret ? <SecretReveal secret={secret} onDismiss={() => { setDismissed(true); setOpen(false) }} /> : null}

      {open && !secret ? (
        <form action={action} className="clay space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="hookName" className="block text-xs font-semibold text-ink">Name</label>
              <input
                id="hookName" name="name" required placeholder="Ops Slack relay"
                className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus-visible:border-accent"
              />
            </div>
            <div>
              <label htmlFor="hookUrl" className="block text-xs font-semibold text-ink">URL</label>
              <input
                id="hookUrl" name="url" required type="url" placeholder="https://example.com/hooks/outlio"
                className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus-visible:border-accent"
              />
              <p className="mt-1 text-xs text-muted">Must be https and publicly reachable.</p>
            </div>
          </div>

          <fieldset>
            <legend className="text-xs font-semibold text-ink">Events</legend>
            <p className="mt-0.5 text-xs text-muted">Tick none to receive everything.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {WEBHOOK_EVENTS.map((event) => (
                <label
                  key={event}
                  className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-2 py-1 text-xs text-ink"
                >
                  <input type="checkbox" name="events" value={event} className="accent-[var(--accent)]" />
                  {event}
                </label>
              ))}
            </div>
          </fieldset>

          {state && !state.ok ? (
            <p role="alert" className="rounded-[var(--radius-md)] bg-danger-soft px-3 py-2 text-xs text-danger">
              {state.error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="submit" disabled={pending}
              className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
            >
              {pending ? 'Saving…' : 'Add endpoint'}
            </button>
            <button
              type="button" onClick={() => setOpen(false)}
              className="rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {subscriptions.length === 0 ? (
        <p className="text-sm text-muted">No endpoints yet.</p>
      ) : (
        <div className="space-y-2">
          {subscriptions.map((sub) => (
            <div key={sub.id} className="clay space-y-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{sub.name}</span>
                    {!sub.isActive ? (
                      <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                        paused
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted">{sub.url}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {sub.events.length === 0 ? 'All events' : `${sub.events.length} events`}
                  </p>
                </div>

                {canManage ? (
                  <div className="flex items-center gap-1">
                    <form action={toggle}>
                      <input type="hidden" name="subscriptionId" value={sub.id} />
                      <input type="hidden" name="active" value={String(!sub.isActive)} />
                      <button
                        type="submit"
                        className="rounded-[var(--radius-md)] border border-border px-2 py-1 text-xs font-semibold text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink"
                      >
                        {sub.isActive ? 'Pause' : 'Enable'}
                      </button>
                    </form>
                    <form action={remove}>
                      <input type="hidden" name="subscriptionId" value={sub.id} />
                      <button
                        type="submit"
                        className="rounded-[var(--radius-md)] px-2 py-1 text-xs font-semibold text-danger transition-colors duration-150 hover:bg-danger-soft"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                ) : null}
              </div>

              {/*
                ⚠️ THE DISABLE REASON IS SHOWN IN FULL. A subscription switched
                off after repeated failures, with no explanation, looks like the
                product losing their configuration.
              */}
              {sub.disabledReason ? (
                <p className="rounded-[var(--radius-md)] bg-warning-soft px-3 py-2 text-xs leading-relaxed text-warning">
                  {sub.disabledReason}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {notice ? (
        <p className={notice.ok ? 'text-xs text-success' : 'text-xs text-danger'}>
          {notice.ok ? notice.message : notice.error}
        </p>
      ) : null}

      {/*
        ⚠️ THE DELIVERY LOG IS PART OF THE FEATURE, not a debug view. Without
        it a customer whose endpoint is quietly rejecting everything has no way
        to find out.
      */}
      {deliveries.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            Recent deliveries
          </h3>
          <div className="clay overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Event</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Result</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Tries</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">When</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 font-mono text-xs text-ink">{d.eventType}</td>
                    <td className="px-4 py-2.5 text-xs">
                      <span
                        className={
                          d.status === 'delivered'
                            ? 'text-success'
                            : d.status === 'pending'
                              ? 'text-muted'
                              : 'text-danger'
                        }
                      >
                        {d.status}
                        {d.lastStatusCode ? ` (${d.lastStatusCode})` : ''}
                      </span>
                      {d.lastError ? (
                        <span className="block text-muted">{d.lastError}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">{d.attempts}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">
                      {new Date(d.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  )
}
