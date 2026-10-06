import type { CalendarEvent, TimeEntry } from "@farmer/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, View } from "react-native";

import { useAttachActivity } from "../src/api/day";
import { useEntries, useTasks, useWhoami } from "../src/api/queries";
import { useCreateTimeEntry, useUpdateTimeEntry } from "../src/api/time";
import { useCreateRecurringBlock, useIntegrations } from "../src/api/you";
import { ProjectPicker, TaskPicker } from "../src/forms/pickers";
import { FormCluster, FormPart, Sheet } from "../src/forms/sheet";
import { DayStepper, DurationStepper } from "../src/forms/steppers";
import { addDays, weekdayOf } from "../src/lib/days";
import {
	formatHours,
	QUARTER_HOUR_SECONDS,
	toQuarter,
} from "../src/lib/duration";
import { meetingSeconds } from "../src/time/calendar-change";
import { CalendarNotice } from "../src/time/components/calendar-notice";
import { DateField } from "../src/time/components/date-field";
import {
	EntryGithubSection,
	useEntryGithub,
} from "../src/time/components/entry-github";
import { MeetingPicker } from "../src/time/components/meeting-picker";
import { SwitchRow } from "../src/time/components/switch-row";
import { WeekdayChips } from "../src/time/components/weekday-chips";
import { useConfirmDeleteEntry } from "../src/time/delete-entry";
import { committed } from "../src/time/haptics";
import {
	ActionButton,
	EmptyState,
	ErrorBanner,
	Field,
	Skeleton,
	Text,
} from "../src/ui/components";
import { DestructiveButton } from "../src/ui/destructive-button";
import { showDialog } from "../src/ui/dialog";
import { messageOf } from "../src/ui/errors";
import { usePalette } from "../src/ui/theme";
import { SPACE } from "../src/ui/type";

const FILL_NOTE =
	"This block fills the rest of the day: your working hours, less everything else logged on the day. Its time follows the day.";
const NOTE_HINT =
	"Most tasks need a note. The server says when one is missing.";

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
				timezone={whoami.data.timezone}
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
			timezone={whoami.data.timezone}
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
	timezone,
	weekStartsOn,
	projectId: initialProjectId,
	read,
}: {
	entry: TimeEntry | null;
	date: string;
	today: string;
	/** The workspace's timezone, for the times of the meetings. */
	timezone: string;
	weekStartsOn: number;
	projectId: string | null;
	/** The entries of the week behind the form. */
	read: readonly TimeEntry[];
}) {
	const palette = usePalette();
	const router = useRouter();
	const tasks = useTasks();
	const integrations = useIntegrations();
	const attach = useAttachActivity();
	const create = useCreateTimeEntry();
	const update = useUpdateTimeEntry();
	const remove = useConfirmDeleteEntry();
	const repeat = useCreateRecurringBlock();
	const [date, setDay] = useState(initialDate);
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
	// A meeting picked from the calendar, with its link.
	const [picked, setPicked] = useState<CalendarEvent | null>(null);
	const [calendarOpen, setCalendarOpen] = useState(false);

	// The server keeps one rest-of-day block on a day, so a second one is
	// refused before it is sent. Only the week behind the form is known.
	const dayHasFill =
		!entry && read.some((row) => row.date === date && row.fillsDay);
	// A switch that the form hides has no effect. Time off has no rest-of-day
	// block and does not repeat, and a repeat is not a rest-of-day block.
	const repeats = repeating && !entry && !absence;
	const isFill = entry
		? entry.fillsDay
		: fillsDay && !dayHasFill && !absence && !repeats;
	// The repeat days follow the day of the form until the person picks
	// them.
	const days = repeatDays ?? [weekdayOf(date)];
	const showRepeat = !entry && !absence && !isFill;
	const showFill = !entry && !absence && !repeats;
	const busy =
		create.isPending ||
		update.isPending ||
		remove.pending ||
		repeat.isPending ||
		attach.isPending;
	const failure = messageOf(create.error ?? update.error ?? repeat.error);
	const repeatInvalid = repeats && days.length === 0;

	// The meeting picker is for the Meeting task, found by its system key:
	// a workspace may rename the task.
	const task = [
		...(tasks.data?.tasks ?? []),
		...(tasks.data?.absenceTasks ?? []),
	].find((row) => row.id === taskId);
	const showCalendarPicker =
		!repeats &&
		!isFill &&
		!absence &&
		task?.systemKey === "meeting" &&
		integrations.data?.googleCalendar.connected === true;
	const github = useEntryGithub({
		entryId: entry?.id ?? null,
		projectId: absence ? null : projectId,
		date,
		repeats,
		fill: isFill,
		note,
		setNote,
	});
	// What was picked for another day is evidence of that day: the meeting
	// goes, and the GitHub ticks belong to their own day.
	const setDate = (next: string) => {
		if (next === date) return;
		setPicked(null);
		setCalendarOpen(false);
		setDay(next);
	};
	const pickMeeting = (event: CalendarEvent) => {
		setPicked(event);
		setSeconds(meetingSeconds(event));
		if (!note) setNote(event.title);
		setCalendarOpen(false);
	};
	const meetingFields =
		isFill || absence
			? {}
			: {
					meetingUrl: picked?.meetingUrl ?? undefined,
					calendarEventId: picked?.id ?? undefined,
				};

	const save = () => {
		if (!taskId || repeatInvalid) return;
		const done = {
			onSuccess: () => {
				committed();
				router.back();
			},
		};
		// The entry is saved before its GitHub activity is attached. The sheet
		// closes either way: a second Save would make a second entry.
		const saved = {
			onSuccess: (row: TimeEntry) => {
				const activity = github.picks();
				if (
					activity.commits.length === 0 &&
					activity.pullRequests.length === 0
				) {
					done.onSuccess();
					return;
				}
				attach.mutate(
					{ id: row.id, ...activity },
					{
						onSuccess: done.onSuccess,
						onError: (error) => {
							showDialog(
								"The entry is saved",
								`Its GitHub activity was not attached: ${messageOf(error) ?? ""}`,
							);
							router.back();
						},
					},
				);
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
					...meetingFields,
				},
				saved,
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
					...meetingFields,
				},
			},
			saved,
		);
	};

	const confirmDelete = () => {
		if (entry) remove.confirm(entry, () => router.back());
	};

	const repeatDetails =
		showRepeat && repeats ? (
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
		) : null;

	return (
		<Sheet
			title={entry ? "Edit entry" : "Log time"}
			actionLabel="Save"
			onAction={save}
			busy={busy}
			actionDisabled={!taskId || repeatInvalid}
		>
			{failure ? <ErrorBanner message={failure} /> : null}
			{entry ? (
				<CalendarNotice
					entry={entry}
					timezone={timezone}
					onTaken={() => router.back()}
				/>
			) : null}
			<FormCluster>
				<FormPart
					label={repeats ? "Starts on" : "Day"}
					footer={
						github.dayLocked
							? "Its GitHub activity keeps this entry on this day."
							: undefined
					}
				>
					<DayStepper
						label={repeats ? "Starts on" : "Day"}
						day={date}
						today={today}
						onChange={setDate}
						disabled={github.dayLocked}
					/>
				</FormPart>
				<FormPart label="Time" groupFooter={isFill ? FILL_NOTE : undefined}>
					{isFill ? (
						// iOS shows this note as the footer of the group.
						Platform.OS === "ios" ? null : (
							<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
								{FILL_NOTE}
							</Text>
						)
					) : (
						<DurationStepper
							label="Time"
							seconds={seconds}
							onChange={setSeconds}
						/>
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
				</FormPart>
			</FormCluster>
			<FormCluster>
				<FormPart>
					{absence ? null : (
						<ProjectPicker value={projectId} onChange={setProjectId} />
					)}
					<TaskPicker
						value={taskId}
						includeAbsence={absence || (!entry && projectId === null)}
						onChange={(task) => {
							setTaskId(task.id);
							setAbsence(task.isAbsence);
						}}
					/>
				</FormPart>
			</FormCluster>
			<FormCluster>
				<FormPart groupFooter={NOTE_HINT}>
					<Field
						label="Note"
						hint={NOTE_HINT}
						value={note}
						onChangeText={setNote}
						placeholder="What did you work on?"
						multiline
					/>
				</FormPart>
			</FormCluster>
			{showCalendarPicker ? (
				<View style={{ gap: SPACE.s }}>
					<View style={{ flexDirection: "row" }}>
						<ActionButton
							label="Pull in a calendar event"
							variant="text"
							onPress={() => setCalendarOpen(!calendarOpen)}
						/>
					</View>
					{calendarOpen ? (
						<MeetingPicker
							date={date}
							timezone={timezone}
							selectedId={picked?.id ?? null}
							onPick={pickMeeting}
						/>
					) : null}
				</View>
			) : null}
			{picked?.meetingUrl && !isFill && !absence ? (
				<Text
					variant="bodyMedium"
					color={palette.onSurfaceVariant}
					numberOfLines={1}
				>
					Meeting link: {picked.meetingUrl}
				</Text>
			) : null}
			<EntryGithubSection github={github} />
			{absence ? null : (
				<>
					<FormCluster>
						<FormPart label="More options">
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
							{/* Android keeps the details in the section. */}
							{Platform.OS === "ios" ? null : repeatDetails}
						</FormPart>
					</FormCluster>
					{Platform.OS === "ios" ? repeatDetails : null}
				</>
			)}
			{entry ? (
				<DestructiveButton
					label="Delete entry"
					onPress={confirmDelete}
					disabled={busy}
				/>
			) : null}
		</Sheet>
	);
}
