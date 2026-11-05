// Pure planning helpers for the "assemble my day" suggestion engine — no db
// or service imports so the split math stays unit-testable in isolation.
//
// These are the module the engines call: `day-assembly.service` and the commit
// fill-block sync in `time-entries.service` both go through here rather than
// keeping their own copies. That matters because the copies had drifted — the
// split disagreed about minimum shares and the summary disagreed about which
// subjects it kept.

// Suggested amounts snap to 15-minute steps.
const SLOT_SECONDS = 900;

// The ceiling every description input carries (`src/schema/time-entries.ts`).
const DESCRIPTION_MAX_CHARS = 10_000;

// Largest-remainder split of totalSeconds across weights, in 15-minute units.
//
// Two properties callers depend on:
//   - Shares never exceed totalSeconds. The unit count FLOORS rather than
//     rounds, because the caller's total is a remaining-budget for the day
//     (target minus what is already spoken for) and over-allocating it puts
//     the day over its working hours.
//   - Every non-zero weight gets at least one unit when there are enough units
//     to go around, so a project with commits never renders as a 0-second
//     suggestion the person cannot see.
export const splitProportionally = (
	totalSeconds: number,
	weights: number[],
): number[] => {
	const totalUnits = Math.floor(totalSeconds / SLOT_SECONDS);
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

// Divide a day's rest across the projects its evidence names, for the commit
// engine's fill block. The ratio is `splitProportionally`'s, the same one
// Assemble my day uses, so the two disagree about nothing.
//
// The project with the largest share (the first of equals) comes first: it
// owns the fill block, which `recomputeDayFill` resizes later, so it also takes
// the part of the day that is not a whole quarter hour and the shares sum to
// `totalSeconds` exactly. A project whose share is zero is left out.
export const splitRestOfDay = (
	totalSeconds: number,
	projects: { projectId: string; weight: number }[],
): { projectId: string; seconds: number }[] => {
	const shares = splitProportionally(
		totalSeconds,
		projects.map((p) => p.weight),
	);
	const planned = projects.map((p, index) => ({
		projectId: p.projectId,
		seconds: shares[index] ?? 0,
	}));
	let largest = 0;
	for (let index = 1; index < planned.length; index++) {
		if ((planned[index]?.seconds ?? 0) > (planned[largest]?.seconds ?? 0)) {
			largest = index;
		}
	}
	const [owner] = planned.splice(largest, 1);
	if (!owner) return [];
	const others = planned.filter((p) => p.seconds > 0);
	const othersSeconds = others.reduce((sum, p) => sum + p.seconds, 0);
	return [{ ...owner, seconds: totalSeconds - othersSeconds }, ...others];
};

// One-line summary of a day's commits, used as the description of the entry
// they produced. Mandatory descriptions mean the engines have to write one and
// the commit subjects are the only raw material they have; the person edits it
// like any other entry.
//
// Every subject is kept: a "+N more" tail hid the very work the entry is
// evidence of. Subjects stop only at the description ceiling, and whole — a
// subject cut mid-word reads as a typo, and the input schema would refuse the
// entry the moment somebody saved it by hand.
export const summarizeCommitMessages = (messages: string[]): string => {
	const firstLines = messages
		.map((m) => (m.split("\n")[0] ?? "").trim())
		.filter((line) => line.length > 0);
	let summary = "";
	for (const line of firstLines) {
		const next = summary ? `${summary}; ${line}` : line;
		if (next.length > DESCRIPTION_MAX_CHARS) break;
		summary = next;
	}
	return summary;
};
