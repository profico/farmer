import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";

import { formatClock } from "#/lib/format-hours.ts";
import { springLayout } from "#/lib/motion.ts";
import { cn } from "#/lib/utils.ts";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayOfWeek = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const isWeekend = (date: string) => {
	const day = dayOfWeek(date);
	return day === 0 || day === 6;
};
/** "14" from "2026-09-14", without constructing a Date to ask. */
const dayOfMonth = (date: string) => date.slice(8).replace(/^0/, "");

/**
 * The seven days of the week, as the tabs the Day view is read through.
 *
 * It exists so a person filling in Tuesday can see, without navigating, that
 * Thursday is still empty — which is the whole reason Harvest puts a strip
 * there.
 *
 * **A day is only judged once it is over.** Past working days say what they
 * fell short by, in red. Today says what it is aiming at, in muted text.
 * Future days say nothing at all. The strip used to put "2:00 short" in red
 * under today at nine in the morning, which is not information, it is a
 * telling-off for a day still being worked.
 *
 * Every tab holds the same four rows whatever it contains — name and date,
 * figure, verdict, rail — so nothing moves as you step across the week, and an
 * empty day is a visible slot rather than a collapsed one.
 */
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
	/** With a day's worth, a PAST working day says how far it fell short.
	 *  Omitted for people the rule does not apply to. */
	today?: string;
	dayTargetSeconds?: number | null;
}) {
	return (
		<div className="-mx-4 grid grid-cols-7 gap-1 px-4 pb-1.5 sm:-mx-8 sm:px-8">
			{dates.map((date) => {
				const seconds = secondsByDay.get(date) ?? 0;
				const isActive = date === activeDate;
				const isToday = date === today;
				const holidayName = holidays.get(date);
				const weekend = isWeekend(date);
				const target = dayTargetSeconds ?? null;
				const past = today != null && date < today;
				// A day is judged only once it HAS HAPPENED. Without the date test a
				// future Thursday with nothing on it was scored as "nothing logged"
				// and went red, which is a verdict on a day nobody has lived yet —
				// and it appeared as soon as you stepped forward a week.
				const happened = today != null && date <= today;
				const judged =
					target != null && target > 0 && !holidayName && !weekend && happened;
				const short = judged && past && seconds < target;
				const met = judged && past && seconds >= target;
				const fill =
					target != null && target > 0
						? Math.min(100, (seconds / target) * 100)
						: 0;
				return (
					<Link
						key={date}
						to="/$orgSlug/time"
						params={{ orgSlug }}
						search={{ date }}
						title={holidayName}
						aria-current={isActive ? "page" : undefined}
						className={cn(
							"relative min-w-0 rounded-[10px] px-2.5 pt-2 pb-2.5 transition-colors duration-(--dur-fast) outline-none focus-visible:ring-3 focus-visible:ring-ring/16",
							// The active day has no fill (nothing inside the page is a card);
							// the purple rule under it is the whole indicator.
							!isActive && "hover:bg-muted",
							weekend && !isActive && "opacity-45",
						)}
					>
						{isActive && (
							<motion.span
								aria-hidden
								layoutId="week-strip-active-day"
								// Same shared-element move, same spring, as the Day/Week/Month
								// pill in the SegmentedControl above this strip —
								// `reducedMotion="user"` on the root <MotionConfig> makes it
								// jump instead of glide. It sits on the strip's own bottom
								// rule, which is what ties the tab to the list under it.
								transition={springLayout}
								className="absolute inset-x-2.5 -bottom-1.5 h-0.5 rounded-full bg-primary"
							/>
						)}
						<span className="flex items-baseline gap-1.5">
							<span className={cn("eyebrow", isActive && "text-foreground")}>
								{WEEKDAY_LABELS[dayOfWeek(date)]}
							</span>
							<span
								className={cn(
									"tnum text-2xs",
									isToday ? "font-semibold text-primary" : "text-faint",
								)}
							>
								{dayOfMonth(date)}
							</span>
						</span>
						<span
							className={cn(
								"tnum mt-1.5 block truncate text-md font-semibold",
								!judged
									? seconds > 0
										? "text-foreground"
										: "text-faint"
									: seconds === 0
										? "text-bad"
										: seconds >= target
											? "text-ok"
											: "text-warn",
							)}
						>
							{seconds > 0 ? formatClock(seconds) : "—"}
						</span>
						{/* One fixed row, whatever it holds — so the rails under seven
						    tabs land on one line however the week went. */}
						<span className="mt-0.5 block h-4 truncate text-2xs">
							{holidayName ? (
								<span className="text-warn">{holidayName}</span>
							) : short ? (
								<span className="tnum text-bad">
									{formatClock(target - seconds)} short
								</span>
							) : met ? (
								<span className="text-ok">done</span>
							) : isToday && target != null && seconds < target ? (
								<span className="tnum text-muted-foreground">
									of {formatClock(target)}
								</span>
							) : (
								<span>&nbsp;</span>
							)}
						</span>
						{/* Always drawn on a judged day, even at nothing: an empty track
						    is what makes an untouched day visible rather than blank.
						    The same three colours the home chart uses — red at nothing,
						    amber part-way, green at a full day — so "green means done"
						    means one thing on both screens. */}
						{judged && (
							<span className="mt-2 block h-[3px] overflow-hidden rounded-full bg-line2">
								<span
									className={cn(
										"rail-fill block h-full rounded-full",
										seconds === 0
											? "bg-bad"
											: seconds >= target
												? "bg-ok"
												: "bg-warn",
									)}
									style={{
										width: `${Math.max(fill, seconds === 0 ? 100 : 0)}%`,
									}}
								/>
							</span>
						)}
					</Link>
				);
			})}
		</div>
	);
}
