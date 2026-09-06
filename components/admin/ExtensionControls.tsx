'use client'

import { useActionState } from 'react'

import {
  adminRevokeAllDevicesAction,
  adminRevokeDeviceAction,
  setExtensionAccessAction,
  type AdminActionState,
  type ExtensionUsage,
} from '@/lib/admin/extension-actions'

const INITIAL: AdminActionState = { status: 'idle' }

export type ExtensionDevice = {
  id: string
  label: string
  browser: string | null
  platform: string | null
  lastActiveAt: string | null
}

/**
 * Per-account extension administration.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ALL FOUR OF THESE WERE WRITTEN, ADMIN-GATED, AUDITED — AND CALLED FROM   ║
 * ║  NOWHERE.                                                                 ║
 * ║                                                                           ║
 * ║  Access could be granted and revoked, a single browser disconnected or    ║
 * ║  all of them at once, each writing an `admin_audit_logs` row. `/admin`    ║
 * ║  rendered none of it, so the only way to disconnect a lost or shared      ║
 * ║  browser was a hand-written SQL statement.                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ PRESENTATION ONLY. Every action calls `assertAdmin()` itself and consumes
 * an admin rate limit. This component being on an admin-gated page is not what
 * makes it safe.
 */
export function ExtensionControls({
  userId,
  enabled,
  usage,
  devices,
}: {
  userId: string
  enabled: boolean
  usage: ExtensionUsage
  devices: ExtensionDevice[]
}) {
  return (
    <div className="space-y-3">
      <Usage usage={usage} />
      <AccessToggle userId={userId} enabled={enabled} />
      {devices.length > 0 ? <Devices userId={userId} devices={devices} /> : null}
    </div>
  )
}

function Usage({ usage }: { usage: ExtensionUsage }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
      {[
        ['Browsers', String(usage.devices)],
        ['Sessions', String(usage.sessions)],
        ['Pages', String(usage.pagesProcessed)],
        ['Leads', String(usage.leadsImported)],
        [
          'Last active',
          // Absent is stated, not blanked — "never" and "we did not load it"
          // look identical as an empty cell.
          usage.lastActiveAt ? new Date(usage.lastActiveAt).toLocaleString() : 'Never',
        ],
      ].map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-1.5">
          <dt className="text-muted">{label}</dt>
          <dd className="font-medium text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function AccessToggle({ userId, enabled }: { userId: string; enabled: boolean }) {
  const [state, action, pending] = useActionState(setExtensionAccessAction, INITIAL)

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="user_id" value={userId} />
      {/*
        ⚠️ THE VALUE IS THE OPPOSITE OF THE CURRENT STATE. The action reads
        `enabled` as an absolute, not a toggle, so submitting the state it is
        already in is a no-op that looks like a broken button.
      */}
      <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />

      <span className="flex items-center gap-2 text-xs">
        <span
          aria-hidden="true"
          className={`inline-block size-2 shrink-0 rounded-full ${
            enabled ? 'bg-success' : 'bg-danger'
          }`}
        />
        <span className="text-muted">
          Extension is {enabled ? 'enabled' : 'disabled'} for this account
        </span>
      </span>

      <button
        type="submit"
        disabled={pending}
        className={`rounded-[var(--radius-md)] border px-3 py-1.5 text-xs font-semibold transition-colors duration-150 disabled:opacity-60 ${
          enabled
            ? 'border-border-strong text-danger hover:bg-surface-muted'
            : 'border-border-strong text-ink hover:bg-surface-muted'
        }`}
      >
        {pending ? 'Saving…' : enabled ? 'Disable extension' : 'Enable extension'}
      </button>

      <Feedback state={state} />
    </form>
  )
}

function Devices({ userId, devices }: { userId: string; devices: ExtensionDevice[] }) {
  const [allState, allAction, revokingAll] = useActionState(
    adminRevokeAllDevicesAction,
    INITIAL,
  )

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-lg)] border border-border">
        {devices.map((device) => (
          <DeviceRow key={device.id} userId={userId} device={device} />
        ))}
      </ul>

      {devices.length > 1 ? (
        <form action={allAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="user_id" value={userId} />
          <button
            type="submit"
            disabled={revokingAll}
            className="rounded-[var(--radius-md)] px-2 py-1 text-xs font-semibold text-danger transition-colors duration-150 hover:underline disabled:opacity-60"
          >
            {revokingAll ? 'Disconnecting…' : `Disconnect all ${devices.length}`}
          </button>
          <Feedback state={allState} />
        </form>
      ) : null}
    </div>
  )
}

function DeviceRow({ userId, device }: { userId: string; device: ExtensionDevice }) {
  const [state, action, pending] = useActionState(adminRevokeDeviceAction, INITIAL)

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
      <span className="text-sm font-medium text-ink">{device.label}</span>
      <span className="text-xs text-muted">
        {[device.browser, device.platform].filter(Boolean).join(' · ') || 'Unknown browser'}
      </span>
      <span className="min-w-0 flex-1 text-xs text-muted">
        {device.lastActiveAt
          ? `Last active ${new Date(device.lastActiveAt).toLocaleString()}`
          : 'Never used'}
      </span>

      {/*
        ⚠️ NO CONFIRMATION HERE, DELIBERATELY, AND IT IS NOT AN OVERSIGHT.
        Revoking a device is how an admin responds to a lost or shared laptop —
        the urgent direction is ON, and it is reversible by pairing again. A
        confirmation step on the safe action is friction at the worst moment.
      */}
      <form action={action}>
        <input type="hidden" name="user_id" value={userId} />
        <input type="hidden" name="device_id" value={device.id} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] px-2 py-1 text-xs font-semibold text-danger transition-colors duration-150 hover:underline disabled:opacity-60"
        >
          {pending ? 'Disconnecting…' : 'Disconnect'}
        </button>
      </form>

      <Feedback state={state} />
    </li>
  )
}

function Feedback({ state }: { state: AdminActionState }) {
  if (state.status === 'idle') return null
  return (
    <p
      role="status"
      aria-live="polite"
      className={`text-xs ${state.status === 'error' ? 'text-danger' : 'text-success'}`}
    >
      {state.message}
    </p>
  )
}
