/**
 * Labels for values of the workspace screens. A value of an open set (a
 * role, a type) that the app does not know shows as it came.
 */

/** "6 Oct 2026, 14:05" in the phone's locale, for an ISO instant. */
export const formatInstant = (iso: string, timeZone?: string) =>
	new Intl.DateTimeFormat(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		timeZone,
	}).format(new Date(iso));

/** "6 Oct 2026" for a day key (yyyy-MM-dd). */
export const formatDay = (key: string) =>
	new Intl.DateTimeFormat(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(`${key}T00:00:00Z`));

/** "1 person" or "3 people". */
export const peopleCount = (count: number) =>
	`${count} ${count === 1 ? "person" : "people"}`;

/** Hours with at most two decimals: 160, 7.5, 7.25. */
export const hoursOf = (seconds: number) =>
	String(Math.round((seconds / 3600) * 100) / 100);
