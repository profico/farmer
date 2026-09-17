import { weekDayMarks } from "@farmer/core/lib/day-marks";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";

import { formatClock } from "#/lib/format-hours.ts";
import { springLayout } from "#/lib/motion.ts";
import { cn } from "#/lib/utils.ts";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The seven-day context bar above the Day view. It exists so a person filling in
// Tuesday can see, without navigating, that Thursday is still empty — which is
// the whole reason Harvest puts it there and the single biggest thing our Day
// view was missing.
export function WeekStrip({
	orgSlug,
	dates,
	activeDate,
	secondsByDay,
	holidays,
	today,
	dayTargetSeconds,
}: {
	orgSlug: string;
	dates: string[];
	activeDate: string;
	secondsByDay: Map<string, number>;
	holidays: Map<string, string>;
	/** With a day's worth, a past or present working day says how far it is
	 *  from it — unless the rest of its week has made up for it
	 *  (`@farmer/core/lib/day-marks`). Omitted for people the rule does not
	 *  apply to. */
	today?: string;
	dayTargetSeconds?: number | null;
}) {
	const weekTotal = dates.reduce(
		(sum, date) => sum + (secondsByDay.get(date) ?? 0),
		0,
	);
	const marks =
		today == null || dayTargetSeconds == null
			? null
			: weekDayMarks({
					dates,
					secondsByDay,
					holidays,
					today,
					daySeconds: dayTargetSeconds,
				});

	return (
		<div className="-mx-4 flex items-stretch gap-1 overflow-x-auto border-b px-4 sm:-mx-8 sm:px-8">
			{dates.map((date) => {
				const seconds = secondsByDay.get(date) ?? 0;
				const isActive = date === activeDate;
				const holidayName = holidays.get(date);
				const mark = marks?.get(date);
				return (
					<Link
						key={date}
						to="/$orgSlug/time"
						params={{ orgSlug }}
						search={{ date }}
						title={holidayName}
						// The active day is marked by a 2px accent underscore sitting on
						// the strip's own hairline, not by a filled tab — the strip is
						// context, and a filled cell would out-weigh the day below it.
						//
						// The underscore is drawn by the shared-layout span below rather
						// than by this element's own border, so stepping to another day
						// slides it instead of blinking it off one cell and on at another.
						// The `border-b-2 border-transparent` stays to hold the 2px the
						// underscore sits in, so no row changes height.
						className={cn(
							// No minimum on a phone: seven days have to fit the viewport or
							// the strip becomes a horizontal scroller, and a context bar you
							// have to scroll tells you nothing at a glance.
							"relative min-w-0 flex-1 border-b-2 border-transparent px-1 py-2.5 transition-colors duration-(--dur-fast) sm:min-w-16",
							!isActive && "hover:bg-muted",
						)}
					>
						{isActive && (
							<motion.span
								aria-hidden
								layoutId="week-strip-active-day"
								// Same shared-element move, same spring, as the Day/Week/Month
								// pill in the SegmentedControl directly above this strip —
								// `reducedMotion="user"` on the root <MotionConfig> makes it
								// jump instead of glide. Negative insets pull it back out to
								// the border box the border-b-2 used to occupy.
								transition={springLayout}
								className="absolute -inset-x-1 -bottom-0.5 h-0.5 bg-primary"
							/>
						)}
						<span className="eyebrow block">
							{WEEKDAY_LABELS[new Date(`${date}T12:00:00Z`).getUTCDay()]}
						</span>
						<span
							className={cn(
								"mono mt-1 block text-sm",
								seconds > 0 ? "text-muted-foreground" : "text-faint",
								isActive && "text-foreground",
							)}
						>
							{formatClock(seconds)}
						</span>
						{holidayName && (
							<span className="mt-1 block truncate text-2xs text-warn">
								{holidayName}
							</span>
						)}
						{/* A covered day says nothing. A mark here is either a day's worth
						    or something to do, and a day the week has made up for is
						    neither — the targets above carry the week's number. */}
						{mark === "done" && (
							<span className="mt-1 block text-2xs text-ok">done</span>
						)}
						{mark === "short" && dayTargetSeconds != null && (
							<span className="mt-1 block text-2xs text-bad">
								{formatClock(dayTargetSeconds - seconds)} short
							</span>
						)}
					</Link>
				);
			})}
			{/* The week total is what would push the seventh day off a phone, and
			    the Week tab is one tap away — so it's a desktop affordance. */}
			<div className="ml-auto hidden min-w-24 flex-col justify-center py-2.5 pl-4 text-right sm:flex">
				<span className="eyebrow">Week total</span>
				<span className="mono mt-1 text-sm">{formatClock(weekTotal)}</span>
			</div>
		</div>
	);
}
