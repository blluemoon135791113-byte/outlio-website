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

/*
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ NOTHING BUT `async function` MAY BE EXPORTED FROM THIS FILE.         ║
 * ║                                                                           ║
 * ║  A `SUGGESTED_STAGES` array was exported from here, and it took down the  ║
 * ║  entire pipeline page in production:                                      ║
 * ║                                                                           ║
 * ║    Error: A "use server" file can only export async functions,            ║
 * ║           found object.                                                   ║
 * ║                                                                           ║
 * ║  The failure is at MODULE EVALUATION, so it is not the export that        ║
 * ║  breaks — it is every action in the file, and every action reachable      ║
 * ║  from the same page. "New pipeline" and "New deal" both returned a 500    ║
 * ║  and crashed the page to a black error screen, and no row was written.    ║
 * ║                                                                           ║
 * ║  ⚠️ NOTHING CAUGHT IT. `tsc` is happy, ESLint is happy, `next build`      ║
 * ║  compiles and the page renders fine — the module is only evaluated when   ║
 * ║  an action is INVOKED. Every test passed because tests import the         ║
 * ║  functions directly, which is exactly what the runtime refuses to do.     ║
 * ║                                                                           ║
 * ║  The array had no importer anywhere, in this file or outside it. Dead     ║
 * ║  code that cost the whole feature. `PipelineSetup.tsx` holds the real     ║
 * ║  prefilled stages, where they belong: they are a form default, not a      ║
 * ║  server concern.                                                          ║
 * ║                                                                           ║
 * ║  Types are erased at compile time, so `export type` above is safe.        ║
 * ║  `tests/unit/use-server-exports.test.ts` enforces this for every          ║
 * ║  'use server' file in the repo.                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

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
