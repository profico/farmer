import { useState } from "react";
import { View } from "react-native";

import { EmptyState, ErrorState, Skeleton } from "../ui/components";
import { ListSearch } from "../ui/list-search";
import { Inset } from "../ui/screen";
import { SPACE } from "../ui/type";
import {
	type PeriodState,
	ReportControls,
	useRange,
} from "./components/controls";
import { EntryLine, ListCard, Note, SummaryRow } from "./components/disclosure";
import { ExportButton } from "./components/export-button";
import { TotalFigure } from "./components/figure";
import { MenuPicker } from "./components/menu-picker";
import { absenceCsv } from "./csv";
import { formatReportDays, formatReportHours, plural } from "./format";
import { dayHeading } from "./period";
import { useAbsenceReport } from "./queries";
import { ABSENCE_VIEWS, type AbsenceView, absenceView } from "./views";

/**
 * The Absence report: the time off of each person over the period, in one
 * of five views. The days are for reading only; the hours are the unit.
 * Time off has no project, so this report has no "Active projects only".
 */
export function AbsenceReport({ period }: { period: PeriodState }) {
	const range = useRange(period.selection);
	const report = useAbsenceReport(range ?? { from: "", to: "" });
	const [view, setView] = useState<AbsenceView>("all");
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
	const label =
		ABSENCE_VIEWS.find((item) => item.value === view)?.label ?? "Time-off";
	const toggle = (userId: string) =>
		setOpen((current) => {
			const next = new Set(current);
			if (next.has(userId)) next.delete(userId);
			else next.add(userId);
			return next;
		});

	const body = () => {
		if (!range || report.isPending) {
			return (
				<Inset>
					<Skeleton height={64} />
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
		const { workingDaySeconds } = report.data;
		const all = absenceView(report.data, view);
		const total = all.reduce((sum, row) => sum + row.seconds, 0);
		const max = Math.max(...all.map((row) => row.seconds), 1);
		const needle = query.trim().toLowerCase();
		const rows = all
			.filter((row) => !needle || row.name.toLowerCase().includes(needle))
			.sort(
				(a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name, "hr"),
			);
		return (
			<>
				<Inset>
					<TotalFigure
						value={formatReportHours(total)}
						caption={`${formatReportDays(total, workingDaySeconds)} days, ${plural(all.length, "person", "people")}`}
					/>
					<View
						style={{
							flexDirection: "row",
							flexWrap: "wrap",
							alignItems: "flex-end",
							gap: SPACE.m,
						}}
					>
						<MenuPicker
							label="Kind of time-off"
							options={ABSENCE_VIEWS}
							value={view}
							onChange={(next) => {
								setView(next);
								setOpen(new Set());
							}}
						/>
						<ExportButton
							name={`absence_${view}_${range.from}_${range.to}`}
							build={() => absenceCsv(all, workingDaySeconds)}
							disabled={all.length === 0}
						/>
					</View>
				</Inset>
				{all.length === 0 ? (
					<EmptyState
						icon="inbox"
						title={`No ${label.toLowerCase()} in this period.`}
					/>
				) : (
					<>
						<Inset>
							<ListSearch
								label="Search"
								value={query}
								onChangeText={setQuery}
								placeholder="Name"
							/>
						</Inset>
						{rows.length === 0 ? (
							<EmptyState
								icon="search"
								title="No match"
								message={`Nobody matches "${query.trim()}".`}
							/>
						) : (
							<ListCard>
								{rows.map((row) => {
									const isOpen = open.has(row.userId);
									return (
										<View key={row.userId}>
											<SummaryRow
												title={row.name}
												subtitle={`${formatReportDays(row.seconds, workingDaySeconds)} days, ${plural(row.entries.length, "entry", "entries")}`}
												value={formatReportHours(row.seconds)}
												share={{ value: row.seconds, max }}
												open={isOpen}
												onToggle={() => toggle(row.userId)}
											/>
											{isOpen
												? row.entries.map((entry) => (
														<EntryLine
															key={entry.id}
															title={dayHeading(entry.date)}
															detail={entry.taskName}
															note={entry.description}
															value={formatReportHours(entry.durationSeconds)}
														/>
													))
												: null}
										</View>
									);
								})}
							</ListCard>
						)}
					</>
				)}
				<Note>
					{`How it is calculated: only the time-off entries in the selected period, of the kind that the view names. "Non-vacation leave" is all that is not vacation. Days = hours / ${workingDaySeconds / 3600}, only for reading: the hours are the unit. The figures come from the logged entries. Open a name for the entries.`}
				</Note>
			</>
		);
	};

	return (
		<>
			<ReportControls period={period} />
			{body()}
		</>
	);
}
