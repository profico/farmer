import {
	formatDurationInput,
	parseDuration,
	QUARTER_HOUR_SECONDS,
} from "@farmer/core/lib/time";

import { UsageError } from "./errors";

const MAX_ENTRY_SECONDS = 24 * 3600;

/**
 * Reads a duration the way the web app's inputs do (`1h30m`, `1.5`, `90m`,
 * `1:30`), and refuses anything that is not a whole quarter-hour.
 *
 * The web app snaps; the CLI refuses and names the two nearest values instead.
 * A typed `1h20m` that quietly became `1h15m` is time nobody chose to log, and a
 * terminal has no field that shows the snapped value back before it is saved.
 */
export const parseQuarterHours = (input: string): number => {
	const seconds = parseDuration(input);
	if (seconds === null) {
		throw new UsageError(
			`Cannot read "${input}" as a duration. Use 1h30m, 1.5 or 90m.`,
		);
	}
	if (seconds <= 0) throw new UsageError("Enter some time.");
	if (seconds > MAX_ENTRY_SECONDS) {
		throw new UsageError("One entry cannot be longer than 24 hours.");
	}
	if (seconds % QUARTER_HOUR_SECONDS !== 0) {
		const lower =
			Math.floor(seconds / QUARTER_HOUR_SECONDS) * QUARTER_HOUR_SECONDS;
		// Below 15 minutes the lower neighbour is zero, which is not a duration,
		// so the two nearest values that can be logged are 15m and 30m.
		const [first, second] =
			lower === 0
				? [QUARTER_HOUR_SECONDS, 2 * QUARTER_HOUR_SECONDS]
				: [lower, lower + QUARTER_HOUR_SECONDS];
		throw new UsageError(
			`Time is logged in 15-minute steps. Use ${formatDurationInput(first)} or ${formatDurationInput(second)}.`,
		);
	}
	return seconds;
};

/**
 * What an entry's duration becomes when a person adds to the time already
 * logged on it — `farmer edit 1 --add 1.25`.
 *
 * The addend goes through `parseQuarterHours`, so one rule and one set of
 * messages cover both flags. The total is checked as well: two additions that
 * each fit on their own can still pass 24 hours together.
 */
export const addToDuration = (
	currentSeconds: number,
	input: string,
): number => {
	const added = parseQuarterHours(input);
	const total = currentSeconds + added;

	if (total > MAX_ENTRY_SECONDS) {
		throw new UsageError(
			`${formatDurationInput(currentSeconds)} plus ${formatDurationInput(added)} is more than 24 hours, which one entry cannot be.`,
		);
	}

	return total;
};

/**
 * The head start of `farmer start --head-start 20m` (issue #107): time already
 * worked before the timer began. Any whole minute, not a quarter hour — it is
 * added to a measurement, and the sum is what gets snapped when it stops.
 */
export const parseHeadStart = (input: string): number => {
	const seconds = parseDuration(input);
	if (seconds === null) {
		throw new UsageError(
			`Cannot read "${input}" as a duration. Use 20m, 1h30m or 1:30.`,
		);
	}
	if (seconds <= 0) throw new UsageError("Enter some time.");
	if (seconds >= MAX_ENTRY_SECONDS) {
		throw new UsageError("A head start must be shorter than a day.");
	}
	return seconds;
};

/** `H:MM`, the form the web app displays every duration in. */
export const formatHours = (seconds: number): string => {
	const minutes = Math.round(seconds / 60);
	return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
};
