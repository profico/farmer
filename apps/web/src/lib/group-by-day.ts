// Entries carry their own day now (a `date` column, in the org's timezone), so
// grouping is a plain bucket — no timezone conversion, no timestamps.
export function groupByDay<T extends { date: string }>(
	entries: T[],
): Array<[string, T[]]> {
	const groups = new Map<string, T[]>();

	for (const entry of entries) {
		const list = groups.get(entry.date);

		if (list) {
			list.push(entry);
		} else {
			groups.set(entry.date, [entry]);
		}
	}

	return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}
