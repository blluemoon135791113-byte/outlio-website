/**
 * What Outlio integrates with, and what it only claims to — R17.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `INTEGRATION_PROVIDERS` PROMISES FIVE. THREE EXIST.                     ║
 * ║                                                                           ║
 * ║  `microsoft` and `dropbox` are in the enum with no implementation behind  ║
 * ║  them, and `EXPORT_DESTINATIONS` names `onedrive` and `dropbox` with no   ║
 * ║  writer. Nothing was broken by that — no screen offers them — but the     ║
 * ║  type says a value is legal that the product cannot honour, and the next  ║
 * ║  person to add a picker driven by the enum ships a dead option.           ║
 * ║                                                                           ║
 * ║  ⚠️ THIS FILE IS THE SINGLE PLACE THAT SAYS WHICH IS WHICH. A provider    ║
 * ║  added to the enum and not here fails the test in                         ║
 * ║  `tests/unit/integration-catalogue.test.ts` — so growing the enum forces  ║
 * ║  a decision rather than quietly widening a promise.                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import {
  EXPORT_DESTINATIONS,
  INTEGRATION_PROVIDERS,
  type ExportDestination,
  type IntegrationProvider,
} from '@/lib/integrations/types'

export type IntegrationEntry = {
  provider: IntegrationProvider
  name: string
  /** What it does, in the words someone would use to ask for it. */
  description: string
  /**
   * ⚠️ `planned` MEANS THE TYPE ALLOWS IT AND THE PRODUCT CANNOT DO IT. Never
   * show a planned integration as connectable: an option that fails on click
   * is worse than an absent one, because the person retries.
   */
  status: 'available' | 'planned'
  /** Why it is not built yet. Required for `planned`, so nobody has to guess. */
  blockedBy?: string
}

export const INTEGRATION_CATALOGUE: IntegrationEntry[] = [
  {
    provider: 'google',
    name: 'Google',
    description: 'Export leads straight into Sheets or Drive.',
    status: 'available',
  },
  {
    provider: 'clay',
    name: 'Clay',
    description: 'Push leads into a Clay table for enrichment.',
    status: 'available',
  },
  {
    provider: 'ghl',
    name: 'GoHighLevel',
    description: 'Send contacts to a GoHighLevel sub-account.',
    status: 'available',
  },
  {
    provider: 'microsoft',
    name: 'Microsoft',
    description: 'Export to OneDrive, and connect an Outlook mailbox.',
    status: 'planned',
    // The same credential gap that blocks calendar sync.
    blockedBy: 'Needs Microsoft OAuth credentials, which the project does not have.',
  },
  {
    provider: 'dropbox',
    name: 'Dropbox',
    description: 'Export lead files to a Dropbox folder.',
    status: 'planned',
    blockedBy: 'No adapter written. Nothing depends on it yet.',
  },
]

/** Destinations an export can actually be written to today. */
export const AVAILABLE_EXPORT_DESTINATIONS: ExportDestination[] = [
  'csv',
  'google_sheets',
  'google_drive',
  'clay',
  'ghl',
]

export function integration(provider: string): IntegrationEntry | null {
  return INTEGRATION_CATALOGUE.find((entry) => entry.provider === provider) ?? null
}

export function availableIntegrations(): IntegrationEntry[] {
  return INTEGRATION_CATALOGUE.filter((entry) => entry.status === 'available')
}

/**
 * Whether an export destination can be honoured.
 *
 * ⚠️ CALL THIS BEFORE OFFERING ONE. `EXPORT_DESTINATIONS` includes `onedrive`
 * and `dropbox`, which have no writer — a picker built from the enum would
 * offer an export that silently produces nothing.
 */
export function canExportTo(destination: string): boolean {
  return (AVAILABLE_EXPORT_DESTINATIONS as string[]).includes(destination)
}

/** Every enum member, for the test that keeps this file honest. */
export const DECLARED_PROVIDERS = INTEGRATION_PROVIDERS
export const DECLARED_DESTINATIONS = EXPORT_DESTINATIONS
