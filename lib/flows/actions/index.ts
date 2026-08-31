import 'server-only'

/**
 * Action registration — M7 Phases 20-21.
 *
 * ⚠️ ONE PLACE, CALLED ONCE. Registration is a side effect on a module-level
 * map, so scattering `registerAction` calls across import sites would make the
 * available action set depend on which modules happened to load — and a flow
 * would fail with ACTION_NOT_AVAILABLE depending on the entry point that
 * triggered it.
 */
import { registerCrmActions } from '@/lib/flows/actions/crm'
import { registerEmailActions } from '@/lib/flows/actions/email'
import { registerHubbleActions } from '@/lib/flows/actions/hubble'
import { registerNotifyAction } from '@/lib/flows/actions/notify'

let registered = false

/** Idempotent: safe to call from every entry point that runs flows. */
export function registerAllActions(): void {
  if (registered) return
  registerCrmActions()
  registerEmailActions()
  registerHubbleActions()
  registerNotifyAction()
  registered = true
}
