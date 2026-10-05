import { useState } from "react";
import { View } from "react-native";

import { EmptyState, ErrorState, Field, Skeleton } from "../ui/components";
import { Inset } from "../ui/screen";
import {
	type PeriodState,
	ReportControls,
	useRange,
} from "./components/controls";
import { EntryLine, ListCard, Note, SummaryRow } from "./components/disclosure";
import { ExportButton } from "./components/export-button";
import { TotalFigure } from "./components/figure";
import { overtimeCsv } from "./csv";
import { formatReportHours, plural } from "./format";
import { dayHeading } from "./period";
import { useOvertimeReport } from "./queries";

/**
 * The Overtime report: the people with the entries that they flagged as
 * overtime when they logged them, over the period. A row opens the
 * entries. Nothing comes from the hour fund.
 */
export function OvertimeReport({
	period,
	activeOnly,
	onActiveOnly,
}: {
	period: PeriodState;
	activeOnly: boolean;
	onActiveOnly: (value: boolean) => void;
}) {
	const range = useRange(period.selection);
	const report = useOvertimeReport(range ?? { from: "", to: "" }, activeOnly);
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
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
		const data = report.data;
		const needle = query.trim().toLowerCase();
		const rows = data.rows
			.filter((row) => !needle || row.name.toLowerCase().includes(needle))
			.sort(
				(a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name, "hr"),
			);
		const max = Math.max(...data.rows.map((row) => row.seconds), 1);
		return (
			<>
				<Inset>
					<TotalFigure
						value={formatReportHours(data.totalSeconds)}
						caption={`${plural(data.totalEntries, "flagged entry", "flagged entries")}, ${plural(data.rows.length, "person", "people")}`}
					/>
					<View style={{ alignItems: "flex-start" }}>
						<ExportButton
							name={`overtime_${range.from}_${range.to}`}
							build={() => overtimeCsv(data)}
							disabled={data.rows.length === 0}
						/>
					</View>
				</Inset>
				{data.rows.length === 0 ? (
					<EmptyState
						icon="inbox"
						title="No overtime flagged in this period."
					/>
				) : (
					<>
						<Inset>
							<Field
								label="Search"
								value={query}
								onChangeText={setQuery}
								placeholder="Name"
								autoCorrect={false}
								clearButtonMode="while-editing"
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
												subtitle={plural(row.count, "entry", "entries")}
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
															detail={`${entry.projectCode ? `[${entry.projectCode}] ` : ""}${entry.projectName}, ${entry.taskName}`}
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
					How it is calculated: only the entries that the person flagged as
					overtime when they logged them, in the selected period. Nothing comes
					from the hour fund. Open a name for the entries.
				</Note>
			</>
		);
	};

	return (
		<>
			<ReportControls
				period={period}
				activeOnly={{ value: activeOnly, onChange: onActiveOnly }}
			/>
			{body()}
		</>
	);
}
