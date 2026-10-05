import type { TimeEntry } from "@farmer/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";

import { useAccess } from "../src/api/capabilities";
import { useEntries, useWhoami } from "../src/api/queries";
import {
	useCreateRecurringBlock,
	useCreateTimeEntry,
	useDeleteTimeEntry,
	useUpdateTimeEntry,
} from "../src/api/time";
import { ProjectPicker, TaskPicker } from "../src/forms/pickers";
import { FormSection, Sheet } from "../src/forms/sheet";
import { DayStepper, DurationStepper } from "../src/forms/steppers";
import { addDays, weekdayOf } from "../src/lib/days";
import {
	formatHours,
	QUARTER_HOUR_SECONDS,
	toQuarter,
} from "../src/lib/duration";
import { DateField } from "../src/time/components/date-field";
import { SwitchRow } from "../src/time/components/switch-row";
import { WeekdayChips } from "../src/time/components/weekday-chips";
import { committed } from "../src/time/haptics";
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
	/** The week the screen behind read, so the form uses that read. */
	from?: string;
	to?: string;
	projectId?: string;
};

/** Add an entry, or edit one of the day's (`id`). The entry and the other
 *  entries of its day come from the week the screen behind read, so
 *  nothing is fetched again. */
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
				weekStartsOn={whoami.data.weekStartsOn}
				projectId={params.projectId ?? null}
				read={entries.data ?? []}
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
			weekStartsOn={whoami.data.weekStartsOn}
			projectId={entry.project?.id ?? null}
			read={entries.data ?? []}
		/>
	);
}

function EntryForm({
	entry,
	date: initialDate,
	today,
	weekStartsOn,
	projectId: initialProjectId,
	read,
}: {
	entry: TimeEntry | null;
	date: string;
	today: string;
	weekStartsOn: number;
	projectId: string | null;
	/** The entries of the week behind the form. */
	read: readonly TimeEntry[];
}) {
	const palette = usePalette();
	const router = useRouter();
	const { fullApi } = useAccess();
	const create = useCreateTimeEntry();
	const update = useUpdateTimeEntry();
	const remove = useDeleteTimeEntry();
	const repeat = useCreateRecurringBlock();
	const [date, setDate] = useState(initialDate);
	const [projectId, setProjectId] = useState(initialProjectId);
	const [taskId, setTaskId] = useState<string | null>(entry?.task.id ?? null);
	const [absence, setAbsence] = useState(entry?.task.isAbsence ?? false);
	const [seconds, setSeconds] = useState(
		entry ? toQuarter(entry.durationSeconds) : 4 * QUARTER_HOUR_SECONDS,
	);
	const [note, setNote] = useState(entry?.description ?? "");
	const [overtime, setOvertime] = useState(entry?.overtime ?? false);
	// A new entry only: an entry keeps what it is.
	const [fillsDay, setFillsDay] = useState(entry?.fillsDay ?? false);
	const [repeating, setRepeating] = useState(false);
	const [repeatDays, setRepeatDays] = useState<number[] | null>(null);
	const [until, setUntil] = useState<string | null>(null);

	// The server keeps one rest-of-day block on a day, so a second one is
	// refused before it is sent. Only the week behind the form is known.
	const dayHasFill =
		!entry && read.some((row) => row.date === date && row.fillsDay);
	// A switch that the form hides has no effect. Time off has no rest-of-day
	// block and does not repeat, and a repeat is not a rest-of-day block.
	const repeats = repeating && !entry && fullApi && !absence;
	const isFill = entry
		? entry.fillsDay
		: fillsDay && !dayHasFill && !absence && !repeats;
	// The repeat days follow the day of the form until the person picks
	// them.
	const days = repeatDays ?? [weekdayOf(date)];
	const showRepeat = !entry && fullApi && !absence && !isFill;
	const showFill = !entry && !absence && !repeats;
	const busy =
		create.isPending ||
		update.isPending ||
		remove.isPending ||
		repeat.isPending;
	const failure = messageOf(
		create.error ?? update.error ?? remove.error ?? repeat.error,
	);
	const repeatInvalid = repeats && days.length === 0;

	const save = () => {
		if (!taskId || repeatInvalid) return;
		const done = {
			onSuccess: () => {
				committed();
				router.back();
			},
		};
		const project = absence ? undefined : (projectId ?? undefined);
		if (repeats) {
			repeat.mutate(
				{
					taskId,
					projectId: project,
					description: note.trim() || undefined,
					daysOfWeek: days,
					duration: formatHours(seconds),
					effectiveFrom: date,
					effectiveUntil: until ?? undefined,
				},
				done,
			);
			return;
		}
		if (!entry) {
			create.mutate(
				{
					date,
					taskId,
					projectId: project,
					description: note.trim(),
					// A rest-of-day block's length comes from the day.
					durationSeconds: isFill ? undefined : seconds,
					overtime: absence ? false : overtime,
					fillsDay: isFill,
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
					durationSeconds: isFill ? undefined : seconds,
					overtime: absence ? false : overtime,
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
			actionDisabled={!taskId || repeatInvalid}
		>
			{failure ? <ErrorBanner message={failure} /> : null}
			<FormSection label={repeats ? "Starts on" : "Day"}>
				<DayStepper day={date} today={today} onChange={setDate} />
			</FormSection>
			<FormSection label="Time">
				{isFill ? (
					<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
						This block fills the rest of the day: your working hours, less
						everything else logged on the day. Its time follows the day.
					</Text>
				) : (
					<DurationStepper seconds={seconds} onChange={setSeconds} />
				)}
				{showFill ? (
					<SwitchRow
						title="Rest of the day"
						description={
							dayHasFill
								? "This day already has a rest-of-day block. Change that one."
								: "Fill what is left of your working hours on this day."
						}
						value={isFill}
						onValueChange={setFillsDay}
						disabled={dayHasFill}
					/>
				) : null}
			</FormSection>
			{absence ? null : (
				<FormSection label="Project">
					<ProjectPicker value={projectId} onChange={setProjectId} />
				</FormSection>
			)}
			<FormSection label="Task">
				<TaskPicker
					value={taskId}
					includeAbsence={absence || (!entry && projectId === null)}
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
			{absence ? null : (
				<FormSection label="More options">
					<SwitchRow
						title="Overtime"
						description="Mark this time as overtime."
						value={overtime}
						onValueChange={setOvertime}
					/>
					{showRepeat ? (
						<SwitchRow
							title="Repeat"
							description="Log this every week on the days you pick. This makes a recurring block, not an entry."
							value={repeating}
							onValueChange={setRepeating}
						/>
					) : null}
					{showRepeat && repeats ? (
						<View style={{ gap: 12 }}>
							<WeekdayChips
								value={days}
								weekStartsOn={weekStartsOn}
								onChange={setRepeatDays}
							/>
							{repeatInvalid ? (
								<Text variant="bodySmall" color={palette.error}>
									Pick at least one day.
								</Text>
							) : null}
							<SwitchRow
								title="Stop on a day"
								description={
									until
										? undefined
										: "With no last day, it repeats until you stop it."
								}
								value={until !== null}
								onValueChange={(on) => setUntil(on ? addDays(date, 28) : null)}
							/>
							{until !== null ? (
								<DateField
									label="Last day"
									value={until}
									minimum={date}
									onChange={setUntil}
								/>
							) : null}
						</View>
					) : null}
				</FormSection>
			)}
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
