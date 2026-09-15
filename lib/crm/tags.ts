import 'server-only'

/**
 * Attaching a tag to a contact — the one implementation.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ EXTRACTED FROM `lib/flows/actions/crm.ts`, NOT COPIED ALONGSIDE IT.   ║
 * ║                                                                           ║
 * ║  Phase 20's `ADD_TAG` workflow step needs exactly what the flow engine's   ║
 * ║  `addTag` handler already does, and writing a second one would be this    ║
 * ║  repository's most expensive recurring defect — one question, two          ║
 * ║  implementations. The two would drift on the part that is easy to get      ║
 * ║  wrong: `crm_tags_name_uniq` is a PARTIAL unique index, so the obvious     ║
 * ║  `upsert` fails outright, and the select-then-insert it forces can lose a  ║
 * ║  race.                                                                     ║
 * ║                                                                           ║
 * ║  So the flow handler now adapts this, and the LinkedIn walker calls it.    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ NORMALISED, so "Hot Lead" and "hot lead" cannot become two tags that render
 * identically — the rule 0071 already encodes in `normalized_name`.
 *
 * ⚠️ EVERY QUERY SCOPES BY `workspace_id`. The service role bypasses RLS, and a
 * tag reached across tenants is one workspace writing into another's CRM.
 */
import { createAdminClient } from '@/lib/supabase/admin'

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = '23505'

export type TagResult =
  | { ok: true; tagId: string; name: string }
  | { ok: false; reason: 'no_tag' | 'failed'; message: string }

export function normalizeTagName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Ensures the tag exists in this workspace and that the contact carries it.
 *
 * ⚠️ ALREADY TAGGED IS SUCCESS, NOT AN ERROR. The desired state holds, and a
 * caller that treated it as a failure would retry forever — or, worse, report a
 * workflow step as failed when it had done exactly what it was asked.
 */
export async function ensureTagAttached(input: {
  workspaceId: string
  contactId: string
  name: string
}): Promise<TagResult> {
  const name = input.name.trim()
  if (!name) return { ok: false, reason: 'no_tag', message: 'No tag was configured.' }

  const db = createAdminClient()
  const normalized = normalizeTagName(name)

  /*
   * ⚠️ SELECT-THEN-INSERT, NOT UPSERT, AND THE REASON IS THE PARTIAL INDEX.
   * `crm_tags_name_uniq` carries `where deleted_at is null`, and
   * `on conflict (workspace_id, normalized_name)` cannot use a partial index
   * unless the statement repeats its predicate — Postgres answers "no unique or
   * exclusion constraint matching the ON CONFLICT specification" and the whole
   * write fails.
   */
  const existing = await db
    .from('crm_tags')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .eq('normalized_name', normalized)
    .is('deleted_at', null)
    .maybeSingle()

  let tag = existing.data

  if (!tag) {
    const created = await db
      .from('crm_tags')
      .insert({ workspace_id: input.workspaceId, name, normalized_name: normalized })
      .select('id')
      .single()

    if (created.error) {
      if (created.error.code !== UNIQUE_VIOLATION) {
        return { ok: false, reason: 'failed', message: 'Could not create the tag.' }
      }
      /*
       * ⚠️ THE RACE IS REAL AND IS HANDLED BY READING THE WINNER. Two workflows
       * tagging the same contact both pass the select; only one insert survives,
       * and the loser's job is still to attach the tag rather than to fail.
       */
      const raced = await db
        .from('crm_tags')
        .select('id')
        .eq('workspace_id', input.workspaceId)
        .eq('normalized_name', normalized)
        .is('deleted_at', null)
        .maybeSingle()
      if (!raced.data) {
        return { ok: false, reason: 'failed', message: 'Could not create the tag.' }
      }
      tag = raced.data
    } else {
      tag = created.data
    }
  }

  const { error: linkError } = await db
    .from('crm_contact_tags')
    .upsert(
      { workspace_id: input.workspaceId, contact_id: input.contactId, tag_id: tag.id },
      { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
    )

  if (linkError) {
    return { ok: false, reason: 'failed', message: 'Could not tag this contact.' }
  }

  return { ok: true, tagId: tag.id, name }
}
