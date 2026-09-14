import {
	formatQuarterKey,
	isCurrentPeriod,
	monthsPerStep,
	PERIOD_PRESETS,
	resolveReportPeriod,
	shiftMonthKey,
} from "@farmer/core/lib/report-period";
import { addDaysToKey } from "@farmer/core/lib/time";
import { ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import type * as React from "react";

import { TableLoadingSkeleton } from "#/components/states/loading-skeleton.tsx";
import {
	returnLinkClass,
	stepperClass,
	TimeToolbar,
} from "#/components/time/time-toolbar.tsx";
import { DatePicker } from "#/components/ui/date-picker.tsx";
import { NoMatchesRow, SearchInput } from "#/components/ui/search-input.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { formatMonthKey, formatWeekRange } from "#/lib/format-date.ts";
import { matchesSearch } from "#/lib/search.ts";
import { cn } from "#/lib/utils.ts";

import type { Search } from "./search.ts";

// What every report tab on this screen shares: the in-panel loading state, the
// month/period controls that frame the tabs which are month-scoped, and the one
// table shape the numeric reports all render into.
//
// Split out of `routes/$orgSlug/reports.tsx` — see the note at the top of that
// file. Nothing here knows which report it is framing; that is the point.
/**
 * The in-panel loading state. Every tab on this screen resolves to a table, so
 * the placeholder is that table — which also keeps the promise the old spinner
 * only gestured at: the panel is roughly the height of what replaces it, so the
 * tab strip above doesn't jump when the data lands.
 */
export function TabPending({ className = "pt-1" }: { className?: string }) {
	return (
		<div className={className}>
			<TableLoadingSkeleton />
		</div>
	);
}

/**
 * Wraps a month-based report in the month stepper.
 *
 * The stepper is chrome, not content: it owns its own Suspense boundary around
 * the report below it so that stepping to a month that isn't cached yet swaps
 * the table and leaves the arrows in place. Without it the suspension escapes to
 * the tab-level boundary, which replaces the stepper with the skeleton it just
 * triggered — you'd have to wait for the data to come back before you could
 * press "previous month" twice.
 */
export function MonthFramed({
	orgSlug,
	search,
	month,
	thisMonth,
	children,
}: {
	orgSlug: string;
	search: Search;
	month: string;
	thisMonth: string;
	children: React.ReactNode;
}) {
	const step = (delta: number) => (
		<Link
			to="/$orgSlug/reports"
			params={{ orgSlug }}
			search={{ ...search, month: shiftMonthKey(month, delta) }}
			className={stepperClass}
			aria-label={delta < 0 ? "Previous month" : "Next month"}
		>
			{delta < 0 ? (
				<ArrowLeftIcon weight="regular" className="size-4" />
			) : (
				<ArrowRightIcon weight="regular" className="size-4" />
			)}
		</Link>
	);

	return (
		<>
			<TimeToolbar
				prev={step(-1)}
				label={formatMonthKey(month)}
				next={step(1)}
				returnLink={
					month !== thisMonth && (
						<Link
							to="/$orgSlug/reports"
							params={{ orgSlug }}
							search={{ ...search, month: undefined, detailId: undefined }}
							className={returnLinkClass}
						>
							Return to this month
						</Link>
					)
				}
			/>
			<div className="mt-6">
				<Suspense fallback={<TabPending />}>{children}</Suspense>
			</div>
		</>
	);
}

/** What the period reads as — "August 2026", "Q3 2026", "2026", or a range —
 *  for the stepper and for the page's eyebrow, so the two never disagree. */
export const periodLabel = (search: Search, today: string) => {
	const { preset, from, to } = resolveReportPeriod(search, today);
	const month = search.month ?? today.slice(0, 7);
	return preset === "month"
		? formatMonthKey(month)
		: preset === "quarter"
			? formatQuarterKey(month)
			: preset === "year"
				? month.slice(0, 4)
				: formatWeekRange(from, to);
};

/**
 * The period, as one control: ‹ August 2026 › with the preset — Week, Month,
 * Quarter, Year, Custom — in a select beside it. It used to be the stepper
 * AND a five-segment pill strip, which under the report tabs and over the
 * Clients · Projects · Team tabs made four rows of tabs on one screen.
 */
export function PeriodPicker({
	orgSlug,
	search,
	today,
	thisMonth,
	children,
}: {
	orgSlug: string;
	search: Search;
	today: string;
	thisMonth: string;
	children?: React.ReactNode;
}) {
	const { preset, from, to } = resolveReportPeriod(search, today);
	const month = search.month ?? thisMonth;
	const navigate = useNavigate({ from: "/$orgSlug/reports" });

	// A Breakdown keeps its filters across a period change on purpose: "this
	// client, last quarter" is a question, and the filters are the answer's
	// subject, not something the period picker should forget.
	const withSearch = (patch: Partial<Search>) => ({ ...search, ...patch });

	const step = (delta: number) => {
		if (preset === "week") {
			return withSearch({ from: addDaysToKey(from, 7 * delta), to: undefined });
		}
		return withSearch({
			month: shiftMonthKey(month, delta * monthsPerStep(preset)),
		});
	};

	const label = periodLabel(search, today);

	const atNow = isCurrentPeriod(search, today);

	return (
		<div className="flex flex-wrap items-center gap-3">
			<Select
				items={PERIOD_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
				value={preset}
				onValueChange={(next: string | null) => {
					const picked = PERIOD_PRESETS.find((p) => p.id === next);
					if (!picked) return;
					navigate({
						to: "/$orgSlug/reports",
						params: { orgSlug },
						search: withSearch({
							preset: picked.id,
							// Switching preset restarts from "now" in the new unit,
							// which is the only period that means the same thing in
							// all of them. Custom keeps the range it was opened from.
							from: picked.id === "custom" ? from : undefined,
							to: picked.id === "custom" ? to : undefined,
						}),
					});
				}}
			>
				<SelectTrigger aria-label="Period" className="h-8 w-28 text-sm">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{PERIOD_PRESETS.map((p) => (
						<SelectItem key={p.id} value={p.id}>
							{p.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>

			{/* A custom range has no natural next, so it gets two date fields
			    instead of arrows rather than arrows that guess a stride. */}
			{preset === "custom" ? (
				<CustomRangeFields
					orgSlug={orgSlug}
					search={search}
					from={from}
					to={to}
				/>
			) : (
				<TimeToolbar
					prev={
						<Link
							to="/$orgSlug/reports"
							params={{ orgSlug }}
							search={step(-1)}
							className={stepperClass}
							aria-label="Previous period"
						>
							<ArrowLeftIcon weight="regular" className="size-4" />
						</Link>
					}
					label={label}
					next={
						<Link
							to="/$orgSlug/reports"
							params={{ orgSlug }}
							search={step(1)}
							className={stepperClass}
							aria-label="Next period"
						>
							<ArrowRightIcon weight="regular" className="size-4" />
						</Link>
					}
					returnLink={
						!atNow && (
							<Link
								to="/$orgSlug/reports"
								params={{ orgSlug }}
								search={withSearch({
									month: undefined,
									from: undefined,
									to: undefined,
								})}
								className={returnLinkClass}
							>
								{preset === "week"
									? "Return to this week"
									: preset === "quarter"
										? "Return to this quarter"
										: preset === "year"
											? "Return to this year"
											: "Return to this month"}
							</Link>
						)
					}
				/>
			)}

			{children && (
				<div className="ml-auto flex items-center gap-2">{children}</div>
			)}
		</div>
	);
}

function CustomRangeFields({
	orgSlug,
	search,
	from,
	to,
}: {
	orgSlug: string;
	search: Search;
	from: string;
	to: string;
}) {
	const navigate = useNavigate({ from: "/$orgSlug/reports" });
	return (
		<div className="flex items-center gap-2">
			<DatePicker
				aria-label="From date"
				className="w-40 text-xs"
				value={from}
				max={to}
				onValueChange={(next) =>
					next &&
					navigate({
						to: "/$orgSlug/reports",
						params: { orgSlug },
						search: { ...search, from: next },
					})
				}
			/>
			<span className="text-sm text-muted-foreground">to</span>
			<DatePicker
				aria-label="To date"
				className="w-40 text-xs"
				value={to}
				min={from}
				onValueChange={(next) =>
					next &&
					navigate({
						to: "/$orgSlug/reports",
						params: { orgSlug },
						search: { ...search, to: next },
					})
				}
			/>
		</div>
	);
}

export const formatDateHeading = (key: string) =>
	new Intl.DateTimeFormat("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	}).format(new Date(`${key}T00:00:00Z`));

export const TREND_MONTHS = 6;

// One table shape for the tabs that are simply "a list of people or projects
// with a few numbers" — giving each its own table would be six copies of the
// same markup. The two that aren't (Time, Absence) build their own.
export type ReportTableRow = {
	/** The row's own identity — a userId, a projectId, an entry id.
	 *
	 *  Was derived by joining the cells, which stopped being possible once a
	 *  cell could be a rendered face rather than a string. It is the better key
	 *  anyway: two people with the same name and the same four numbers used to
	 *  collide into one React key. */
	key: string;
	cells: React.ReactNode[];
	/** A tint for the whole row — the Tracking table colours a row by its
	 *  verdict so a list of forty people can be read at a glance. */
	className?: string;
	/** Plain text for the row, for the table's own search box. A cell can render
	 *  a face (`<PersonCell>`) instead of text, so filtering needs its own copy;
	 *  a row with no fields is simply unmatchable by search. Only worth supplying
	 *  when the table lists people, projects or clients — not a fixed short
	 *  series like a trend's months. */
	searchFields?: readonly (string | null | undefined)[];
};

export function ReportTable({
	headers,
	rows,
	empty,
	// Set by a tab that puts its tables side by side at xl (Tracking). Up to that
	// point the table bleeds edge-to-edge like every other table in the app; once
	// the grid splits, the negative margin would run each table under its
	// neighbour, so from xl it sits inside its own column instead.
	columned = false,
}: {
	headers: string[];
	rows: ReportTableRow[];
	empty: string;
	columned?: boolean;
}) {
	// The box only appears once some row actually carries searchable text — a
	// table nobody wired up (e.g. a trend's fixed run of months) renders exactly
	// as before.
	const searchable = rows.some((r) => r.searchFields);
	const [query, setQuery] = useState("");
	const filteredRows = searchable
		? rows.filter((r) => matchesSearch(query, r.searchFields ?? []))
		: rows;

	if (rows.length === 0) {
		// An empty report is a sentence on the page, not a dashed box: a dashed
		// rectangle is a drop target, and nothing here can be dropped into.
		return (
			<p className="mt-5 border-t pt-5 text-base text-muted-foreground">
				{empty}
			</p>
		);
	}
	return (
		<>
			{searchable && (
				<SearchInput
					value={query}
					onValueChange={setQuery}
					className="mt-6 w-full sm:w-56"
				/>
			)}
			<Table
				className={cn(
					columned &&
						"xl:[&_td:first-child]:pl-2 xl:[&_td:last-child]:pr-2 xl:[&_th:first-child]:pl-2 xl:[&_th:last-child]:pr-2",
				)}
				containerClassName={cn(
					searchable ? "mt-3" : "mt-6",
					columned && "xl:mx-0",
				)}
			>
				<TableHeader>
					<TableRow>
						{headers.map((h, i) => (
							<TableHead key={h} className={cn(i > 0 && "text-right")}>
								{h}
							</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{filteredRows.length === 0 ? (
						<NoMatchesRow colSpan={headers.length} />
					) : (
						filteredRows.map((row) => (
							<TableRow key={row.key} className={row.className}>
								{row.cells.map((cell, i) => (
									<TableCell
										key={`${row.key}-${headers[i]}`}
										className={cn(i === 0 ? "font-medium" : "mono text-right")}
									>
										{cell}
									</TableCell>
								))}
							</TableRow>
						))
					)}
				</TableBody>
			</Table>
		</>
	);
}
