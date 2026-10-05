import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useWhoami } from "../../../src/api/queries";
import { useExportAudit, usePeople } from "../../../src/api/workspace";
import { FormSection, Sheet } from "../../../src/forms/sheet";
import { ErrorBanner, Skeleton, Text } from "../../../src/ui/components";
import { messageOf } from "../../../src/ui/errors";
import { SettingsSection } from "../../../src/ui/settings-list";
import { usePalette } from "../../../src/ui/theme";
import { SPACE } from "../../../src/ui/type";
import {
	addDays,
	categoryOfParam,
	KIND_OPTIONS,
	kindOfParam,
} from "../../../src/workspace/audit/labels";
import { PickerRow } from "../../../src/workspace/components";
import { formatDay } from "../../../src/workspace/format";
import { paramOf } from "../../../src/workspace/params";
import { shareCsv } from "../../../src/workspace/share";

/** The server takes a range of at most a year: 365 days, both ends in. */
const MAX_SPAN_DAYS = 364;

/** Exports the log for a range as a CSV file and opens the share sheet.
 *  The category, kind and person filters of the list come as parameters. */
export default function ExportAuditSheet() {
	const whoami = useWhoami();
	if (!whoami.data) {
		return (
			<Sheet
				title="Export the audit log"
				actionLabel="Export"
				onAction={() => undefined}
				busy
			>
				<Skeleton height={56} radius={16} />
			</Sheet>
		);
	}
	return <ExportForm today={whoami.data.today} />;
}

function ExportForm({ today }: { today: string }) {
	const palette = usePalette();
	const params = useLocalSearchParams();
	const people = usePeople();
	const exporter = useExportAudit();
	const category = categoryOfParam(paramOf(params.category));
	const kind = kindOfParam(paramOf(params.kind));
	const userId = paramOf(params.userId) || undefined;
	const [from, setFrom] = useState(addDays(today, -29));
	const [to, setTo] = useState(today);
	const [result, setResult] = useState<{
		rows: number;
		truncated: boolean;
	} | null>(null);
	const [shareError, setShareError] = useState<string | null>(null);
	const failure = messageOf(exporter.error) ?? shareError;
	const person = people.data?.find((row) => row.userId === userId)?.name;
	const filters = [
		category === "change"
			? "Changes"
			: category === "security"
				? "Security"
				: "",
		KIND_OPTIONS.find((option) => option.value === kind)?.label ?? "",
		person ?? "",
	].filter(Boolean);

	const run = () => {
		setResult(null);
		setShareError(null);
		exporter.mutate(
			{ category, kind, userId, from, to },
			{
				onSuccess: (data) => {
					setResult({ rows: data.rows, truncated: data.truncated });
					shareCsv(`audit-log-${from}-${to}.csv`, data.csv).catch(
						(error: Error) => setShareError(messageOf(error)),
					);
				},
			},
		);
	};

	return (
		<Sheet
			title="Export the audit log"
			actionLabel="Export"
			onAction={run}
			busy={exporter.isPending}
		>
			{failure ? <ErrorBanner message={failure} /> : null}
			<FormSection label="Range">
				<View style={{ marginHorizontal: -SPACE.l }}>
					<SettingsSection footer="At most a year. The file holds at most 10,000 rows. The export is recorded in the log.">
						<PickerRow
							title="From"
							mode="date"
							value={from}
							display={formatDay(from)}
							onChange={setFrom}
							minimum={addDays(to, -MAX_SPAN_DAYS)}
							maximum={to}
						/>
						<PickerRow
							title="To"
							mode="date"
							value={to}
							display={formatDay(to)}
							onChange={setTo}
							minimum={from}
							maximum={
								addDays(from, MAX_SPAN_DAYS) < today
									? addDays(from, MAX_SPAN_DAYS)
									: today
							}
						/>
					</SettingsSection>
				</View>
			</FormSection>
			{filters.length > 0 ? (
				<FormSection label="Filters of the list">
					<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
						{filters.join(", ")}
					</Text>
				</FormSection>
			) : null}
			{result ? (
				<FormSection label="Result">
					<Text variant="bodyMedium">
						{`${result.rows} ${result.rows === 1 ? "row" : "rows"} exported.`}
					</Text>
					{result.truncated ? (
						<Text variant="bodyMedium" color={palette.error}>
							{`The export holds the newest ${result.rows} rows. Pick a shorter range for the rest.`}
						</Text>
					) : null}
				</FormSection>
			) : null}
		</Sheet>
	);
}
