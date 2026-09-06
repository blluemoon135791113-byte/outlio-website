/**
 * A server action nobody calls is a feature nobody has.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS PROJECT'S MOST-REPEATED DEFECT, AND NOTHING WATCHED FOR IT.      ║
 * ║                                                                           ║
 * ║  `action-authorization.test.ts` asks whether an action is GATED.          ║
 * ║  `orphan-module.test.ts` asks whether a MODULE is imported. Neither asks  ║
 * ║  whether an action is ever CALLED, so an action can be written, tested,   ║
 * ║  permission-gated, audited — and unreachable.                             ║
 * ║                                                                           ║
 * ║  Found this way in one session:                                           ║
 * ║    • `enrolContacts` — a user could connect a mailbox, author a sequence  ║
 * ║      and press Launch on a campaign containing nobody. It read a          ║
 * ║      comma-separated `contactIds` string while every bulk form in the     ║
 * ║      product submits repeated `contactId` fields, so it could not be      ║
 * ║      wired without changing it first.                                     ║
 * ║    • `requireWorkspacePermission` — named in its own file's header as the ║
 * ║      guard pages call, with zero callers.                                 ║
 * ║    • Saved views — storage, actions and tests, no interface.              ║
 * ║                                                                           ║
 * ║  ⚠️ AND THE SEQUENCE SENDER WAS THE SAME SHAPE ONE LEVEL DOWN: steps,     ║
 * ║  enrollments and `next_action_at` all written, and nothing read them.    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

function walk(dir: string, match: RegExp): string[] {
  const out: string[] = []
  const full = join(ROOT, dir)
  let entries: string[]
  try {
    entries = readdirSync(full)
  } catch {
    return out
  }
  for (const entry of entries) {
    const rel = join(dir, entry)
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel, match))
    else if (match.test(entry)) out.push(rel)
  }
  return out
}

type Action = { file: string; name: string }

function serverActions(): Action[] {
  const out: Action[] = []
  for (const file of [...walk('app', /\.ts$/), ...walk('lib', /\.ts$/)]) {
    const src = readFileSync(join(ROOT, file), 'utf8')
    if (!src.includes("'use server'")) continue
    for (const m of src.matchAll(/^export async function (\w+)/gm)) {
      out.push({ file: file.split('\\').join('/'), name: m[1]! })
    }
  }
  return out
}

/*
 * ⚠️ COMMENTS ARE STRIPPED, BECAUSE A MENTION IS NOT A CALL. The first version
 * of this guard passed while `enrolContacts` was unwired — a comment in
 * `crm/contacts/page.tsx` explaining which permission that action enforces was
 * enough to count as a reference. A reachability check that documentation can
 * satisfy is worse than none, because writing about the problem silences the
 * alarm about it. Same stripper `action-authorization.test.ts` uses.
 */
const stripComments = (s: string) =>
  s.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*\n/gm, '').replace(/^[ \t]*\/\/.*\n/gm, '')

/** Every file that could plausibly reference an action. */
function callSites(): Map<string, string> {
  const files = [
    ...walk('app', /\.tsx?$/),
    ...walk('lib', /\.ts$/),
    ...walk('components', /\.tsx?$/),
  ]
  return new Map(
    files.map((f) => [
      f.split('\\').join('/'),
      stripComments(readFileSync(join(ROOT, f), 'utf8')),
    ]),
  )
}

/**
 * Actions known to have no caller.
 *
 * ⚠️ THIS LIST MAY ONLY EVER SHRINK, exactly as `schema-without-code.test.ts`
 * says of its own. Each entry is a built, gated, audited capability that no
 * human can reach — a decision to leave it that way, not permission to add more.
 */
/**
 * ⚠️ THIS IS A DEAD-CODE LIST, NOT A SECURITY BACKLOG. Verified rather than
 * assumed, against `.next/server/server-reference-manifest.json` after a build:
 * every one of these has NO action id, so Next never emits an endpoint for it
 * and none is callable over HTTP. 0 of 10.
 *
 * The check is not vacuous — the same manifest lookup finds `enrolContacts`,
 * `updateSenderPostalAddress` and `runWorkersNow`, which are wired.
 *
 * CLAUDE.md's rule that "a server action is a public HTTP endpoint" is about
 * actions something imports. An action nothing imports is tree-shaken out of
 * the build entirely. So the cost of these is unfinished features and code
 * that reads as live, not exposure — which changes how urgently they want
 * fixing, and is worth knowing before someone deletes working code to close a
 * hole that is not open.
 *
 * ⚠️ THE LIST MAY ONLY SHRINK. An entry means someone wrote and gated an
 * action and never gave it a caller.
 */
const KNOWN_UNREACHABLE = new Set<string>([
  /*
   * Pipeline management. `crm.pipeline.manage` exists, the actions are written
   * and gated, and the pipeline board offers no way to rename, archive or
   * change the default — so a workspace is stuck with whatever it first made.
   */
  'app/(product)/crm/pipeline/actions.ts:archivePipelineAction',
  'app/(product)/crm/pipeline/actions.ts:renamePipelineAction',
  'app/(product)/crm/pipeline/actions.ts:setDefaultPipelineAction',
  /*
   * The whole extension admin surface. Access can be granted and revoked, and
   * devices revoked individually or all at once, with an `admin_audit_logs` row
   * for each — from nowhere. `/admin` renders none of it.
   */
  'lib/admin/extension-actions.ts:adminRevokeAllDevicesAction',
  'lib/admin/extension-actions.ts:adminRevokeDeviceAction',
  'lib/admin/extension-actions.ts:getExtensionUsage',
  'lib/admin/extension-actions.ts:setExtensionAccessAction',
  /*
   * ⚠️ FOUND BY THIS GUARD ON ITS FIRST RUN, WHILE WIRING UP `enrolContacts`.
   * `BulkAssign.tsx` renders one bulk toolbar — assign, and now enrol — and no
   * `BulkTag.tsx`, `BulkAddToList.tsx` or bulk-delete control exists anywhere.
   * These three are written, gated on `crm.contact.edit`/`crm.contact.delete`,
   * and reachable by nobody. Building three bulk-UI features was not in scope
   * for this change; recorded rather than left silently passing.
   */
  'lib/crm/contact-actions.ts:bulkTagAction',
  'lib/crm/contact-actions.ts:bulkAddToListAction',
  'lib/crm/contact-actions.ts:bulkDeleteAction',
])

describe('the scanner itself', () => {
  it('finds the server actions', () => {
    // Without this, a refactor empties the list and everything below passes
    // against nothing.
    const actions = serverActions()
    expect(actions.length).toBeGreaterThanOrEqual(100)
    expect(actions.some((a) => a.name === 'enrolContacts')).toBe(true)
  })

  it('finds files that could call them', () => {
    expect(callSites().size).toBeGreaterThan(200)
  })

  it('would notice a reference that does not exist', () => {
    /*
     * Proves the search can return false at all. A matcher that found every
     * name everywhere would report perfect reachability forever.
     */
    const sites = callSites()
    const found = [...sites.values()].some((src) => /\bzzNoSuchActionName\b/.test(src))
    expect(found).toBe(false)
  })
})

describe('every server action is reachable', () => {
  const sites = callSites()

  const orphans = serverActions().filter(({ file, name }) => {
    if (KNOWN_UNREACHABLE.has(`${file}:${name}`)) return false
    for (const [path, src] of sites) {
      if (path === file) continue
      if (new RegExp(`\\b${name}\\b`).test(src)) return false
    }
    return true
  })

  it('has a caller outside its own file', () => {
    expect(
      orphans.map((a) => `${a.file} → ${a.name}()`),
      `These server actions are written, gated and unreachable. Nothing imports ` +
        `or renders them, so the capability does not exist for any user. Wire it ` +
        `up, delete it, or add it to KNOWN_UNREACHABLE with the reason.`,
    ).toEqual([])
  })

  it('the known-unreachable list has not grown', () => {
    /*
     * ⚠️ PINNED AT ITS CURRENT SIZE. Without this, the fix for a failing build
     * is to append to the allowlist, and the guard becomes a list of things
     * nobody intends to fix.
     */
    expect(KNOWN_UNREACHABLE.size).toBeLessThanOrEqual(10)
  })
})
