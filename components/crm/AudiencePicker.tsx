'use client'

import Link from 'next/link'
import { useState } from 'react'

/**
 * Choosing who a campaign or sequence goes to.
 *
 * ⚠️ THE CHANNELS SHARE THIS, AND SHARE `resolveAudience` BEHIND IT. Email
 * enrolment and LinkedIn enrolment ask the same question; only what they do
 * with the answer differs. Two pickers would drift on the part that matters —
 * which source names which id field — and the drift would be invisible until
 * somebody enrolled the wrong people.
 *
 * ⚠️ IT RENDERS FIELDS, NOT A FORM. The caller owns the `<form>`, its action
 * and its submit button, because the two channels need different extra fields
 * around this (LinkedIn needs a sender and a topic; email needs neither).
 */

export type AudienceOption = { id: string; name: string; note?: string }

export type AudienceCatalogue = {
  lists: AudienceOption[]
  /** Stages, labelled with their pipeline so two "Qualified" stages are distinct. */
  stages: AudienceOption[]
  pipelines: AudienceOption[]
  /** Recent CSV imports, most recent first. */
  batches: AudienceOption[]
}

type Kind = 'list' | 'stage' | 'pipeline' | 'batch'

const LABELS: Record<Kind, { tab: string; empty: string; hint: string }> = {
  list: {
    tab: 'A list',
    empty: 'No lists yet. Create one on the Lists screen, then add contacts to it.',
    hint: 'Everyone on the list.',
  },
  stage: {
    tab: 'A pipeline stage',
    empty: 'No stages yet. Create a pipeline first.',
    // ⚠️ SAYS "OPEN", because `resolveAudience` takes open deals only and a
    // stage on an established pipeline has far more history than current work.
    hint: 'The contacts on the open deals sitting in that stage right now.',
  },
  pipeline: {
    tab: 'A whole pipeline',
    empty: 'No pipelines yet.',
    hint: 'The contacts on every open deal in that pipeline.',
  },
  batch: {
    // ⚠️ "IMPORT OR EXTRACTION", because `crm_lead_batches` holds both. Calling
    // this "a file you imported" would hide every Sales Navigator extraction
    // behind a label that says it is not there.
    tab: 'An import or extraction',
    empty: 'Nothing imported yet. Upload a CSV on the Import screen first.',
    hint: 'Everyone that batch brought in, including people already in your CRM.',
  },
}

export function AudiencePicker({
  catalogue,
  /** Rendered under the picker — the caller's own extra fields. */
  children,
}: {
  catalogue: AudienceCatalogue
  children?: React.ReactNode
}) {
  const available = (Object.keys(LABELS) as Kind[]).filter(
    (kind) => optionsFor(catalogue, kind).length > 0,
  )

  /*
   * ⚠️ DEFAULTS TO A TAB THAT HAS SOMETHING IN IT. Defaulting to `list` on a
   * workspace with no lists opens the picker on an empty state and makes the
   * whole panel look broken, when three other sources were ready.
   */
  const [kind, setKind] = useState<Kind>(available[0] ?? 'list')
  const [id, setId] = useState('')

  if (available.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm leading-relaxed text-muted">
          There is nothing to add from yet. Upload a file, create a list, or add deals
          to a pipeline — then come back and pick one here.
        </p>
        {/*
          ⚠️ A WAY OUT, NOT JUST A DIAGNOSIS. An empty state that names three
          things to go and do, and links to none of them, is the dead end the
          campaign page itself had before this panel existed.
        */}
        <div className="flex flex-wrap gap-3 text-xs font-medium">
          <Link href="/crm/import" className="text-accent underline underline-offset-2">
            Upload a file →
          </Link>
          <Link href="/crm/lists" className="text-accent underline underline-offset-2">
            Create a list →
          </Link>
        </div>
      </div>
    )
  }

  const options = optionsFor(catalogue, kind)
  const labels = LABELS[kind]

  return (
    <div className="space-y-3">
      <input type="hidden" name="audienceKind" value={kind} />

      {/*
        ⚠️ RADIOS, NOT A SELECT OF SELECTS. The source and the thing are two
        different questions, and collapsing them into one dropdown of every
        list, stage, pipeline and import produces a list where "Qualified" and
        "Warm leads" sit together with no way to tell what either is.
      */}
      <fieldset>
        <legend className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
          Add from
        </legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {available.map((option) => (
            <label
              key={option}
              className={`cursor-pointer rounded-[var(--radius-md)] border px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 ${
                kind === option
                  ? 'border-border-strong bg-surface-muted text-ink'
                  : 'border-border text-muted hover:text-ink'
              }`}
            >
              <input
                type="radio"
                name="audienceTab"
                className="sr-only"
                checked={kind === option}
                onChange={() => {
                  setKind(option)
                  // ⚠️ CLEARED ON SWITCH. A stage id left in the field while
                  // the kind says "list" submits a mismatched pair, and
                  // `resolveAudience` would refuse it with a confusing message
                  // about a list that does not exist.
                  setId('')
                }}
              />
              {LABELS[option].tab}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="sr-only">Choose which</span>
        <select
          name="audienceId"
          value={id}
          onChange={(event) => setId(event.target.value)}
          required
          className="w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink [color-scheme:light]"
        >
          <option value="">Choose…</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
              {option.note ? ` — ${option.note}` : ''}
            </option>
          ))}
        </select>
      </label>

      <p className="text-xs leading-relaxed text-muted">
        {options.length === 0 ? labels.empty : labels.hint}
      </p>

      {/*
        ╔═══════════════════════════════════════════════════════════════════════╗
        ║  ⚠️ "FROM MY COMPUTER" IS A LINK, NOT A SECOND UPLOAD FIELD.         ║
        ║                                                                       ║
        ║  A file picker here would be one click shorter and would have to      ║
        ║  reimplement the whole of `/crm/import`: header mapping, the          ║
        ║  content-hash re-upload check, contact-level de-duplication, the      ║
        ║  batch row, and undo. The part that would get skipped is the          ║
        ║  canonical-contact rule — so the same person, already in the CRM,     ║
        ║  would be added again as a second record, which is the one mistake    ║
        ║  the entire ingestion design exists to prevent.                       ║
        ║                                                                       ║
        ║  So an upload goes through the import screen and comes back here as   ║
        ║  a batch. One extra step, one ingestion path.                         ║
        ╚═══════════════════════════════════════════════════════════════════════╝
      */}
      {kind === 'batch' ? (
        <Link
          href="/crm/import"
          className="inline-block text-xs font-medium text-accent underline underline-offset-2"
        >
          Upload a file from your computer →
        </Link>
      ) : null}

      {children}
    </div>
  )
}

function optionsFor(catalogue: AudienceCatalogue, kind: Kind): AudienceOption[] {
  switch (kind) {
    case 'list':
      return catalogue.lists
    case 'stage':
      return catalogue.stages
    case 'pipeline':
      return catalogue.pipelines
    case 'batch':
      return catalogue.batches
  }
}
