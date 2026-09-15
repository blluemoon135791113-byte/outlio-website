'use client'

import { useActionState, useState } from 'react'

import {
  draftAction,
  saveProspectMessageAction,
  removeProspectMessageAction,
  type DraftState,
  type ProspectMessageState,
} from '@/app/(product)/linkedin/strategy-actions'
import { PLACEHOLDERS, PLACEHOLDER_SPECS } from '@/lib/linkedin/placeholders'

export type ProspectMessageCard = {
  kind: 'OPENER' | 'PITCH'
  body: string
  authorName: string | null
  updatedAt: string | null
}

const LABEL: Record<'OPENER' | 'PITCH', { title: string; help: string; purpose: string }> = {
  OPENER: {
    title: 'Opener',
    help: 'The first thing you would say to this person.',
    purpose: 'OPENER',
  },
  PITCH: {
    title: 'Pitch',
    help: 'What you would say once they reply.',
    purpose: 'PITCH',
  },
}

/**
 * The opener and pitch for one prospect — Phase 20.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS IS THE REP'S OWN STRATEGY, NOT THE CAMPAIGN'S COPY.              ║
 * ║                                                                           ║
 * ║  A workflow step's body goes to everybody in that campaign. These two are  ║
 * ║  what THIS rep decided to say to THIS person — and the difference between  ║
 * ║  two reps' openers is most of what the strategy analysis is reading.       ║
 * ║                                                                           ║
 * ║  ⚠️ NOTHING HERE SENDS. Writing an opener does not contact anybody; it     ║
 * ║  records what you intend to say.                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function ProspectMessages({
  contactId,
  messages,
}: {
  contactId: string
  messages: ProspectMessageCard[]
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted">
        What you plan to say to this person. Saving changes nothing on LinkedIn — it records
        your approach so the strategy analysis has something to read.
      </p>

      {(['OPENER', 'PITCH'] as const).map((kind) => (
        <MessageEditor
          key={kind}
          contactId={contactId}
          kind={kind}
          existing={messages.find((m) => m.kind === kind) ?? null}
        />
      ))}
    </div>
  )
}

function MessageEditor({
  contactId,
  kind,
  existing,
}: {
  contactId: string
  kind: 'OPENER' | 'PITCH'
  existing: ProspectMessageCard | null
}) {
  const spec = LABEL[kind]
  const [body, setBody] = useState(existing?.body ?? '')
  const [showAi, setShowAi] = useState(false)

  const [saveState, save, saving] = useActionState<ProspectMessageState, FormData>(
    saveProspectMessageAction,
    null,
  )
  const [removeState, remove, removing] = useActionState<ProspectMessageState, FormData>(
    removeProspectMessageAction,
    null,
  )
  const [draftState, draft, drafting] = useActionState<DraftState, FormData>(
    async (previous, formData) => {
      const result = await draftAction(previous, formData)
      /*
       * ⚠️ THE DRAFT LANDS IN THE TEXTAREA AND IS NOT SAVED. The rep is the
       * author: they read it, edit it, and press Save themselves. A button that
       * wrote a model's words straight into the record would make the byline on
       * this message false — and the analysis groups by author.
       */
      if (result?.ok) setBody(result.text)
      return result
    },
    null,
  )

  const state = saveState ?? removeState

  return (
    <div className="rounded-[var(--radius-md)] border border-line bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold text-ink">{spec.title}</h4>
        {existing?.authorName ? (
          /*
            ⚠️ THE AUTHOR IS SHOWN, because the analysis reports per rep and a
            message whose author is invisible here would appear in somebody
            else's column without explanation.
          */
          <span className="text-xs text-muted">by {existing.authorName}</span>
        ) : null}
      </div>
      <p className="mt-0.5 text-xs text-muted">{spec.help}</p>

      <form action={save} className="mt-2 space-y-2">
        <input type="hidden" name="contactId" value={contactId} />
        <input type="hidden" name="kind" value={kind} />

        <label className="block">
          <span className="sr-only">{spec.title}</span>
          <textarea
            name="body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={4}
            maxLength={8_000}
            placeholder={
              kind === 'OPENER'
                ? 'Hi {{first_name}} — saw you are in {{location}}…'
                : 'What you would say once they are interested…'
            }
            className="w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm leading-relaxed text-ink"
          />
        </label>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Insert:</span>
          {PLACEHOLDERS.map((name) => (
            <button
              key={name}
              type="button"
              title={PLACEHOLDER_SPECS[name].note}
              onClick={() => setBody((current) => `${current}{{${name}}}`)}
              className="rounded-full border border-line px-2 py-0.5 text-xs text-muted transition-colors duration-150 hover:border-accent hover:text-accent"
            >
              {PLACEHOLDER_SPECS[name].label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-medium text-cream transition-colors duration-150 hover:bg-accent-deep disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>

          <button
            type="button"
            onClick={() => setShowAi((open) => !open)}
            className="rounded-[var(--radius-md)] bg-surface-muted px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-150 hover:opacity-90"
          >
            {showAi ? 'Close' : 'Write with AI'}
          </button>

          {existing ? (
            <button
              type="submit"
              formAction={remove}
              disabled={removing}
              className="rounded-[var(--radius-md)] px-2 py-1 text-xs text-muted transition-colors duration-150 hover:text-danger disabled:opacity-60"
            >
              {removing ? 'Removing…' : 'Remove'}
            </button>
          ) : null}
        </div>
      </form>

      {showAi ? (
        <form action={draft} className="mt-3 space-y-2 border-t border-line pt-3">
          <input type="hidden" name="purpose" value={spec.purpose} />
          <input type="hidden" name="current" value={body} />

          <label className="block">
            <span className="text-xs font-medium text-ink">
              How do you want it written?
            </span>
            {/*
              ⚠️ REQUIRED, AND THE OWNER WAS EXPLICIT: "for that the user has to
              give input into ai on how he wants it written". A button that
              produces generic outreach from nothing is the feature they were
              careful to say they did not want — and `draftMessage` refuses an
              empty instruction server-side, so this is the hint rather than the
              rule.
            */}
            <input
              name="instruction"
              required
              maxLength={2_000}
              placeholder="Short and casual, lead with their city, no pitch yet"
              className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>

          {/*
            ⚠️ SAID PLAINLY, BECAUSE IT IS THE SURPRISING PART. Every comparable
            tool shows the model the prospect's profile. Outlio does not, and a
            rep who assumed otherwise would write an instruction like "mention
            their recent post" and get something invented.
          */}
          <p className="text-xs leading-relaxed text-muted">
            The AI is never shown this person&apos;s details — it writes a template using the
            placeholders above, and Outlio fills those in from what it has actually recorded.
          </p>

          <button
            type="submit"
            disabled={drafting}
            className="rounded-[var(--radius-md)] bg-surface-muted px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
          >
            {drafting ? 'Writing…' : 'Draft it'}
          </button>

          {draftState && !draftState.ok ? (
            <p role="alert" className="text-xs text-danger">
              {draftState.error}
            </p>
          ) : null}
          {draftState?.ok ? (
            <p role="status" className="text-xs text-muted">
              Draft placed above. Edit it, then press Save.
            </p>
          ) : null}
        </form>
      ) : null}

      {state && !state.ok ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="mt-2 text-xs text-muted">
          {state.message}
        </p>
      ) : null}
    </div>
  )
}
