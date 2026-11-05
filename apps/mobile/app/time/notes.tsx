import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";

import { useEntries } from "../../src/api/queries";
import { useWriteNotes } from "../../src/api/time";
import { Sheet } from "../../src/forms/sheet";
import { addDays, dayOfMonth, weekdayShort } from "../../src/lib/days";
import { formatHours } from "../../src/lib/duration";
import { committed } from "../../src/time/haptics";
import {
	buildRows,
	cellSeconds,
	type GridRow,
	notePatches,
	rowKey,
	storedNote,
} from "../../src/time/week-grid";
import {
	EmptyState,
	ErrorBanner,
	Field,
	Skeleton,
	Text,
} from "../../src/ui/components";
import { messageOf } from "../../src/ui/errors";
import { usePalette } from "../../src/ui/theme";

type Params = {
	from: string;
	to: string;
	/** "" for a row with no project. */
	projectId?: string;
	taskId: string;
};

/**
 * The notes of one row of the week grid: a box for each day that has time
 * in the row. A note is stored on an entry, so a day with no time has no
 * box. The row comes from the week that the grid read.
 */
export default function RowNotesSheet() {
	const params = useLocalSearchParams<Params>();
	const entries = useEntries(params.from, params.to);
	const key = rowKey(params.projectId || null, params.taskId);
	const row = buildRows(entries.data ?? [], []).find(
		(item) => item.key === key,
	);

	if (entries.isPending) {
		return (
			<Sheet title="Notes" actionLabel="Save" onAction={() => undefined} busy>
				<Skeleton height={88} radius={16} />
			</Sheet>
		);
	}
	if (!row) {
		return (
			<Sheet
				title="Notes"
				actionLabel="Save"
				onAction={() => undefined}
				actionDisabled
			>
				<EmptyState
					icon="inbox"
					title="This row has no time"
					message="It was changed or removed somewhere else."
				/>
			</Sheet>
		);
	}
	return <NotesForm row={row} from={params.from} />;
}

function NotesForm({ row, from }: { row: GridRow; from: string }) {
	const palette = usePalette();
	const router = useRouter();
	const write = useWriteNotes();
	// The days of the week with time in this row, in order.
	const days = Array.from({ length: 7 }, (_, i) => addDays(from, i)).filter(
		(date) => (row.byDate.get(date) ?? []).length > 0,
	);
	const [drafts, setDrafts] = useState<Record<string, string>>(() =>
		Object.fromEntries(days.map((date) => [date, storedNote(row, date)])),
	);
	const patches = days.flatMap((date) =>
		notePatches(row, date, drafts[date] ?? ""),
	);

	return (
		<Sheet
			title={row.taskName ? `${row.heading}, ${row.taskName}` : row.heading}
			actionLabel="Save"
			busy={write.isPending}
			actionDisabled={patches.length === 0}
			onAction={() =>
				write.mutate(patches, {
					onSuccess: () => {
						committed();
						router.back();
					},
				})
			}
		>
			{write.error ? (
				<ErrorBanner message={messageOf(write.error) ?? ""} />
			) : null}
			<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
				A note describes the work of one day.
			</Text>
			{days.map((date) => (
				<Field
					key={date}
					label={`${weekdayShort(date)} ${dayOfMonth(date)}, ${formatHours(cellSeconds(row, date))}`}
					value={drafts[date] ?? ""}
					onChangeText={(text) =>
						setDrafts((current) => ({ ...current, [date]: text }))
					}
					placeholder="What you did"
					multiline
				/>
			))}
		</Sheet>
	);
}
