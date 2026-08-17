import { monthKeyOf } from "@farmer/core/lib/time";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense } from "react";
import { z } from "zod";
import { CloseSheetPanel } from "#/components/close/close-sheet-panel.tsx";
import { TableLoadingSkeleton } from "#/components/states/loading-skeleton.tsx";
import { StatusPill } from "#/components/status-pill.tsx";
import { Button } from "#/components/ui/button.tsx";
import { FadeSwap } from "#/components/ui/fade-swap.tsx";
import { PageFull, PageHeader } from "#/components/ui/page-header.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { formatHoursShort } from "#/lib/format-hours.ts";
import { cn } from "#/lib/utils.ts";
import { closeOverviewQuery } from "#/queries/close.ts";

const searchSchema = z.object({
	// yyyy-MM, so the month survives a refresh and is linkable.
	month: z
		.string()
		.regex(/^\d{4}-\d{2}$/)
		.optional(),
	projectId: z.uuid().optional(),
});

const parseMonth = (monthKey: string) => {
	const [year, month] = monthKey.split("-").map(Number);
	return { year: year ?? 1970, month: month ?? 1 };
};

const shiftMonthKey = (monthKey: string, delta: number): string => {
	const { year, month } = parseMonth(monthKey);
	const total = year * 12 + (month - 1) + delta;
	return `${Math.floor(total / 12)}-${String((((total % 12) + 12) % 12) + 1).padStart(2, "0")}`;
};

// The close normally happens in the first days of the following month, so the
// default month is the one that just ended, not the one in progress.
const defaultMonthKey = () => {
	const now = new Date();
	return shiftMonthKey(
		monthKeyOf(
			`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`,
		),
		-1,
	);
};

export const Route = createFileRoute("/$orgSlug/close")({
	validateSearch: searchSchema,
	loaderDeps: ({ search }) => ({ month: search.month }),
	loader: async ({ context, deps, params }) => {
		const orgSlug = params.orgSlug;
		const monthKey = deps.month ?? defaultMonthKey();
		await context.queryClient.ensureQueryData(
			closeOverviewQuery(orgSlug, parseMonth(monthKey)),
		);
	},
	component: ClosePage,
});

/**
 * The in-panel loading state, cut to the sheet that replaces it: the status
 * strip across the top, then the per-person table.
 *
 * Seven figure columns, because this table is much wider than the report ones —
 * expected, absence, reported, adjusted, Δ, final, Δ. Getting that count right
 * is the whole point: the placeholder is here to hold the shape, and a
 * three-column stand-in for a seven-column table would make the pane visibly
 * re-flow at the moment the numbers arrive.
 */
function SheetPending() {
	return (
		<div className="flex h-full flex-col">
			<div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
				<Skeleton className="h-4 w-44" />
				<Skeleton className="h-5 w-16 rounded-full" />
			</div>
			<div className="min-h-0 flex-1 px-1 pt-1">
				<TableLoadingSkeleton cols={7} />
			</div>
		</div>
	);
}

const STATUS_TONE = {
	open: "neutral",
	submitted: "warning",
	finalized: "positive",
} as const;

const STATUS_LABEL = {
	open: "Open",
	submitted: "Submitted",
	finalized: "Finalized",
} as const;

function ClosePage() {
	const orgSlug = useOrgSlug();
	const { organization } = Route.useRouteContext();
	const search = Route.useSearch();
	const monthKey = search.month ?? defaultMonthKey();
	const period = parseMonth(monthKey);
	const { data: projects } = useSuspenseQuery(
		closeOverviewQuery(orgSlug, period),
	);

	const monthLabel = new Intl.DateTimeFormat("en-US", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(Date.UTC(period.year, period.month - 1, 15)));

	const waiting = projects.filter((p) => p.status === "submitted").length;

	return (
		// One island filling the frame. It used to set its own wide cap, which is
		// how this screen ended up a different width from the timesheet next to it
		// in the sidebar; the frame is the only thing that decides width now.
		<PageFull className="min-h-0 flex-1">
			<PageHeader
				eyebrow={
					waiting > 0 ? (
						<>
							<span className="text-primary">{waiting}</span> waiting to be
							finalized
						</>
					) : (
						"Nothing waiting"
					)
				}
				title="Monthly close"
				// The month the sheet belongs to is what the whole screen is about,
				// so it sits where every screen's controls sit rather than being
				// crushed against the title.
				action={
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="icon-sm"
							nativeButton={false}
							render={
								<Link
									to="/$orgSlug/close"
									params={{ orgSlug: organization.slug }}
									search={{ month: shiftMonthKey(monthKey, -1) }}
								>
									‹
								</Link>
							}
						/>
						<span className="mono min-w-[140px] text-center text-sm">
							{monthLabel}
						</span>
						<Button
							variant="outline"
							size="icon-sm"
							nativeButton={false}
							render={
								<Link
									to="/$orgSlug/close"
									params={{ orgSlug: organization.slug }}
									search={{ month: shiftMonthKey(monthKey, 1) }}
								>
									›
								</Link>
							}
						/>
					</div>
				}
				className="mb-0 shrink-0"
			/>

			<div className="-mx-4 mt-6 grid min-h-0 flex-1 grid-cols-1 border-t sm:-mx-8 lg:grid-cols-[minmax(0,440px)_1fr] lg:divide-x">
				<div className="scrollbar-stable min-h-0 overflow-y-auto">
					{projects.length === 0 ? (
						<div className="px-4 py-8 sm:px-8">
							<p className="h2">Nothing to close</p>
							<p className="lede mt-2">
								You aren't PM on any project, so no close sheet is yours to
								finalize.
							</p>
						</div>
					) : (
						<Table bleed={false}>
							<TableHeader>
								<TableRow>
									<TableHead>Project</TableHead>
									<TableHead className="text-right">Reported</TableHead>
									<TableHead>Status</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{projects.map((p) => {
									const selected = search.projectId === p.projectId;
									return (
										<TableRow
											key={p.projectId}
											className={cn(selected && "bg-[var(--sel)]")}
										>
											<TableCell>
												<Link
													to="/$orgSlug/close"
													params={{ orgSlug: organization.slug }}
													search={{ month: monthKey, projectId: p.projectId }}
													className="block"
												>
													<span className="block font-medium">
														{p.projectName}
													</span>
													<span className="block text-xs text-faint">
														{p.clientName}
													</span>
												</Link>
											</TableCell>
											<TableCell className="mono text-right">
												{formatHoursShort(p.reportedSeconds)}
											</TableCell>
											<TableCell>
												<StatusPill tone={STATUS_TONE[p.status]}>
													{STATUS_LABEL[p.status]}
												</StatusPill>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					)}
				</div>
				<div className="scrollbar-stable min-h-0 overflow-y-auto border-t lg:border-t-0">
					{/* `CloseSheetPanel` reads its sheet with `useSuspenseQuery` and the
					    loader only prefetches the overview, so picking a project always
					    suspends. Without this local boundary that suspension escapes to
					    the router's `defaultPendingComponent`, which replaces the whole
					    route — header, month stepper and the project table you just
					    clicked in — for at least `defaultPendingMinMs`. Same reasoning as
					    the tab boundary on Reports.

					    Keyed by project so picking a different one re-suspends rather
					    than showing the previous project's numbers under a new name. */}
					<FadeSwap activeKey={search.projectId ?? "none"} className="h-full">
						{search.projectId ? (
							<Suspense key={search.projectId} fallback={<SheetPending />}>
								<CloseSheetPanel
									projectId={search.projectId}
									year={period.year}
									month={period.month}
								/>
							</Suspense>
						) : (
							<p className="px-4 py-8 text-base text-muted-foreground sm:px-8">
								Pick a project to open its close sheet.
							</p>
						)}
					</FadeSwap>
				</div>
			</div>
		</PageFull>
	);
}
