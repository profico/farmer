import {
	formatDecimalHours,
	formatReportDays,
	formatReportHours,
} from "@farmer/core/lib/report-format";
import { resolveReportPeriod } from "@farmer/core/lib/report-period";
import { matchesSearch } from "@farmer/core/lib/search";
import type { AbsenceReportInput } from "@farmer/core/schema";
import type { AbsenceRow } from "@farmer/core/services";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Fragment, Suspense, useState } from "react";

import { PersonCell } from "#/components/person-avatar.tsx";
import { Button } from "#/components/ui/button.tsx";
import { NoMatchesRow, SearchInput } from "#/components/ui/search-input.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { useWeekStartsOn } from "#/hooks/use-week-starts-on.ts";
import { cn } from "#/lib/utils.ts";
import { absenceReportQuery } from "#/queries/reports.ts";

import type { Search } from "./search.ts";
import {
	byNumber,
	byText,
	ExportMenu,
	FigurePending,
	formatDateHeading,
	PeriodPicker,
	QuietTabs,
	RowDisclosure,
	type Sort,
	SortHead,
	TabPending,
	toggleSort,
} from "./shared.tsx";

// The Absence report (PRD 6.3), as the COO signed it off: the same period
// control as the Time report, then five views — All time-off · Vacation ·
// Sick Leave · Paid Leave · Non-vacation leave — over one table of people
// with days (for reading) and hours (the unit). A row opens into the entries
// behind it: date, kind, note, hours. Time-off has no project, so there is no
// "Active projects only" here.

/** The views. Which columns each one adds up is decided against the
 *  report's own columns, by system key, so a renamed task keeps its view and
 *  a fourth kind of absence lands under "Non-vacation leave" by itself. */
const VIEWS = [
	{ id: "all", label: "All time-off" },
	{ id: "vacation", label: "Vacation" },
	{ id: "sick", label: "Sick Leave" },
	{ id: "paid", label: "Paid Leave" },
	{ id: "other", label: "Non-vacation leave" },
] as const;

type View = (typeof VIEWS)[number]["id"];

const VIEW_KEY = {
	vacation: "vacation",
	sick: "sick",
	paid: "paid_leave",
} as const satisfies Record<Exclude<View, "all" | "other">, string>;

/** The column keys a view counts. */
const keysFor = (view: View, columns: { key: string }[]): Set<string> => {
	const all = columns.map((c) => c.key);

	if (view === "all") return new Set(all);

	if (view === "other") return new Set(all.filter((k) => k !== "vacation"));

	return new Set([VIEW_KEY[view]]);
};

export function AbsenceTab({
	orgSlug,
	search,
	today,
	thisMonth,
}: {
	orgSlug: string;
	search: Search;
	today: string;
	thisMonth: string;
}) {
	const navigate = useNavigate({ from: "/$orgSlug/reports" });
	const weekStartsOn = useWeekStartsOn();
	const { from, to } = resolveReportPeriod(search, today, weekStartsOn);
	const input: AbsenceReportInput = { from, to };
	const view: View = search.type ?? "all";

	return (
		<>
			<PeriodPicker
				search={search}
				today={today}
				thisMonth={thisMonth}
				link={(s) => (
					<Link to="/$orgSlug/reports" params={{ orgSlug }} search={s} />
				)}
				navigateTo={(s) =>
					navigate({ to: "/$orgSlug/reports", params: { orgSlug }, search: s })
				}
			>
				<Suspense
					fallback={
						<Button variant="outline" size="sm" disabled>
							Export
						</Button>
					}
				>
					<AbsenceExport input={input} view={view} />
				</Suspense>
			</PeriodPicker>

			{/* The view only re-reads what is already loaded — every view is the
			    same query — so the tabs sit outside the boundary and never blink. */}
			<div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
				<QuietTabs
					label="Kind of time-off"
					items={VIEWS}
					active={view}
					orgSlug={orgSlug}
					search={(id) => ({ ...search, type: id === "all" ? undefined : id })}
				/>
				<Suspense fallback={<FigurePending label="Total hours" />}>
					<AbsenceFigure input={input} view={view} />
				</Suspense>
			</div>

			<Suspense fallback={<TabPending className="mt-6" />}>
				<AbsenceRows input={input} view={view} />
			</Suspense>
		</>
	);
}

type ViewRow = {
	userId: string;
	name: string;
	seconds: number;
	entries: AbsenceRow["entries"];
};

/** The report narrowed to one view: each person's hours in the kinds the
 *  view counts, with the entries of those kinds; people with nothing in the
 *  view are left out. */
function useView(input: AbsenceReportInput, view: View) {
	const orgSlug = useOrgSlug();
	const { data } = useSuspenseQuery(absenceReportQuery(orgSlug, input));
	const keys = keysFor(view, data.columns);

	const rows: ViewRow[] = data.rows
		.map((row) => {
			const entries = row.entries.filter((e) => keys.has(e.taskKey));

			return {
				userId: row.userId,
				name: row.name,
				seconds: entries.reduce((sum, e) => sum + e.durationSeconds, 0),
				entries,
			};
		})
		.filter((row) => row.entries.length > 0);

	const label = VIEWS.find((v) => v.id === view)?.label ?? "Time-off";

	return { rows, workingDaySeconds: data.workingDaySeconds, label };
}

function AbsenceFigure({
	input,
	view,
}: {
	input: AbsenceReportInput;
	view: View;
}) {
	const { rows, workingDaySeconds } = useView(input, view);
	const total = rows.reduce((sum, r) => sum + r.seconds, 0);

	return (
		<span className="flex items-baseline gap-2 whitespace-nowrap">
			<span className="eyebrow">Total hours</span>
			<span className="mono text-lg">{formatReportHours(total)}</span>
			<span className="text-xs text-muted-foreground">
				{formatReportDays(total, workingDaySeconds)} days · {rows.length}{" "}
				{rows.length === 1 ? "person" : "people"}
			</span>
		</span>
	);
}

function AbsenceExport({
	input,
	view,
}: {
	input: AbsenceReportInput;
	view: View;
}) {
	const { rows, workingDaySeconds, label } = useView(input, view);

	return (
		<ExportMenu
			disabled={rows.length === 0}
			filename={`absence_${view}_${input.from}_${input.to}`}
			csv={() => ({
				headers: ["Person", "Days", "Hours"],
				rows: rows.map((r) => [
					r.name,
					(r.seconds / workingDaySeconds).toFixed(2),
					formatDecimalHours(r.seconds),
				]),
			})}
			pdf={() => ({
				title: "Absence report",
				from: input.from,
				to: input.to,
				total: formatReportHours(rows.reduce((sum, r) => sum + r.seconds, 0)),
				facts: [["Kind of time-off", label]],
				columns: [
					{ label: "Person" },
					{ label: "Days", align: "right" },
					{ label: "Hours", align: "right" },
				],
				groups: [
					{
						rows: [...rows]
							.sort((a, b) => b.seconds - a.seconds)
							.map((r) => ({
								cells: [
									r.name,
									formatReportDays(r.seconds, workingDaySeconds),
									formatReportHours(r.seconds),
								],
							})),
					},
				],
			})}
		/>
	);
}

type SortKey = "name" | "hours";

function AbsenceRows({
	input,
	view,
}: {
	input: AbsenceReportInput;
	view: View;
}) {
	const { rows, workingDaySeconds, label } = useView(input, view);
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
	const [sort, setSort] = useState<Sort<SortKey>>({ key: "hours", dir: -1 });

	const onSort = (key: SortKey, numeric: boolean) =>
		setSort((current) => toggleSort(current, key, numeric));

	const compare = {
		name: byText((r: ViewRow) => r.name),
		hours: byNumber((r: ViewRow) => r.seconds),
	} satisfies Record<SortKey, (a: ViewRow, b: ViewRow) => number>;

	const toggle = (userId: string) =>
		setOpen((current) => {
			const next = new Set(current);

			if (next.has(userId)) next.delete(userId);
			else next.add(userId);

			return next;
		});

	const shown = rows
		.filter((row) => matchesSearch(query, [row.name]))
		.sort(
			(a, b) =>
				compare[sort.key](a, b) * sort.dir ||
				a.name.localeCompare(b.name, "hr"),
		);

	// Over every row, not whatever the search box narrows to.
	const total = rows.reduce((sum, r) => sum + r.seconds, 0);

	return (
		<>
			{rows.length === 0 ? (
				<p className="mt-5 border-t pt-5 text-base text-muted-foreground">
					No {label.toLowerCase()} in this period.
				</p>
			) : (
				<>
					<SearchInput
						value={query}
						onValueChange={setQuery}
						className="mt-4 w-full sm:w-56"
					/>
					<Table containerClassName="mt-3">
						<TableHeader>
							<TableRow>
								<SortHead
									label="Name"
									sortKey="name"
									sort={sort}
									onSort={onSort}
								/>
								<SortHead
									label="Days"
									sortKey="hours"
									numeric
									sort={sort}
									onSort={onSort}
									className="text-right"
								/>
								<SortHead
									label="Hours"
									sortKey="hours"
									numeric
									sort={sort}
									onSort={onSort}
									className="text-right"
								/>
							</TableRow>
						</TableHeader>
						<TableBody>
							{shown.length === 0 ? (
								<NoMatchesRow colSpan={3} />
							) : (
								shown.map((row) => {
									const isOpen = open.has(row.userId);

									return (
										<Fragment key={row.userId}>
											<TableRow>
												<TableCell className="p-0">
													<RowDisclosure
														open={isOpen}
														onToggle={() => toggle(row.userId)}
													>
														<PersonCell userId={row.userId} name={row.name} />
														<span className="text-sm font-normal text-muted-foreground">
															{row.entries.length}{" "}
															{row.entries.length === 1 ? "entry" : "entries"}
														</span>
													</RowDisclosure>
												</TableCell>
												<TableCell className="mono text-right text-muted-foreground">
													{formatReportDays(row.seconds, workingDaySeconds)}
												</TableCell>
												<TableCell className="mono text-right">
													{formatReportHours(row.seconds)}
												</TableCell>
											</TableRow>
											{isOpen &&
												row.entries.map((e) => (
													<TableRow key={e.id}>
														<TableCell className="pl-7 whitespace-normal">
															{formatDateHeading(e.date)}
															<span className="text-muted-foreground">
																{" "}
																· {e.taskName}
															</span>
															{e.description && (
																<span className="block text-xs text-muted-foreground">
																	{e.description}
																</span>
															)}
														</TableCell>
														<TableCell />
														<TableCell className="mono text-right">
															{formatReportHours(e.durationSeconds)}
														</TableCell>
													</TableRow>
												))}
										</Fragment>
									);
								})
							)}
							<TableRow className="bg-secondary/60 hover:bg-secondary/60">
								<TableCell className="font-medium">Total</TableCell>
								<TableCell className="mono text-right font-medium text-muted-foreground">
									{formatReportDays(total, workingDaySeconds)}
								</TableCell>
								<TableCell className="mono text-right font-medium">
									{formatReportHours(total)}
								</TableCell>
							</TableRow>
						</TableBody>
					</Table>
				</>
			)}

			<p
				className={cn(
					"max-w-[72ch] text-sm text-muted-foreground",
					rows.length === 0 ? "mt-4" : "mt-3",
				)}
			>
				<span className="font-medium text-foreground">
					How it's calculated.
				</span>{" "}
				Time-off entries only, in the selected period, of the kind the tab
				names; "Non-vacation leave" is everything that is not vacation. Days =
				hours ÷ {workingDaySeconds / 3600}, shown for reading only — hours are
				the unit. Counted from logged entries: if this disagrees with the
				accounting book, someone forgot to log their time off, and that gap is
				the point. Open a name for the entries.
			</p>
		</>
	);
}
