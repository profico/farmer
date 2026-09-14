import type { WeekStartsOn } from "@farmer/core/lib/time";

// The stored numbers are JavaScript's, Sunday = 0 (Date#getDay()), as
// recurringBlockRule.daysOfWeek, memberWorkingHoursDay.dayOfWeek and
// reminderSettings.nudgeWeekdays hold them. Only the order a week is drawn in
// follows the organization's `weekStartsOn`.
export const WEEKDAYS = [
	{ day: 0, label: "Sun", short: "Su", initial: "S" },
	{ day: 1, label: "Mon", short: "Mo", initial: "M" },
	{ day: 2, label: "Tue", short: "Tu", initial: "T" },
	{ day: 3, label: "Wed", short: "We", initial: "W" },
	{ day: 4, label: "Thu", short: "Th", initial: "T" },
	{ day: 5, label: "Fri", short: "Fr", initial: "F" },
	{ day: 6, label: "Sat", short: "Sa", initial: "S" },
] as const;

/** The seven days in the order the organization draws a week. */
export const orderedWeekdays = (weekStartsOn: WeekStartsOn) => [
	...WEEKDAYS.slice(weekStartsOn),
	...WEEKDAYS.slice(0, weekStartsOn),
];
