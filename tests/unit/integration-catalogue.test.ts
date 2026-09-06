/**
 * The integration catalogue keeps the enum honest — R17.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A TYPE THAT ALLOWS WHAT THE PRODUCT CANNOT DO IS A TRAP.                ║
 * ║                                                                           ║
 * ║  `INTEGRATION_PROVIDERS` names five providers and three exist;            ║
 * ║  `EXPORT_DESTINATIONS` names seven and five have a writer. Nothing is     ║
 * ║  broken today because no screen is built from the enum — but the next     ║
 * ║  person who builds a picker from it ships options that fail on click.     ║
 * ║                                                                           ║
 * ║  These tests make growing the enum FORCE a decision.                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  AVAILABLE_EXPORT_DESTINATIONS,
  DECLARED_DESTINATIONS,
  DECLARED_PROVIDERS,
  INTEGRATION_CATALOGUE,
  availableIntegrations,
  canExportTo,
  integration,
} from '@/lib/integrations/catalogue'

const FILES = readdirSync('lib/integrations')

describe('every declared provider is accounted for', () => {
  for (const provider of DECLARED_PROVIDERS) {
    it(`${provider} appears in the catalogue`, () => {
      /*
       * ⚠️ THE POINT OF THE WHOLE FILE. Adding a provider to the enum and not
       * to the catalogue fails here, so nobody can widen the type's promise
       * without saying whether the product can keep it.
       */
      expect(integration(provider)).not.toBeNull()
    })
  }

  it('has no catalogue entry for a provider the type does not allow', () => {
    for (const entry of INTEGRATION_CATALOGUE) {
      expect(DECLARED_PROVIDERS).toContain(entry.provider)
    }
  })
})

describe('“available” means there is something behind it', () => {
  for (const entry of availableIntegrations()) {
    it(`${entry.provider} has an implementation file`, () => {
      /*
       * Read from disk rather than trusted: marking something available is a
       * claim, and this is what turns it into a checkable one.
       */
      const implemented = FILES.some(
        (file) => file !== 'types.ts' && file.startsWith(entry.provider),
      )
      expect(implemented, `${entry.provider} is marked available with no adapter`).toBe(
        true,
      )
    })
  }

  it('every PLANNED entry says why it is not built', () => {
    // "Coming soon" with no reason is how something stays not-built for a year.
    for (const entry of INTEGRATION_CATALOGUE) {
      if (entry.status !== 'planned') continue
      expect(entry.blockedBy, `${entry.provider} is planned with no reason`).toBeTruthy()
      expect(entry.blockedBy!.length).toBeGreaterThan(15)
    }
  })

  it('describes each one in terms of what it does', () => {
    for (const entry of INTEGRATION_CATALOGUE) {
      expect(entry.description.length).toBeGreaterThan(20)
      expect(entry.description).not.toBe(entry.name)
    }
  })
})

describe('export destinations', () => {
  it('only reports a destination as available if it is declared', () => {
    for (const destination of AVAILABLE_EXPORT_DESTINATIONS) {
      expect(DECLARED_DESTINATIONS).toContain(destination)
    }
  })

  it('refuses the destinations that have no writer', () => {
    /*
     * ⚠️ NAMED EXPLICITLY, not derived. `onedrive` and `dropbox` are in the
     * enum and nothing can write to them; a picker built from the enum would
     * offer an export that silently produces nothing.
     */
    expect(canExportTo('onedrive')).toBe(false)
    expect(canExportTo('dropbox')).toBe(false)
    expect(canExportTo('csv')).toBe(true)
    expect(canExportTo('google_sheets')).toBe(true)
  })

  it('refuses a destination that does not exist at all', () => {
    expect(canExportTo('')).toBe(false)
    expect(canExportTo('ftp')).toBe(false)
  })
})
