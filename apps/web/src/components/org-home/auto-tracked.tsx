import {
	CalendarBlankIcon,
	GitCommitIcon,
	SparkleIcon,
} from "@phosphor-icons/react";

import { formatHoursShort } from "#/lib/format-hours.ts";
import { type AutoTracked, githubSummary } from "#/lib/org-home.ts";

/** The blocks Farmer filled in for you rather than by hand. Draws nothing
 *  when there are none. */
export function AutoTrackedList({ summary }: { summary: AutoTracked }) {
	if (summary.meetingCount === 0 && summary.githubCount === 0) return null;
	return (
		<div className="mt-7">
			<h2 className="eyebrow flex items-center gap-1.5">
				<SparkleIcon className="size-3" />
				Auto-tracked today
			</h2>
			<div className="mt-3 flex flex-col gap-2.5">
				{summary.meetingCount > 0 && (
					<div className="flex items-center gap-2.5 text-sm">
						<CalendarBlankIcon className="size-4 shrink-0 text-muted-foreground" />
						<span className="min-w-0 flex-1 truncate text-muted-foreground">
							<span className="font-medium text-foreground">
								{summary.meetingCount} meeting
								{summary.meetingCount === 1 ? "" : "s"}
							</span>{" "}
							from your calendar
						</span>
						<span className="mono shrink-0 text-muted-foreground">
							{formatHoursShort(summary.meetingSeconds)}
						</span>
					</div>
				)}
				{summary.githubCount > 0 && (
					<div className="flex items-center gap-2.5 text-sm">
						<GitCommitIcon className="size-4 shrink-0 text-muted-foreground" />
						<span className="min-w-0 flex-1 truncate text-muted-foreground">
							<span className="font-medium text-foreground">
								{githubSummary(summary.commitTotal, summary.pullRequestTotal)}
							</span>{" "}
							linked
						</span>
						<span className="mono shrink-0 text-muted-foreground">
							{formatHoursShort(summary.githubSeconds)}
						</span>
					</div>
				)}
			</div>
		</div>
	);
}
