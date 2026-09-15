import {
	formatDecimalHours,
	formatReportHours,
} from "@farmer/core/lib/report-format";
import { matchesSearch } from "@farmer/core/lib/search";
import type { TimeReportDetailInput } from "@farmer/core/schema";
import type { TimeReportDetailRow } from "@farmer/core/services";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fragment, Suspense, useState } from "react";

import { PersonCell } from "#/components/person-avatar.tsx";
import { returnLinkClass } from "#/components/time/time-toolbar.tsx";
import { Button } from "#/components/ui/button.tsx";
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
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { downloadCsv } from "#/lib/csv.ts";
import { cn } from "#/lib/utils.ts";
import { timeReportDetailQuery } from "#/queries/reports.ts";

import type { Search } from "./search.ts";
import {
	byNumber,
	byText,
	formatDateHeading,
	RowDisclosure,
	type Sort,
	SortHead,
	TabPending,
	toggleSort,
} from "./shared.tsx";

// The entries behind a number, grouped one of several ways with the groups
// closed — the Reports drill-down, and a project's page, which is the same
// table already narrowed to one project. The tools row (search, Group by,
// Expand all) sits outside the boundary the table suspends in, so a period
// change never takes the controls off the screen.

export const ENTRY_GROUPS = [
	{ id: "client", label: "Client" },
	{ id: "project", label: "Project" },
	{ id: "task", label: "Task" },
	{ id: "teammate", label: "Teammate" },
	{ id: "date", label: "Date" },
] as const;
export type EntryGroup = (typeof ENTRY_GROUPS)[number]["id"];

/** Which groups are open: closed except a few (the default), or open except a
 *  few (after "Expand all"). Named by exception so "all" needs no list of
 *  keys, which only the table knows. */
type Expand = { mode: "closed" | "open"; except: ReadonlySet<string> };
const ALL_CLOSED: Expand = { mode: "closed", except: new Set() };
const ALL_OPEN: Expand = { mode: "open", except: new Set() };
const isOpen = (expand: Expand, key: string) =>
	(expand.mode === "open") !== expand.except.has(key);
const toggled = (expand: Expand, key: string): Expand => {
	const except = new Set(expand.except);
	if (except.has(key)) except.delete(key);
	else except.add(key);
	return { mode: expand.mode, except };
};

export function EntriesDrilldown<G extends EntryGroup>({
	input,
	groups,
	by,
	onByChange,
	narrow,
	roleOf,
	empty = "No entries match these filters.",
}: {
	input: TimeReportDetailInput;
	/** The groupings on offer — Reports all five, a project's page three. */
	groups: readonly G[];
	by: G;
	onByChange: (by: G) => void;
	/** Where a group's hours go: Reports adds the group as a filter, so a
	 *  person's project row opens that person on that project. Null for a
	 *  grouping that is not a filter (date); absent on a project's page, which
	 *  has no filter to add, and the hours stay text. */
	narrow?: (by: EntryGroup, id: string) => Search | null;
	/** A project's page tags each person's row with their role there. */
	roleOf?: (userId: string) => string | null;
	empty?: string;
}) {
	const [query, setQuery] = useState("");
	const [expand, setExpand] = useState<Expand>(ALL_CLOSED);
	const options = groups.map((id) => ({
		id,
		label: ENTRY_GROUPS.find((g) => g.id === id)?.label ?? id,
	}));

	return (
		<>
			<div className="mt-4 flex flex-wrap items-center gap-3">
				<label className="flex items-center gap-2 text-sm text-muted-foreground">
					Group by
					<Select
						items={options.map((g) => ({ value: g.id, label: g.label }))}
						value={by}
						onValueChange={(next: string | null) => {
							const picked = options.find((g) => g.id === next);
							if (!picked) return;
							// New groups, so the old open set means nothing.
							setExpand(ALL_CLOSED);
							onByChange(picked.id);
						}}
					>
						<SelectTrigger className="h-8 w-32 text-sm">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{options.map((g) => (
								<SelectItem key={g.id} value={g.id}>
									{g.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</label>
				<SearchInput
					value={query}
					onValueChange={setQuery}
					placeholder="Search entries…"
					className="w-full sm:w-56"
				/>
				<button
					type="button"
					className={`${returnLinkClass} ml-auto`}
					onClick={() =>
						setExpand(expand.mode === "open" ? ALL_CLOSED : ALL_OPEN)
					}
				>
					{expand.mode === "open" ? "Collapse all" : "Expand all"}
				</button>
			</div>

			<Suspense fallback={<TabPending className="mt-6" />}>
				<EntriesTable
					input={input}
					by={by}
					query={query}
					expand={expand}
					onToggle={(key) => setExpand(toggled(expand, key))}
					narrow={narrow}
					roleOf={roleOf}
					empty={empty}
				/>
			</Suspense>
		</>
	);
}

/** The total and the counts — a function of the rows the filters selected, so
 *  they load with the table, not with the header. */
export function EntriesFigure({
	input,
	className,
}: {
	input: TimeReportDetailInput;
	className?: string;
}) {
	const orgSlug = useOrgSlug();
	const { data: detail } = useSuspenseQuery(
		timeReportDetailQuery(orgSlug, input),
	);
	const people = new Set(detail.rows.map((r) => r.userId)).size;
	return (
		<span
			className={cn("flex items-baseline gap-2 whitespace-nowrap", className)}
		>
			<span className="eyebrow">Total hours</span>
			{/* The service's figure, summed across every matching row — not
			    `rows`, which the service caps. */}
			<span className="mono text-lg">
				{formatReportHours(detail.totalSeconds)}
			</span>
			<span className="text-xs text-muted-foreground">
				{detail.totalRows.toLocaleString("hr-HR")}{" "}
				{detail.totalRows === 1 ? "entry" : "entries"} · {people}{" "}
				{people === 1 ? "person" : "people"}
			</span>
		</span>
	);
}

export function EntriesExport({
	input,
	filename,
}: {
	input: TimeReportDetailInput;
	filename: string;
}) {
	const orgSlug = useOrgSlug();
	const { data: detail } = useSuspenseQuery(
		timeReportDetailQuery(orgSlug, input),
	);
	const rows = detail.rows;
	return (
		<Button
			variant="outline"
			size="sm"
			disabled={rows.length === 0}
			onClick={() =>
				downloadCsv(
					filename,
					[
						"Date",
						"Client",
						"Project",
						"Code",
						"Task",
						"Person",
						"Hours",
						"Overtime",
						"Description",
					],
					rows.map((r) => [
						r.date,
						r.clientName,
						r.projectName,
						r.projectCode ?? "",
						r.taskName,
						r.userName,
						formatDecimalHours(r.durationSeconds),
						r.overtime ? "yes" : "",
						r.description,
					]),
				)
			}
		>
			Export CSV
		</Button>
	);
}

const COLUMNS: { id: EntryGroup; label: string; muted?: boolean }[] = [
	{ id: "client", label: "Client", muted: true },
	{ id: "project", label: "Project" },
	{ id: "task", label: "Task" },
	{ id: "teammate", label: "Person" },
	{ id: "date", label: "Date", muted: true },
];

type DetailRow = TimeReportDetailRow;
type EntrySortKey = EntryGroup | "hours";

type DetailGroup = {
	key: string;
	label: string;
	/** The group's own identity for rendering its header: a person's face, a
	 *  project's code. From the first row in, which every row shares. */
	userId: string;
	projectCode: string | null;
	rows: DetailRow[];
	seconds: number;
	people: Set<string>;
};

function EntriesTable({
	input,
	by,
	query,
	expand,
	onToggle,
	narrow,
	roleOf,
	empty,
}: {
	input: TimeReportDetailInput;
	by: EntryGroup;
	query: string;
	expand: Expand;
	onToggle: (key: string) => void;
	narrow?: (by: EntryGroup, id: string) => Search | null;
	roleOf?: (userId: string) => string | null;
	empty: string;
}) {
	const orgSlug = useOrgSlug();
	const { data: detail } = useSuspenseQuery(
		timeReportDetailQuery(orgSlug, input),
	);
	const rows = detail.rows;
	const [sort, setSort] = useState<Sort<EntrySortKey>>({ key: "date", dir: 1 });
	const onSort = (key: EntrySortKey, numeric: boolean) =>
		setSort((current) => toggleSort(current, key, numeric));
	const compare = {
		client: byText((r: DetailRow) => r.clientName),
		project: byText((r: DetailRow) => r.projectName),
		task: byText((r: DetailRow) => r.taskName),
		teammate: byText((r: DetailRow) => r.userName),
		date: byText((r: DetailRow) => r.date),
		hours: byNumber((r: DetailRow) => r.durationSeconds),
	} satisfies Record<EntrySortKey, (a: DetailRow, b: DetailRow) => number>;
	// The search box only ever narrows what's already loaded — when the server
	// truncated the entries, a search finds nothing past that cutoff, same as
	// the CSV export.
	const filteredRows = rows.filter((row) =>
		matchesSearch(query, [
			row.description,
			row.userName,
			row.clientName,
			row.projectName,
			row.projectCode,
			row.taskName,
		]),
	);

	// Grouped by id, not by name: two people can share a name.
	const keyOf = (row: DetailRow) =>
		by === "client"
			? row.clientId
			: by === "project"
				? row.projectId
				: by === "task"
					? row.taskId
					: by === "teammate"
						? row.userId
						: row.date;
	const labelOf = (row: DetailRow) =>
		by === "client"
			? row.clientName
			: by === "project"
				? row.projectName
				: by === "task"
					? row.taskName
					: by === "teammate"
						? row.userName
						: formatDateHeading(row.date);
	const groups = new Map<string, DetailGroup>();
	for (const row of filteredRows) {
		const key = keyOf(row);
		const group = groups.get(key) ?? {
			key,
			label: labelOf(row),
			userId: row.userId,
			projectCode: row.projectCode,
			rows: [],
			seconds: 0,
			people: new Set<string>(),
		};
		group.rows.push(row);
		group.seconds += row.durationSeconds;
		group.people.add(row.userId);
		groups.set(key, group);
	}
	// A column every row would repeat says nothing: the project you opened,
	// its client, the person a link narrowed to. The task column stays — it
	// carries the note.
	const fixed = new Set<EntryGroup>([
		...(input.clientId || input.projectId ? ["client" as const] : []),
		...(input.projectId ? ["project" as const] : []),
		...(input.userId ? ["teammate" as const] : []),
	]);
	const columns = COLUMNS.filter((c) => c.id !== by && !fixed.has(c.id));
	// A sort on a column no longer shown — it became the grouping, or a link
	// fixed it — falls back to the order the entries arrived in.
	const active: Sort<EntrySortKey> =
		sort.key === "hours" || columns.some((c) => c.id === sort.key)
			? sort
			: { key: "date", dir: 1 };

	// Dates read in order; everything else biggest first — the group's sum is
	// the point of the header row. Hours is the one column that also reorders
	// the groups; every other column sorts the entries inside each group.
	const ordered = [...groups.values()].sort((a, b) =>
		active.key === "hours"
			? (a.seconds - b.seconds) * active.dir
			: by === "date"
				? a.key.localeCompare(b.key)
				: b.seconds - a.seconds,
	);
	const max = Math.max(...ordered.map((g) => g.seconds), 1);

	const cellOf = (row: DetailRow, column: EntryGroup) =>
		column === "client"
			? row.clientName
			: column === "project"
				? `${row.projectCode ? `[${row.projectCode}] ` : ""}${row.projectName}`
				: column === "task"
					? row.taskName
					: column === "teammate"
						? row.userName
						: formatDateHeading(row.date);

	if (rows.length === 0) {
		return (
			<p className="mt-5 border-t pt-5 text-base text-muted-foreground">
				{empty}
			</p>
		);
	}

	return (
		<>
			{detail.truncated && (
				// Say it rather than just showing fewer rows: the Total above is the
				// whole figure, so a quietly short table would read as a table that
				// disagrees with its own total.
				<p className="mt-5 border-t pt-5 text-base text-warn">
					Showing the first {rows.length.toLocaleString("hr-HR")} of{" "}
					{detail.totalRows.toLocaleString("hr-HR")} entries — the CSV export
					covers the same {rows.length.toLocaleString("hr-HR")}. The Total above
					is the full figure. Narrow the filters or the period to see the rest.
				</p>
			)}
			<Table containerClassName="mt-4">
				<TableHeader>
					<TableRow>
						{columns.map((c) => (
							<SortHead
								key={c.id}
								label={c.label}
								sortKey={c.id}
								sort={active}
								onSort={onSort}
							/>
						))}
						<SortHead
							label="Hours"
							sortKey="hours"
							numeric
							sort={active}
							onSort={onSort}
							className="text-right"
						/>
					</TableRow>
				</TableHeader>
				<TableBody>
					{ordered.length === 0 ? (
						<NoMatchesRow colSpan={columns.length + 1} />
					) : (
						ordered.map((group) => {
							const open = isOpen(expand, group.key);
							const role =
								roleOf && by === "teammate" ? roleOf(group.userId) : null;
							const narrowed = narrow?.(by, group.key) ?? null;
							return (
								<Fragment key={group.key}>
									{/* The summary row: a disclosure, the same one the
									    archived section under every list uses. */}
									<TableRow className="bg-secondary/60 hover:bg-secondary">
										<TableCell colSpan={columns.length} className="p-0">
											<RowDisclosure
												open={open}
												onToggle={() => onToggle(group.key)}
											>
												{by === "teammate" ? (
													<PersonCell
														userId={group.userId}
														name={group.label}
													/>
												) : (
													<>
														{by === "project" && group.projectCode && (
															<span className="mono text-xs text-muted-foreground">
																[{group.projectCode}]
															</span>
														)}
														{group.label}
													</>
												)}
												{roleOf && by === "teammate" && (
													<span className="rounded-full bg-muted px-2 py-0.5 text-2xs font-normal text-muted-foreground">
														{role ?? "Not on the team"}
													</span>
												)}
												<span className="text-sm font-normal text-muted-foreground">
													{group.rows.length}{" "}
													{group.rows.length === 1 ? "entry" : "entries"}
													{by !== "teammate" &&
														` · ${group.people.size} ${group.people.size === 1 ? "person" : "people"}`}
												</span>
											</RowDisclosure>
										</TableCell>
										<TableCell className="text-right">
											<span className="flex items-center justify-end gap-3">
												{narrowed ? (
													<Link
														to="/$orgSlug/reports"
														params={{ orgSlug }}
														search={narrowed}
														className="mono font-medium underlined"
													>
														{formatReportHours(group.seconds)}
													</Link>
												) : (
													<span className="mono font-medium">
														{formatReportHours(group.seconds)}
													</span>
												)}
												<span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-secondary">
													<span
														className="block h-full rounded-full bg-primary"
														style={{
															width: `${Math.max((group.seconds / max) * 100, 2)}%`,
														}}
													/>
												</span>
											</span>
										</TableCell>
									</TableRow>
									{open &&
										[...group.rows]
											.sort((a, b) => compare[active.key](a, b) * active.dir)
											.map((row) => (
												<TableRow key={row.id}>
													{columns.map((c, i) => (
														<TableCell
															key={c.id}
															className={cn(
																i === 0 && "pl-7",
																c.muted && "text-muted-foreground",
																c.id === "task" && "max-w-[36ch]",
															)}
														>
															{cellOf(row, c.id)}
															{c.id === "task" && (
																// The description sits under the task: it is what
																// the task meant that day, and a row without one
																// says so rather than reading as a task with
																// nothing to add.
																<span
																	className={cn(
																		"block truncate text-xs",
																		row.description
																			? "text-muted-foreground"
																			: "text-faint italic",
																	)}
																>
																	{row.description || "No description"}
																</span>
															)}
														</TableCell>
													))}
													<TableCell className="mono text-right">
														{formatReportHours(row.durationSeconds)}
														{row.overtime && (
															<span className="ml-2 rounded-full bg-warn/12 px-1.5 py-0.5 text-2xs font-medium text-warn">
																OT
															</span>
														)}
													</TableCell>
												</TableRow>
											))}
								</Fragment>
							);
						})
					)}
					{ordered.length > 0 && (
						<TableRow className="bg-secondary/60 hover:bg-secondary/60">
							<TableCell colSpan={columns.length} className="font-medium">
								Total
							</TableCell>
							<TableCell className="mono text-right font-medium">
								{formatReportHours(
									ordered.reduce((sum, g) => sum + g.seconds, 0),
								)}
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
		</>
	);
}
