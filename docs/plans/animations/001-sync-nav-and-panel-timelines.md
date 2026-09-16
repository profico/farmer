# 001 — Put the nav column and the section panel on one timeline

- **Commit:** `cf262c3`
- **Severity:** HIGH
- **Category:** Physicality & origin / Cohesion
- **Status:** DONE — shipped differently, see "What actually shipped"

## The defect

The shell's left island is two columns whose widths change together, driven by
**two independent timelines**:

- The nav column (`apps/web/src/components/app-sidebar.tsx`, the
  `<nav aria-label="Sections">` element with `className="app-nav …"`) is sized
  by CSS in `apps/web/src/styles.css`:
  ```css
  .app-nav {
    width: 15rem;
    transition: width var(--dur-base) var(--ease-out);
  }
  ```
  `--dur-base` is `150ms` and `--ease-out` is `cubic-bezier(0.23, 1, 0.32, 1)`
  (both declared in `apps/web/src/styles.css`, lines 147-150).

- The panel beside it is a `motion.div` animating `width` with
  `springProductive` (`apps/web/src/lib/motion.ts`:
  `{ type: "spring", bounce: 0, visualDuration: 0.13 }`).

A spring and a front-loaded cubic-bezier do not track each other. Because one
column grows while the other shrinks, the SUM of the two is not monotonic, so
the whole island — and therefore the page beside it — changes width in the wrong
direction before settling.

## Measured evidence

Sampled per animation frame in Chrome at 1512px, `getBoundingClientRect().width`
of the island that contains both columns:

| Transition | Resting before | Resting after | Actual excursion |
| --- | --- | --- | --- |
| Home → Settings (panel opens) | 240px | 296px | **dips to 110px** |
| Settings → Home (panel closes) | 296px | 240px | **bulges to 405px** |

Opening makes the page island jump ~130px WIDER and snap back. Closing makes it
jump ~110px NARROWER and snap back. Every row, table and chart on the page
re-lays out twice per navigation.

## The fix

Drive both halves off the identical curve. Do not convert the CSS rule to
Motion: the CSS rule is load-bearing for first paint (see the comment above
`.app-nav` in `styles.css` — `navInitScript` sets `data-nav` before React
exists). Instead, give the panel's width animation the same duration and the
same cubic-bezier as the CSS transition.

With both columns on the same normalised progress `p`, the sum becomes exactly
linear and therefore monotonic:

- opening: `nav = 240 - 184p`, `panel = 240p` → sum = `240 + 56p` (240 → 296)
- closing: `nav = 56 + 184p`, `panel = 240 - 240p` → sum = `296 - 56p` (296 → 240)

### Step 1 — add the shared transition to `apps/web/src/lib/motion.ts`

Append beside the existing spring presets, keeping the file's comment style:

```ts
/**
 * The shell's two columns changing width together.
 *
 * Deliberately NOT a spring, and deliberately not `springProductive`: the nav
 * column's width is a CSS transition (`.app-nav` in `styles.css`), because the
 * collapsed choice has to be applied before React exists. A spring beside a
 * cubic-bezier makes the SUM of the two columns non-monotonic — the island
 * bulged to 405px on its way from 296px to 240px — so the page beside it
 * jumped wider and snapped back on every navigation. Identical curve, identical
 * duration, and the sum is linear. Keep these two values equal to `--dur-base`
 * and `--ease-out`.
 */
export const shellColumnTransition: Transition = {
	duration: 0.15,
	ease: [0.23, 1, 0.32, 1],
};
```

### Step 2 — use it in `apps/web/src/components/app-sidebar.tsx`

In the panel's `AnimatePresence` block, replace:

```tsx
	transition={springProductive}
```

with:

```tsx
	transition={shellColumnTransition}
```

Update the import on line ~49 from
`import { springLayout, springProductive } from "#/lib/motion.ts";`
to
`import { shellColumnTransition, springLayout } from "#/lib/motion.ts";`
(alphabetical — `oxfmt`'s `sortImports` enforces the order inside the braces).

`springProductive` has no other use in this file; if `oxlint` reports it as an
unused import, the replacement above already removed it.

### Step 3 — update the comment that names the old transition

Directly above the `AnimatePresence` in `app-sidebar.tsx` there is a comment
ending:

```
				    Width is the one property `MotionConfig reducedMotion="user"` does
				    not drop (it drops transform, scale and slide), so this branches on
				    the preference itself — the same note as the old settings
				    sub-menu. */}
```

Add one sentence to it: that the transition is shared with `.app-nav`'s CSS rule
on purpose, and the two must stay equal.

## Scope boundary

- Do NOT change `--dur-base` or `--ease-out` in `styles.css`. Other components
  read both.
- Do NOT change `springProductive`, `springLayout` or any other preset.
- Do NOT convert `.app-nav`'s width to a React/Motion value.
- Do NOT touch the `reduced` branches in the same `AnimatePresence`; those are
  plan 003.
- Touch exactly two files: `apps/web/src/lib/motion.ts` and
  `apps/web/src/components/app-sidebar.tsx`.

## Verification

1. `bun run typecheck` and `bun run check` from the repo root — both must exit 0.
2. In a real browser at `http://localhost:3000/<org>`, with the sidebar expanded,
   paste this into the console and navigate Home → Settings:

   ```js
   const el = document.querySelector('nav[aria-label="Sections"]').closest('.island');
   const w = []; const t0 = performance.now();
   (function tick(){ w.push(+el.getBoundingClientRect().width.toFixed(1));
     if (performance.now()-t0 < 800) requestAnimationFrame(tick);
     else console.log('min', Math.min(...w), 'max', Math.max(...w)); })();
   ```

   **Pass:** `min` ≥ 239 and `max` ≤ 297 for the opening direction, and
   `min` ≥ 239 / `max` ≤ 297 for the closing direction. Any value outside
   240-296 is the defect still present.
3. Feel-check: navigate Home ↔ Settings repeatedly at normal speed. The page
   content must only ever slide one way. If you see it widen-then-narrow, the
   curves are still not equal.
4. Feel-check interrupted: click Settings and click Home again after ~60ms. The
   island must reverse from where it is, not jump.


## What actually shipped

Matching the curve was **not sufficient**. Implemented as written, the measured
excursion moved rather than disappeared: opening still reached 403px, closing
still dipped to 132px. A per-frame trace of the two columns separately showed
why — the sum was correct from 61ms onward, but the nav's CSS transition began
about 30ms after Motion's, across a dropped frame while the Settings route
committed:

```
27ms nav=240 panel=0     sum=240
29ms nav=240 panel=33.9  sum=273.9   <- panel moving, nav not yet
59ms nav=217.9 panel=182.1 sum=400.0 <- the spike
61ms nav=116.1 panel=184.8 sum=300.9 <- nav catches up in one frame
```

A CSS transition and a Motion animation are two clocks with two start times. The
curve was never the problem; the start was. The shipped fix therefore moves the
**panel's** width onto CSS as well, so both are one property on one curve started
by one style recalculation:

- `styles.css` gained `--dur-nav: 240ms` and a shared
  `.app-nav, .app-panel { transition: width var(--dur-nav) var(--ease-in-out); }`
- `data-panel` moved onto the island (the two columns' common parent), so one
  attribute flip drives both widths.
- The panel is now always mounted at `width: 0; overflow: hidden` instead of
  going through `AnimatePresence`, with `inert` when closed and a `lastPanel`
  ref so a closing panel narrows around its own contents.
- `shellColumnTransition` was therefore never needed and has been removed again.
- The reduced-motion branch is gone: `:root[data-motion='reduce']` already kills
  CSS transitions, which retires plan 003.

Verified: island stays within [240, 296] in both directions.
