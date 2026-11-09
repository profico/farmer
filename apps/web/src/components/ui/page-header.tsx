import type { ReactNode } from "react";

import { ScrollFade } from "#/components/ui/scroll-fade.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * The layout vocabulary every $orgSlug/* screen is built from.
 *
 * The app is a centered frame (`.app-frame`) that holds islands (`.island`):
 * the sidebar and the page beside it. An island carries the surface and the
 * corner. The ground showing through the gap separates one island from the
 * next. The frame sets the one width, and an island fills it. Do not pull a
 * hairline to the content edge with a negative margin.
 *
 * Use `Page` for a normal scrolling screen and `PageFull` for one that owns the
 * viewport height (the calendar views, the master/detail screens). Inside
 * either, `PageSection` is a stacked island and `SettingList`/`SettingRow` are
 * the one ruled-list idiom.
 *
 * Both carry the `.screen` entrance (styles.css). A caller cannot ask for it,
 * so no screen can forget it.
 */

/**
 * A normal screen: one island, padded, scrolling with the document.
 *
 * Takes no width control of any kind, on purpose. The frame has exactly one
 * cap, and a page is exactly as wide as the frame lets it be — which is what
 * makes the pages line up with each other, and what stops the shell resizing
 * itself as somebody walks between them.
 *
 * `flex-1` is what makes a short screen still fill the window. Without it the
 * island is only as tall as its content, so a two-setting page floated as a
 * stub near the top of the viewport with a large field of bare ground under it
 * — the island has to *be* the page, not a card sitting on one.
 *
 * On desktop full height is also the CEILING, not just the floor: the island is
 * exactly as tall as the frame and its content moves inside it (`ScrollFade`),
 * so the ground stays visible on all four sides however long the page is.
 * Before this, a long timesheet grew the island past the bottom of the screen
 * and took the frame padding with it. On a phone the document still scrolls —
 * see the note on `.scroll-fade`.
 */
export function Page({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className="island flex flex-1 flex-col">
			<ScrollFade
				gutter
				className={cn("page-scroll island-pad screen", className)}
			>
				{children}
			</ScrollFade>
		</div>
	);
}

/**
 * A screen that owns the viewport height and scrolls internally — the calendar
 * views and the two-pane master/detail screens. Same island, but it fills the
 * frame's height and hands `min-h-0` to its children so an inner scroller
 * actually scrolls instead of pushing the island taller.
 */
export function PageFull({
	children,
	className,
	padded = true,
}: {
	children: ReactNode;
	className?: string;
	/** Off for screens whose content (a grid, a split pane) reaches the island's edge. */
	padded?: boolean;
}) {
	return (
		<div
			className={cn(
				"island screen flex min-h-0 flex-1 flex-col",
				padded && "island-pad",
				className,
			)}
		>
			{children}
		</div>
	);
}

/**
 * A column of stacked islands, for screens that read as separate panels rather
 * than one sheet. The gap between them is the same gap as between the sidebar
 * and the page, so the rhythm is the frame's, not the page's.
 */
export function PageColumn({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return <div className={cn("page-column", className)}>{children}</div>;
}

/**
 * The header a screen opens with: an optional eyebrow line, the serif title
 * under it, and optionally a line of lede.
 *
 * The eyebrow row holds `action` at its far right, so the title begins at the
 * same height whether or not the screen has one, and a control never moves as
 * you walk through the sidebar.
 *
 * An eyebrow carries live context or a way back: a date, a period, a count, a
 * return link. It is never a static label. With neither an eyebrow nor an
 * action the row is dropped and the title opens the header.
 *
 * The header owns the gap under itself (`mb-7`, the same 1.75rem as between
 * two `PageSection`s), and no caller may set it. Every screen must open with
 * the same distance. `className` is for flex-layout concerns only (`shrink-0`
 * in a `PageFull` child), not for a margin.
 *
 * Nothing may sit in that gap. The `.screen` rules in styles.css drop the
 * hairline off the first `PageSection`, or off a bleeding `<Table>` placed
 * directly under the header, because the header is already the boundary.
 */
export function PageHeader({
	eyebrow,
	title,
	lede,
	action,
	className,
}: {
	eyebrow?: ReactNode;
	title: ReactNode;
	lede?: ReactNode;
	action?: ReactNode;
	/** Layout only — never a margin. See the note above. */
	className?: string;
}) {
	const hasRow = eyebrow != null || action != null;
	return (
		<header className={cn("mb-7", className)}>
			{/* min-h holds the row open on screens with no action, so a missing
			    button can't pull the title up a line. */}
			{hasRow && (
				<div className="section-head min-h-3.5">
					<div className="eyebrow-lg">{eyebrow}</div>
					{action}
				</div>
			)}
			<h1 className={cn("h1", hasRow && "mt-4")}>{title}</h1>
			{lede && <p className="lede mt-2 max-w-[62ch]">{lede}</p>}
		</header>
	);
}

/**
 * One band of a page. Inside a `Page` it's a hairline-separated band; given
 * `standalone`, it's its own island in a `PageColumn`.
 *
 * The hairline runs the full width of the island's padding box (the `-mx`/`px`
 * pair), so it meets the island's own edge rather than stopping short of it —
 * the bug that made Day's and Week's footers look truncated. Because the island
 * clips to its radius, the rule terminates on the corner cleanly.
 *
 * A section always asks for its rule; the PAGE decides that the first one does
 * not get it (`.screen > section:first-of-type`, styles.css). This used to be a
 * `divided` prop with the note "off for the first section under a PageHeader",
 * and in the whole tree no caller ever passed it — which is what a per-caller
 * opt-out is worth against a rule that holds on every screen without exception.
 * Stack the sections and the geometry is already right.
 */
export function PageSection({
	id,
	title,
	description,
	action,
	children,
	className,
	contentClassName,
	standalone = false,
}: {
	/** An anchor, for a link that points at this section. */
	id?: string;
	title?: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
	/** Optional: a section that is only a title and a note is a real section. */
	children?: ReactNode;
	className?: string;
	contentClassName?: string;
	standalone?: boolean;
}) {
	const head = (title || action) && (
		<div className="section-head">
			<div>
				{title && <h2 className="eyebrow">{title}</h2>}
				{description && (
					<p className="mt-2 max-w-[68ch] text-sm leading-normal text-muted-foreground">
						{description}
					</p>
				)}
			</div>
			{action}
		</div>
	);

	// An empty content div would still contribute its `mt-5`, so a prose-only
	// section would sit 20px taller than its neighbours for nothing.
	const body = children != null && (
		<div className={cn(head ? "mt-5" : undefined, contentClassName)}>
			{children}
		</div>
	);

	if (standalone) {
		return (
			<section id={id} className={cn("island island-pad", className)}>
				{head}
				{body}
			</section>
		);
	}

	return (
		<section
			id={id}
			className={cn(
				"-mx-4 mt-7 border-t px-4 pt-6 sm:-mx-8 sm:px-8",
				className,
			)}
		>
			{head}
			{body}
		</section>
	);
}

/**
 * A list of settings rows separated by hairlines. This is the app's single
 * ruled-list idiom — before it, Preferences stacked its sign-in methods with a
 * plain `gap-5` while the Notifications block directly under it ruled its rows,
 * so one screen showed two different answers to the same question.
 */
export function SettingList({
	children,
	className,
	bleed = true,
}: {
	children: ReactNode;
	className?: string;
	/**
	 * Whether the rows' hairlines reach the island's own edge.
	 *
	 * On by default, because that is what every `PageSection` above them already
	 * does: a section's rule runs the full width of the island's padding box, so
	 * a list of rows that stopped 32px short of it drew two different left edges
	 * down one screen — the section rules at the island's edge and the row rules
	 * inset from it. Turn it off only where the list sits in a container
	 * narrower than the island, since the bleed resolves against the PARENT and
	 * would then overhang whatever that container is.
	 */
	bleed?: boolean;
}) {
	return (
		<div
			className={cn("flex flex-col", bleed && "setting-list-bleed", className)}
		>
			{children}
		</div>
	);
}

/**
 * One row of a `SettingList`: a label, a note under it, and a control at the
 * right. The rule sits on the top edge and the first row suppresses it, so a
 * list never opens or closes on a hairline.
 */
export function SettingRow({
	icon,
	title,
	description,
	badge,
	action,
	className,
}: {
	icon?: ReactNode;
	title: ReactNode;
	description?: ReactNode;
	badge?: ReactNode;
	action?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-col items-start gap-3 border-t border-line2 py-4 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
				className,
			)}
		>
			<div className="flex min-w-0 items-start gap-3">
				{icon && (
					<span className="flex size-5 shrink-0 items-center justify-center">
						{icon}
					</span>
				)}
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2 text-base font-medium">
						{title}
						{badge}
					</div>
					{description && (
						<p className="mt-1 max-w-[68ch] text-sm leading-normal text-muted-foreground">
							{description}
						</p>
					)}
				</div>
			</div>
			{action && <div className="shrink-0">{action}</div>}
		</div>
	);
}
