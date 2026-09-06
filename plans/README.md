# Animation improvement plans

| Plan | Title | Severity | Status |
| --- | --- | --- | --- |
| 001 | Use native page scrolling | HIGH | DONE |
| 002 | Stabilize pricing expansion | HIGH | DONE |

## Recommended order

1. `001-use-native-page-scrolling.md` removes the global input-latency source.
2. `002-stabilize-pricing-expansion.md` then isolates the remaining pricing
   interaction from layout work.

The plans are independent, but running them in this order makes the pricing
feel check reflect the final native-scroll environment.
