// Display form for stat tiles, e.g. 23400 -> "6h 30m", 3600 -> "6h", 1800 -> "30m".
export function formatHoursShort(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.round((totalSeconds % 3600) / 60);
	if (hours && minutes) return `${hours}h ${minutes}m`;
	if (hours) return `${hours}h`;
	return `${minutes}m`;
}
