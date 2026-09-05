'use client'

/**
 * Building an ICP profile (spec §18).
 *
 * A criterion is: a field, an operator, a value, a weight, and whether it is
 * required, preferred, or excluded. Nothing here computes a score — that is
 * deterministic arithmetic on the server, and this screen only captures what
 * the arithmetic should use.
 *
 * The field list is the research vocabulary, so a criterion on a protected
 * characteristic cannot be expressed at all. That is enforced by a CHECK
 * constraint in the database too — this dropdown is convenience, not the
 * boundary.
 */
import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'

import {
  createProfileAction,
  deleteProfileAction,
  type ProfileActionState,
} from '@/lib/qualification/actions'
import { valueHint } from '@/lib/qualification/parse'
import { CRITERION_OPERATORS, type CriterionOperator } from '@/lib/qualification/score'
import { RESEARCH_FIELDS } from '@/lib/intelligence/types'

const INITIAL: ProfileActionState = { status: 'idle' }

type DraftCriterion = {
  key: string
  field: string
  operator: CriterionOperator
  kind: 'required' | 'preferred' | 'excluded'
  weight: number
  rawValue: string
}

const OPERATOR_LABELS: Record<CriterionOperator, string> = {
  equals: 'is',
  not_equals: 'is not',
  in: 'is one of',
  not_in: 'is none of',
  between: 'is between',
  gte: 'is at least',
  lte: 'is at most',
  contains: 'includes',
  not_contains: 'does not include',
  exists: 'is known',
}

const KIND_LABELS = {
  required: 'Required — failing disqualifies',
  preferred: 'Preferred — adds to the score',
  excluded: 'Excluded — matching disqualifies',
} as const

function fieldLabel(field: string): string {
  return field.replace(/_/g, ' ')
}

function newCriterion(): DraftCriterion {
  return {
    key: Math.random().toString(36).slice(2),
    field: 'industry',
    operator: 'contains',
    kind: 'preferred',
    weight: 20,
    rawValue: '',
  }
}

export type ExistingProfile = {
  id: string
  name: string
  qualifyAt: number
  criteria: Array<{ field: string; operator: string; kind: string; weight: number }>
}

export function ProfileManager({ profiles }: { profiles: ExistingProfile[] }) {
  const [state, action] = useActionState(createProfileAction, INITIAL)
  const [name, setName] = useState('')
  const [qualifyAt, setQualifyAt] = useState(60)
  const [criteria, setCriteria] = useState<DraftCriterion[]>([newCriterion()])

  const totalWeight = criteria
    .filter((criterion) => criterion.kind !== 'excluded')
    .reduce((sum, criterion) => sum + criterion.weight, 0)

  function update(key: string, patch: Partial<DraftCriterion>) {
    setCriteria((prev) =>
      prev.map((criterion) => (criterion.key === key ? { ...criterion, ...patch } : criterion)),
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-sm)]">
        <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">New profile</h2>
        <p className="mt-1 text-sm text-muted">
          Criteria are scored deterministically. A company Outlio could not research
          is never counted as failing — it is reported as unchecked.
        </p>

        <form action={action} className="mt-5 space-y-5">
          <input
            type="hidden"
            name="profile"
            value={JSON.stringify({ name, qualifyAt, criteria })}
          />

          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div>
              <label htmlFor="profile-name" className="text-xs font-medium text-muted">
                Name
              </label>
              <input
                id="profile-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Seed SaaS ICP"
                maxLength={120}
                className="mt-1 h-10 w-full rounded-[var(--radius-md)] border border-border bg-paper px-3 text-sm text-ink outline-none/50"
              />
            </div>
            <div>
              <label htmlFor="qualify-at" className="text-xs font-medium text-muted">
                Qualifies at or above
              </label>
              <input
                id="qualify-at"
                type="number"
                min={0}
                max={100}
                value={qualifyAt}
                onChange={(event) => setQualifyAt(Number(event.target.value))}
                className="mt-1 h-10 w-full rounded-[var(--radius-md)] border border-border bg-paper px-3 text-sm text-ink outline-none/50"
              />
            </div>
          </div>

          <div className="space-y-3">
            {criteria.map((criterion) => (
              <div
                key={criterion.key}
                className="rounded-[var(--radius-lg)] border border-border bg-surface-muted/40 p-3"
              >
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
                  <select
                    aria-label="Field"
                    value={criterion.field}
                    onChange={(event) => update(criterion.key, { field: event.target.value })}
                    className="h-9 rounded-[var(--radius-md)] border border-border bg-paper px-2 text-sm text-ink"
                  >
                    {RESEARCH_FIELDS.map((field) => (
                      <option key={field} value={field}>
                        {fieldLabel(field)}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Comparison"
                    value={criterion.operator}
                    onChange={(event) =>
                      update(criterion.key, { operator: event.target.value as CriterionOperator })
                    }
                    className="h-9 rounded-[var(--radius-md)] border border-border bg-paper px-2 text-sm text-ink"
                  >
                    {CRITERION_OPERATORS.map((operator) => (
                      <option key={operator} value={operator}>
                        {OPERATOR_LABELS[operator]}
                      </option>
                    ))}
                  </select>

                  <input
                    aria-label="Value"
                    value={criterion.rawValue}
                    onChange={(event) => update(criterion.key, { rawValue: event.target.value })}
                    disabled={criterion.operator === 'exists'}
                    placeholder={valueHint(criterion.operator)}
                    className="h-9 rounded-[var(--radius-md)] border border-border bg-paper px-2 text-sm text-ink outline-none/50 disabled:opacity-50"
                  />
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <select
                    aria-label="Importance"
                    value={criterion.kind}
                    onChange={(event) =>
                      update(criterion.key, { kind: event.target.value as DraftCriterion['kind'] })
                    }
                    className="h-8 rounded-[var(--radius-md)] border border-border bg-paper px-2 text-xs text-ink"
                  >
                    {Object.entries(KIND_LABELS).map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>

                  {criterion.kind !== 'excluded' ? (
                    <label className="flex items-center gap-2 text-xs text-muted">
                      Weight
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={criterion.weight}
                        onChange={(event) =>
                          update(criterion.key, { weight: Number(event.target.value) })
                        }
                        className="h-8 w-16 rounded-[var(--radius-md)] border border-border bg-paper px-2 text-xs text-ink"
                      />
                    </label>
                  ) : null}

                  {criteria.length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setCriteria((prev) => prev.filter((item) => item.key !== criterion.key))
                      }
                      className="ml-auto text-xs text-danger hover:underline"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setCriteria((prev) => [...prev, newCriterion()])}
              disabled={criteria.length >= 20}
              className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-border px-3 text-sm text-ink hover:border-border-strong disabled:opacity-60"
            >
              Add criterion
            </button>

            <p className="text-xs text-muted">
              {/*
                Weights are relative, not a budget. Saying so avoids the natural
                assumption that they must add to 100 before the profile is valid.
              */}
              Scored weight: {totalWeight}. Weights are relative — they do not need
              to add up to 100.
            </p>

            <SaveButton disabled={!name.trim() || criteria.length === 0} />
          </div>

          {state.status !== 'idle' ? (
            <p
              role="status"
              className={
                state.status === 'error'
                  ? 'rounded-[var(--radius-md)] border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger'
                  : 'rounded-[var(--radius-md)] border border-success/30 bg-success-soft px-3 py-2 text-sm text-success'
              }
            >
              {state.message}
            </p>
          ) : null}
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">Saved profiles</h2>

        {profiles.length === 0 ? (
          <p className="rounded-[var(--radius-lg)] border border-dashed border-border bg-surface-muted/40 p-8 text-center text-sm text-muted">
            No profiles yet. Create one above to score research runs against it.
          </p>
        ) : (
          <ul className="space-y-2">
            {profiles.map((profile) => (
              <li
                key={profile.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-border bg-panel px-4 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-ink">{profile.name}</p>
                  <p className="text-xs text-muted">
                    {profile.criteria.length} criteria · qualifies at {profile.qualifyAt}
                  </p>
                </div>
                <DeleteProfile profileId={profile.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className="product-gradient ml-auto inline-flex h-9 items-center rounded-[var(--radius-md)] px-4 text-sm font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Save profile'}
    </button>
  )
}

function DeleteProfile({ profileId }: { profileId: string }) {
  const [, action] = useActionState(deleteProfileAction, INITIAL)
  return (
    <form action={action}>
      <input type="hidden" name="profile_id" value={profileId} />
      <button
        type="submit"
        className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs text-ink transition-colors duration-150 hover:border-danger/40 hover:text-danger"
      >
        Delete
      </button>
    </form>
  )
}
