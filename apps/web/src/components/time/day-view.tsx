import { addDaysToKey, dayKeyInTz } from "@farmer/core/lib/time";
import { Link } from "@tanstack/react-router";
import { Plus, Sparkles } from "lucide-react";
import { AddBlockDialog } from "#/components/time/add-block-dialog.tsx";
import { AssembleDayDialog } from "#/components/time/assemble-day-dialog.tsx";
import {
	EntryBlockRow,
	type EntryBlockRowEntry,
} from "#/components/time/entry-block-row.tsx";
import { Button } from "#/components/ui/button.tsx";
import { formatDateKeyLong } from "#/lib/format-date.ts";
import { formatHoursShort } from "#/lib/format-hours.ts";

export function DayView({
	orgSlug,
	date,
	timezone,
	entries,
	holidays,
}: {
	orgSlug: string;
	date: string;
	timezone: string;
	entries: EntryBlockRowEntry[];
	holidays: Map<string, string>;
}) {
	const total = entries.reduce((sum, e) => sum + e.durationSeconds, 0);
	// A fill ("rest of day") block is a catch-all, so it always sorts last; the
	// stable sort otherwise preserves the server's start-time ordering.
	const sortedEntries = [...entries].sort(
		(a, b) => Number(a.fillsDay) - Number(b.fillsDay),
	);
	const dateOptions = [{ value: date, label: formatDateKeyLong(date) }];
	const today = dayKeyInTz(new Date(), timezone);
	const isToday = date === today;
	const holidayName = holidays.get(date);

	return (
		<div className="flex h-full flex-col">
			<div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="icon-sm"
						nativeButton={false}
						render={
							<Link
								to="/$orgSlug/time"
								params={{ orgSlug }}
								search={{ date: addDaysToKey(date, -1) }}
							>
								‹
							</Link>
						}
					/>
					<h2 className="min-w-[150px] text-center text-[13px] font-semibold">
						{formatDateKeyLong(date)}
						{isToday && (
							<span className="ml-2 text-xs font-normal text-muted-foreground">
								today
							</span>
						)}
						{holidayName && (
							<span className="ml-2 text-xs font-medium text-amber-700 dark:text-amber-400">
								{holidayName}
							</span>
						)}
					</h2>
					<Button
						variant="outline"
						size="icon-sm"
						nativeButton={false}
						render={
							<Link
								to="/$orgSlug/time"
								params={{ orgSlug }}
								search={{ date: addDaysToKey(date, 1) }}
							>
								›
							</Link>
						}
					/>
					{!isToday && (
						<Button
							variant="outline"
							size="sm"
							nativeButton={false}
							render={
								<Link to="/$orgSlug/time" params={{ orgSlug }} search={{}}>
									Today
								</Link>
							}
						/>
					)}
				</div>
				<div className="flex items-center gap-2">
					<AssembleDayDialog
						orgSlug={orgSlug}
						date={date}
						trigger={
							<Button variant="outline" size="sm">
								<Sparkles className="size-4" />
								Assemble my day
							</Button>
						}
					/>
					<AddBlockDialog
						timezone={timezone}
						dateOptions={dateOptions}
						trigger={
							<Button size="sm">
								<Plus className="size-4" />
								Add block
							</Button>
						}
					/>
				</div>
			</div>
			<div className="-mx-4 mt-3 flex shrink-0 items-center justify-between border-t px-4 py-2.5 text-sm sm:-mx-8 sm:px-8">
				<span className="text-muted-foreground">
					{entries.length} {entries.length === 1 ? "block" : "blocks"} logged
				</span>
				<span>
					<span className="text-muted-foreground">Total </span>
					<span className="font-medium text-lg">{formatHoursShort(total)}</span>
				</span>
			</div>
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto sm:-mx-8">
				{sortedEntries.length === 0 ? (
					<p className="px-4 py-12 text-center text-sm text-muted-foreground sm:px-8">
						Nothing logged yet — add a block to get started.
					</p>
				) : (
					<div className="divide-y border-b">
						{sortedEntries.map((entry) => (
							<EntryBlockRow
								key={entry.id}
								entry={entry}
								timezone={timezone}
								dateOptions={dateOptions}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
