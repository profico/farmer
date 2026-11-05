import type { TimeReport } from "@farmer/api-client";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, View } from "react-native";

import { EmptyState, ErrorState, Skeleton } from "../ui/components";
import { ListSearch } from "../ui/list-search";
import { Inset } from "../ui/screen";
import { SegmentedControl } from "../ui/segmented";
import { SPACE } from "../ui/type";
import {
	type PeriodState,
	ReportControls,
	useRange,
} from "./components/controls";
import { ListCard, Note, SummaryRow } from "./components/disclosure";
import { ExportButton } from "./components/export-button";
import { TotalFigure } from "./components/figure";
import { MenuPicker } from "./components/menu-picker";
import { rowHours, type TimeTab, timeSummaryCsv } from "./csv";
import { formatReportHours, plural } from "./format";
import { useTimeReport } from "./queries";
import type { EntryGroupBy } from "./views";

const TABS: { value: TimeTab; label: string; noun: [string, string] }[] = [
	{ value: "clients", label: "Clients", noun: ["client", "clients"] },
	{ value: "projects", label: "Projects", noun: ["project", "projects"] },
	{ value: "teammates", label: "Team", noun: ["person", "people"] },
];

type Sort = "hours" | "name";
const SORTS: { value: Sort; label: string }[] = [
	{ value: "hours", label: "Hours" },
	{ value: "name", label: "Name" },
];

type Row = TimeReport["rows"][number];

/** The parameters of `reports/detail`. A filter that is not set is not in
 *  the link. */
type DetailParams = {
	from: string;
	to: string;
	by: EntryGroupBy;
	title: string;
	clientId?: string;
	projectId?: string;
	userId?: string;
	activeOnly?: "1";
};

/** The filter that a row of each tab opens, and how the entries are
 *  grouped then: a client by project, a project by teammate, a person by
 *  project. */
const OPENS = {
	clients: { param: "clientId", by: "project" },
	projects: { param: "projectId", by: "teammate" },
	teammates: { param: "userId", by: "project" },
} as const satisfies {
	[tab in TimeTab]: {
		param: "clientId" | "projectId" | "userId";
		by: EntryGroupBy;
	};
};

const titleOf = (row: Row) =>
	row.code ? `[${row.code}] ${row.name}` : row.name;

const subtitleOf = (row: Row, tab: TimeTab) => {
	const parts =
		tab === "clients"
			? [plural(row.count, "project", "projects")]
			: tab === "projects"
				? [row.clientName ?? "", plural(row.count, "person", "people")]
				: [
						`${formatReportHours(row.secondsTotal)} work`,
						row.timeOffSeconds > 0
							? `${formatReportHours(row.timeOffSeconds)} time-off`
							: "",
					];
	return [...parts, row.archived ? "Archived" : ""]
		.filter((part) => part)
		.join(", ");
};

/**
 * The Time report: hours by client, by project or by person over the
 * period. A row opens its entries (the drill-down). The server limits the
 * rows to what the person may see.
 */
export function TimeReport({
	period,
	activeOnly,
	onActiveOnly,
}: {
	period: PeriodState;
	activeOnly: boolean;
	onActiveOnly: (value: boolean) => void;
}) {
	const router = useRouter();
	const range = useRange(period.selection);
	const [tab, setTab] = useState<TimeTab>("projects");
	const [sort, setSort] = useState<Sort>("hours");
	const [query, setQuery] = useState("");
	const report = useTimeReport(range ?? { from: "", to: "" }, tab, activeOnly);
	const noun = TABS.find((item) => item.value === tab)?.noun ?? ["row", "rows"];

	const open = (row: Row) => {
		if (!range) return;
		const opens = OPENS[tab];
		const params: DetailParams = {
			from: range.from,
			to: range.to,
			by: opens.by,
			title: titleOf(row),
		};
		params[opens.param] = row.id;
		// Only a flag that is on goes into the link.
		if (activeOnly) params.activeOnly = "1";
		router.push({ pathname: "/reports/detail", params });
	};

	const body = () => {
		if (!range || report.isPending) {
			return (
				<Inset>
					<Skeleton height={64} />
					<Skeleton height={56} />
					<Skeleton height={56} />
					<Skeleton height={56} />
				</Inset>
			);
		}
		if (report.isError) {
			return (
				<ErrorState
					error={report.error}
					onRetry={() => void report.refetch()}
				/>
			);
		}
		const data = report.data;
		const total = data.rows.reduce((sum, row) => sum + rowHours(row, tab), 0);
		const max = Math.max(...data.rows.map((row) => rowHours(row, tab)), 1);
		const needle = query.trim().toLowerCase();
		const rows = data.rows
			.filter(
				(row) =>
					!needle ||
					[row.name, row.clientName ?? "", row.code ?? ""].some((text) =>
						text.toLowerCase().includes(needle),
					),
			)
			.sort(
				(a, b) =>
					(sort === "hours" ? rowHours(b, tab) - rowHours(a, tab) : 0) ||
					a.name.localeCompare(b.name, "hr"),
			);
		return (
			<>
				<Inset>
					<TotalFigure
						value={formatReportHours(total)}
						caption={plural(data.rows.length, noun[0], noun[1])}
					/>
					{data.unfiledSeconds > 0 ? (
						<Note>
							{`${formatReportHours(data.unfiledSeconds)} hours in this period are not filed against a project and are not included above.`}
						</Note>
					) : null}
					<View
						style={{
							flexDirection: "row",
							flexWrap: "wrap",
							// iOS puts the label beside the menu and the share action at
							// the end. Android keeps its floating label field.
							alignItems: Platform.OS === "ios" ? "center" : "flex-end",
							justifyContent:
								Platform.OS === "ios" ? "space-between" : undefined,
							gap: SPACE.m,
						}}
					>
						<MenuPicker
							inline={Platform.OS === "ios"}
							label="Sort by"
							options={SORTS}
							value={sort}
							onChange={setSort}
						/>
						<ExportButton
							name={`time-report_${tab}_${range.from}_${range.to}`}
							build={() => timeSummaryCsv(data, tab)}
							disabled={data.rows.length === 0}
						/>
					</View>
				</Inset>
				{data.rows.length === 0 ? (
					<EmptyState icon="inbox" title="Nothing logged in this period." />
				) : (
					<>
						<Inset>
							<ListSearch
								label="Search"
								value={query}
								onChangeText={setQuery}
								placeholder="Name, client or code"
							/>
						</Inset>
						{rows.length === 0 ? (
							<EmptyState
								icon="search"
								title="No match"
								message={`Nothing matches "${query.trim()}".`}
							/>
						) : (
							<ListCard>
								{rows.map((row) => (
									<SummaryRow
										key={row.id}
										title={titleOf(row)}
										subtitle={subtitleOf(row, tab)}
										value={formatReportHours(rowHours(row, tab))}
										share={{ value: rowHours(row, tab), max }}
										onPress={() => open(row)}
										accessibilityHint="Opens the entries"
									/>
								))}
							</ListCard>
						)}
						<Note>
							A row opens its entries. Time-off is counted in Team only. It
							belongs to nobody&apos;s client.
						</Note>
					</>
				)}
			</>
		);
	};

	return (
		<>
			<ReportControls
				period={period}
				activeOnly={{ value: activeOnly, onChange: onActiveOnly }}
			/>
			<Inset>
				<SegmentedControl
					options={TABS}
					value={tab}
					onChange={(next) => {
						setTab(next);
						setQuery("");
					}}
				/>
			</Inset>
			{body()}
		</>
	);
}
