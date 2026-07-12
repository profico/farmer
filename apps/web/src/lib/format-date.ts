// Human-readable rendering of the yyyy-MM-dd / yyyy-MM calendar keys used by
// the time views. These keys carry no time-of-day, so they're formatted from
// their numeric parts in local time — never `new Date("2026-07-09")`, which
// parses as UTC and can slip a day when displayed in a western timezone.

const parseDateKey = (key: string): Date => {
	const [year, month, day] = key.split("-").map(Number);
	return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
};

const parseMonthKey = (key: string): Date => {
	const [year, month] = key.split("-").map(Number);
	return new Date(year ?? 1970, (month ?? 1) - 1, 1);
};

// "2026-07-09" → "July 9, 2026"
export const formatDateKeyLong = (key: string): string =>
	parseDateKey(key).toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		year: "numeric",
	});

// "2026-07" → "July 2026"
export const formatMonthKey = (key: string): string =>
	parseMonthKey(key).toLocaleDateString("en-US", {
		month: "long",
		year: "numeric",
	});

// A week range, collapsing the shared parts: "July 6 – 12, 2026",
// "June 29 – July 5, 2026", or the full form across a year boundary.
export const formatWeekRange = (startKey: string, endKey: string): string => {
	const start = parseDateKey(startKey);
	const end = parseDateKey(endKey);
	const sameYear = start.getFullYear() === end.getFullYear();
	const sameMonth = sameYear && start.getMonth() === end.getMonth();

	if (sameMonth) {
		const month = start.toLocaleDateString("en-US", { month: "long" });
		return `${month} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
	}
	if (sameYear) {
		const left = start.toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
		});
		const right = end.toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
		});
		return `${left} – ${right}, ${end.getFullYear()}`;
	}
	return `${formatDateKeyLong(startKey)} – ${formatDateKeyLong(endKey)}`;
};
