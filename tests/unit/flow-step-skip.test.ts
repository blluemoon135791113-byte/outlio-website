/**
 * A skipped flow step is recorded as skipped, and shown as skipped.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `flow_step_status` HAS HAD A `skipped` VALUE ALL ALONG. NOTHING WROTE IT.║
 * ║                                                                           ║
 * ║  The engine mapped every result to `succeeded` or `failed`. §10: "SKIP is ║
 * ║  an explicit branch outcome, not a swallowed error." Once assignment      ║
 * ║  steps began leaving owned contacts alone, that gap had two wrong         ║
 * ║  answers: record the skip as a success, and the run trace says a contact  ║
 * ║  was assigned when it was not; record it as a failure, and a correct run  ║
 * ║  halts.                                                                   ║
 * ║                                                                           ║
 * ║  ⚠️ THE REASON LIVES IN `output`, NOT `error_message`. The run trace       ║
 * ║  renders any error message in the danger colour, so a skip reason there   ║
 * ║  would make correct behaviour look like a fault.                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Read from source, like the other engine guards in this directory: the step
 * loop depends on a claimed run, a pinned version and live facts, and a mocked
 * copy of all three would test the mocks.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const ENGINE = strip(readFileSync(join(ROOT, 'lib', 'flows', 'engine.ts'), 'utf8'))
const TRACE = strip(readFileSync(join(ROOT, 'app', '(product)', 'flows', '[id]', 'page.tsx'), 'utf8'))

const STEP_UPDATE = (() => {
  const at = ENGINE.indexOf(".from('flow_step_runs')\n      .update({")
  expect(at, 'the step result update was not found').toBeGreaterThan(-1)
  /*
   * ⚠️ BOUNDED BY THE WHERE CLAUSE, NOT BY THE FIRST `})`. The first version
   * cut at `})` — and `(result.output ?? {})` inside the update contains exactly
   * that, so the slice ended before the `skipped` spread it was looking for and
   * the test failed against correct code.
   */
  const end = ENGINE.indexOf(".eq('run_id', runId)", at)
  expect(end, 'the end of the step result update was not found').toBeGreaterThan(at)
  return ENGINE.slice(at, end)
})()

describe('the engine', () => {
  it('lets a handler say it skipped, with a code and a message', () => {
    expect(ENGINE).toMatch(/skipped\?: \{ code: string; message: string \}/)
  })

  it('records a skip as skipped — not succeeded, not failed', () => {
    expect(STEP_UPDATE).toContain("status: !result.ok ? 'failed' : skipped ? 'skipped' : 'succeeded'")
  })

  it('keeps the skip reason in output and out of the error columns', () => {
    expect(STEP_UPDATE).toContain('{ ...(result.output ?? {}), skipped }')
    expect(STEP_UPDATE).toContain('error_code: result.ok ? null : result.code')
    expect(STEP_UPDATE).toContain('error_message: result.ok ? null : result.message')
  })

  it('does not end the run on a skip — only a failure does that', () => {
    // A skip is `ok: true`, so the only branch that finishes a run as failed
    // must be keyed on `!result.ok` and nothing broader.
    expect(ENGINE).toMatch(/if \(!result\.ok\) \{\s*await finish\(db, runId, 'failed'\)/)
  })
})

describe('the run trace', () => {
  it('loads the step output the skip reason lives in', () => {
    expect(TRACE).toMatch(/from\('flow_step_runs'\)\s*\.select\('[^']*\boutput\b[^']*'\)/)
  })

  it('draws a skipped step in its own colour and states the reason', () => {
    expect(TRACE).toContain("step.status === 'skipped'")
    expect(TRACE).toContain('bg-warning')
    expect(TRACE).toContain('skipReason(step.output)')
  })
})
