import { dayKeyInTz } from "@farmer/core/lib/time";

export function groupByDay<T extends { startedAt: Date | string }>(
	entries: T[],
	timezone: string,
): Array<[string, T[]]> {
	const groups = new Map<string, T[]>();
	for (const entry of entries) {
		const key = dayKeyInTz(new Date(entry.startedAt), timezone);
		const list = groups.get(key);
		if (list) {
			list.push(entry);
		} else {
			groups.set(key, [entry]);
		}
	}
	return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}
