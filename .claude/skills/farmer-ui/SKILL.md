---
name: farmer-ui
description: The design procedure for any visual work in this repo. Invoke before changing a component, a screen, a token or a stylesheet, and before producing a design artifact. Loads the four review lenses (taste-skill redesign audit, minimalist editorial rules, high-end visual craft, Vercel Web Interface Guidelines) and pins them to Farmer's own system in DESIGN.md.
---

# Farmer UI work

Invoke this before ANY visual change: a component, a screen, a token, a
stylesheet, or a design artifact. It exists so the design lenses are applied
visibly and in the same order every time, rather than from memory.

## Step 1 — read the system

Read `DESIGN.md` at the repo root. It is the authority on this product's
palette, type scale, radius-per-role, depth model, screen patterns and motion.
Anything below that contradicts it loses; anything it does not cover, the
lenses decide.

## Step 2 — read the four lenses, in this order

Installed at `~/.claude/skills/`. Read the files, do not work from memory.

1. **`redesign-existing-projects/SKILL.md`** — the audit checklist. Run the
   current screen through Typography, Color and Surfaces, Layout, Interactivity
   and States, Content, Component Patterns. List every hit before proposing
   anything. This is the diagnosis step and it is not optional on a redesign.
2. **`design-taste-frontend/SKILL.md`** — the anti-slop rules. Section 4
   (typography, colour calibration, layout diversification, materiality,
   interactive states), section 8 (dark mode protocol), section 9 (AI tells,
   including the em-dash ban and the decorative-dot ban), section 11 (the
   redesign protocol: preserve brand tokens, never change IA silently).
3. **`minimalist-ui/SKILL.md`** — the editorial rules for a dense product UI:
   structure by hairline and whitespace rather than by boxes, macro-whitespace,
   restraint in accent use, motion that is present but never distracting.
4. **`high-end-visual-design/SKILL.md`** — craft: spatial rhythm, nested
   surfaces, tactile feedback, spring motion. Take the rhythm and the
   micro-interaction guidance; ignore its marketing-page archetypes, which do
   not apply to a timesheet.

## Step 3 — check against the guidelines

Fetch `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`
and check the changed files against it: focus states, labels on every control,
`tabular-nums` on every column of digits, hover states, reduced motion, URL as
state, semantic HTML, contrast in both themes.

## Step 4 — state what you applied

In the reply, name the specific rules that drove each decision. "Reduced the
figure because redesign-skill flags oversized display numbers" is checkable;
"made it tidier" is not. When a lens was consulted and had nothing to say, say
so rather than implying it drove the change.

## Step 5 — both themes, always

Nothing ships having been seen in one theme. `data-theme` on `<html>` is the
whole switch.

## House rules that outrank the lenses

- **The accent hue never changes.** `#6f4ebe` in light, one step lighter in
  dark for contrast. Not negotiable, whatever a lens says about purple.
- **One typeface** (Geist), weights 400 / 500 / 600 only.
- **Radius by role**, from DESIGN.md. Never a new radius.
- **Semantic colour is a label on a tint, never a fill.**
- Where a lens contradicts DESIGN.md, DESIGN.md wins and the lens is noted.
