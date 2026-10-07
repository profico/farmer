import type { CalendarEvent, TimeEntry } from "@farmer/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";

import { useAttachActivity } from "../src/api/day";
import { useEntries, useTasks, useWhoami } from "../src/api/queries";
import { useCreateTimeEntry, useUpdateTimeEntry } from "../src/api/time";
import { useCreateRecurringBlock, useIntegrations } from "../src/api/you";
import { Sheet } from "../src/forms/sheet";
import { meetingSeconds } from "../src/time/calendar-change";
import { CalendarNotice } from "../src/time/components/calendar-notice";
import {
	CalendarSection,
	DayTimeCluster,
	MeetingLink,
	MoreOptions,
	NoteCluster,
	RepeatDetails,
	TaskCluster,
} from "../src/time/components/entry-form-parts";
import {
	EntryGithubSection,
	useEntryGithub,
} from "../src/time/components/entry-github";
import { useConfirmDeleteEntry } from "../src/time/delete-entry";
import {
	createPayload,
	deriveForm,
	type EntryDerived,
	type EntryValues,
	findTask,
	meetingLinkOf,
	repeatPayload,
	showsCalendarPicker,
	startOf,
	updatePayload,
} from "../src/time/entry-form";
import { committed } from "../src/time/haptics";
import { EmptyState, ErrorBanner, Skeleton } from "../src/ui/components";
import { DestructiveButton } from "../src/ui/destructive-button";
import { showDialog } from "../src/ui/dialog";
import { messageOf } from "../src/ui/errors";

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

type EntryFormProps = {
	entry: TimeEntry | null;
	date: string;
	today: string;
	/** The workspace's timezone, for the times of the meetings. */
	timezone: string;
	weekStartsOn: number;
	projectId: string | null;
	/** The entries of the week behind the form. */
	read: readonly TimeEntry[];
};

type SubmitArgs = {
	entry: TimeEntry | null;
	values: EntryValues;
	derived: EntryDerived;
	picked: CalendarEvent | null;
	github: ReturnType<typeof useEntryGithub>;
	router: ReturnType<typeof useRouter>;
	create: ReturnType<typeof useCreateTimeEntry>;
	update: ReturnType<typeof useUpdateTimeEntry>;
	repeat: ReturnType<typeof useCreateRecurringBlock>;
	attach: ReturnType<typeof useAttachActivity>;
};

/** The entry is saved before its GitHub activity is attached. The sheet
 *  closes either way: a second Save would make a second entry. */
const afterSave = ({
	github,
	router,
	attach,
}: Pick<SubmitArgs, "github" | "router" | "attach">) => {
	const done = () => {
		committed();
		router.back();
	};
	return {
		onSuccess: (row: TimeEntry) => {
			const activity = github.picks();
			if (activity.commits.length === 0 && activity.pullRequests.length === 0) {
				done();
				return;
			}
			attach.mutate(
				{ id: row.id, ...activity },
				{
					onSuccess: done,
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
};

const submit = (args: SubmitArgs) => {
	const { entry, values, derived, picked, router } = args;
	if (derived.repeats) {
		args.repeat.mutate(repeatPayload(values, derived), {
			onSuccess: () => {
				committed();
				router.back();
			},
		});
		return;
	}
	if (!entry) {
		args.create.mutate(createPayload(values, derived, picked), afterSave(args));
		return;
	}
	args.update.mutate(
		updatePayload(entry.id, values, derived, picked),
		afterSave(args),
	);
};

function EntryForm({
	entry,
	date: initialDate,
	today,
	timezone,
	weekStartsOn,
	projectId: initialProjectId,
	read,
}: EntryFormProps) {
	const router = useRouter();
	const tasks = useTasks();
	const integrations = useIntegrations();
	const attach = useAttachActivity();
	const create = useCreateTimeEntry();
	const update = useUpdateTimeEntry();
	const remove = useConfirmDeleteEntry();
	const repeat = useCreateRecurringBlock();
	const start = startOf(entry);
	const [date, setDay] = useState(initialDate);
	const [projectId, setProjectId] = useState(initialProjectId);
	const [taskId, setTaskId] = useState<string | null>(start.taskId);
	const [absence, setAbsence] = useState(start.absence);
	const [seconds, setSeconds] = useState(start.seconds);
	const [note, setNote] = useState(start.note);
	const [overtime, setOvertime] = useState(start.overtime);
	const [fillsDay, setFillsDay] = useState(start.fillsDay);
	const [repeating, setRepeating] = useState(false);
	const [repeatDays, setRepeatDays] = useState<number[] | null>(null);
	const [until, setUntil] = useState<string | null>(null);
	// A meeting picked from the calendar, with its link.
	const [picked, setPicked] = useState<CalendarEvent | null>(null);
	const [calendarOpen, setCalendarOpen] = useState(false);

	const derived = deriveForm({
		entry,
		read,
		date,
		absence,
		repeating,
		fillsDay,
		repeatDays,
	});
	const { repeats, isFill, repeatInvalid } = derived;
	const busy =
		create.isPending ||
		update.isPending ||
		remove.pending ||
		repeat.isPending ||
		attach.isPending;
	const failure = messageOf(create.error ?? update.error ?? repeat.error);

	const task = findTask(tasks.data, taskId);
	const showCalendarPicker = showsCalendarPicker(
		derived,
		absence,
		task?.systemKey,
		integrations.data?.googleCalendar.connected === true,
	);
	const meetingLink = meetingLinkOf(picked, derived, absence);
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

	const save = () => {
		if (!taskId || repeatInvalid) return;
		const values = {
			date,
			taskId,
			projectId,
			absence,
			seconds,
			note,
			overtime,
			until,
		};
		submit({
			entry,
			values,
			derived,
			picked,
			github,
			router,
			create,
			update,
			repeat,
			attach,
		});
	};

	const repeatDetails =
		derived.showRepeat && repeats ? (
			<RepeatDetails
				days={derived.days}
				weekStartsOn={weekStartsOn}
				onDays={setRepeatDays}
				invalid={repeatInvalid}
				date={date}
				until={until}
				onUntil={setUntil}
			/>
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
			<DayTimeCluster
				repeats={repeats}
				dayLocked={github.dayLocked}
				date={date}
				today={today}
				onChange={setDate}
				isFill={isFill}
				showFill={derived.showFill}
				dayHasFill={derived.dayHasFill}
				seconds={seconds}
				onSeconds={setSeconds}
				onFill={setFillsDay}
			/>
			<TaskCluster
				absence={absence}
				isNew={!entry}
				projectId={projectId}
				taskId={taskId}
				onProject={setProjectId}
				onTask={(next) => {
					setTaskId(next.id);
					setAbsence(next.isAbsence);
				}}
			/>
			<NoteCluster note={note} onNote={setNote} />
			{showCalendarPicker ? (
				<CalendarSection
					open={calendarOpen}
					onOpen={setCalendarOpen}
					date={date}
					timezone={timezone}
					selectedId={picked?.id ?? null}
					onPick={pickMeeting}
				/>
			) : null}
			{meetingLink ? <MeetingLink url={meetingLink} /> : null}
			<EntryGithubSection github={github} />
			{absence ? null : (
				<MoreOptions
					overtime={overtime}
					onOvertime={setOvertime}
					showRepeat={derived.showRepeat}
					repeating={repeating}
					onRepeating={setRepeating}
					details={repeatDetails}
				/>
			)}
			{entry ? (
				<DestructiveButton
					label="Delete entry"
					onPress={() => remove.confirm(entry, () => router.back())}
					disabled={busy}
				/>
			) : null}
		</Sheet>
	);
}
