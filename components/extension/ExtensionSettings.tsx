'use client'

import { useState, useTransition } from 'react'

import {
  revokeAllDevicesAction,
  revokeDeviceAction,
} from '@/app/(product)/dashboard/settings/extension-actions'
import type { ConnectedDevice } from '@/lib/extension/devices'

/** Store listings, or a developer-build note where none exists yet. */
export type StoreLinks = {
  chrome: string | null
  firefox: string | null
  safari: string | null
}

function relative(iso: string | null): string {
  if (!iso) return 'never'

  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function ExtensionSettings({
  devices,
  stores,
}: {
  devices: ConnectedDevice[]
  stores: StoreLinks
}) {
  const [pending, startTransition] = useTransition()
  const [notice, setNotice] = useState<string | null>(null)

  function revoke(deviceId: string) {
    startTransition(async () => {
      const result = await revokeDeviceAction({ deviceId })
      setNotice(result.message)
    })
  }

  function revokeAll() {
    startTransition(async () => {
      const result = await revokeAllDevicesAction()
      setNotice(result.message)
    })
  }

  const connected = devices.length > 0

  const installs: Array<[string, string | null]> = [
    ['Chrome', stores.chrome],
    ['Firefox', stores.firefox],
    ['Safari', stores.safari],
  ]

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={
              connected
                ? 'h-2 w-2 rounded-full bg-success'
                : 'h-2 w-2 rounded-full bg-border-strong'
            }
          />
          <p className="text-sm font-medium text-ink">
            {connected ? 'Connected' : 'Not connected'}
          </p>
        </div>
        <p className="mt-1 text-sm leading-6 text-muted">
          Capture leads straight from your browser — no HTML downloads, no manual uploads. Start a
          capture and pages you open are processed into your dashboard.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {installs.map(([name, href]) =>
          href ? (
            <a
              key={name}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-3.5 text-xs font-semibold text-ink transition-colors duration-150 hover:bg-surface-muted"
            >
              Install for {name}
            </a>
          ) : (
            <span
              key={name}
              title="Not yet published to this store"
              className="inline-flex h-9 cursor-default items-center rounded-[var(--radius-md)] border border-border bg-surface-muted px-3.5 text-xs font-semibold text-muted"
            >
              {name} — coming soon
            </span>
          ),
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-sm font-semibold text-ink">Connected browsers</h3>
          {connected ? (
            <button
              type="button"
              onClick={revokeAll}
              disabled={pending}
              className="text-xs font-semibold text-danger hover:underline disabled:opacity-60"
            >
              Disconnect all
            </button>
          ) : null}
        </div>

        {notice ? (
          <p role="status" className="mt-2 text-xs font-medium text-accent">
            {notice}
          </p>
        ) : null}

        {!connected ? (
          <p className="mt-3 rounded-[var(--radius-md)] border border-dashed border-border-strong bg-surface-muted/45 px-4 py-5 text-center text-sm text-muted">
            No browsers connected yet. Install the extension, then click Connect Account inside it.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-[var(--radius-md)] border border-border">
            {devices.map((device) => (
              <li key={device.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{device.label}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    Connected {shortDate(device.connectedAt)} · Last active{' '}
                    {relative(device.lastActiveAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => revoke(device.id)}
                  disabled={pending}
                  className="shrink-0 rounded-[var(--radius-md)] border border-border-strong px-3 py-1.5 text-xs font-semibold text-ink transition-colors duration-150 hover:bg-surface-muted disabled:opacity-60"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-xs leading-5 text-muted">
          Revoking stops that browser immediately — any capture in progress there will fail on its
          next page. The extension stays installed and can be reconnected at any time.
        </p>
      </div>
    </div>
  )
}
