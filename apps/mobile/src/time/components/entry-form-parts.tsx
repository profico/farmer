import type { CalendarEvent } from "@farmer/api-client";
import type { ReactNode } from "react";
import { Platform, View } from "react-native";

import { ProjectPicker, TaskPicker } from "../../forms/pickers";
import { FormCluster, FormPart } from "../../forms/sheet";
import { DayStepper, DurationStepper } from "../../forms/steppers";
import { addDays } from "../../lib/days";
import { ActionButton, Field, Text } from "../../ui/components";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import { DateField } from "./date-field";
import { MeetingPicker } from "./meeting-picker";
import { SwitchRow } from "./switch-row";
import { WeekdayChips } from "./weekday-chips";

const FILL_NOTE =
	"This block fills the rest of the day: your working hours, less everything else logged on the day. Its time follows the day.";
const REQUIRED_NOTE = "This task needs a note.";
const NOTE_HINT = "Most tasks need a note. Time off and breaks do not.";

type DayPartProps = {
	repeats: boolean;
	dayLocked: boolean;
	date: string;
	today: string;
	onChange: (day: string) => void;
};

/** The day of the form. A repeat starts on it. A plain function, so the
 *  cluster gets the part as its direct child. */
function dayPart({ repeats, dayLocked, date, today, onChange }: DayPartProps) {
	const label = repeats ? "Starts on" : "Day";
	return (
		<FormPart
			label={label}
			footer={
				dayLocked
					? "Its GitHub activity keeps this entry on this day."
					: undefined
			}
		>
			<DayStepper
				label={label}
				day={date}
				today={today}
				onChange={onChange}
				disabled={dayLocked}
			/>
		</FormPart>
	);
}

function FillNote() {
	const palette = usePalette();
	return (
		<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
			{FILL_NOTE}
		</Text>
	);
}

type TimePartProps = {
	isFill: boolean;
	showFill: boolean;
	dayHasFill: boolean;
	seconds: number;
	onSeconds: (seconds: number) => void;
	onFill: (on: boolean) => void;
};

/** The length of the entry, and the rest-of-day switch. */
function timePart({
	isFill,
	showFill,
	dayHasFill,
	seconds,
	onSeconds,
	onFill,
}: TimePartProps) {
	return (
		<FormPart label="Time" groupFooter={isFill ? FILL_NOTE : undefined}>
			{isFill ? (
				<FillNote />
			) : (
				<DurationStepper label="Time" seconds={seconds} onChange={onSeconds} />
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
					onValueChange={onFill}
					disabled={dayHasFill}
				/>
			) : null}
		</FormPart>
	);
}

/** The day and the time of the form. */
export function DayTimeCluster(props: DayPartProps & TimePartProps) {
	return (
		<FormCluster>
			{dayPart(props)}
			{timePart(props)}
		</FormCluster>
	);
}

/** The project and the task. */
export function TaskCluster({
	absence,
	isNew,
	projectId,
	taskId,
	onProject,
	onTask,
}: {
	absence: boolean;
	isNew: boolean;
	projectId: string | null;
	taskId: string | null;
	onProject: (id: string | null) => void;
	onTask: (task: { id: string; isAbsence: boolean }) => void;
}) {
	return (
		<FormCluster>
			<FormPart>
				{absence ? null : (
					<ProjectPicker value={projectId} onChange={onProject} />
				)}
				<TaskPicker
					value={taskId}
					includeAbsence={absence || (isNew && projectId === null)}
					onChange={onTask}
				/>
			</FormPart>
		</FormCluster>
	);
}

export function NoteCluster({
	note,
	onNote,
	required,
	missing,
}: {
	note: string;
	onNote: (note: string) => void;
	/** The task needs a note. */
	required: boolean;
	/** The task needs a note and there is none. Save is off. */
	missing: boolean;
}) {
	const hint = required ? REQUIRED_NOTE : NOTE_HINT;
	return (
		<FormCluster>
			<FormPart
				footerError={missing}
				groupFooter={missing ? REQUIRED_NOTE : hint}
			>
				<Field
					label="Note"
					hint={hint}
					error={missing ? REQUIRED_NOTE : null}
					value={note}
					onChangeText={onNote}
					placeholder="What did you work on?"
					multiline
				/>
			</FormPart>
		</FormCluster>
	);
}

/** The button that opens the meeting picker, and the picker. */
export function CalendarSection({
	open,
	onOpen,
	date,
	timezone,
	selectedId,
	onPick,
}: {
	open: boolean;
	onOpen: (open: boolean) => void;
	date: string;
	timezone: string;
	selectedId: string | null;
	onPick: (event: CalendarEvent) => void;
}) {
	return (
		<View style={{ gap: SPACE.s }}>
			<View style={{ flexDirection: "row" }}>
				<ActionButton
					label="Pull in a calendar event"
					variant="text"
					onPress={() => onOpen(!open)}
				/>
			</View>
			{open ? (
				<MeetingPicker
					date={date}
					timezone={timezone}
					selectedId={selectedId}
					onPick={onPick}
				/>
			) : null}
		</View>
	);
}

export function MeetingLink({ url }: { url: string }) {
	const palette = usePalette();
	return (
		<Text
			variant="bodyMedium"
			color={palette.onSurfaceVariant}
			numberOfLines={1}
		>
			Meeting link: {url}
		</Text>
	);
}

/** The days, the last day and the error of a repeat. */
export function RepeatDetails({
	days,
	weekStartsOn,
	onDays,
	invalid,
	date,
	until,
	onUntil,
}: {
	days: number[];
	weekStartsOn: number;
	onDays: (days: number[]) => void;
	invalid: boolean;
	date: string;
	until: string | null;
	onUntil: (day: string | null) => void;
}) {
	const palette = usePalette();
	return (
		<View style={{ gap: 12 }}>
			<WeekdayChips
				value={days}
				weekStartsOn={weekStartsOn}
				onChange={onDays}
			/>
			{invalid ? (
				<Text variant="bodySmall" color={palette.error}>
					Pick at least one day.
				</Text>
			) : null}
			<SwitchRow
				title="Stop on a day"
				description={
					until ? undefined : "With no last day, it repeats until you stop it."
				}
				value={until !== null}
				onValueChange={(on) => onUntil(on ? addDays(date, 28) : null)}
			/>
			{until !== null ? (
				<DateField
					label="Last day"
					value={until}
					minimum={date}
					onChange={onUntil}
				/>
			) : null}
		</View>
	);
}

/** The overtime and repeat switches. On Android the repeat details sit in
 *  the section, and on iOS they sit under it. */
export function MoreOptions({
	overtime,
	onOvertime,
	showRepeat,
	repeating,
	onRepeating,
	details,
}: {
	overtime: boolean;
	onOvertime: (on: boolean) => void;
	showRepeat: boolean;
	repeating: boolean;
	onRepeating: (on: boolean) => void;
	details: ReactNode;
}) {
	const ios = Platform.OS === "ios";
	return (
		<>
			<FormCluster>
				<FormPart label="More options">
					<SwitchRow
						title="Overtime"
						description="Mark this time as overtime."
						value={overtime}
						onValueChange={onOvertime}
					/>
					{showRepeat ? (
						<SwitchRow
							title="Repeat"
							description="Log this every week on the days you pick. This makes a recurring block, not an entry."
							value={repeating}
							onValueChange={onRepeating}
						/>
					) : null}
					{ios ? null : details}
				</FormPart>
			</FormCluster>
			{ios ? details : null}
		</>
	);
}
