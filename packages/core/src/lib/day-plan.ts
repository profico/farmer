// Pure planning helpers for the "assemble my day" suggestion engine — no db
// or service imports so the placement math stays unit-testable in isolation.

export type MinuteInterval = { startMin: number; endMin: number };

const DAY_END_MIN = 24 * 60;

// Suggested blocks snap to 15-minute steps.
export const SLOT_SECONDS = 900;

export const timeKeyToMinutes = (time: string): number => {
	const [hours, minutes] = time.split(":").map(Number);
	return (hours ?? 0) * 60 + (minutes ?? 0);
};

export const minutesToTimeKey = (totalMinutes: number): string => {
	const clamped = Math.max(0, Math.min(totalMinutes, DAY_END_MIN - 1));
	const hours = Math.floor(clamped / 60);
	const minutes = clamped % 60;
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

// Largest-remainder split of totalSeconds across weights, in 15-minute units.
// Shares always sum to round(totalSeconds / 900) units, and every non-zero
// weight gets at least one unit when there are enough units to go around.
export const splitProportionally = (
	totalSeconds: number,
	weights: number[],
): number[] => {
	const totalUnits = Math.round(totalSeconds / SLOT_SECONDS);
	const weightSum = weights.reduce((sum, w) => sum + w, 0);
	if (totalUnits <= 0 || weightSum <= 0) return weights.map(() => 0);

	const exact = weights.map((w) => (totalUnits * w) / weightSum);
	const units = exact.map((value) => Math.floor(value));
	let leftover = totalUnits - units.reduce((sum, u) => sum + u, 0);
	const byRemainder = exact
		.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
		.sort((a, b) => b.remainder - a.remainder);
	for (const { index } of byRemainder) {
		if (leftover <= 0) break;
		units[index] = (units[index] ?? 0) + 1;
		leftover -= 1;
	}

	// Visibility guarantee: steal from the largest share so every project with
	// commits shows up with at least one slot.
	const nonZeroWeights = weights.filter((w) => w > 0).length;
	if (totalUnits >= nonZeroWeights) {
		for (let index = 0; index < units.length; index++) {
			if ((weights[index] ?? 0) <= 0 || (units[index] ?? 0) > 0) continue;
			let richest = 0;
			for (let j = 1; j < units.length; j++) {
				if ((units[j] ?? 0) > (units[richest] ?? 0)) richest = j;
			}
			if ((units[richest] ?? 0) > 1) {
				units[richest] = (units[richest] ?? 0) - 1;
				units[index] = 1;
			}
		}
	}

	return units.map((u) => u * SLOT_SECONDS);
};

// Sort, clip to the day, and merge overlapping busy intervals.
const normalizeBusy = (busy: MinuteInterval[]): MinuteInterval[] => {
	const sorted = busy
		.map((b) => ({
			startMin: Math.max(0, b.startMin),
			endMin: Math.min(DAY_END_MIN, b.endMin),
		}))
		.filter((b) => b.endMin > b.startMin)
		.sort((a, b) => a.startMin - b.startMin);
	const merged: MinuteInterval[] = [];
	for (const interval of sorted) {
		const last = merged[merged.length - 1];
		if (last && interval.startMin <= last.endMin) {
			last.endMin = Math.max(last.endMin, interval.endMin);
		} else {
			merged.push({ ...interval });
		}
	}
	return merged;
};

// First-fit placement of blocks (durations in minutes, in order) into the free
// gaps at/after dayStartMin. A block that fits no gap lands after the last
// busy interval instead; a block pushed past midnight comes back as null, and
// one straddling midnight is clipped to end there. Placed blocks never overlap
// each other because the cursor only moves forward.
export const placeBlocks = (
	durationsMin: number[],
	busy: MinuteInterval[],
	dayStartMin: number,
): (MinuteInterval | null)[] => {
	const merged = normalizeBusy(busy);
	let cursor = Math.max(0, dayStartMin);
	const placed: (MinuteInterval | null)[] = [];
	for (const duration of durationsMin) {
		if (duration <= 0) {
			placed.push(null);
			continue;
		}
		let start = cursor;
		for (const interval of merged) {
			if (start >= interval.endMin) continue;
			if (start + duration <= interval.startMin) break;
			start = interval.endMin;
		}
		if (start >= DAY_END_MIN) {
			placed.push(null);
			continue;
		}
		const end = Math.min(start + duration, DAY_END_MIN);
		placed.push({ startMin: start, endMin: end });
		cursor = end;
	}
	return placed;
};

// Preferred start for a lunch break: the midpoint of the working window
// (dayStart .. dayStart + workingSeconds), snapped to a 15-minute slot. The
// caller feeds this to placeBlocks so the break shifts off any meeting it
// would collide with instead of overlapping it.
export const middayBreakStartMin = (
	dayStartMin: number,
	workingSeconds: number,
): number => {
	const midpoint = dayStartMin + Math.round(workingSeconds / 60 / 2);
	const slotMinutes = SLOT_SECONDS / 60;
	return Math.round(midpoint / slotMinutes) * slotMinutes;
};

// One-line summary of a day's commits for an entry description:
// first lines of up to three messages, "+N more" past that.
export const summarizeCommitMessages = (messages: string[]): string => {
	const firstLines = messages
		.map((m) => (m.split("\n")[0] ?? "").trim())
		.filter((line) => line.length > 0);
	const shown = firstLines.slice(0, 3).join("; ");
	const extra = firstLines.length - 3;
	return extra > 0 ? `${shown} (+${extra} more)` : shown;
};
