// Pure helpers of the "You" screens. They import nothing from React Native,
// so `bun test` can run them.

/** 0 is Sunday, as the server counts. */
const WEEKDAY_NAMES = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
] as const;

/** The seven weekdays from the first day of the workspace's week. */
export const orderedWeekdays = (weekStartsOn: number): number[] =>
	Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7);

export const weekdayName = (day: number): string =>
	WEEKDAY_NAMES[((day % 7) + 7) % 7] ?? "";

/** "M", "T" and so on, for a small weekday chip. */
export const weekdayInitial = (day: number): string =>
	weekdayName(day).slice(0, 1);

/** "Mon, Tue, Wed" for a set of weekdays, in the order of the week. A full
 *  working week and every day have short names. */
export const daysSummary = (days: number[], weekStartsOn: number): string => {
	const set = new Set(days);
	if (set.size === 7) return "Every day";
	if (set.size === 5 && [1, 2, 3, 4, 5].every((day) => set.has(day))) {
		return "Monday to Friday";
	}
	return orderedWeekdays(weekStartsOn)
		.filter((day) => set.has(day))
		.map((day) => weekdayName(day).slice(0, 3))
		.join(", ");
};

/** Minutes after midnight of "HH:mm". */
const minutesOf = (time: string): number => {
	const [hours, minutes] = time.split(":").map(Number);
	return (hours ?? 0) * 60 + (minutes ?? 0);
};

/** The seconds of a working day from its start and end, or 0. */
export const daySeconds = (start: string, end: string): number =>
	Math.max(0, minutesOf(end) - minutesOf(start)) * 60;

/** "8 hours", "30 minutes", "1 hour 30 minutes". */
export const hoursLabel = (seconds: number): string => {
	const total = Math.round(seconds / 60);
	const hours = Math.floor(total / 60);
	const minutes = total % 60;
	const parts = [
		hours > 0 ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "",
		minutes > 0 ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}` : "",
	].filter((part) => part);
	return parts.length > 0 ? parts.join(" ") : "0 minutes";
};

/** The choices of the timer limit, as the web app offers them. */
export const TIMER_LIMIT_HOURS = [4, 6, 8, 10, 12, 16, 24] as const;

/** The labels of the task groups, as the web app shows them. A group the
 *  app does not know keeps its own name. */
const TASK_GROUP_LABELS = new Map([
	["engineering", "Engineering"],
	["product", "Product"],
	["learning", "Learning"],
	["general", "General"],
	["time_off", "Time off"],
]);

export const taskGroupLabel = (group: string): string =>
	TASK_GROUP_LABELS.get(group) ?? group;

/** The order of the task groups on the web. Unknown groups come last. */
export const TASK_GROUP_ORDER = [
	"engineering",
	"product",
	"learning",
	"general",
	"time_off",
];

/** Worked time must say what it is for. Time off and a Break need not. The
 *  server has the same rule. */
export const descriptionRequiredFor = (task: {
	isAbsence: boolean;
	systemKey: string | null;
}): boolean => !task.isAbsence && task.systemKey !== "break";

/** The year and the month (1 to 12) of a day key, moved by whole months. */
export const shiftMonth = (year: number, month: number, by: number) => {
	const index = year * 12 + (month - 1) + by;
	return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

export const monthTitle = (year: number, month: number): string =>
	new Intl.DateTimeFormat("en", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(Date.UTC(year, month - 1, 1)));

/** "1 January" of a day key. */
export const dayMonth = (key: string): string =>
	new Intl.DateTimeFormat("en", {
		day: "numeric",
		month: "long",
		timeZone: "UTC",
	}).format(new Date(`${key}T00:00:00Z`));

/** "Thursday" of a day key. */
export const weekdayOfKey = (key: string): string =>
	weekdayName(new Date(`${key}T00:00:00Z`).getUTCDay());
