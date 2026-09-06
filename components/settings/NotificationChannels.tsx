'use client'

import { useActionState, useState } from 'react'

import {
  createChannel,
  deleteChannel,
  setChannelActive,
  testChannel,
  type ChannelActionState,
} from '@/app/(product)/dashboard/settings/notifications/actions'
import { CHANNEL_SETUP, NOTIFIABLE_EVENTS, type ChannelProvider } from '@/lib/notifications/format'

export type ChannelRow = {
  id: string
  name: string
  provider: ChannelProvider
  /**
   * ⚠️ THE HOST ONLY. The full URL is a credential — anyone holding a Slack
   * incoming-webhook URL can post into that channel as the app — so it is never
   * sent to the browser. The host is enough to recognise which is which.
   */
  host: string
  events: string[]
  isActive: boolean
  failureCount: number
  lastError: string | null
  lastSentAt: string | null
}

function Feedback({ state }: { state: ChannelActionState }) {
  if (!state) return null
  return (
    <p role="status" aria-live="polite" className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>
      {state.ok ? state.message : state.error}
    </p>
  )
}

function AddChannel() {
  const [provider, setProvider] = useState<ChannelProvider>('slack')
  const [state, action, pending] = useActionState<ChannelActionState, FormData>(createChannel, null)

  return (
    <form action={action} className="clay space-y-4 p-4">
      <div className="flex gap-2">
        {(Object.keys(CHANNEL_SETUP) as ChannelProvider[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setProvider(value)}
            aria-pressed={provider === value}
            className={`rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
              provider === value
                ? 'bg-accent text-cream'
                : 'bg-surface-muted text-muted hover:text-ink'
            }`}
          >
            {CHANNEL_SETUP[value].label}
          </button>
        ))}
      </div>
      <input type="hidden" name="provider" value={provider} />

      {/* The setup steps differ enough per provider to be worth showing inline. */}
      <p className="text-xs leading-relaxed text-muted">{CHANNEL_SETUP[provider].help}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-ink">Name</span>
          <input
            name="name"
            required
            maxLength={120}
            placeholder="#sales"
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink">Webhook URL</span>
          <input
            name="url"
            type="url"
            required
            // Not `type="password"`: it is pasted once and never shown again,
            // and masking it makes a mispaste impossible to spot.
            placeholder={provider === 'slack' ? 'https://hooks.slack.com/services/…' : 'https://…logic.azure.com/…'}
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 font-mono text-xs text-ink"
          />
        </label>
      </div>

      <fieldset>
        <legend className="text-xs font-medium text-ink">Tell this channel about</legend>
        <p className="mt-0.5 text-xs text-muted">
          Leave everything unticked to send all of them. Notifications carry the fact and a
          link — never the contents of a message.
        </p>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {NOTIFIABLE_EVENTS.map((event) => (
            <label key={event.value} className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" name="events" value={event.value} className="accent-[var(--color-accent)]" />
              {event.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Adding…' : 'Add channel'}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  )
}

function ChannelCard({ channel, canManage }: { channel: ChannelRow; canManage: boolean }) {
  const [testState, test, testing] = useActionState<ChannelActionState, FormData>(testChannel, null)
  const [toggleState, toggle] = useActionState<ChannelActionState, FormData>(setChannelActive, null)
  const [removeState, remove] = useActionState<ChannelActionState, FormData>(deleteChannel, null)

  const subscribed = channel.events.length === 0
    ? 'Everything'
    : NOTIFIABLE_EVENTS.filter((e) => channel.events.includes(e.value))
        .map((e) => e.label)
        .join(', ')

  return (
    <li className="clay space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {channel.name}
            <span className="ml-2 text-xs font-normal text-muted">
              {CHANNEL_SETUP[channel.provider].label}
            </span>
          </p>
          <p className="mt-0.5 truncate font-mono text-xs text-muted">{channel.host}</p>
          <p className="mt-1 text-xs text-muted">{subscribed}</p>
        </div>

        <span
          className={`rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-medium ${
            channel.isActive ? 'bg-success-soft text-success' : 'bg-surface-muted text-muted'
          }`}
        >
          {channel.isActive ? 'Active' : 'Paused'}
        </span>
      </div>

      {/*
        ⚠️ THE FAILURE IS SHOWN, not swallowed. A notification channel that has
        quietly stopped working is indistinguishable from nothing happening,
        which is the worst possible failure for a feature whose entire job is to
        tell you something happened.
      */}
      {channel.lastError ? (
        <p className="rounded-[var(--radius-md)] bg-danger-soft px-3 py-2 text-xs text-danger">
          Last attempt failed: {channel.lastError}
          {channel.failureCount > 1 ? ` (${channel.failureCount} in a row)` : ''}
        </p>
      ) : channel.lastSentAt ? (
        <p className="text-xs text-muted">
          Last sent {new Date(channel.lastSentAt).toLocaleString()}
        </p>
      ) : (
        <p className="text-xs text-muted">Nothing sent yet.</p>
      )}

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <form action={test}>
            <input type="hidden" name="channelId" value={channel.id} />
            <button
              type="submit"
              disabled={testing}
              className="rounded-[var(--radius-md)] bg-surface-muted px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
            >
              {testing ? 'Sending…' : 'Send a test'}
            </button>
          </form>

          <form action={toggle}>
            <input type="hidden" name="channelId" value={channel.id} />
            <input type="hidden" name="active" value={channel.isActive ? 'false' : 'true'} />
            <button
              type="submit"
              className="rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
            >
              {channel.isActive ? 'Pause' : 'Enable'}
            </button>
          </form>

          <form action={remove}>
            <input type="hidden" name="channelId" value={channel.id} />
            <button
              type="submit"
              className="rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium text-danger transition-colors duration-150 hover:opacity-80"
            >
              Remove
            </button>
          </form>

          <Feedback state={testState ?? toggleState ?? removeState} />
        </div>
      ) : null}
    </li>
  )
}

export function NotificationChannels({
  channels,
  canManage,
}: {
  channels: ChannelRow[]
  canManage: boolean
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-ink">Slack and Teams</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Get told in a channel when something happens. Each notification carries the fact and a
          link back to Outlio — never the contents of a message, since a channel may include
          people without access to the record.
        </p>
      </div>

      {channels.length === 0 ? (
        <p className="clay p-6 text-center text-sm text-muted">
          No channels yet. Add one below and nothing else changes until you do.
        </p>
      ) : (
        <ul className="space-y-3">
          {channels.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} canManage={canManage} />
          ))}
        </ul>
      )}

      {canManage ? (
        <AddChannel />
      ) : (
        <p className="text-xs text-muted">
          Only workspace admins can add or change notification channels.
        </p>
      )}
    </section>
  )
}
