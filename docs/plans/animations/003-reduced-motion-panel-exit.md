# 003 — Stop the reduced-motion exit from bulging the island

- **Commit:** `cf262c3`
- **Severity:** MEDIUM
- **Category:** Accessibility
- **Status:** RETIRED — 001 removed the Motion path this plan was about

## The suspected defect

In `apps/web/src/components/app-sidebar.tsx` the panel branches on
`useReducedMotion()`:

```tsx
	initial={reduced ? { opacity: 0 } : { width: 0, opacity: 0 }}
	animate={reduced ? { opacity: 1 } : { width: PANEL_WIDTH, opacity: 1 }}
	exit={reduced ? { opacity: 0 } : { width: 0, opacity: 0 }}
```

On the reduced-motion path the panel never animates its width, so it holds its
full 240px for the whole of the exit's opacity fade. Meanwhile
`:root[data-motion='reduce']` in `apps/web/src/styles.css` (line 43) kills every
CSS transition, so the nav column snaps from 56px straight to 240px on frame one.

If the opacity fade still takes time, the island is momentarily 480px wide — a
bigger jump than the one plan 001 fixes, and it lands on exactly the readers who
asked for less movement.

Whether it actually happens depends on two things this plan cannot settle from
the code alone:

- `useReducedMotion()` reads the OS preference. The app's own "Less movement"
  switch writes `data-motion="reduce"` and sets Motion's
  `MotionGlobalConfig.instantAnimations` (see `apps/web/src/lib/display-prefs.ts`
  and the CLAUDE.md note). The two are separate signals and can disagree.
- With `instantAnimations` on, the exit completes in one frame and there is no
  defect. With only the OS preference set, the opacity fade runs at its normal
  length and the defect is real.

## Verify the defect exists

Before changing anything, reproduce it. In a real browser:

1. Turn the OS "reduce motion" setting ON, and leave the app's Preferences →
   Display → "Less movement" switch OFF.
2. Load a workspace, go to Settings, then click Home while sampling:

   ```js
   const el = document.querySelector('nav[aria-label="Sections"]').closest('.island');
   const w = []; const t0 = performance.now();
   (function tick(){ w.push(+el.getBoundingClientRect().width.toFixed(1));
     if (performance.now()-t0 < 800) requestAnimationFrame(tick);
     else console.log('max', Math.max(...w)); })();
   ```

3. `max` materially above 296 confirms it. If `max` is ~296, close this plan as
   NOT REPRODUCIBLE and change nothing.

## The fix, if it reproduces

Give the reduced-motion path the width change too, at zero duration, so the two
columns still resolve on the same frame:

```tsx
	initial={{ width: 0, opacity: reduced ? 1 : 0 }}
	animate={{ width: PANEL_WIDTH, opacity: 1 }}
	exit={{ width: 0, opacity: reduced ? 1 : 0 }}
	transition={reduced ? { duration: 0 } : shellColumnTransition}
```

Two things to keep straight:

- Opacity is pinned at 1 on the reduced path rather than animated. A fade is
  motion too, and the point of the branch is that nothing should move.
- `{ duration: 0 }` rather than dropping `width` from the object. The width has
  to REACH zero for the element to stop occupying space; leaving it unset is
  what causes the bulge in the first place.

If plan 001 has not landed yet, use `springProductive` in place of
`shellColumnTransition` and let plan 001 replace it.

Replace the comment above the `AnimatePresence` that currently reads "so this
branches on the preference itself" — after this change it no longer branches on
the property, it branches on the duration. Say that instead, and say why the
width must still animate to zero.

## Scope boundary

- Do NOT change the `:root[data-motion='reduce']` rule in `styles.css`. It is
  the app-wide switch and several components depend on it.
- Do NOT wire `useReducedMotion()` to the app's `data-motion` attribute. Those
  are two different signals on purpose and merging them is a product decision,
  not an animation fix.
- One file: `apps/web/src/components/app-sidebar.tsx`.

## Verification

1. `bun run typecheck` and `bun run check` — both exit 0.
2. Re-run the sampling snippet from "Verify the defect exists". **Pass:** `max`
   ≤ 297 and `min` ≥ 239 with the OS preference on.
3. With the OS preference ON, navigate Home ↔ Settings. Nothing may be seen to
   move: the panel is either there or not there, on consecutive frames.
4. With the OS preference OFF, re-run the plan 001 check — the ordinary animated
   path must be unchanged.


## Retired

001 shipped by moving the panel's width onto CSS, so there is no longer a
`useReducedMotion()` branch in `app-sidebar.tsx` at all. Reduced motion is now
handled by `:root[data-motion='reduce']` in `styles.css`, which kills every
transition including both columns'. Nothing to do.
