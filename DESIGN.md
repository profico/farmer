---
version: alpha
name: Farmer
description: "A time-tracking product UI with exactly two islands, the navigation and the page, on a recessed ground; nothing inside the page is a card. Hedvig Letters Serif sets page titles and the big numbers, Inclusive Sans everything else, and Geist Mono every column of figures. Warm grey neutrals by default, with five other neutral sets as a per-device choice; the accent is always the logo's #6f4ebe. Both themes are written out in full and switch on one attribute."

colors:
  accent: "#6f4ebe"
  accent-dark: "#9b84e6"
  ink: "#1b1a17"
  ink-muted: "#6f695f"
  ink-faint: "#928b80"
  ground: "#efece5"
  island: "#faf9f6"
  band: "#f4f2ed"
  floating: "#ffffff"
  hairline: "rgba(27, 26, 23, 0.11)"
  hairline-soft: "rgba(27, 26, 23, 0.06)"
  dark-ink: "#ede8de"
  dark-ink-muted: "#8f887c"
  dark-ink-faint: "#6b6459"
  dark-ground: "#0e0d0a"
  dark-island: "#1a1914"
  dark-band: "#232219"
  dark-floating: "#232219"
  semantic-ok: "#067037"
  semantic-warn: "#895700"
  semantic-bad: "#b42b2b"
  dark-semantic-ok: "#5fb883"
  dark-semantic-warn: "#d4a548"
  dark-semantic-bad: "#e4736d"

typography:
  page-title:
    fontFamily: Hedvig Letters Serif
    fontSize: 34px
    fontWeight: 400
    lineHeight: 1.10
    letterSpacing: -0.015em
  headline:
    fontFamily: Hedvig Letters Serif
    fontSize: 23px
    fontWeight: 400
    lineHeight: 1.20
    letterSpacing: -0.01em
  lede:
    fontFamily: Inclusive Sans
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: Inclusive Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.45
  caption:
    fontFamily: Inclusive Sans
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.40
  eyebrow:
    fontFamily: Inclusive Sans
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.00
    letterSpacing: 0.08em
    textTransform: uppercase
  figure:
    fontFamily: Hedvig Letters Serif
    fontSize: 26px
    fontWeight: 400
    lineHeight: 1.00
  mono:
    fontFamily: Geist Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: -0.03em
    fontFeature: tnum
  button:
    fontFamily: Inclusive Sans
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.00

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

Farmer is a dense product UI, read for minutes at a time and operated with a keyboard, so the system is built for scanning. The whole shell is a centered frame holding **exactly two islands**, the sidebar and the page, cut from `{colors.island}` and standing on `{colors.ground}`; what separates them is the ground showing through the gap, never a border and never a shadow.

**Nothing inside the page is a card.** Structure inside the page is hairlines and space: sections are divided by `{colors.hairline}`, repeated rows by `{colors.hairline-soft}`, figures sit in a band between two hairlines. A filled, rounded box inside the page is reserved for a control (a button, a field, a chip, a selected option); a block of content never gets one. Floating things (menus, popovers, dialogs, toasts) are not inside the page and keep their surface.

**Key characteristics**

- Three faces, each with one job. Hedvig Letters Serif for page titles and the big numbers; Inclusive Sans for everything else; Geist Mono for every column of figures, tables, ids and codes. "Boring font" (Preferences → Display) puts Inclusive Sans on the titles and numbers too.
- Hedvig Letters Serif has one weight. Titles and figures are 400 and weight synthesis is off; hierarchy comes from size. Inclusive Sans carries 400 / 500 / 600.
- Neither Hedvig nor Inclusive Sans has tabular figures, so anything read down a column (entry times, the timesheet grid, report tables, a day total) is Geist Mono.
- Text is binary: `{colors.ink}` or `{colors.ink-muted}`. `{colors.ink-faint}` is for placeholders and disabled labels.
- Warm grey neutrals by default (production's), with five other neutral sets as a per-device choice. The accent, green/amber/red and the task group colours are the same in all of them.
- One accent, the logo's violet, for actions, links, focus and selection.

## Colors

### Accent

- **Violet** (`{colors.accent}`): every filled primary control, link, focus ring and selected state. In dark it lifts one step to `{colors.accent-dark}` so violet text passes 4.5:1 on the island; the hue is the same. It never changes with the colour choice.

### Surfaces (light / dark)

- **Ground** (`{colors.ground}` / `{colors.dark-ground}`): what `body` is painted. It only shows through as the gap around the two islands.
- **Island** (`{colors.island}` / `{colors.dark-island}`): the paper of the sidebar and of the page.
- **Band** (`{colors.band}` / `{colors.dark-band}`): a filled field, a secondary button, a selected nav row or option. A control surface, never a content box.
- **Floating** (`{colors.floating}` / `{colors.dark-floating}`): a menu, a popover, a dialog, a toast. White in light; the band in dark.
- **Hairline** (`{colors.hairline}`) divides sections and the top and bottom of a band of figures; **hairline-soft** (`{colors.hairline-soft}`) separates repeated rows and the cells of a band.

### Colour choices

Preferences → Display → Colours sets `data-palette` on `<html>` (`lib/palette.ts`, applied before paint like the theme). Each choice swaps ground, island, band, the three text greys and the hairlines mixed from the ink, in light and in dark, and nothing else:

| Choice | Light ground / island / band / ink | Dark ground / island / band / ink |
|---|---|---|
| Warm grey (default) | #efece5 / #faf9f6 / #f4f2ed / #1b1a17 | #0e0d0a / #1a1914 / #232219 / #ede8de |
| Violet grey | #f1f0f5 / #fcfcfd / #f3f2f7 / #111016 | #0a090c / #141317 / #1d1c22 / #f1f0f4 |
| Teal | #e2ecec / #f8fbfb / #ecf3f3 / #131b1c | #091112 / #121c1e / #1b282a / #eef3ef |
| Graphite | #ece9e5 / #fbfaf9 / #f3f1ee / #1b1916 | #0f0e0d / #191816 / #24221f / #efebe5 |
| Cocoa | #f1e7e2 / #fdfaf8 / #f7efec / #201713 | #0f0b09 / #1a1411 / #261d19 / #f7ece5 |
| Lilac | #ebe7f3 / #fbfafe / #f2f0f8 / #1b1721 | #121017 / #1f1b27 / #2c2635 / #f6f1fb |

Every light set passes 4.5:1 for ink and muted ink on island and band, and 3:1 for placeholders on band. A new choice has to pass the same checks before it ships.

### Semantic

- **OK** (`{colors.semantic-ok}` / `{colors.dark-semantic-ok}`), **warn** (`{colors.semantic-warn}` / `{colors.dark-semantic-warn}`), **bad** (`{colors.semantic-bad}` / `{colors.dark-semantic-bad}`): verdicts, status pills, the week chart, and the one red also marks a destructive action, a form error and an invalid field. Always as text on a 12% tint, never as a fill. In light they are dark enough for that label to pass 4.5:1 on its own tint on every colour choice; at their old values it sat near 3.6:1.
- **Task groups** (`--group-*`): engineering #486370, product #8e4d37, learning #50634f, time off #7a5a05 in light (lifted in dark), general is muted ink. Chips are the group colour on a 15% tint.

## Typography

Hedvig Letters Serif (optical sizes 12–24, one weight) and Inclusive Sans (300–700) from Google Fonts, with Geist Mono beside them. Tracking stays near zero: the serif is pulled in slightly at title size, the sans is set as drawn.

| Token | Face | Size | Weight | Use |
|---|---|---|---|---|
| `{typography.page-title}` | Hedvig Letters Serif | 34px | 400 | The `PageHeader` title, `.h1` |
| `{typography.headline}` | Hedvig Letters Serif | 23px | 400 | Dialog titles, `.h2` |
| `{typography.figure}` | Hedvig Letters Serif | 26px | 400 | A target figure, a `Metric`, `FigureCell` |
| `{typography.lede}` | Inclusive Sans | 16px | 400 | The line under a page title |
| `{typography.body}` | Inclusive Sans | 14px | 400 | Everything else |
| `{typography.caption}` | Inclusive Sans | 13px | 400 | Notes under a setting, captions |
| `{typography.eyebrow}` | Inclusive Sans | 12px | 500, caps | Section labels, column heads |
| `{typography.mono}` | Geist Mono | 13–15px | 400–500 | Columns of figures, tables, ids, codes |

- **Display rules turn weight synthesis off** (`font-synthesis-weight: none`), so a `font-semibold` next to `font-display` renders the serif's real 400 instead of a smeared fake bold.
- **"Boring font"** (`data-font="sans"`) re-points `--serif` at Inclusive Sans and gives the display rules 600 and -0.02em. A new display rule must read `var(--serif)`, never name a face.
- **Columns of figures are Geist Mono** (`.mono`). A single figure, or a number inside a sentence, stays in its own face. `.tnum` only asks for tabular figures and does nothing in Hedvig or Inclusive Sans.
- Headings take `text-wrap: balance`. Ellipses are `…`, never three dots.

## Shapes

One answer per role, applied everywhere:

| Token | Value | Use |
|---|---|---|
| `{rounded.control}` | 8px | Buttons, fields, selects, menu items, project icons |
| `{rounded.md}` | 6px | Small buttons, chips |
| `{rounded.nav}` | 10px | Sidebar rows |
| `{rounded.floating}` | 12px | Menus, popovers, toasts |
| `{rounded.dialog}` | 16px | Dialogs, islands |
| `{rounded.full}` | round | Badges, status pills, avatars, calendar days, the floating mobile tab bar |

Buttons are rounded rectangles, not pills, so a button beside a field reads as the same family of control.

## Elevation

| Level | Treatment | Use |
|---|---|---|
| 0 | Ground | The body |
| 1 | Island paper | The sidebar and the page, nothing else |
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
- **Target band** (`ui/stat-tile.tsx`, `StatTiles` / `StatTile`): cells side by
  side between two hairlines, each a label, a figure in the display face, a
  caption and a thin meter carrying the verdict colour. For a figure that is a
  proportion of a target: home's three, the timesheet's two.
- **Figure band** (`ui/stat-tile.tsx`, `FigureBand` / `FigureCell`): plain cells
  divided by soft hairlines, never boxed, for figures that are not a proportion
  of anything. The project page's four.
- **Entry row** (`time/entry-block-row.tsx`): a row of a list closed by the soft
  hairline, no fill. A code-and-mark stub at the left, identity on line one
  (project, client, task), the note on line two aligned under the project name,
  and the time in Geist Mono pinned to the top right. The list's own top rule is
  its parent's.
- **Task colour is the GROUP's colour**, not the task's (`lib/task-group-colors.ts`).
  Five groups, five colours, so it is a family you can learn. The taxonomy's
  per-task colours are not used on rows.
- **Counting figures** (`ui/count-up.tsx`): a headline figure counts up from
  zero on first paint and tweens between values afterwards, so the number that
  changed is the one that moves.
- **Ghost row** (`ui/ghost-row.tsx`): a list ends on a quiet, boxless "add" row,
  and an empty list is a sentence plus that same row. No dashed boxes and no
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

- Structure the inside of the page with hairlines and space before anything else.
- Set every column of figures in Geist Mono.
- Keep Hedvig Letters Serif at 400; make a title bigger, never bolder.
- Use ink-muted for secondary text and reserve ink-faint for placeholders.
- Let a status colour be text on a tint.
- Check a new colour against every colour choice, in both themes.

## Don't

- Don't put a filled or bordered box around a block of content inside the page. Only controls and floating things have a surface.
- Don't add a third island, or a stacked panel beside the page.
- Don't set figures that are read down a column in Hedvig or Inclusive Sans; they don't line up.
- Don't put a border around a menu, a popover or a dialog. The shadow ring is the edge.
- Don't fill a button with red, green or amber. Semantic colour is a label, not a surface.
- Don't make a button a pill. Only what is round by nature (a badge, an avatar, a day) is round.
- Don't let a colour choice change the accent or a semantic colour.

## Iteration guide

1. Change a token in `apps/web/src/styles.css` before touching a component: both palettes and the five colour choices live there, in full, in layer 1 (`--bg`, `--fg`, `--acc`, …), and shadcn's names are derived from them.
2. Name a component by its entry above when asking for a change, and say which surface it lives on.
3. Check both themes and at least one other colour choice before finishing. `data-theme` and `data-palette` on `<html>` are the whole switch.
