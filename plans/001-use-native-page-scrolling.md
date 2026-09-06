# 001 — Use native page scrolling

- **Status**: DONE
- **Commit**: 4accf91
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: 1 file, 3 removals

## Problem

The root layout mounts Lenis on every marketing and Lead Engine route. It runs a
continuous JavaScript scroll loop on pages that already contain WebGL and CSS
animation, which adds input latency and competes for the same frame budget.

```tsx
// app/layout.tsx:8,10,314 — current
import SmoothScroll from "./components/SmoothScroll";
import "lenis/dist/lenis.css";
<SmoothScroll />
```

## Target

Use the browser's native scrolling pipeline for every route. Remove the
`SmoothScroll` import, the Lenis stylesheet import, and the mounted
`<SmoothScroll />` node from `app/layout.tsx`. Keep
`app/components/SmoothScroll.tsx` and the package dependency untouched so this
change is reversible and does not expand into dependency cleanup.

## Repo conventions to follow

- `app/globals.css:898` already sets `scroll-behavior: auto` for reduced motion.
- Product routes already opt out of Lenis in `app/components/SmoothScroll.tsx:10`;
  this change extends that native behavior consistently to the landing routes.

## Steps

1. Remove the `SmoothScroll` component import from `app/layout.tsx`.
2. Remove the Lenis CSS import from `app/layout.tsx`.
3. Remove `<SmoothScroll />` from the root body.

## Boundaries

- Do NOT delete `app/components/SmoothScroll.tsx`.
- Do NOT remove the `lenis` package.
- Do NOT change route, host, or rewrite behavior.

## Verification

- **Mechanical**: run `npm run typecheck` and `npm run lint`.
- **Feel check**: load `http://app.localhost:3000/`, scroll through the hero,
  extraction, pricing, and library sections, and confirm wheel input tracks the
  pointer without easing or delayed settling. Open the library dialog and
  confirm wheel input inside the dialog remains local to it.
- **Done when**: no Lenis root is mounted and page scrolling is native.

## Result

Completed. The root Lenis imports and mount were removed, the native scrolling
pipeline is active, and type checking plus targeted linting pass with no errors.
