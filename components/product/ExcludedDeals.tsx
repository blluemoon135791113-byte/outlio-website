/**
 * ⚠️ EXTRACTED 2026-09-14, WHEN THE HOME DASHBOARD NEEDED THE SAME WARNING.
 *
 * It lived inside `app/(product)/crm/reports/page.tsx`. A second copy for the
 * home would be two implementations of one sentence — and the sentence is the
 * only thing standing between a reader and an average deal size that is wrong
 * by however many deals could not be converted. Copies of a warning drift, and
 * the drift is invisible because both still render something plausible.
 */
/**
 * Says how many deals a money total had to leave out.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE DEAL COUNT AND THE MONEY DISAGREE, AND WITHOUT THIS NOBODY KNOWS. ║
 * ║                                                                           ║
 * ║  0131 sums `value_amount_base`, which is NULL when a deal has no exchange  ║
 * ║  rate, and `sum()` skips NULLs. So an unconvertible deal is counted in     ║
 * ║  "Open deals" and absent from "Open value" — a reader dividing one by the  ║
 * ║  other gets an average deal size that is wrong.                           ║
 * ║                                                                           ║
 * ║  Dropping it from the total was the right call: adding €10,000 to a dollar ║
 * ║  figure at face value is the bug §5.6 exists to prevent. But a total       ║
 * ║  nobody knows is short is worse than one that is wrong, so it says so.    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ RENDERS NOTHING AT ZERO. Today every deal is the workspace currency and
 * this is 0 everywhere, so a permanent "0 deals excluded" line would be noise
 * teaching people to ignore the place the real warning will appear.
 */
export function ExcludedDeals({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <p className="text-xs text-warning">
      {count === 1
        ? '1 deal is not included in these values — no exchange rate for its currency.'
        : `${count} deals are not included in these values — no exchange rate for their currencies.`}
    </p>
  )
}
