import {
	formatQuarterKey,
	isCurrentPeriod,
	monthsPerStep,
	PERIOD_PRESETS,
	resolveReportPeriod,
	shiftMonthKey,
} from "@farmer/core/lib/report-period";
import { matchesSearch } from "@farmer/core/lib/search";
import { addDaysToKey, type WeekStartsOn } from "@farmer/core/lib/time";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	CaretDownIcon,
	CaretRightIcon,
	CaretUpIcon,
} from "@phosphor-icons/react";
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { cloneElement, type ReactElement, Suspense, useState } from "react";
import type * as React from "react";
import { toast } from "sonner";

import { TableLoadingSkeleton } from "#/components/states/loading-skeleton.tsx";
import {
	returnLinkClass,
	stepperClass,
	TimeToolbar,
} from "#/components/time/time-toolbar.tsx";
import { Button } from "#/components/ui/button.tsx";
import { DatePicker } from "#/components/ui/date-picker.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { NoMatchesRow, SearchInput } from "#/components/ui/search-input.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useWeekStartsOn } from "#/hooks/use-week-starts-on.ts";
import { downloadCsv } from "#/lib/csv.ts";
import { formatMonthKey, formatWeekRange } from "#/lib/format-date.ts";
import { downloadPdf, type PdfReport } from "#/lib/pdf.ts";
import { cn } from "#/lib/utils.ts";

import type { PeriodSearch, Search } from "./search.ts";

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
							search={{ ...search, month: undefined }}
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
export const periodLabel = (
	search: PeriodSearch,
	today: string,
	weekStartsOn: WeekStartsOn,
) => {
	const { preset, from, to } = resolveReportPeriod(search, today, weekStartsOn);
	const month = search.month ?? today.slice(0, 7);
	return preset === "month"
		? formatMonthKey(month)
		: preset === "quarter"
			? formatQuarterKey(month)
			: preset === "year"
				? month.slice(0, 4)
				: formatWeekRange(from, to);
};

/** What a caller renders a period link as: an element the picker fills in —
 *  class, label, arrow — the Base UI `render` idiom. */
type PeriodLink = ReactElement<{
	className?: string;
	children?: React.ReactNode;
	"aria-label"?: string;
}>;

/**
 * The period, as one control: ‹ August 2026 › with the preset — Week, Month,
 * Quarter, Year, Custom — in a select beside it. It used to be the stepper
 * AND a five-segment pill strip, which under the report tabs and over the
 * Clients · Projects · Team tabs made four rows of tabs on one screen.
 *
 * Route-agnostic: Reports and a project's page both use it, so the caller
 * renders the links (`link`, given the search a step leads to) and does the
 * moving for the select and the custom range fields (`navigateTo`). The
 * search is generic so whatever else the caller's URL carries — a tab, a
 * grouping, a filter — travels with the period.
 */
export function PeriodPicker<S extends PeriodSearch>({
	search,
	today,
	thisMonth,
	link,
	navigateTo,
	children,
}: {
	search: S;
	today: string;
	thisMonth: string;
	link: (search: S) => PeriodLink;
	navigateTo: (search: S) => void;
	children?: React.ReactNode;
}) {
	const weekStartsOn = useWeekStartsOn();
	const { preset, from, to } = resolveReportPeriod(search, today, weekStartsOn);
	const month = search.month ?? thisMonth;

	// A drill-down keeps its filters across a period change on purpose: "this
	// client, last quarter" is a question, and the filters are the answer's
	// subject, not something the period picker should forget.
	const withSearch = (patch: Partial<PeriodSearch>): S => ({
		...search,
		...patch,
	});

	const step = (delta: number) => {
		if (preset === "week") {
			return withSearch({ from: addDaysToKey(from, 7 * delta), to: undefined });
		}
		return withSearch({
			month: shiftMonthKey(month, delta * monthsPerStep(preset)),
		});
	};
	const stepLink = (delta: number) =>
		cloneElement(link(step(delta)), {
			className: stepperClass,
			"aria-label": delta < 0 ? "Previous period" : "Next period",
			children:
				delta < 0 ? (
					<ArrowLeftIcon weight="regular" className="size-4" />
				) : (
					<ArrowRightIcon weight="regular" className="size-4" />
				),
		});

	const label = periodLabel(search, today, weekStartsOn);
	const atNow = isCurrentPeriod(search, today, weekStartsOn);

	return (
		<div className="flex flex-wrap items-center gap-3">
			<Select
				items={PERIOD_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
				value={preset}
				onValueChange={(next: string | null) => {
					const picked = PERIOD_PRESETS.find((p) => p.id === next);
					if (!picked) return;
					navigateTo(
						withSearch({
							preset: picked.id,
							// Switching preset restarts from "now" in the new unit,
							// which is the only period that means the same thing in
							// all of them. Custom keeps the range it was opened from.
							from: picked.id === "custom" ? from : undefined,
							to: picked.id === "custom" ? to : undefined,
						}),
					);
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
					from={from}
					to={to}
					onChange={(patch) => navigateTo(withSearch(patch))}
				/>
			) : (
				<TimeToolbar
					prev={stepLink(-1)}
					label={label}
					next={stepLink(1)}
					returnLink={
						!atNow &&
						cloneElement(
							link(
								withSearch({
									month: undefined,
									from: undefined,
									to: undefined,
								}),
							),
							{
								className: returnLinkClass,
								children:
									preset === "week"
										? "Return to this week"
										: preset === "quarter"
											? "Return to this quarter"
											: preset === "year"
												? "Return to this year"
												: "Return to this month",
							},
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
	from,
	to,
	onChange,
}: {
	from: string;
	to: string;
	onChange: (patch: { from?: string; to?: string }) => void;
}) {
	return (
		<div className="flex items-center gap-2">
			<DatePicker
				aria-label="From date"
				className="w-40 text-xs"
				value={from}
				max={to}
				onValueChange={(next) => next && onChange({ from: next })}
			/>
			<span className="text-sm text-muted-foreground">to</span>
			<DatePicker
				aria-label="To date"
				className="w-40 text-xs"
				value={to}
				min={from}
				onValueChange={(next) => next && onChange({ to: next })}
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
	/** A tint for the whole row — the Tracking table colors a row by its
	 *  verdict so a list of forty people can be read at a glance. */
	className?: string;
	/** Plain text for the row, for the table's own search box. A cell can render
	 *  a face (`<PersonCell>`) instead of text, so filtering needs its own copy;
	 *  a row with no fields is simply unmatchable by search. Only worth supplying
	 *  when the table lists people, projects or clients — not a fixed short
	 *  series like a trend's months. */
	searchFields?: readonly (string | null | undefined)[];
};

/** A column header of a `ReportTable`. With a `sortKey` — and once the table
 *  is given a `sort` and an `onSort` — it is a label the reader can click to
 *  sort by; without one it is just the label. The table only draws the
 *  headers: the tab that owns the rows does the ordering, as the Time, Absence
 *  and Overtime tabs do with their own tables. */
export type ReportTableHeader<K extends string> = {
	label: string;
	sortKey?: K;
	/** Starts biggest first. */
	numeric?: boolean;
};

export function ReportTable<K extends string>({
	headers,
	rows,
	empty,
	sort,
	onSort,
	// Set by a tab that puts its tables side by side at xl (Tracking). Up to that
	// point the table bleeds edge-to-edge like every other table in the app; once
	// the grid splits, the negative margin would run each table under its
	// neighbour, so from xl it sits inside its own column instead.
	columned = false,
}: {
	headers: ReportTableHeader<K>[];
	rows: ReportTableRow[];
	empty: string;
	sort?: Sort<K>;
	onSort?: (key: K, numeric: boolean) => void;
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
						{headers.map((h, i) =>
							h.sortKey && sort && onSort ? (
								<SortHead
									key={h.label}
									label={h.label}
									sortKey={h.sortKey}
									numeric={h.numeric}
									sort={sort}
									onSort={onSort}
									className={cn(i > 0 && "text-right")}
								/>
							) : (
								<TableHead key={h.label} className={cn(i > 0 && "text-right")}>
									{h.label}
								</TableHead>
							),
						)}
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
										key={`${row.key}-${headers[i]?.label}`}
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

// ── The pieces the Time, Absence and Overtime tabs share ─────────────────

/** The placeholder for a single figure — a total or a percentage — that sits in
 *  a row of controls. The label stays: only the number is unknown. */
export function FigurePending({
	label,
	className,
}: {
	label: string;
	className?: string;
}) {
	return (
		<span
			className={cn("flex items-baseline gap-2 whitespace-nowrap", className)}
		>
			<span className="eyebrow">{label}</span>
			<Skeleton className="h-4 w-16" />
		</span>
	);
}

/** "Active projects only" — leaves archived projects' time out of every figure
 *  on the screen. In the URL like every other report control, so a shared link
 *  shows what its sender saw. */
export function ActiveOnlyToggle({
	orgSlug,
	search,
}: {
	orgSlug: string;
	search: Search;
}) {
	const navigate = useNavigate({ from: "/$orgSlug/reports" });
	const on = search.active === "1";
	return (
		<span className="flex items-center gap-2 text-sm text-muted-foreground">
			<Switch
				size="sm"
				aria-label="Active projects only"
				checked={on}
				onCheckedChange={(checked) =>
					navigate({
						to: "/$orgSlug/reports",
						params: { orgSlug },
						search: { ...search, active: checked ? "1" : undefined },
					})
				}
			/>
			Active projects only
		</span>
	);
}

/**
 * Quiet tabs under the period row — an underscore, not a second pill strip
 * under the report tabs. The same 2px accent underscore the week strip uses
 * for the active day. Navigation, so a link carries the view.
 */
export function QuietTabs<T extends string>({
	label,
	items,
	active,
	orgSlug,
	search,
}: {
	label: string;
	items: readonly { id: T; label: string }[];
	active: T;
	orgSlug: string;
	/** The search for a tab — the caller decides which param it is. */
	search: (id: T) => Search;
}) {
	return (
		<nav aria-label={label} className="flex flex-wrap gap-x-5 gap-y-1">
			{items.map((item) => {
				const on = item.id === active;
				return (
					<Link
						key={item.id}
						to="/$orgSlug/reports"
						params={{ orgSlug }}
						search={search(item.id)}
						aria-current={on ? "page" : undefined}
						className={cn(
							"border-b-2 py-1.5 text-sm whitespace-nowrap transition-colors duration-(--dur-fast)",
							on
								? "border-primary font-medium text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						{item.label}
					</Link>
				);
			})}
		</nav>
	);
}

/** The button that opens a summary row into the rows beneath it — the same
 *  disclosure the archived section under every list uses, with the caret
 *  turning. Sits inside a `TableCell className="p-0"`. */
export function RowDisclosure({
	open,
	onToggle,
	children,
}: {
	open: boolean;
	onToggle: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-expanded={open}
			onClick={onToggle}
			className="flex w-full items-center gap-2 px-2 py-2.5 text-left font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/16 focus-visible:ring-inset"
		>
			<CaretRightIcon
				weight="bold"
				className={cn(
					"size-3 shrink-0 text-muted-foreground transition-transform duration-(--dur-fast)",
					open && "rotate-90",
				)}
			/>
			{children}
		</button>
	);
}

/** The export control every report shares: one button, CSV or PDF. Both are
 *  built on the click from the rows already on screen (lib/csv.ts says why),
 *  so each format is a function returning what it writes. The filename
 *  carries no extension — each format adds its own. The organization's name
 *  is read here, once, for the PDF's header. */
export function ExportMenu({
	disabled,
	filename,
	csv,
	pdf,
}: {
	disabled?: boolean;
	filename: string;
	csv: () => { headers: string[]; rows: string[][] };
	pdf: () => Omit<PdfReport, "org">;
}) {
	const org = useRouteContext({
		from: "/$orgSlug",
		select: (context) => context.organization.name,
	});
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				disabled={disabled}
				render={<Button variant="outline" size="sm" disabled={disabled} />}
			>
				Export
				<CaretDownIcon weight="bold" data-icon="inline-end" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem
					onClick={() => {
						const { headers, rows } = csv();
						downloadCsv(`${filename}.csv`, headers, rows);
					}}
				>
					Export CSV
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={() =>
						downloadPdf(`${filename}.pdf`, { org, ...pdf() }).catch(() =>
							toast.error("Could not build the PDF"),
						)
					}
				>
					Export PDF
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** A column sort: which column, and which way. Clicking the same column
 *  again flips it; a fresh text column starts A→Z, a fresh number column
 *  starts biggest first — "who has the most hours" is the question a Hours
 *  column gets asked. */
export type Sort<K extends string> = { key: K; dir: 1 | -1 };
export const toggleSort = <K extends string>(
	current: Sort<K>,
	key: K,
	numeric: boolean,
): Sort<K> =>
	current.key === key
		? { key, dir: current.dir > 0 ? -1 : 1 }
		: { key, dir: numeric ? -1 : 1 };
export const byText =
	<R,>(pick: (row: R) => string | null) =>
	(a: R, b: R) =>
		(pick(a) ?? "").localeCompare(pick(b) ?? "", "hr");
export const byNumber =
	<R,>(pick: (row: R) => number) =>
	(a: R, b: R) =>
		pick(a) - pick(b);

/** A column header that sorts the table, with the arrow on the active one.
 *  Every column is one: a table you cannot sort by the column you are
 *  reading is a table you read twice. */
export function SortHead<K extends string>({
	label,
	sortKey,
	numeric = false,
	sort,
	onSort,
	className,
}: {
	label: string;
	sortKey: K;
	/** Starts biggest first. */
	numeric?: boolean;
	sort: Sort<K>;
	onSort: (key: K, numeric: boolean) => void;
	className?: string;
}) {
	const active = sort.key === sortKey;
	return (
		<TableHead
			className={className}
			aria-sort={active ? (sort.dir > 0 ? "ascending" : "descending") : "none"}
		>
			<button
				type="button"
				onClick={() => onSort(sortKey, numeric)}
				className={cn(
					"inline-flex items-center gap-1 rounded-sm transition-colors duration-(--dur-fast) outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/16",
					active && "text-foreground",
				)}
			>
				{label}
				{active &&
					(sort.dir > 0 ? (
						<CaretUpIcon weight="bold" className="size-3" />
					) : (
						<CaretDownIcon weight="bold" className="size-3" />
					))}
			</button>
		</TableHead>
	);
}
