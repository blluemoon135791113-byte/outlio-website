# 002 — Stabilize pricing expansion

- **Status**: DONE
- **Commit**: 4accf91
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: 3 files, medium CSS rewrite

## Problem

The pricing strip animates its grid tracks on hover, which recalculates layout
for all three plans on every frame. At the same time, the active plan's intro
animates its width, so its words move and reflow while the pointer is over it.

```css
/* components/leadengine/Pricing.module.css:122,503 — current */
.pricingStrip {
  transition: grid-template-columns var(--plan-motion);
}

.pricingStrip:has(.planPanel:nth-child(1):hover) {
  grid-template-columns: minmax(0, 1.42fr) minmax(0, 0.79fr) minmax(0, 0.79fr);
}

.planPanel:hover .planIntro {
  width: var(--active-intro-width);
}
```

## Target

Wrap the three cards in a `.plansTrack`, keep each plan at a fixed `60%`
layout width, and reveal the hovered plan by animating only `transform`,
`clip-path`, and `opacity`. The plan intro remains exactly `55.555556%` of that fixed
width, equal to one third of the track, so all headings, prices, metrics, and
CTAs keep the same position throughout expansion.

```css
/* target desktop geometry */
.plansTrack { position: relative; min-height: 23.6rem; }
.planPanel {
  position: absolute;
  width: 60%;
  clip-path: inset(0 44.444444% 0 0 round 1.65rem);
  transition: transform 260ms var(--ease-in-out), clip-path 260ms var(--ease-in-out);
}
.planIntro { width: 55.555556%; }
.planIncludes { inset: 0 0 0 55.555556%; }
```

For plan 1, 2, and 3 respectively, transform siblings by the exact ratios
`44.444444%`, `22.222222%`, `-22.222222%`, and `-44.444444%` needed to produce a
60% active card plus two 20% inactive cards. Use
`cubic-bezier(0.77, 0, 0.175, 1)` over `260ms`. Keep the current stacked mobile
layout below `48rem` and preserve the reduced-motion override.

## Repo conventions to follow

- Reuse the existing `--plan-motion: 280ms cubic-bezier(0.77, 0, 0.175, 1)`
  token in `components/leadengine/Pricing.module.css:123`.
- Reuse the existing `clip-path` and opacity reveal language from
  `components/leadengine/Pricing.module.css:336`.
- Keep `Pricing.tsx` and `FastSpringPricing.tsx` structurally identical around
  the pricing track so the landing and checkout routes cannot drift.

## Steps

1. Wrap plan articles in `.plansTrack` in both pricing components.
2. Replace the animated desktop grid tracks with fixed absolute plan geometry.
3. Keep `.planIntro` at `62.5%`; remove its width transition.
4. Animate the outer cards with transform and clip-path and reveal the details
   with transform and opacity only.
5. Restore normal document flow under `64rem` and retain reduced-motion rules.

## Boundaries

- Do NOT change plan names, prices, credits, capacities, features, or CTAs.
- Do NOT change checkout behavior.
- Do NOT add a motion dependency.
- Do NOT modify the library or extraction animation in this plan.

## Verification

- **Mechanical**: run `npm run typecheck` and `npm run lint`.
- **Feel check**: at desktop width, hover plans 1 → 2 → 3 rapidly and confirm:
  - the active card opens on its right side;
  - the plan name, price, metrics, and CTA never move within their card;
  - interrupted hover transitions continue from their current visual state;
  - no plan copy scales or stretches.
  At widths below `64rem`, confirm every plan and feature remains visible in the
  stacked layout. Toggle reduced motion and confirm positional movement is
  removed while state visibility remains understandable.
- **Done when**: pricing no longer transitions grid tracks or intro width and
  copy remains visually anchored throughout hover expansion.

## Result

Completed. Both pricing implementations share the fixed track wrapper, desktop
cards reveal with transform/clip/opacity transitions, stacked layouts remain in
normal flow below `64rem`, and type checking plus targeted linting pass with no
errors.
