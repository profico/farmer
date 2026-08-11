// Pure planning helpers for the "assemble my day" suggestion engine — no db
// or service imports so the split math stays unit-testable in isolation.
//
// These are the module the engines call: `day-assembly.service` and the commit
// fill-block sync in `time-entries.service` both go through here rather than
// keeping their own copies. That matters because the copies had drifted — the
// split disagreed about minimum shares and the summary disagreed about what
// "+N more" counts.

// Suggested amounts snap to 15-minute steps.
const SLOT_SECONDS = 900;

const COMMIT_SUMMARY_LIMIT = 3;

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

// One-line summary of a day's commits, used as the description of the entry
// they produced. Mandatory descriptions mean the engines have to write one and
// the commit subjects are the only raw material they have; the person edits it
// like any other entry.
//
// "+N more" counts what was left out of the SHOWN list, so empty messages —
// which are dropped, not shown — are not counted twice.
export const summarizeCommitMessages = (messages: string[]): string => {
	const firstLines = messages
		.map((m) => (m.split("\n")[0] ?? "").trim())
		.filter((line) => line.length > 0);
	const shown = firstLines.slice(0, COMMIT_SUMMARY_LIMIT).join("; ");
	const extra = firstLines.length - COMMIT_SUMMARY_LIMIT;
	return extra > 0 ? `${shown} (+${extra} more)` : shown;
};
