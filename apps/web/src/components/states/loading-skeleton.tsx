import type { ReactNode } from "react";

import { Skeleton } from "#/components/ui/skeleton.tsx";

/**
 * The app's loading states.
 *
 * All of them are the same idea: a placeholder cut to the shape of the thing
 * that is arriving, anchored where that thing will start. That is what a spinner
 * in the corner of an empty island could never do — it says "something is
 * happening" without saying *what*, so the page still lands as a surprise and
 * the eye has to re-find the top of it.
 *
 * Widths are hand-picked rather than random: a placeholder that reshuffles on
 * every render draws attention to itself, and `Math.random()` would differ
 * between the server render and the client's, which React would flag as a
 * hydration mismatch.
 */

/** Ragged but fixed line lengths, as a percentage of the row's text column. */
const ROW_WIDTHS = [70, 58, 46, 34, 62, 40] as const;

/**
 * A ruled list: colour chip, label, figure — the shape of the entry rows on the
 * timesheet and of most settings lists.
 */
export function ListLoadingSkeleton({ rows = 4 }: { rows?: number }) {
	const widths = ROW_WIDTHS.slice(0, rows);
	return (
		<div>
			{widths.map((width) => (
				<div
					key={width}
					className="flex items-center gap-3 border-t px-3 py-3 first:border-t-0"
				>
					<Skeleton className="size-2.5 shrink-0 rounded-sm" />
					<Skeleton className="h-3 flex-1" style={{ maxWidth: `${width}%` }} />
					<Skeleton className="h-3 w-11 shrink-0" />
				</div>
			))}
		</div>
	);
}

/**
 * A table: a lighter header rule, then rows of a label and right-aligned
 * figures. Used for the report panels, which are all this shape.
 *
 * `cols` counts the figure columns *after* the label, matching how the report
 * tables are built.
 */
export function TableLoadingSkeleton({
	rows = 5,
	cols = 3,
}: {
	rows?: number;
	cols?: number;
}) {
	const widths = ROW_WIDTHS.slice(0, rows);
	const figures = Array.from({ length: cols }, (_, i) => i);
	return (
		<div className="w-full">
			{/* The header rule, at the weight `TableHead` renders — without it the
			    first body row reads as the header and the table appears to shift
			    down by one when the data lands. */}
			<div className="flex items-center gap-6 border-b px-3 py-2.5">
				<Skeleton className="h-2.5 w-24 flex-1" />
				{figures.map((i) => (
					<Skeleton key={i} className="h-2.5 w-12 shrink-0" />
				))}
			</div>
			{widths.map((width) => (
				<div
					key={width}
					className="flex items-center gap-6 border-b px-3 py-3.5 last:border-b-0"
				>
					<div className="flex-1">
						<Skeleton className="h-3" style={{ maxWidth: `${width}%` }} />
					</div>
					{figures.map((i) => (
						<Skeleton key={i} className="h-3 w-12 shrink-0" />
					))}
				</div>
			))}
		</div>
	);
}

/**
 * A whole screen: the eyebrow and title where `PageHeader` puts them, then a
 * list below.
 *
 * This is the app-wide route fallback, so it can't know which screen is coming.
 * It commits to the one thing every `$orgSlug/*` screen does share — a header
 * over a ruled body — rather than guessing at a table or a calendar and being
 * wrong more often than right.
 */
export function PageLoadingSkeleton({ rows = 4 }: { rows?: number }) {
	return (
		<div>
			<Skeleton className="h-2.5 w-28" />
			<Skeleton className="mt-3 h-6 w-56" />
			<div className="-mx-4 mt-7 border-t sm:-mx-8">
				<ListLoadingSkeleton rows={rows} />
			</div>
		</div>
	);
}

// The nav's rows, named so the keys are stable, each with the width its label
// takes. The two at the foot (Settings and Report a problem) are not drawn —
// they sit against the footer rule, and a placeholder there reads as content
// rather than as chrome waiting.
const NAV_ROWS = [
	{ key: "home", width: 40 },
	{ key: "time", width: 34 },
	{ key: "projects", width: 58 },
	{ key: "reports", width: 52 },
	{ key: "assistant", width: 62 },
];

/**
 * The nav column, as a placeholder.
 *
 * It has to be here rather than reusing `AppSidebar` with empty props: the real
 * column needs the org and the session, and the whole reason this is on screen
 * is that neither has resolved yet.
 *
 * It carries `.app-nav`, so a reader who collapsed the column gets the rail
 * width here too — that rule reads `data-nav` off <html>, which the inline head
 * script has already set by this point (`lib/nav-collapse.ts`). The labels are
 * drawn either way and simply clip, which is the same frame the real column
 * spends before `useNavCollapsed` catches up.
 *
 * The column alone, with no section panel beside it: the panel belongs to
 * Settings and to Chat, and which section is being entered is not yet known —
 * an incoming panel that turns out not to exist is a 240px column that opens
 * and shuts itself, which is worse than one that opens a beat late. It takes
 * neither the hairline nor the darker paper for the same reason: both belong to
 * a column that has a panel beside it.
 */
function NavLoadingSkeleton() {
	return (
		// The geometry is `AppSidebar`'s own: 40px targets and a footer row at
		// `--footer-h`, so the hairline lands where the real one does.
		<div className="app-nav island sticky top-(--frame-pad) hidden h-[calc(100svh-2*var(--frame-pad))] shrink-0 flex-col self-stretch overflow-hidden md:flex">
			<div className="flex min-h-0 flex-1 flex-col gap-1 px-2.5 pt-2.5">
				{/* The workspace mark and its name, where the switcher sits. */}
				<div className="flex h-9 shrink-0 items-center gap-2.5 px-2">
					<Skeleton className="size-6.5 shrink-0 rounded-md" />
					<Skeleton className="h-3 w-24" />
				</div>
				<div className="h-1.5 shrink-0" />
				{NAV_ROWS.map(({ key, width }) => (
					<div
						key={key}
						className="flex h-10 shrink-0 items-center gap-2.5 px-2.5"
					>
						<Skeleton className="size-4.5 shrink-0 rounded-sm" />
						<Skeleton className="h-3" style={{ width }} />
					</div>
				))}
			</div>
			<div className="flex h-(--footer-h) shrink-0 items-center gap-2.5 border-t px-4">
				<Skeleton className="size-7 shrink-0 rounded-full" />
				<Skeleton className="h-3 w-20" />
			</div>
		</div>
	);
}

/**
 * The whole app shell, for the moment before the `$orgSlug` layout itself has
 * resolved — the sign-in hand-off, and any workspace switch.
 *
 * Without it that moment renders a lone page skeleton on bare ground: no frame,
 * no sidebar, no gap, because `.app-frame` and the sidebar both live *inside*
 * the layout route's component and a pending layout hasn't rendered it yet. The
 * result read as a different app for a beat rather than as this one loading.
 * Everything here is the shell's own geometry, which is knowable without any
 * data — only the page beside it is a guess.
 */
export function AppShellLoadingSkeleton({
	children,
}: {
	/** The incoming screen's own placeholder; falls back to the generic page. */
	children?: ReactNode;
}) {
	return (
		<div className="app-frame">
			<NavLoadingSkeleton />
			{/* Matches `SidebarInset`: transparent, so the ground shows between the
			    two islands the way it does once the real layout mounts. */}
			<main className="relative flex w-full min-w-0 flex-1 flex-col">
				{children ?? (
					<div className="island island-pad flex-1">
						<PageLoadingSkeleton />
					</div>
				)}
			</main>
		</div>
	);
}

// Fixed bar heights, in px, for the "this week by day" placeholder — including
// the two 2px stubs an unworked weekend leaves, so the row reads as a week of
// logged time rather than as a chart of nothing.
const DAY_BARS = [
	{ day: "mon", height: 34 },
	{ day: "tue", height: 48 },
	{ day: "wed", height: 26 },
	{ day: "thu", height: 41 },
	{ day: "fri", height: 30 },
	{ day: "sat", height: 2 },
	{ day: "sun", height: 2 },
];

/**
 * The dashboard, which is the one screen the generic page placeholder was
 * wrong about: it isn't a header over a ruled list, it's a header over two
 * figures, a target rail, a week of bars, and the day's entries beside them.
 * The generic version put four ragged lines where the metrics were about to
 * land, so the screen didn't so much resolve as get replaced.
 */
export function DashboardLoadingSkeleton() {
	return (
		<div className="island island-pad flex-1">
			<header className="mb-6">
				<div className="section-head min-h-3.5">
					<Skeleton className="h-2.5 w-52" />
					<Skeleton className="h-8 w-28 rounded-lg" />
				</div>
				{/* The h1 is 32px serif; this is its cap height, not its line box. */}
				<Skeleton className="mt-4 h-6 w-64" />
			</header>

			<div className="-mx-4 mt-6 grid border-t border-b sm:-mx-8 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] xl:divide-x">
				<div className="min-w-0">
					<div className="grid grid-cols-2 divide-x border-b">
						{["logged-today", "this-week"].map((key) => (
							<div key={key} className="px-4 py-5 sm:px-8">
								{/* The figure is set at 30px/1, so the placeholder is that
								    tall — a metric that arrives taller than its placeholder
								    shunts everything under it down. */}
								<Skeleton className="h-[30px] w-24" />
								<Skeleton className="mt-2.5 h-2 w-20" />
							</div>
						))}
					</div>

					<div className="border-b px-4 py-4 sm:px-8">
						<div className="flex items-baseline justify-between gap-3">
							<Skeleton className="h-2 w-40" />
							<Skeleton className="h-2.5 w-24" />
						</div>
						{/* The rail itself, unfilled — it's a 2px hairline either way, so
						    there is nothing to stand in for. */}
						<div className="bar mt-3" />
					</div>

					<div className="border-b px-4 py-4 sm:px-8">
						<Skeleton className="h-2 w-28" />
						<div className="mt-3.5 flex gap-2">
							{DAY_BARS.map(({ day, height }) => (
								<div
									key={day}
									className="flex min-w-0 flex-1 basis-0 flex-col items-center gap-2 py-1"
								>
									<div className="flex h-12 w-full items-end justify-center">
										<Skeleton
											className="w-full max-w-6 rounded-[2px]"
											style={{ height }}
										/>
									</div>
									<Skeleton className="h-2 w-6" />
								</div>
							))}
						</div>
					</div>
				</div>

				<div className="min-w-0 pt-4 pb-1.5">
					<div className="mb-1 px-4 sm:px-8">
						<Skeleton className="h-2 w-24" />
					</div>
					{ROW_WIDTHS.slice(0, 3).map((width) => (
						<div
							key={width}
							className="flex items-start gap-3 px-4 py-3 sm:px-8"
						>
							<Skeleton className="mt-1.5 size-2 shrink-0 rounded-full" />
							<div className="min-w-0 flex-1">
								<Skeleton className="h-3.5" style={{ maxWidth: `${width}%` }} />
								<Skeleton
									className="mt-1.5 h-3"
									style={{ maxWidth: `${width - 14}%` }}
								/>
							</div>
							<Skeleton className="mt-0.5 h-3.5 w-12 shrink-0" />
						</div>
					))}
				</div>
			</div>

			{/* "View full calendar" — the screen's last line, and the reason the
			    island ends where it does. */}
			<div className="mt-5">
				<Skeleton className="h-4 w-44" />
			</div>
		</div>
	);
}
