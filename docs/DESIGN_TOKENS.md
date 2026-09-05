# Design Tokens — Phase 0

Extracted from `app/globals.css`, `app/layout.tsx`, and `app/components/HeroHeadline.tsx`
on 2026-08-05. Values are verbatim.

---

## 1. Color

All tokens are defined once in `app/globals.css:10-40` under `:root`, then exposed
to Tailwind v4 via `@theme inline` (`app/globals.css:43-52`).

| Token | Value | Tailwind class | Role |
|---|---|---|---|
| `--paper` | `#ffffff` | `bg-paper` | page background |
| `--panel` | `#ffffff` | `bg-panel` | raised surface |
| `--cream` | `#f2eee3` | `bg-cream` | warm secondary surface |
| `--ink` | `#16150f` | `text-ink` | primary text |
| `--muted` | `#605e55` | `text-muted` | secondary text |
| `--accent` | `#4f4bff` | `text-accent` | primary action, active state |
| `--accent-deep` | `#322ed1` | `bg-accent-deep` | hover/pressed |
| `--accent-soft` | `#edecff` | `bg-accent-soft` | tinted background |

**There is no dark mode.** No `.dark` class, no `prefers-color-scheme` block. The
app inherits light-only. Do not introduce dark mode without a decision.

### Gradients

```css
--grad-band: linear-gradient(140deg, #131129 0%, #1c1950 48%, #322ed1 92%, #4f4bff 120%);
--grad-halo: transparent;
--grad-glass: linear-gradient(160deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.4) 100%);
--grad-glass-card: linear-gradient(160deg, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0.35) 100%);
```

### Hero background treatment

The hero is **flat white** with a drifting two-pool aurora overlay
(`app/globals.css:192-205`):

```css
.hero-aurora {
  background:
    radial-gradient(42% 55% at 78% 12%, rgba(79, 75, 255, 0.16), transparent 70%),
    radial-gradient(36% 48% at 12% 80%, rgba(124, 121, 255, 0.1), transparent 70%);
  animation: aurora-drift 16s ease-in-out infinite alternate;
}
```

Plus canvas starfield/meteor components layered behind. **None of this appears on
authenticated app surfaces** — see §8.

> ⚠️ **Token debt.** `.hero-aurora`, `.glass-card`, `.team-beam`, and `.shimmer`
> hardcode `rgba(79,75,255,…)` and `rgba(124,121,255,…)` — the accent in raw form
> rather than `var(--accent)`. New components must not copy this pattern
> (`CLAUDE.md`: zero hardcoded colors). Promoting these into tokens would require
> editing landing-page CSS, which needs approval first.

---

## 2. Typography

Fonts are **not** loaded via `next/font`. Two mechanisms:

1. **System stack** — `app/globals.css:36-38`:
   ```css
   --font-display: "Helvetica Neue", "Arial Nova", Helvetica, Arial,
                   ui-sans-serif, system-ui, sans-serif;
   --font-body: var(--font-display);
   ```
2. **Caveat** (handwriting) via a Google Fonts `<link>` in `app/layout.tsx:165`.

> Both `globals.css:35` and `:42` carry a `FONT PLACEHOLDER` comment: the founder's
> real fonts are pending. When they arrive, swap `--font-display` / `--font-body`
> in one place. **The app must use the variables, never a literal family name.**

> ⚠️ Loading Caveat via `<link>` rather than `next/font` costs a render-blocking
> round trip to `fonts.googleapis.com` and risks layout shift. Preconnects exist
> (`layout.tsx:163-164`), which softens it. Migrating to `next/font` is a Core Web
> Vitals win but touches the landing page — not a Phase 0 change.

### Hero headline — the marketing reference

`app/components/HeroHeadline.tsx:45-52`, quoted verbatim:

```tsx
<h1
  ref={headlineRef}
  className="text-[clamp(2.6rem,7.2vw,6.2rem)] font-bold uppercase leading-[0.98] tracking-tight transition-all duration-300"
  style={{
    opacity: scrollOpacity,
    filter: `blur(${(1 - scrollOpacity) * 4}px)`,
    transform: `translateY(${(1 - scrollOpacity) * -20}px)`
  }}
>
```

- Size: `clamp(2.6rem, 7.2vw, 6.2rem)` — fluid, 41.6px → 99.2px
- Weight `700`, `uppercase`, `leading-[0.98]`, `tracking-tight`
- Cycles `["tech startups", "SaaS startups", "agencies"]` every 2500 ms
- Respects `prefers-reduced-motion` (`HeroHeadline.tsx:14-15`)
- Reserves width with an invisible longest-word span to prevent layout shift
  (`HeroHeadline.tsx:70-72`) — a good pattern worth reusing

### Observed type scale (from `app/page.tsx`)

| Use | Classes |
|---|---|
| Eyebrow | `text-[13px] font-semibold uppercase tracking-[0.22em] text-accent` |
| Section h2 | `text-4xl font-bold uppercase tracking-tight sm:text-5xl` / `sm:text-6xl` |
| Card h3 | `text-2xl font-bold tracking-tight` |
| Lead body | `text-base leading-relaxed text-muted sm:text-lg` |
| Body | `text-base font-medium leading-relaxed text-ink` |
| Small | `text-sm leading-relaxed text-muted` |
| Micro | `text-[13px] leading-snug`, `text-[10px] font-bold uppercase tracking-[0.16em]` |

---

## 3. Radius

**No `--radius` token exists.** The landing page uses Tailwind defaults ad hoc —
`rounded-full` on pills/badges, plus `rounded-*` utilities inline.

**Action for the app:** define a radius scale once in `@theme` before building any
component, and use it everywhere. This is a genuinely missing token, not an
oversight to copy.

---

## 4. Elevation

No shadow scale token. Shadows appear inline within glass utilities
(`app/globals.css:278-310`):

```css
.glass-card {
  background: linear-gradient(160deg, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0.45) 100%);
  backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.3);
  box-shadow: 0 8px 32px 0 rgba(79, 75, 255, 0.08);
}
.glass-card:hover {
  border-color: rgba(79, 75, 255, 0.4);
  box-shadow: 0 16px 48px 0 rgba(79, 75, 255, 0.12);
  transform: translateY(-3px);
}
```

Separation strategy: **borders + soft accent-tinted shadows**, not hard shadows.

**Action for the app:** define `--shadow-sm/md/lg` once. Do **not** use
`backdrop-filter` on dashboard surfaces — it is expensive when composited over
scrolling tables.

---

## 5. Spacing

- Container: `max-w-3xl` recurs for text blocks; `mx-auto` centred
- Vertical rhythm: `mt-6`, `mt-3`, `mt-2`, `space-y-8`, `gap-12`, `pt-4`, `mb-3`
- Marketing sections use generous multi-`rem` padding

No container token is defined; widths are per-section utilities.

---

## 6. Motion

| Purpose | Duration | Easing |
|---|---|---|
| Reveal on scroll | `0.8s` | `cubic-bezier(0.22, 1, 0.36, 1)` |
| Hero word fade | `0.8s` | `ease-in-out` |
| Hero text slide | `0.6s` | `cubic-bezier(0.22, 1, 0.36, 1)` |
| Bouncy period | `1.2s` | `cubic-bezier(0.34, 1.56, 0.64, 1)` |
| Glass card hover | `0.5s` | `cubic-bezier(0.34, 1.56, 0.64, 1)` |
| Modal panel | `0.4s` | `cubic-bezier(0.34, 1.56, 0.64, 1)` |
| Aurora drift | `16s` | `ease-in-out infinite alternate` |
| Marquee | `35s` | `linear infinite` |

Two signature curves: **`cubic-bezier(0.22, 1, 0.36, 1)`** (decelerate) and
**`cubic-bezier(0.34, 1.56, 0.64, 1)`** (overshoot).

`prefers-reduced-motion` is handled at `app/globals.css:413-433`, disabling
`.reveal`, marquee, modal, pinboard sway, and FAQ transitions.

---

## 7. Components and focus

**Focus ring — inherit exactly** (`app/globals.css:74-77`):

```css
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
```

**Selection** (`app/globals.css:69-72`): `background: var(--accent); color: var(--cream);`

**Badge/pill:** `inline-block rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-cream`

**No shared `Button`, `Card`, `Input`, or `Container` primitive exists.** Styles are
inline per usage across `app/page.tsx`. The app must define its own primitives —
there is nothing to inherit but the tokens and the focus ring.

---

## 8. App Adaptation

### Inherit unchanged
- All eight color tokens and their semantic names
- `--font-display` / `--font-body` variables (never literal families)
- `:focus-visible` ring, verbatim
- Accent used **only** for primary actions, active nav, progress indicators

### Adapt
- **Type scale:** down one step. Dashboard page title ≈ `text-2xl`/`text-3xl`,
  never the hero's `clamp()`. Table cells and body at `text-sm`/`text-base`.
- **Spacing:** 8px baseline. Compress the marketing rhythm.
- **Backgrounds:** `--grad-band`, `.hero-aurora`, starfield/meteor canvases appear
  **only** on the marketing site. Authenticated surfaces — and, since the flat
  pass below, the auth screens too — use flat `--paper` / `--panel`.

### The product is flat and white (revised 2026-09-03)

The authenticated product and the auth screens are **white surfaces separated by
hairline borders**. Neumorphism/claymorphism is gone from both.

| | Marketing (`:root`) | Product (`.product-clay`, `.auth-clay`) |
|---|---|---|
| Canvas | `--app: #faf9ff`, `--clay-bg: #fffaf0` | `#ffffff` |
| Panel | cream + paired neumorphic shadow | `#ffffff` + `1px solid var(--border)` |
| Border | `#e9e4f3` | `#e6e6ea`, strong `#d2d2d9` |
| Muted fill | `--clay-sunken: #f4eadb` | `#f6f6f7` |
| Card radius | `--radius-clay: 1rem` | `0.625rem` |
| Panel shadow | `--neo-shadow` | **none** |
| Input | cream fill + inset shadow | white fill + border |

**Why.** Neumorphism spends its contrast budget describing a light source. That
is charming on a landing page with six elements and costly on a table with 25
rows: the surface competes with the data, and there is no contrast left to mark
the row that matters. Hierarchy now comes from borders and space.

**Rules.**
- Shadow means **"this floats and will go away"** — menus, popovers, dialogs
  only. A panel that sits on the page gets a border, never a shadow.
- `--shadow-lg` bakes in a `0 0 0 1px var(--border)` ring. Floating surfaces are
  white on white; a blur alone leaves a dropdown's top edge undetectable.
- **`--neo-shadow-focus` is never flattened.** It is a real 2px ring. Setting it
  to `none` alongside the other shadows removes the focus indicator from every
  input in the product — an accessibility regression wearing a visual cleanup's
  clothes.
- **`--neo-shadow-lg` / `--clay-shadow-lg` are never flattened either.** They are
  what the batch filter and date picker use to float dropdowns.

**Scoping — do not lift this to `:root`.** CLAUDE.md rule 5 makes the landing
page read-only and `/product` shares its material. The flat rules win on
specificity (`.product-clay .clay` = 0,2,0 over `.clay` = 0,1,0) without editing
the base rules, so the marketing site is bit-for-bit unchanged. The `clay` class
names are kept: renaming them across 62 files is a large diff that changes no
pixel. They now mean "the product's surface".
- **Motion:** ≤150ms on interactive feedback. Keep the decelerate curve
  `cubic-bezier(0.22, 1, 0.36, 1)`; **drop the overshoot curve** — bounce reads as
  latency on data screens.
- **No entrance animations** on upload, jobs table, or leads table. Do not use
  `Reveal.tsx` inside the product.
- **No `backdrop-filter`** on dashboard surfaces.

### Tokens that must be added (missing today)
1. **Radius scale** — none exists
2. **Shadow scale** — none exists
3. **Semantic status colors** — success / warning / danger / info. Required for job
   states (`completed`, `partially_completed`, `failed`) and validation errors.
   The landing page hardcodes `#28a745` green and `#007bff` blue inside the old
   scraper GUI only; the site itself has no status palette.
4. **Border token** — separators are currently `border-ink/10` opacity utilities

Add each once to `@theme` in `app/globals.css`. That is an **addition**, not a
restyle, and is the one edit `CLAUDE.md` rule 6 permits — flagged here as required.

### Absolute rules
- No `#hex`, `rgb()`, `hsl()`, or arbitrary color values in any new component
- A reviewer grepping new components for `#` in a color position finds nothing
- Do not restyle any existing landing-page component

---

## 9. Phase 0 acceptance

- [x] Color — every token, value, and definition site recorded; hero background quoted
- [x] Typography — loading mechanism, hero headline quoted verbatim, full scale
- [x] Radius — recorded as **absent**, with required action
- [x] Elevation — every shadow quoted; border-vs-shadow strategy noted
- [x] Spacing — container widths and recurring gaps
- [x] Motion — all durations and both easing curves
- [x] Components — focus ring, selection, badge; **no primitives exist**
- [x] Breakpoints — standard Tailwind; hero reflows via `clamp()` not breakpoints
- [x] App Adaptation section complete
- [x] Hero component code quoted as reference
- [x] Zero application code written
