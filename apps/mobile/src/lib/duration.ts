/** Every entry is a whole number of quarter hours (15-minute steps). */
export const QUARTER_HOUR_SECONDS = 900;

/** A day holds at most 24 hours, and so does one entry. */
export const MAX_DAY_SECONDS = 24 * 3600;

const pad = (value: number) => String(value).padStart(2, "0");

/** `7:30`. A duration as the web app and the CLI print it. */
export const formatHours = (seconds: number) => {
	const minutes = Math.round(seconds / 60);
	return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
};

/** `1:02:03`. A stopwatch shows its seconds. */
export const formatStopwatch = (totalSeconds: number) => {
	const seconds = Math.max(0, Math.floor(totalSeconds));
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	return `${h}:${pad(m)}:${pad(seconds % 60)}`;
};

/** One 15-minute step up or down, kept between one step and 24 hours. */
export const stepQuarter = (seconds: number, steps: number) => {
	const next = seconds + steps * QUARTER_HOUR_SECONDS;
	return Math.min(MAX_DAY_SECONDS, Math.max(QUARTER_HOUR_SECONDS, next));
};

/** A value moved onto the 15-minute grid, at least one step. */
export const toQuarter = (seconds: number) =>
	Math.min(
		MAX_DAY_SECONDS,
		Math.max(
			QUARTER_HOUR_SECONDS,
			Math.round(seconds / QUARTER_HOUR_SECONDS) * QUARTER_HOUR_SECONDS,
		),
	);
