// Display form for stat tiles, e.g. 23400 -> "6h 30m", 3600 -> "6h", 1800 -> "30m".
export function formatHoursShort(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.round((totalSeconds % 3600) / 60);
	if (hours && minutes) return `${hours}h ${minutes}m`;
	if (hours) return `${hours}h`;
	return `${minutes}m`;
}

// Harvest's canonical duration format: H:MM, e.g. 28800 -> "8:00", 1800 -> "0:30".
// Used everywhere a duration sits in a column of other durations (the day list,
// the week grid, every total), because "8:00" over "7:30" lines up and "8h" over
// "7h 30m" does not.
export function formatClock(totalSeconds: number): string {
	const totalMinutes = Math.round(totalSeconds / 60);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${hours}:${String(minutes).padStart(2, "0")}`;
}
