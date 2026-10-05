import type {
	ReminderSettings,
	ReminderSettingsPatch,
} from "@farmer/api-client";

// The pure part of the reminder settings: the limits of the server, the
// slice of the settings that each section sends, and the checks that run
// before a save. The server checks the same limits again.

export const EARLIEST_TIME = "07:00";
export const LATEST_TIME = "20:00";
export const MAX_NUDGE_DAYS = 3;
export const MAX_MONTH_END_DAYS_BEFORE = 10;

export const TIME_HINT = `${EARLIEST_TIME} to ${LATEST_TIME}, on the quarter hour. Workspace time.`;

/** Overhead employees are not here on purpose: nobody gets a reminder about
 *  a timesheet that nobody reads. */
export const MEMBER_TYPES = [
	"employee_billable",
	"student_full_time",
	"student_hourly",
	"contractor_full_time",
	"contractor_hourly",
] as const;
export type MemberType = (typeof MEMBER_TYPES)[number];

export const MEMBER_TYPE_LABELS = {
	employee_billable: "Employees",
	student_full_time: "Students - full-time",
	student_hourly: "Students - hourly",
	contractor_full_time: "Contractors - full-time",
	contractor_hourly: "Contractors - hourly",
} satisfies { [type in MemberType]: string };

/** The days as the server numbers them: Sunday is 0. */
export const WEEKDAYS = [
	{ day: 0, label: "Sunday" },
	{ day: 1, label: "Monday" },
	{ day: 2, label: "Tuesday" },
	{ day: 3, label: "Wednesday" },
	{ day: 4, label: "Thursday" },
	{ day: 5, label: "Friday" },
	{ day: 6, label: "Saturday" },
] as const;

/** The seven days in the order the workspace draws a week. */
export const orderedWeekdays = (weekStartsOn: number) => [
	...WEEKDAYS.slice(weekStartsOn),
	...WEEKDAYS.slice(0, weekStartsOn),
];

/** The member types in the stored order, so the order of the presses does
 *  not change what is sent. */
export const memberTypesOf = (values: readonly string[]): MemberType[] =>
	MEMBER_TYPES.filter((type) => values.includes(type));

/** Rounds "HH:mm" to the nearest quarter hour. The server accepts nothing
 *  else, and the iOS picker steps by the minute. */
export const toQuarterHour = (time: string) => {
	const [hours = 0, minutes = 0] = time.split(":").map(Number);
	const total = (Math.round((hours * 60 + minutes) / 15) * 15) % 1440;
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
};

export const toggleIn = <T extends string | number>(
	list: readonly T[],
	item: T,
): T[] =>
	list.includes(item)
		? list.filter((value) => value !== item)
		: [...list, item];

export type LogDraft = Required<
	Pick<ReminderSettingsPatch, "logMode" | "logTime" | "logBelowPct">
>;
export type NudgeDraft = Required<
	Pick<
		ReminderSettingsPatch,
		"nudgeWeekdays" | "nudgeTime" | "nudgeMemberTypes"
	>
>;
export type MonthEndDraft = Required<
	Pick<
		ReminderSettingsPatch,
		| "monthEndDaysBefore"
		| "monthEndTime"
		| "monthEndOnlyBehind"
		| "monthEndMemberTypes"
	>
>;
export type DigestDraft = Required<
	Pick<ReminderSettingsPatch, "digestWeekday" | "digestTime">
>;

// Each section sends its own slice and nothing else, so a save on one
// section cannot write back a stale value of another.
export const logSlice = (s: ReminderSettings): LogDraft => ({
	logMode: s.logMode === "fixed" ? "fixed" : "end_of_day",
	logTime: s.logTime,
	logBelowPct: s.logBelowPct,
});
export const nudgeSlice = (s: ReminderSettings): NudgeDraft => ({
	nudgeWeekdays: [...s.nudgeWeekdays].sort((a, b) => a - b),
	nudgeTime: s.nudgeTime,
	nudgeMemberTypes: memberTypesOf(s.nudgeMemberTypes),
});
export const monthEndSlice = (s: ReminderSettings): MonthEndDraft => ({
	monthEndDaysBefore: s.monthEndDaysBefore,
	monthEndTime: s.monthEndTime,
	monthEndOnlyBehind: s.monthEndOnlyBehind,
	monthEndMemberTypes: memberTypesOf(s.monthEndMemberTypes),
});
export const digestSlice = (s: ReminderSettings): DigestDraft => ({
	digestWeekday: s.digestWeekday,
	digestTime: s.digestTime,
});

export const sameSlice = (a: ReminderSettingsPatch, b: ReminderSettingsPatch) =>
	JSON.stringify(a) === JSON.stringify(b);

const timeProblem = (time: string) =>
	time >= EARLIEST_TIME && time <= LATEST_TIME
		? null
		: `Pick a time from ${EARLIEST_TIME} to ${LATEST_TIME}.`;

export const logProblem = (draft: LogDraft) =>
	(draft.logMode === "fixed" ? timeProblem(draft.logTime) : null) ??
	(draft.logBelowPct >= 1 && draft.logBelowPct <= 100
		? null
		: "The percentage must be from 1 to 100.");

export const nudgeProblem = (draft: NudgeDraft) =>
	timeProblem(draft.nudgeTime) ??
	(draft.nudgeWeekdays.length === 0 ? "Pick at least one day." : null) ??
	(draft.nudgeWeekdays.length > MAX_NUDGE_DAYS
		? `Pick at most ${MAX_NUDGE_DAYS} days a week.`
		: null) ??
	(draft.nudgeMemberTypes.length === 0
		? "Pick at least one person type."
		: null);

export const monthEndProblem = (draft: MonthEndDraft) =>
	timeProblem(draft.monthEndTime) ??
	(draft.monthEndDaysBefore >= 0 &&
	draft.monthEndDaysBefore <= MAX_MONTH_END_DAYS_BEFORE
		? null
		: `The number of days must be from 0 to ${MAX_MONTH_END_DAYS_BEFORE}.`) ??
	(draft.monthEndMemberTypes.length === 0
		? "Pick at least one person type."
		: null);

export const digestProblem = (draft: DigestDraft) =>
	timeProblem(draft.digestTime);
