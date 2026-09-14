// Every week in the app is drawn Monday first. The stored numbers stay
// JavaScript's, Sunday = 0 (Date#getDay()), as recurringBlockRule.daysOfWeek,
// memberWorkingHoursDay.dayOfWeek and reminderSettings.nudgeWeekdays hold
// them — only the display order changes.
export const WEEKDAYS = [
	{ day: 1, label: "Mon", initial: "M" },
	{ day: 2, label: "Tue", initial: "T" },
	{ day: 3, label: "Wed", initial: "W" },
	{ day: 4, label: "Thu", initial: "T" },
	{ day: 5, label: "Fri", initial: "F" },
	{ day: 6, label: "Sat", initial: "S" },
	{ day: 0, label: "Sun", initial: "S" },
] as const;
