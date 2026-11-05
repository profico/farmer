/**
 * Days as `yyyy-MM-dd` keys, the form every `api/v1` route takes and answers.
 *
 * A day key is a calendar date, not an instant, so the arithmetic runs in UTC
 * on the key itself. "Today" comes from the server (`whoami.today`, in the
 * workspace's timezone), never from the phone's clock.
 */

const DAY_MS = 86_400_000;

const toUtc = (key: string) => Date.parse(`${key}T00:00:00Z`);

const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (key: string, days: number) =>
	fromUtc(toUtc(key) + days * DAY_MS);

/** 0 = Sunday, as the server counts. */
export const weekdayOf = (key: string) => new Date(toUtc(key)).getUTCDay();

/** The first day of the week that holds `key`. */
export const weekStartOf = (key: string, weekStartsOn: number) => {
	const back = (weekdayOf(key) - weekStartsOn + 7) % 7;
	return addDays(key, -back);
};

/** The seven days of the week that holds `key`, in order. */
export const weekOf = (key: string, weekStartsOn: number) => {
	const start = weekStartOf(key, weekStartsOn);
	return Array.from({ length: 7 }, (_, i) => addDays(start, i));
};

/** The calendar day of an instant in a timezone. */
export const dayKeyInTimeZone = (instant: Date, timeZone: string) => {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(instant);
	const part = (type: "year" | "month" | "day") =>
		parts.find((item) => item.type === type)?.value ?? "";
	return `${part("year")}-${part("month")}-${part("day")}`;
};

const format = (key: string, options: Intl.DateTimeFormatOptions) =>
	new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(
		new Date(toUtc(key)),
	);

/** "Tuesday, 6 October", or "Today" and "Yesterday" near `today`. */
export const dayTitle = (key: string, today: string) => {
	if (key === today) return "Today";
	if (key === addDays(today, -1)) return "Yesterday";
	if (key === addDays(today, 1)) return "Tomorrow";
	return format(key, { weekday: "long", day: "numeric", month: "long" });
};

/** "Tue". */
export const weekdayShort = (key: string) => format(key, { weekday: "short" });

/** "6". */
export const dayOfMonth = (key: string) => String(Number(key.slice(8, 10)));

/** "6 Oct – 12 Oct" for a period. */
export const periodTitle = (from: string, to: string) =>
	`${format(from, { day: "numeric", month: "short" })} - ${format(to, {
		day: "numeric",
		month: "short",
	})}`;
