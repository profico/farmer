import type { TimeEntry } from "@farmer/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";

import {
	useCreateEntry,
	useDeleteEntry,
	useEntries,
	useUpdateEntry,
	useWhoami,
} from "../src/api/queries";
import { ProjectPicker, TaskPicker } from "../src/forms/pickers";
import { FormSection, Sheet } from "../src/forms/sheet";
import { DayStepper, DurationStepper } from "../src/forms/steppers";
import { QUARTER_HOUR_SECONDS, toQuarter } from "../src/lib/duration";
import {
	ActionButton,
	EmptyState,
	ErrorBanner,
	Field,
	Skeleton,
	Text,
} from "../src/ui/components";
import { messageOf } from "../src/ui/errors";
import { usePalette } from "../src/ui/theme";

type Params = {
	id?: string;
	date?: string;
	from?: string;
	to?: string;
	projectId?: string;
};

/** Add an entry, or edit one of the day's (`id`, with the week it was read
 *  in, so the entry comes from that read and nothing is fetched again). */
export default function EntrySheet() {
	const params = useLocalSearchParams<Params>();
	const whoami = useWhoami();
	const today = whoami.data?.today ?? params.date ?? "";
	const from = params.from ?? params.date ?? today;
	const to = params.to ?? params.date ?? today;
	const entries = useEntries(from, to);

	if (!whoami.data) {
		return (
			<Sheet
				title="Log time"
				actionLabel="Save"
				onAction={() => undefined}
				busy
			>
				<Skeleton height={56} radius={16} />
			</Sheet>
		);
	}
	if (!params.id) {
		return (
			<EntryForm
				entry={null}
				date={params.date ?? today}
				today={today}
				projectId={params.projectId ?? null}
			/>
		);
	}
	if (entries.isPending) {
		return (
			<Sheet
				title="Edit entry"
				actionLabel="Save"
				onAction={() => undefined}
				busy
			>
				<Skeleton height={56} radius={16} />
				<Skeleton height={56} radius={16} />
			</Sheet>
		);
	}
	const entry = entries.data?.find((row) => row.id === params.id);
	if (!entry) {
		return (
			<Sheet
				title="Edit entry"
				actionLabel="Save"
				onAction={() => undefined}
				actionDisabled
			>
				<EmptyState
					icon="inbox"
					title="This entry is gone"
					message="It was changed or removed somewhere else."
				/>
			</Sheet>
		);
	}
	return (
		<EntryForm
			entry={entry}
			date={entry.date}
			today={today}
			projectId={entry.project?.id ?? null}
		/>
	);
}

function EntryForm({
	entry,
	date: initialDate,
	today,
	projectId: initialProjectId,
}: {
	entry: TimeEntry | null;
	date: string;
	today: string;
	projectId: string | null;
}) {
	const palette = usePalette();
	const router = useRouter();
	const create = useCreateEntry();
	const update = useUpdateEntry();
	const remove = useDeleteEntry();
	const [date, setDate] = useState(initialDate);
	const [projectId, setProjectId] = useState(initialProjectId);
	const [taskId, setTaskId] = useState<string | null>(entry?.task.id ?? null);
	const [absence, setAbsence] = useState(entry?.task.isAbsence ?? false);
	const [seconds, setSeconds] = useState(
		entry ? toQuarter(entry.durationSeconds) : 4 * QUARTER_HOUR_SECONDS,
	);
	const [note, setNote] = useState(entry?.description ?? "");
	const fillsDay = entry?.fillsDay ?? false;
	const busy = create.isPending || update.isPending || remove.isPending;
	const failure = messageOf(create.error ?? update.error ?? remove.error);

	const save = () => {
		if (!taskId) return;
		const done = { onSuccess: () => router.back() };
		if (!entry) {
			create.mutate(
				{
					date,
					taskId,
					projectId: absence ? undefined : (projectId ?? undefined),
					description: note.trim(),
					durationSeconds: seconds,
				},
				done,
			);
			return;
		}
		update.mutate(
			{
				id: entry.id,
				patch: {
					date,
					taskId,
					// Null clears the project; time off has none.
					projectId: absence ? null : projectId,
					description: note.trim(),
					// A rest-of-day block's length follows the day.
					durationSeconds: fillsDay ? undefined : seconds,
				},
			},
			done,
		);
	};

	const confirmDelete = () => {
		if (!entry) return;
		Alert.alert("Delete this entry?", "This cannot be undone.", [
			{ text: "Cancel", style: "cancel" },
			{
				text: "Delete",
				style: "destructive",
				onPress: () =>
					remove.mutate(entry.id, { onSuccess: () => router.back() }),
			},
		]);
	};

	return (
		<Sheet
			title={entry ? "Edit entry" : "Log time"}
			actionLabel="Save"
			onAction={save}
			busy={busy}
			actionDisabled={!taskId}
		>
			{failure ? <ErrorBanner message={failure} /> : null}
			<FormSection label="Day">
				<DayStepper day={date} today={today} onChange={setDate} />
			</FormSection>
			<FormSection label="Time">
				{fillsDay ? (
					<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
						This block fills the rest of the day, so its length follows the day.
					</Text>
				) : (
					<DurationStepper seconds={seconds} onChange={setSeconds} />
				)}
			</FormSection>
			{absence ? null : (
				<FormSection label="Project">
					<ProjectPicker value={projectId} onChange={setProjectId} />
				</FormSection>
			)}
			<FormSection label="Task">
				<TaskPicker
					value={taskId}
					includeAbsence={absence}
					onChange={(task) => {
						setTaskId(task.id);
						setAbsence(task.isAbsence);
					}}
				/>
			</FormSection>
			<Field
				label="Note"
				hint="Most tasks need a note. The server says when one is missing."
				value={note}
				onChangeText={setNote}
				placeholder="What did you work on?"
				multiline
			/>
			{entry ? (
				<View style={{ flexDirection: "row" }}>
					<ActionButton
						label="Delete entry"
						variant="text"
						onPress={confirmDelete}
						disabled={busy}
					/>
				</View>
			) : null}
		</Sheet>
	);
}
