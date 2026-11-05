/** Anything that counts seconds, such as an entry or a booked day. */
type Timed = { durationSeconds: number };

/** The seconds of a list of entries. */
export const sumSeconds = (items: readonly Timed[]): number =>
	items.reduce((total, item) => total + item.durationSeconds, 0);

/** The seconds of one day in a list of entries. */
export const daySeconds = (
	entries: readonly (Timed & { date: string })[],
	day: string,
): number => sumSeconds(entries.filter((entry) => entry.date === day));

/** The seconds of each day that has an entry, by day key. */
export const secondsByDay = (
	entries: readonly (Timed & { date: string })[],
): Map<string, number> => {
	const totals = new Map<string, number>();
	for (const entry of entries) {
		totals.set(
			entry.date,
			(totals.get(entry.date) ?? 0) + entry.durationSeconds,
		);
	}
	return totals;
};
