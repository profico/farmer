import type { ReactNode } from "react";
import { ScrollFade } from "#/components/ui/scroll-fade.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * The layout vocabulary every $orgSlug/* screen is built from.
 *
 * The app is a centered frame (`.app-frame`) holding islands (`.island`): the
 * sidebar, and the page beside it. An island carries the surface and the corner;
 * what separates one from the next is the ground showing through the gap. That
 * is the whole model, and it replaces the previous one, where a section was a
 * hairline rule pulled out to the content edge by a negative margin. That idiom
 * was copy-pasted into fourteen places and had drifted in every one of them —
 * different top margins, `border-t` vs `border-y` vs `border-b` — and the
 * negative margin resolved against whatever max-width each screen happened to
 * set for itself, so the same "full-bleed" rule stopped at a different x on Day,
 * on Week and on Settings. Islands have no such freedom: the frame sets the one
 * width, and an island simply fills it.
 *
 * Use `Page` for a normal scrolling screen and `PageFull` for one that owns the
 * viewport height (the calendar views, the master/detail screens). Inside
 * either, `PageSection` is a stacked island and `SettingList`/`SettingRow` are
 * the one ruled-list idiom.
 */

/**
 * A normal screen: one island, padded, scrolling with the document.
 *
 * Takes no width prop on purpose. Every page is exactly as wide as the frame,
 * which is what makes them line up with each other.
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
			<ScrollFade className={cn("island-pad", className)}>
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
				"island flex min-h-0 flex-1 flex-col",
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
 * The header a screen opens with: an eyebrow line stating what you're looking
 * at, the serif title under it, and optionally a line of lede.
 *
 * The eyebrow row is what fixes the geometry. `action` sits at its far right, so
 * the title always begins at the same height whether or not the screen has one,
 * and a control never moves as you walk through the sidebar.
 *
 * `eyebrow` is required for that reason. Every screen can say what slice of data
 * it is showing — a date, a window, a scope — and a screen that genuinely can't
 * is a screen that doesn't know what it is.
 */
export function PageHeader({
	eyebrow,
	title,
	lede,
	action,
	className,
}: {
	eyebrow: ReactNode;
	title: ReactNode;
	lede?: ReactNode;
	action?: ReactNode;
	className?: string;
}) {
	return (
		<header className={cn("mb-7", className)}>
			{/* min-h holds the row open on screens with no action, so a missing
			    button can't pull the title up a line. */}
			<div className="section-head min-h-3.5">
				<div className="eyebrow-lg">{eyebrow}</div>
				{action}
			</div>
			<h1 className="h1 mt-4">{title}</h1>
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
 */
export function PageSection({
	title,
	description,
	action,
	children,
	className,
	contentClassName,
	standalone = false,
	/** Off for the first section under a PageHeader, which needs no rule above it. */
	divided = true,
}: {
	title?: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
	children: ReactNode;
	className?: string;
	contentClassName?: string;
	standalone?: boolean;
	divided?: boolean;
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

	if (standalone) {
		return (
			<section className={cn("island island-pad", className)}>
				{head}
				<div className={cn(head ? "mt-5" : undefined, contentClassName)}>
					{children}
				</div>
			</section>
		);
	}

	return (
		<section
			className={cn(
				divided && "-mx-4 mt-7 border-t px-4 pt-6 sm:-mx-8 sm:px-8",
				!divided && "mt-7",
				className,
			)}
		>
			{head}
			<div className={cn(head ? "mt-5" : undefined, contentClassName)}>
				{children}
			</div>
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
}: {
	children: ReactNode;
	className?: string;
}) {
	return <div className={cn("flex flex-col", className)}>{children}</div>;
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
