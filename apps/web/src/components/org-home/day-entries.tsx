import { formatReportHours } from "@farmer/core/lib/report-format";
import { formatDayKey } from "@farmer/core/lib/time";

import { AddBlockDialog } from "#/components/time/add-block-dialog.tsx";
import {
	EntryBlockRow,
	type EntryBlockRowEntry,
} from "#/components/time/entry-block-row.tsx";
import { GhostRow } from "#/components/ui/ghost-row.tsx";
import { cn } from "#/lib/utils.ts";

function ghostRowLabel(
	count: number,
	selectedDay: string,
	today: string,
): string {
	const isToday = selectedDay === today;
	if (count === 0) {
		return isToday
			? "Nothing logged yet. Log your first block of the day"
			: "Nothing logged. Add an entry to this day";
	}
	return `Add another entry to ${isToday ? "today" : formatDayKey(selectedDay, { year: false })}`;
}

/** The list of the picked day, and the way to add to it. */
export function SelectedDayEntries({
	entries,
	total,
	selectedDay,
	today,
	timezone,
	timedEntryId,
}: {
	entries: EntryBlockRowEntry[];
	total: number;
	selectedDay: string;
	today: string;
	timezone: string;
	timedEntryId: string | null | undefined;
}) {
	return (
		<>
			<div className="section-head">
				<h2 className="eyebrow">
					{selectedDay === today
						? "Today's entries"
						: formatDayKey(selectedDay, { year: false })}
				</h2>
				<span className="text-sm text-muted-foreground">
					{formatReportHours(total)} logged
				</span>
			</div>
			{/* No AnimatePresence — see the note in EntryBlockRow. It matters
			    most here: picking another day in "This week by day" swaps every
			    row at once, so the whole list collapsed as if each entry had
			    been deleted. Switching days is navigation, not removal.

			    The rows keep the island's own padding and take a negative
			    margin of the same size, so the text stays on the column's
			    text edge while the hover fill and the rules between rows run
			    edge to edge — the island's left edge, and the vertical rule
			    on the right. A row highlighted only as far as its text is a
			    row that looks narrower than the list it is in. */}
			<div className="@container/entries mt-3 flex flex-col divide-y divide-line2">
				{entries.map((entry) => (
					<EntryBlockRow
						key={entry.id}
						entry={entry}
						timezone={timezone}
						timing={entry.id === timedEntryId}
						className="-mx-4 sm:-mx-8"
					/>
				))}
			</div>
			{/* The list ends on the way to add to it, whether or not it has
			    rows: an empty day is a sentence and this same row, rather than
			    a centred placeholder with no action on it. */}
			<AddBlockDialog
				timezone={timezone}
				defaultDate={selectedDay}
				trigger={
					<GhostRow
						className={cn(
							// The same bleed the rows take, so its rule ends where
							// theirs do. The width is spelled out because the row is
							// `w-full`: a negative margin alone moves it left without
							// widening it, and the rule would stop short on the right.
							"-ml-4 w-[calc(100%+2rem)] px-4 sm:-ml-8 sm:w-[calc(100%+4rem)] sm:px-8",
							entries.length > 0 ? "border-t border-line2" : "mt-1",
						)}
					>
						{ghostRowLabel(entries.length, selectedDay, today)}
					</GhostRow>
				}
			/>
		</>
	);
}
