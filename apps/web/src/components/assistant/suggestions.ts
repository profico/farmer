// The questions the empty chat offers, chosen from what the app knows today.
// No model call. Never names a month: the words stay true on any day.

export type SuggestionFacts = {
	/** One working day's target, or null when the person has no target. */
	daySeconds: number | null;
	/** Hours logged today and yesterday. Null while the data loads. */
	todaySeconds: number | null;
	yesterdaySeconds: number | null;
	todayIsWorkingDay: boolean;
	yesterdayIsWorkingDay: boolean;
	unfiledCount: number;
	calendarConnected: boolean;
};

const FALLBACKS = [
	"How many hours did I log last week?",
	"Which project took most of my time last month?",
];

const MAX_SUGGESTIONS = 3;
// Room is kept for at least one general question.
const MAX_SPECIFIC = MAX_SUGGESTIONS - 1;

const isShort = (
	seconds: number | null,
	target: number | null,
	isWorkingDay: boolean,
) => isWorkingDay && target !== null && seconds !== null && seconds < target;

export function chooseSuggestions(facts: SuggestionFacts): string[] {
	const specific: string[] = [];
	if (isShort(facts.todaySeconds, facts.daySeconds, facts.todayIsWorkingDay)) {
		specific.push("Help me log the rest of today");
	}
	if (facts.unfiledCount > 0) {
		specific.push(
			facts.unfiledCount === 1
				? "File my unfiled entry"
				: `File my ${facts.unfiledCount} unfiled entries`,
		);
	}
	if (
		facts.calendarConnected &&
		isShort(
			facts.yesterdaySeconds,
			facts.daySeconds,
			facts.yesterdayIsWorkingDay,
		)
	) {
		specific.push("Fill yesterday from my calendar");
	}
	return [...specific.slice(0, MAX_SPECIFIC), ...FALLBACKS].slice(
		0,
		MAX_SUGGESTIONS,
	);
}
