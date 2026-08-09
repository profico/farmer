import { addDaysToKey } from "@farmer/core/lib/time";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { AddBlockDialog } from "#/components/time/add-block-dialog.tsx";
import { CalendarGrid } from "#/components/time/calendar-grid.tsx";
import type { EntryBlockRowEntry } from "#/components/time/entry-block-row.tsx";
import { Button } from "#/components/ui/button.tsx";
import { formatDateKeyLong, formatWeekRange } from "#/lib/format-date.ts";
import { formatHoursShort } from "#/lib/format-hours.ts";

export function WeekView({
	orgSlug,
	dates,
	timezone,
	entries,
	weekStart,
	holidays,
}: {
	orgSlug: string;
	dates: string[];
	timezone: string;
	entries: EntryBlockRowEntry[];
	weekStart: string;
	holidays: Map<string, string>;
}) {
	const dateOptions = dates.map((d) => ({
		value: d,
		label: formatDateKeyLong(d),
	}));
	const weekTotal = entries.reduce((sum, e) => sum + e.durationSeconds, 0);

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
								to="/$orgSlug/time/week"
								params={{ orgSlug }}
								search={{ weekStart: addDaysToKey(weekStart, -7) }}
							>
								‹
							</Link>
						}
					/>
					<h2 className="min-w-[150px] text-center text-[13px] font-semibold">
						{formatWeekRange(dates[0] ?? "", dates[dates.length - 1] ?? "")}
					</h2>
					<Button
						variant="outline"
						size="icon-sm"
						nativeButton={false}
						render={
							<Link
								to="/$orgSlug/time/week"
								params={{ orgSlug }}
								search={{ weekStart: addDaysToKey(weekStart, 7) }}
							>
								›
							</Link>
						}
					/>
					<Button
						variant="outline"
						size="sm"
						nativeButton={false}
						render={
							<Link to="/$orgSlug/time/week" params={{ orgSlug }} search={{}}>
								Today
							</Link>
						}
					/>
				</div>
				<div className="flex items-center gap-3">
					<span className="text-sm text-muted-foreground">
						<span className="font-medium text-foreground text-base">
							{formatHoursShort(weekTotal)}
						</span>{" "}
						this week
					</span>
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
			<div className="-mx-4 mt-3 min-h-0 flex-1 sm:-mx-8">
				<CalendarGrid
					dates={dates}
					entries={entries}
					timezone={timezone}
					pxPerHour={64}
					variant="week"
					holidays={holidays}
				/>
			</div>
		</div>
	);
}
