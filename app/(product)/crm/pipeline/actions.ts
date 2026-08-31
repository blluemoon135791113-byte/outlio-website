'use server'

/**
 * Pipeline management actions — R5.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS FILE IS THE FIX FOR "I CANNOT CREATE A PIPELINE".                  ║
 * ║                                                                           ║
 * ║  `createPipeline` shipped with M3 and nothing ever called it. A workspace ║
 * ║  therefore had no pipeline, the board showed an empty state with no way   ║
 * ║  out, and the onboarding checklist sent people to that dead end.          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { revalidatePath } from 'next/cache'

import {
  archivePipeline,
  createPipeline,
  renamePipeline,
  setDefaultPipeline,
  type StageInput,
} from '@/lib/crm/opportunities'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type PipelineActionState =
  | { ok: true; message: string; pipelineId?: string }
  | { ok: false; error: string }
  | null

const PATH = '/crm/pipeline'

/**
 * ⚠️ A STARTING POINT, NOT A HARDCODED METHODOLOGY. The brief is explicit that
 * no single sales process may be baked in — so these are prefilled into an
 * editable form rather than created behind the customer's back. Someone
 * selling differently deletes them; someone who does not want to think about
 * it on day one gets a working board.
 */
export const SUGGESTED_STAGES: StageInput[] = [
  { name: 'New', kind: 'open', defaultProbability: 10 },
  { name: 'Contacted', kind: 'open', defaultProbability: 25 },
  { name: 'Qualified', kind: 'open', defaultProbability: 50 },
  { name: 'Proposal', kind: 'open', defaultProbability: 75 },
  { name: 'Won', kind: 'won', defaultProbability: 100 },
  { name: 'Lost', kind: 'lost', defaultProbability: 0 },
]

export async function createPipelineAction(
  _previous: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.pipeline.manage')
  } catch {
    return { ok: false, error: 'Only a manager can set up pipelines.' }
  }

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { ok: false, error: 'Give the pipeline a name.' }

  /*
   * Stages arrive as parallel arrays from the form. Zipping them here keeps
   * ORDER as the single source of position — `createPipeline` derives
   * `sort_order` from array index, so there is no second field to keep
   * consistent with it.
   */
  const names = formData.getAll('stageName').map(String)
  const kinds = formData.getAll('stageKind').map(String)
  const probabilities = formData.getAll('stageProbability').map(String)

  const stages: StageInput[] = names
    .map((stageName, i) => ({
      name: stageName.trim(),
      kind: (kinds[i] === 'won' || kinds[i] === 'lost' ? kinds[i] : 'open') as StageInput['kind'],
      defaultProbability: Math.min(Math.max(Number(probabilities[i] ?? 0) || 0, 0), 100),
    }))
    .filter((s) => s.name.length > 0)

  if (stages.length === 0) {
    return { ok: false, error: 'A pipeline needs at least one stage.' }
  }

  /*
   * ⚠️ A BOARD WITH NO CLOSING STAGE CAN NEVER RECORD A WON DEAL, and every
   * revenue report reads from won stages. Catching it here is far kinder than
   * letting someone discover it after a quarter of use.
   */
  if (!stages.some((s) => s.kind === 'won')) {
    return {
      ok: false,
      error: 'Mark one stage as Won, or no deal in this pipeline can ever be closed.',
    }
  }

  try {
    const pipelineId = await createPipeline(
      ctx.workspace.id,
      // The first pipeline in a workspace becomes the default automatically —
      // otherwise the board has nothing to open and looks broken again.
      { name, stages, isDefault: formData.get('makeDefault') === 'true' },
      ctx.userId,
    )

    revalidatePath(PATH)
    revalidatePath('/dashboard')
    return { ok: true, message: `${name} is ready.`, pipelineId }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('already has a default')) {
      return { ok: false, error: 'This workspace already has a default pipeline.' }
    }
    return { ok: false, error: 'Could not create that pipeline.' }
  }
}

export async function renamePipelineAction(
  _previous: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  try {
    const ctx = await assertWorkspacePermission('crm.pipeline.manage')
    const name = String(formData.get('name') ?? '').trim()
    if (!name) return { ok: false, error: 'Give the pipeline a name.' }

    await renamePipeline(ctx.workspace.id, String(formData.get('pipelineId') ?? ''), name)
    revalidatePath(PATH)
    return { ok: true, message: 'Renamed.' }
  } catch {
    return { ok: false, error: 'Could not rename that pipeline.' }
  }
}

export async function archivePipelineAction(
  _previous: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  try {
    const ctx = await assertWorkspacePermission('crm.pipeline.manage')
    await archivePipeline(ctx.workspace.id, String(formData.get('pipelineId') ?? ''))

    revalidatePath(PATH)
    // Says plainly that nothing was destroyed — the fear about archiving is
    // that the deals go with it.
    return { ok: true, message: 'Archived. Its deals and their history are kept.' }
  } catch {
    return { ok: false, error: 'Could not archive that pipeline.' }
  }
}

export async function setDefaultPipelineAction(
  _previous: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  try {
    const ctx = await assertWorkspacePermission('crm.pipeline.manage')
    await setDefaultPipeline(ctx.workspace.id, String(formData.get('pipelineId') ?? ''))

    revalidatePath(PATH)
    return { ok: true, message: 'This is now the pipeline the board opens on.' }
  } catch {
    return { ok: false, error: 'Could not change the default.' }
  }
}
