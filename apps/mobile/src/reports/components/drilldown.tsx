import { useState } from "react";
import { Platform, View } from "react-native";

import {
	ActionButton,
	EmptyState,
	ErrorState,
	Skeleton,
	Text,
} from "../../ui/components";
import { ListSearch } from "../../ui/list-search";
import { Inset } from "../../ui/screen";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import { entriesCsv } from "../csv";
import { formatCount, formatReportHours, plural } from "../format";
import { dayHeading } from "../period";
import { type DetailFilters, useTimeDetail } from "../queries";
import {
	bucketHours,
	type DetailRow,
	ENTRY_GROUPS,
	type EntryGroupBy,
	entryMatches,
	groupEntries,
	peopleIn,
} from "../views";
import { ColumnChart } from "./bars";
import { EntryLine, ListCard, Note, SummaryRow } from "./disclosure";
import { ExportButton } from "./export-button";
import { TotalFigure } from "./figure";
import { MenuPicker } from "./menu-picker";

/** Which groups are open: all closed except a few, or all open except a
 *  few (after "Expand all"). */
type Expand = { mode: "closed" | "open"; except: ReadonlySet<string> };
const ALL_CLOSED: Expand = { mode: "closed", except: new Set() };
const isOpen = (expand: Expand, key: string) =>
	(expand.mode === "open") !== expand.except.has(key);
const toggled = (expand: Expand, key: string): Expand => {
	const except = new Set(expand.except);
	if (except.has(key)) except.delete(key);
	else except.add(key);
	return { mode: expand.mode, except };
};

/** The words of an entry under its group: what the group does not say. */
const lineOf = (row: DetailRow, by: EntryGroupBy, filters: DetailFilters) => {
	const project = row.project.code
		? `[${row.project.code}] ${row.project.name}`
		: row.project.name;
	const parts = [
		by === "date" ? null : dayHeading(row.date),
		by === "project" || filters.projectId ? null : project,
		by === "teammate" || filters.userId ? null : row.user.name,
	].filter((part) => part !== null);
	return { title: row.task.name, detail: parts.join(", ") };
};

/**
 * The entries behind a figure, in groups that are closed at first: the
 * drill-down of the Time report, and a project's page, which is the same
 * list for one project. Over the groups: the total, a chart of the hours
 * by day or by month, and the CSV export.
 */
export function EntriesDrilldown({
	filters,
	groups,
	initialBy,
	exportName,
	roleOf,
	empty = "No entries match these filters.",
}: {
	filters: DetailFilters;
	groups: EntryGroupBy[];
	initialBy: EntryGroupBy;
	/** The name of the CSV file, without the extension. */
	exportName: string;
	/** The role of a person on the project, on a project's page. */
	roleOf?: (userId: string) => string | null;
	empty?: string;
}) {
	const palette = usePalette();
	const detail = useTimeDetail(filters);
	const [by, setBy] = useState<EntryGroupBy>(initialBy);
	const [query, setQuery] = useState("");
	const [expand, setExpand] = useState<Expand>(ALL_CLOSED);
	const options = ENTRY_GROUPS.filter((group) => groups.includes(group.value));

	if (detail.isPending) {
		return (
			<Inset>
				<Skeleton height={64} />
				<Skeleton height={160} radius={16} />
				<Skeleton height={56} />
				<Skeleton height={56} />
			</Inset>
		);
	}
	if (detail.isError) {
		return (
			<ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
		);
	}

	const data = detail.data;
	const people = peopleIn(data.rows);
	const shown = data.rows.filter((row) => entryMatches(row, query));
	const grouped = groupEntries(shown, by);
	const max = Math.max(...grouped.map((group) => group.seconds), 1);

	return (
		<>
			<Inset>
				<TotalFigure
					value={formatReportHours(data.totalSeconds)}
					caption={`${plural(data.totalRows, "entry", "entries")}, ${plural(people, "person", "people")}`}
				/>
				{data.rows.length > 0 ? (
					<ColumnChart
						title="Hours over the period"
						buckets={bucketHours(data.rows, filters.from, filters.to)}
					/>
				) : null}
				<View
					style={{
						flexDirection: "row",
						flexWrap: "wrap",
						// iOS puts the label beside the menu, so both sit on one
						// centre line. Android keeps its floating label field.
						alignItems: Platform.OS === "ios" ? "center" : "flex-end",
						justifyContent: Platform.OS === "ios" ? "space-between" : undefined,
						gap: SPACE.m,
					}}
				>
					<MenuPicker
						label="Group by"
						inline={Platform.OS === "ios"}
						options={options}
						value={by}
						onChange={(next) => {
							// New groups, so the old open set means nothing.
							setExpand(ALL_CLOSED);
							setBy(next);
						}}
					/>
					<ExportButton
						name={exportName}
						build={() => entriesCsv(data)}
						disabled={data.rows.length === 0}
					/>
				</View>
			</Inset>

			{data.rows.length === 0 ? (
				<EmptyState icon="inbox" title={empty} />
			) : (
				<>
					<Inset>
						<ListSearch
							label="Search entries"
							value={query}
							onChangeText={setQuery}
							placeholder="Description, person, project or task"
						/>
						{data.truncated ? (
							<Text variant="bodyMedium" color={palette.tertiary}>
								{`Showing the first ${formatCount(data.rows.length)} of ${formatCount(data.totalRows)} entries. The CSV export covers the same ${formatCount(data.rows.length)}. The total above is the full figure. Narrow the filters or the period to see the rest.`}
							</Text>
						) : null}
						<View style={{ alignItems: "flex-end" }}>
							<ActionButton
								label={expand.mode === "open" ? "Collapse all" : "Expand all"}
								variant="text"
								onPress={() =>
									setExpand(
										expand.mode === "open"
											? ALL_CLOSED
											: { mode: "open", except: new Set() },
									)
								}
							/>
						</View>
					</Inset>
					{grouped.length === 0 ? (
						<EmptyState
							icon="search"
							title="No match"
							message={`No entry matches "${query.trim()}".`}
						/>
					) : (
						<ListCard>
							{grouped.map((group) => {
								const open = isOpen(expand, group.key);
								const role =
									roleOf && by === "teammate"
										? (roleOf(group.rows[0]?.user.id ?? "") ??
											"Not on the team")
										: null;
								const counts =
									by === "teammate"
										? plural(group.rows.length, "entry", "entries")
										: `${plural(group.rows.length, "entry", "entries")}, ${plural(group.people, "person", "people")}`;
								return (
									<View key={group.key}>
										<SummaryRow
											title={
												by === "project" && group.code
													? `[${group.code}] ${group.label}`
													: group.label
											}
											subtitle={role ? `${role}, ${counts}` : counts}
											value={formatReportHours(group.seconds)}
											share={{ value: group.seconds, max }}
											open={open}
											onToggle={() => setExpand(toggled(expand, group.key))}
										/>
										{open
											? group.rows.map((row) => {
													const line = lineOf(row, by, filters);
													return (
														<EntryLine
															key={row.id}
															title={line.title}
															detail={line.detail}
															note={row.description}
															value={formatReportHours(row.durationSeconds)}
															overtime={row.overtime}
														/>
													);
												})
											: null}
									</View>
								);
							})}
						</ListCard>
					)}
					<Note>
						{by === "teammate"
							? "Open a name for their entries."
							: by === "task"
								? "Open a task for its entries."
								: by === "date"
									? "Open a day for its entries."
									: "Open a group for its entries."}
					</Note>
				</>
			)}
		</>
	);
}
