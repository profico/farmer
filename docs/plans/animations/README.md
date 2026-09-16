# Animation plans — the shell's nav column and section panel

Audited at `cf262c3` against the sidebar's open/close motion, after a report of
the page content "popping" in width when the section panel opens.

Recon: TanStack Start + React, Motion (`motion/react`) for component motion, CSS
custom properties for chrome (`--dur-fast` 120ms, `--dur-base` 150ms,
`--dur-slow` 180ms; `--ease-out` `cubic-bezier(0.23, 1, 0.32, 1)`,
`--ease-in-out` `cubic-bezier(0.77, 0, 0.175, 1)`). Spring presets live in
`apps/web/src/lib/motion.ts`. Personality: a crisp dashboard — bounce is
reserved for dialogs and the tab-bar pill, chrome stays at `bounce: 0`.

Frequency: the shell is on screen on every authenticated route, and the nav is
the app's primary navigation, so these transitions run dozens of times a day per
person. That is what puts 001 at HIGH.

## Execution order

| # | Plan | Severity | Depends on | Status |
| --- | --- | --- | --- | --- |
| 001 | [Put the nav column and the section panel on one timeline](001-sync-nav-and-panel-timelines.md) | HIGH | — | TODO |
| 002 | [Let the nav labels clip away instead of popping](002-clip-nav-labels-instead-of-popping.md) | MEDIUM | — | TODO |
| 003 | [Stop the reduced-motion exit from bulging the island](003-reduced-motion-panel-exit.md) | MEDIUM | 001 (uses its transition) | TODO |

001 and 002 are independent and can run in either order or together. 003 reads
better after 001, because it reuses the transition 001 adds; it also needs its
defect confirmed in a browser before any code changes.

## Not planned

- **Animating `width` reflows the page on every frame.** Measured at 166 frames
  over 800ms, each one re-laying out the content island. This is inherent to a
  sidebar that takes space from the page — a transform-based version would
  overlap the content instead of displacing it, which is a different design.
  Accepted as by-design.
- **The panel's content is at full opacity from frame one**, so the section
  title and the rows are briefly squeezed inside an opening box. Real but LOW:
  at 150ms it is below the threshold where anyone reads the text.

## Missed opportunities

- The panel's rows could stagger in (~20ms apart, first six only) so the list
  reads as arriving rather than as already having been there. Additive; only
  worth it if the panel's opening is lengthened.
- The collapse toggle's icon (`SidebarSimpleIcon`) is identical in both states.
  A mirrored variant, or a 180° rotation on `--dur-fast`, would say which way
  the control goes before it is pressed.

---

# Global audit, 2026-09-16

A deep pass over the whole app against all eight AUDIT categories, plus the
Apple-design lens (response, interruptibility, materials, reduced motion).
Applied directly rather than written up as plans.

## Applied

| Area | Finding | Change |
| --- | --- | --- |
| `styles.css` `.rise` | `scaleY(0)` entrance at 600ms on the daily dashboard | starts at `scaleY(0.04)` + opacity, `--dur-nav` |
| `styles.css` `.rise` | bar height and verdict colour teleported when an entry was saved, beside a meter that eased | added `height` + `background-color` transition at `--dur-slow` |
| `styles.css` `.rail-fill` | 450ms written twice, both over budget | `--dur-nav` for the entrance, `--dur-slow` for the value change |
| `styles.css` "Less movement" | ended EVERY transition, including colour and opacity, which read as the app going dead | re-points `transition-property` at non-moving properties and keeps them at `--dur-fast` |
| `styles.css` "Less movement" | `scroll-behavior: auto` sat under `:root[…] *`, a descendant selector that can never match `<html>` — smooth scrolling survived the switch | own rule on `:root[data-motion='reduce']` |
| `styles.css` spinners | frozen flat by "Less movement" and ungoverned under the OS preference, so "working" and "finished" looked identical | slowed to 1.8s in both modes instead of stopped |
| `styles.css` `.scroll-fade` | reduced motion removed an opacity ramp that moves nothing | shortened to `--dur-fast` instead |
| `styles.css` popups | tooltip/select/combobox/submenu/alert-dialog enter on `tw-animate-css` keyframes, which `reducedMotion="user"` cannot see | reduced motion now zeroes their translate and scale, keeping the fade |
| `lib/motion.ts` | every JS tween re-typed `--ease-out`'s control points | `easeOut` / `easeInOut` exported; Rewind's two copies now import them |
| `lib/motion.ts` | `height: 0 → auto` collapses are untouched by `reducedMotion="user"`, and one carried a comment claiming otherwise | `useHeightTransition()`; applied to the entry row and the three banners |
| `switch.tsx` | the only overshoot curve outside the two sanctioned surfaces, on the control that toggles "Less movement" | `--ease-out` at `--dur-base` |
| `prompt-bar.tsx` | the slash-command palette animated open, and re-animated on every keystroke | entrance removed |
| `prompt-bar.tsx` | the keyboard cursor tweened `top` and `height` over 220ms, slower than key repeat | both snap; only the pointer hand-off fade remains |
| `prompt-bar.tsx` | send button pressed to `scale(0.94)` over 200ms | `0.97` at `--dur-fast` |
| `primitives.tsx` | 120ms uncapped stagger — an eight-tool turn finished arriving a second late | 40ms, capped at the fifth row |
| `primitives.tsx` | 500ms rail, 400ms disclosure, 350ms entrances, 300ms chevron | all inside the 300ms budget, on tokens |
| `primitives.tsx` | a third spinner tempo, inline, so reduced motion froze it | uses the shared `.spin` |
| `answer-chart.tsx` | 300ms layout transitions retargeted on every streamed delta | `--dur-base` |
| assistant subtree | the one un-tokenised island: `duration-100`/`150` and seven hand-typed beziers | on the token scale |
| `mobile-tab-bar.tsx` | `transition-colors` did not cover the press `transform`, so it snapped | transitions the transform, `0.985` → `0.97` |
| `landing.css` | hand-written `:hover` underline sweeps, ungated, sticking after a tap | behind `(hover: hover) and (pointer: fine)` |
| `landing.css` | no reduced-motion handling at all, and smooth scroll unguarded | both added |

## Found and deliberately not applied

- **`components/ui/sidebar.tsx` is mostly dead.** Only `SidebarProvider` and
  `SidebarInset` are imported anywhere. The unreferenced half holds the repo's
  only `transition-all`, three `ease-linear` layout transitions and a Cmd+B
  shortcut that toggles state nothing renders. The fix is deletion, which is a
  cleanup change rather than an animation one — it deserves its own commit.
- **Tooltip is still on `tw-animate-css` keyframes**, so a re-trigger restarts
  the zoom instead of retargeting. Moving it onto the `springProductive` bridge
  the other popups use is the right fix and touches every tooltip in the app.
- **`Select` never animates** — `alignItemWithTrigger` defaults true and
  `data-[align-trigger=true]:animate-none` wins, so the popup teleports.
  Changing it needs a judgement about Base UI's aligned-popup mode.
- **Duplicate keyframes**: `fade-in`/`field-in` are identical, `fade-up`/
  `block-in` differ by 2px. Consolidation, no user-visible effect.
- **Three missed opportunities** worth doing but larger than a motion tweak:
  `FadeSwap` on the Assemble-my-day dialog body, `FadeSwap` on the dashboard's
  day selection, and suppressing `.rise` when bars replace a skeleton that
  already drew them at full height.
- **Stepping days on the timesheet** was raised and rejected: it is a
  tens-of-times-a-day action, and AUDIT §1 says reduce rather than add.
