# 002 — Let the nav labels clip away instead of vanishing

- **Commit:** `cf262c3`
- **Severity:** MEDIUM
- **Category:** Physicality & origin
- **Status:** REJECTED — tried, reverted, see "Why this was reverted"

## The defect

In `apps/web/src/components/app-sidebar.tsx`, every nav row draws its label
behind a conditional:

```tsx
	{!collapsed && (
		<span className="relative min-w-0 flex-1 truncate text-base">
			{item.label}
		</span>
	)}
```

`collapsed` flips on the same frame the column's width transition starts, so all
six labels are **removed from the DOM instantly** and the empty box then takes
150ms to shrink around nothing. The reverse is worse: the box widens for 150ms
and the labels appear fully formed at the end.

The column already carries `overflow-hidden`, so there is a more physical
version available at no cost: leave the labels mounted and let the narrowing
column cut them off. That reads as the column closing over the text, which is
what is actually happening.

The same conditional appears twice more in the file — on the "Report a problem"
row (the label plus its `ArrowUpRightIcon`), and in `UserMenu`'s trigger (the
name, the "Member" line and the `CaretUpDownIcon`).

## The fix

### Step 1 — stop the label from being a flex item that can compress

A `flex-1 truncate` label shrinks to zero width and ellipsises as the column
narrows, which is a second animation nobody asked for. The label must keep its
natural width and be clipped by the parent instead.

In `navRow`, replace the conditional with an always-mounted span:

```tsx
	<span
		aria-hidden={collapsed}
		className="relative min-w-0 flex-1 whitespace-nowrap opacity-100 transition-opacity duration-(--dur-fast) in-data-panel:opacity-0"
	>
		{item.label}
	</span>
```

Do NOT use `in-data-panel:` unless you confirm the variant resolves — the
reliable version is to drive it off the same `collapsed` boolean the component
already has:

```tsx
	<span
		aria-hidden={collapsed}
		className={cn(
			"relative min-w-0 flex-1 whitespace-nowrap transition-opacity duration-(--dur-fast)",
			collapsed && "opacity-0",
		)}
	>
		{item.label}
	</span>
```

`--dur-fast` is `120ms` (`apps/web/src/styles.css`, line 147), deliberately
shorter than the column's `150ms`: the text should be gone before the edge
reaches it, not cut mid-glyph.

`aria-hidden={collapsed}` is required. The row already carries
`aria-label={item.label}`, so without it a screen reader hears the name twice;
with it, the accessible name stays correct at both widths and no row loses its
label.

### Step 2 — apply the same treatment to the other two sites

- The "Report a problem" row: wrap its `<span>` and its `ArrowUpRightIcon` in the
  same always-mounted, opacity-driven wrapper.
- `UserMenu`'s trigger: same for the name block and the `CaretUpDownIcon`.

For `UserMenu`, the trigger's own classes switch between
`justify-center rounded-full` and `w-full gap-2.5 p-1.5 …`. Leave that switch
alone — it is a discrete change on a 28px avatar and does not read as motion.

### Step 3 — check the tooltips still gate correctly

`TooltipContent` carries `hidden={!collapsed}`. That stays exactly as it is: the
tooltip is what replaces the label at rail width, and the label being present in
the DOM but transparent must not bring the tooltip back.

## Scope boundary

- Do NOT remove `overflow-hidden` from the `<nav>`; it is what does the clipping.
- Do NOT change the column's width rule or its duration — that is plan 001.
- Do NOT add a width or transform animation to the labels. Opacity only; a label
  that also slides is two motions where one will do.
- Do NOT touch `panelLink` — the panel's rows are not affected.
- One file: `apps/web/src/components/app-sidebar.tsx`.

## Verification

1. `bun run typecheck` and `bun run check` — both exit 0.
2. In a real browser, collapse the sidebar with the toggle and watch the labels.
   **Pass:** the text fades as the edge closes over it. **Fail:** the text
   disappears a beat before the column moves.
3. Slow it down to judge it. In the console:
   `document.querySelector('.app-nav').style.transitionDuration = '2s'`
   then toggle. The labels must still be clipped by the moving edge, not
   reflowing or ellipsising as the column narrows.
4. Screen reader or accessibility inspector: at rail width every row must still
   report its name once, not twice and not zero times.


## Why this was reverted

Implemented and measured, this regressed the rail. An always-mounted label is a
flex item, and `flex-1 min-w-0` did not take it to zero: at 56px the row's
content measured icon 18px + gap 10px + label 39px = 67px in a 56px box. With
`justify-center` the whole row re-centred on the overflow, so the icon sat at
x=7.9 (outside the column, which starts at x=14) and the text ran to x=75 past
the 70px edge. `overflow-hidden` on the column cannot fix this — the overflow
belongs to the ROW, and the icon is displaced before any clipping happens.

Reverted to conditional rendering, which is correct for layout. The label pop it
causes is real but minor, and it is masked by the column's own movement.

A future attempt must take the label out of flow entirely (absolute positioning)
rather than relying on `min-w-0` to collapse it. The note now in the source at
that site records the constraint.
