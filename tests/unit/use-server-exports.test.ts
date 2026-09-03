/**
 * A `'use server'` file may export async functions and nothing else.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS BROKE THE PIPELINE PAGE IN PRODUCTION, AND NOTHING CAUGHT IT.      ║
 * ║                                                                           ║
 * ║  `app/(product)/crm/pipeline/actions.ts` exported a plain array:          ║
 * ║                                                                           ║
 * ║      export const SUGGESTED_STAGES: StageInput[] = [ … ]                  ║
 * ║                                                                           ║
 * ║  Next refuses it at MODULE EVALUATION:                                    ║
 * ║                                                                           ║
 * ║      Error: A "use server" file can only export async functions,          ║
 * ║             found object.                                                 ║
 * ║                                                                           ║
 * ║  So it is not the export that breaks — it is EVERY action in the file,    ║
 * ║  and every action reachable from the same page. "New pipeline" and "New   ║
 * ║  deal" both returned 500, the page crashed to a black error screen, and   ║
 * ║  no row was written. The array had no importer anywhere.                  ║
 * ║                                                                           ║
 * ║  ⚠️ WHY NOTHING CAUGHT IT — and why this test is structural:              ║
 * ║    • `tsc` is happy: it is valid TypeScript.                              ║
 * ║    • ESLint is happy: no rule covers it.                                  ║
 * ║    • `next build` compiles: the constraint is enforced at runtime.        ║
 * ║    • The page renders: the module is only evaluated when an action is     ║
 * ║      INVOKED.                                                             ║
 * ║    • Every unit test passed: tests import the functions directly, which   ║
 * ║      is exactly what the server runtime refuses to do.                    ║
 * ║                                                                           ║
 * ║  The only signal was a 500 in production.                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** Files whose FIRST directive is 'use server' — the whole-module form. */
function useServerFiles(): { path: string; source: string }[] {
  const files = ['app', 'lib', 'components'].flatMap((dir) => sourceFiles(join(ROOT, dir)))

  return files
    .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
    .filter(({ source }) => /^\s*(['"])use server\1/m.test(source.slice(0, 400)))
}

describe('use server files export only async functions', () => {
  const files = useServerFiles()

  it('finds the action files at all', () => {
    // Guards the scanner: a change to how the directive is written would
    // otherwise make every assertion below vacuously true against an empty set.
    expect(files.length).toBeGreaterThan(5)
    expect(files.some((f) => f.path.includes('crm/pipeline/actions'))).toBe(true)
  })

  it('exports no value bindings', () => {
    /*
     * ⚠️ VERIFIED NON-VACUOUS: restoring `export const SUGGESTED_STAGES` names
     * the file and the line here.
     *
     * `export type` and `export interface` are fine — types are erased before
     * the runtime ever sees the module, which is why the type export sitting
     * beside the broken array was never a problem.
     */
    const offenders: string[] = []

    for (const { path, source } of files) {
      const lines = source.split('\n')
      lines.forEach((line, index) => {
        // `export const`, `export let`, `export var`, `export class`,
        // `export enum` — every one of these is a value, not an async function.
        if (/^export\s+(const|let|var|class|enum)\s/.test(line)) {
          offenders.push(`${path.replace(`${ROOT}/`, '')}:${index + 1} — ${line.trim().slice(0, 70)}`)
        }
      })
    }

    expect(
      offenders,
      `a "use server" file can only export async functions:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('exports no default and no re-exported bindings', () => {
    /*
     * `export default` and `export { x } from './y'` are the two other shapes
     * that smuggle a non-function past the check above. A re-export is
     * especially easy to miss because the offending value lives in a file that
     * is not itself a server module.
     */
    const offenders: string[] = []

    for (const { path, source } of files) {
      const lines = source.split('\n')
      lines.forEach((line, index) => {
        const isTypeOnly = /^export\s+type\s*\{/.test(line)
        if (isTypeOnly) return
        if (/^export\s+default\s/.test(line) || /^export\s*\{[^}]*\}\s*from\s/.test(line)) {
          offenders.push(`${path.replace(`${ROOT}/`, '')}:${index + 1} — ${line.trim().slice(0, 70)}`)
        }
      })
    }

    expect(offenders, `illegal export shape in a "use server" file:\n${offenders.join('\n')}`).toEqual([])
  })

  it('every exported function is async', () => {
    /*
     * A synchronous exported function is the same class of failure: the
     * runtime requires the export to be awaitable, and a non-async one fails
     * module evaluation exactly like the array did.
     */
    const offenders: string[] = []

    for (const { path, source } of files) {
      const lines = source.split('\n')
      lines.forEach((line, index) => {
        if (/^export\s+function\s/.test(line)) {
          offenders.push(`${path.replace(`${ROOT}/`, '')}:${index + 1} — ${line.trim().slice(0, 70)}`)
        }
      })
    }

    expect(
      offenders,
      `exported but not async, which fails module evaluation:\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
