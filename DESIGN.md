---
version: alpha
name: Farmer
description: "A time-tracking product UI built as lit islands on a recessed ground. One typeface, Geist, carries titles, body and figures, with hierarchy in size, weight and negative tracking rather than in a change of face. Neutrals lean faintly violet so they belong to the single accent, the logo's #6f4ebe. Depth is Framer's: three lifts of one neutral, and anything floating wears a light-edge shadow instead of a border. Both themes are written out in full and switch on one attribute."

colors:
  accent: "#6f4ebe"
  accent-dark: "#9b84e6"
  ink: "#111016"
  ink-muted: "#6b6876"
  ink-faint: "#8e8a99"
  ground: "#f1f0f5"
  island: "#fcfcfd"
  band: "#f3f2f7"
  floating: "#ffffff"
  hairline: "rgba(17, 16, 22, 0.10)"
  hairline-soft: "rgba(17, 16, 22, 0.06)"
  dark-ink: "#f1f0f4"
  dark-ink-muted: "#9895a3"
  dark-ink-faint: "#6d6a78"
  dark-ground: "#0a090c"
  dark-island: "#141317"
  dark-band: "#1d1c22"
  dark-floating: "#1d1c22"
  semantic-ok: "#2f8a4f"
  semantic-warn: "#9a6700"
  semantic-bad: "#c73f3b"

typography:
  page-title:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: 500
    lineHeight: 1.10
    letterSpacing: -0.025em
  headline:
    fontFamily: Geist
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.20
    letterSpacing: -0.02em
  lede:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: -0.01em
  body:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: -0.01em
  caption:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: -0.01em
  eyebrow:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.00
    letterSpacing: 0.08em
    textTransform: uppercase
  figure:
    fontFamily: Geist
    fontSize: 30px
    fontWeight: 600
    lineHeight: 1.00
    letterSpacing: -0.03em
    fontFeature: tnum
  mono:
    fontFamily: Geist Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: -0.03em
    fontFeature: tnum
  button:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.00
    letterSpacing: -0.01em

rounded:
  sm: 4px
  md: 6px
  control: 8px
  nav: 10px
  floating: 12px
  dialog: 16px
  island: 16px
  full: 9999px

spacing:
  hair: 1px
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 20px
  xl: 28px
  xxl: 32px
  frame-gap: 14px

components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.island}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: 0 12px
    height: 32px
  button-secondary:
    backgroundColor: "{colors.band}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: 0 12px
    height: 32px
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    border: "1px {colors.hairline}"
    height: 32px
  button-destructive:
    backgroundColor: "rgba(199, 63, 59, 0.10)"
    textColor: "{colors.semantic-bad}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    height: 32px
  text-input:
    backgroundColor: "{colors.band}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    border: "1px {colors.hairline-soft}"
    padding: 0 10px
    height: 32px
  text-input-focused:
    backgroundColor: "{colors.band}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    border: "1px {colors.accent}"
    shadow: "0 0 0 3px rgba(111, 78, 190, 0.16)"
  menu:
    backgroundColor: "{colors.floating}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.floating}"
    padding: 6px
  menu-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: 6px 8px
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.island}"
    typography: "{typography.caption}"
    rounded: "{rounded.control}"
    padding: 6px 10px
  dialog:
    backgroundColor: "{colors.floating}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.dialog}"
    padding: 24px
  island:
    backgroundColor: "{colors.island}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.island}"
    padding: 28px 32px
  nav-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.nav}"
    padding: 6px 10px
  nav-row-active:
    backgroundColor: "{colors.band}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.nav}"
    padding: 6px 10px
  status-pill:
    backgroundColor: "rgba(47, 138, 79, 0.12)"
    textColor: "{colors.semantic-ok}"
    typography: "{typography.eyebrow}"
    rounded: "{rounded.full}"
    padding: 0 8px
    height: 20px
  table-head:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.eyebrow}"
    height: 36px
---

## Overview

Farmer is a dense product UI, read for minutes at a time and operated with a keyboard, so the system is built for scanning: one family of type, three lifts of one neutral, one accent, and a strict answer to every shape question. The whole shell is a centered frame holding **islands** (the sidebar, the page, a stacked panel) cut from `{colors.island}` and standing on `{colors.ground}`; what separates one island from the next is the ground showing through the gap, never a border and never a shadow.

The reference for surfaces, radii and the typographic voice is Framer's marketing system: near-black canvas, surface lift for hierarchy, a floating card with a light top edge, negative tracking that scales with size, and weight held in a narrow band. Where Framer is dark only, Farmer writes both palettes out in full and switches them on `data-theme` on `<html>`.

**Key characteristics**

- One typeface. Geist for titles, body, captions and figures; Geist Mono only for what is an id (a sha, a project code) or a column of table figures.
- Hierarchy is size, weight (400 / 500 / 600) and tracking. There is no 700 anywhere.
- Text is binary: `{colors.ink}` or `{colors.ink-muted}`. `{colors.ink-faint}` exists for placeholders and disabled labels and nothing else.
- Neutrals lean violet. Every grey is mixed from the accent's family, so the accent reads as belonging rather than as a foreign colour.
- Depth is lift. Ground, island, band; a floating thing is one more step up and carries the light-edge shadow (`--shadow-pop`) instead of a border.
- One accent, the logo's violet, for actions, links, focus and selection. Green, amber and red are semantic and sit below it in chroma.

## Colors

### Accent

- **Violet** (`{colors.accent}`): every filled primary control, link, focus ring and selected day. In dark it lifts one step to `{colors.accent-dark}` so violet text passes 4.5:1 on the island; the hue is the same.

### Surfaces (light / dark)

- **Ground** (`{colors.ground}` / `{colors.dark-ground}`): what `body` is painted. Never painted on directly; it shows through the gaps.
- **Island** (`{colors.island}` / `{colors.dark-island}`): the paper of every panel, table and the sidebar.
- **Band** (`{colors.band}` / `{colors.dark-band}`): a recessed strip inside an island, a filled field, a lifted secondary button, the selected nav row.
- **Floating** (`{colors.floating}` / `{colors.dark-floating}`): a menu, a popover, a dialog, a toast. White in light; the band in dark.
- **Hairline** (`{colors.hairline}`) divides sections and outlines controls under the pointer; **hairline-soft** (`{colors.hairline-soft}`) separates repeated rows and rests on a field. Nothing else draws a line.

### Text

- **Ink** (`{colors.ink}` / `{colors.dark-ink}`) and **ink-muted** (`{colors.ink-muted}` / `{colors.dark-ink-muted}`). Both pass AA on every surface they sit on.

### Semantic

- **OK** (`{colors.semantic-ok}`), **warn** (`{colors.semantic-warn}`), **bad** (`{colors.semantic-bad}`): verdicts on the Tracking report, status pills, and the one red also marks a destructive action, a form error and an invalid field. Always as text on a 12% tint, never as a fill.

## Typography

Geist, variable 400 to 700, from Google Fonts, with Geist Mono beside it. Tracking pulls tighter as size grows: `-0.01em` at body, `-0.02em` on a headline, `-0.025em` on the page title, `-0.03em` on a large figure. Line height is tight for a product UI: 1.1 on the title, 1.2 on a headline, 1.45 on body.

| Token | Size | Weight | Tracking | Use |
|---|---|---|---|---|
| `{typography.page-title}` | 32px | 500 | -0.025em | The `PageHeader` title, `.h1` |
| `{typography.headline}` | 22px | 600 | -0.02em | Dialog titles, section headings, `.h2` |
| `{typography.lede}` | 16px | 400 | -0.01em | The line under a page title |
| `{typography.body}` | 14px | 400 | -0.01em | Everything else |
| `{typography.caption}` | 13px | 400 | -0.01em | Notes under a setting, table captions |
| `{typography.eyebrow}` | 12px | 500 | 0.08em, caps | Section labels, column heads, group labels |
| `{typography.figure}` | 30px | 600 | -0.03em, tnum | A `Metric`, the home targets |
| `{typography.mono}` | 13px | 400 | -0.03em, tnum | Ids, codes, table figures |

Every column of digits sets `font-variant-numeric: tabular-nums`. Headings take `text-wrap: balance`. Ellipses are `…`, never three dots.

## Shapes

One answer per role, applied everywhere:

| Token | Value | Use |
|---|---|---|
| `{rounded.control}` | 8px | Buttons, fields, selects, menu items, project icons |
| `{rounded.md}` | 6px | Small buttons, chips |
| `{rounded.nav}` | 10px | Sidebar rows |
| `{rounded.floating}` | 12px | Menus, popovers, toasts, cards |
| `{rounded.dialog}` | 16px | Dialogs, islands |
| `{rounded.full}` | round | Badges, status pills, avatars, calendar days, the floating mobile tab bar |

Buttons are rounded rectangles, not pills, so a button beside a field reads as the same family of control.

## Elevation

| Level | Treatment | Use |
|---|---|---|
| 0 | Ground | The body |
| 1 | Island paper | Every panel |
| 2 | Band | Fields, secondary buttons, selected rows |
| 3 | Floating + `--shadow-pop` | Menus, popovers, dialogs, toasts, the tab bar |
| 4 | `--lift` | A sheet, a drawer, a dragged row |

`--shadow-pop` is a 1px ring, a contact shadow and a long soft drop in light; in dark it adds a one-pixel highlight along the top edge, Framer's light-edge card. Nothing is raised because it is important.

## Components

- **`button-primary`**: violet fill, island-coloured text (white in light, the dark ink in dark). Hover mixes 14% ink into the fill; press scales to 0.97. Disabled drops the fill for a flat 9% grey.
- **`button-secondary`**: the band, no border. **`button-outline`**: hairline on transparent, for a control that sits on a busy surface. **Ghost**: a word in muted ink. **`button-destructive`**: the red at 10%.
- **`text-input`** and every trigger (select, combobox, date picker): the band with a soft hairline, firming to `--line-strong` on hover; accent border plus a 3px 16% ring on focus.
- **`menu`**: the floating surface at 12px with 6px padding; items at 8px with 6px by 8px padding; group labels are eyebrows; the destructive item is red.
- **`tooltip`**: inverted, ink on island, no border, no shadow; rises 2px on open.
- **`dialog`**: the floating surface at 16px; the title is `{typography.headline}`; the footer keeps a soft hairline and is sticky.
- **`nav-row`**: 10px; selected takes the band and the ink, hover takes the pointer tint. A shared-layout spring moves the selection between rows.
- **Segmented control**: the band as track, the island as the sliding pill.
- **Tables**: bleed to the island's edge; heads are eyebrows; rows are separated by the soft hairline; figures are tabular.
- **Status pill**: round, 12px medium, a semantic colour on its 12% tint.
- **Skeleton**: the hairline colour, breathing 1 to 0.55 on a 1.6s cycle, unstaggered.

## Screen patterns

Each of these is one component, used everywhere the shape recurs, so a screen
tidies with the pattern rather than on its own.

- **Page header** (`ui/page-header.tsx`): eyebrow for live context, 32px title,
  one lede, actions right with the primary last and secondaries as lifts. Never
  an outline button beside a filled one.
- **One toolbar** (`time/time-toolbar.tsx`): where you are on the left as a
  filled stepper, what you can do on the right, one row, 32px controls. The
  timesheet, the reports, the hour fund and the project page all take it.
- **Figure chips** (`ui/stat-tile.tsx`, `StatTiles` / `StatTile`): a progress
  ring, a label and a figure, in a card the width of what it holds. For a figure
  that is a proportion of a target. Home's three targets.
- **Figure band** (`ui/stat-tile.tsx`, `FigureBand` / `FigureCell`): plain cells
  divided by soft hairlines, never boxed, for figures that are not a proportion
  of anything. The project page's four.
- **Entry row** (`time/entry-block-row.tsx`): a code-and-mark stub at the left,
  identity on line one (project, client, task), the note on line two aligned
  under the project name, and the time in its own box pinned to the top right.
  The note clamps to two lines with a measured "Show more".
- **Task colour is the GROUP's colour**, not the task's (`lib/task-group-colors.ts`).
  Five groups, five colours, so it is a family you can learn. The taxonomy's
  per-task colours are not used on rows.
- **Counting figures** (`ui/count-up.tsx`): a headline figure counts up from
  zero on first paint and tweens between values afterwards, so the number that
  changed is the one that moves.
- **Ghost row** (`ui/ghost-row.tsx`): a list ends on the dashed row that adds to
  it, and an empty list is a sentence plus that same row. No dashed boxes and no
  centred placeholders with no action on them.
- **Row actions** (`.row-actions` on a `group/row`): hidden at rest, slid in 4px
  on hover or focus-within, always visible on touch. Icon buttons with tooltips,
  never three permanent words on every row.
- **Sparkline** (`ui/sparkline.tsx`): bars for a short history, the last one
  accented, rising in order.
- **Disclosure** (`ui/disclosure.tsx`): one height spring and one rotating
  chevron for everything that unrolls.
- **Sentences, not chains**: one fact per phrase, the number in medium, the
  qualifier muted, at most one middle dot per line.
- **Codes after names**: a project code is a small monospace chip after the
  name, never a bracketed prefix in front of it. Names then line up down a list.
- **Status only when it is not the default**: an "Active" pill on every row of
  a list of active things is a column carrying no information.

## Motion

Three speeds (120 / 150 / 180ms) and two curves. Entrances and exits ease out; travel eases in and out. Transform and opacity only.

- A page assembles: blocks rise 6px, staggered 28ms, capped at the fifth. A
  list inside one staggers its own rows 20ms apart (`.stagger`), capped at the
  twelfth.
- The week chart has ONE continuous target rule across all seven days and one
  baseline, so a column either reaches it or does not. A day is only coloured by
  verdict once it is over: green at a full day, amber part, red nothing, and a
  future day is a hairline.
- Bars and rails grow from zero (`.rise`, `.rail-fill`) and re-grow when the
  period or the sort changes.
- Menus and popovers spring from the trigger with a 4px rise; dialogs spring in with a blurred backdrop.
- The sidebar selection and the segmented control move by shared-layout spring.
- The theme toggle crossfades the whole document over 220ms through a view transition.
- The home target rails grow once from zero and ease between values.
- Everything stops under `prefers-reduced-motion` and under the app's own "Less movement" preference.

## Do

- Reach for lift before a border, and for a border before a shadow.
- Keep weight at 400, 500 or 600. Make a thing bigger or tighter before making it bolder.
- Use ink-muted for secondary text and reserve ink-faint for placeholders.
- Give every column of figures tabular numerals.
- Let a status colour be text on a tint.

## Don't

- Don't introduce a second typeface for emphasis. Italic or a step of weight in Geist is the move.
- Don't put a border around a menu, a popover or a dialog. The shadow ring is the edge.
- Don't fill a button with red, green or amber. Semantic colour is a label, not a surface.
- Don't add a fourth grey for text.
- Don't make a button a pill. Only what is round by nature (a badge, an avatar, a day) is round.
- Don't warm the neutrals. Every grey in this system leans violet.

## Iteration guide

1. Change a token in `apps/web/src/styles.css` before touching a component: both palettes live there, in full, in layer 1 (`--bg`, `--fg`, `--acc`, …), and shadcn's names are derived from them.
2. Name a component by its entry above when asking for a change, and say which surface it lives on.
3. Check both themes before finishing. `data-theme` on `<html>` is the whole switch.
