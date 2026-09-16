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
 * **Two rows and no bars.** The day and its date, then the hours in the day's
 * verdict colour with one short note beside them in grey: how far a past day
 * fell short, or what today is aiming at. The strip used to stack a verdict
 * bar under every day and a purple underline under the selected one on top of
 * the strip's own rule, and put "short" in red beside amber hours, so one day
 * wore two warning colours and the selected day wore three lines.
 *
 * **One colour per day, and a day is only judged once it has happened.** Green
 * at a full day, amber part-way, red for a past working day with nothing on it
 * (the note says "nothing", in the same red). Today with nothing yet is not
 * red: it is not over. Future days, weekends and holidays are not judged; a
 * holiday names itself in amber beside neutral hours.
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
				const empty = judged && past && seconds === 0;
				const short = judged && past && seconds > 0 && seconds < target;
				const hoursTone = empty
					? "text-bad"
					: judged && seconds > 0
						? seconds >= target
							? "text-ok"
							: "text-warn"
						: seconds > 0
							? "text-foreground"
							: "text-faint";
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
								// jump instead of glide. It sits ON the strip's bottom rule
								// (7px: the strip's 6px of padding plus the rule), so the
								// selected day adds no line of its own.
								transition={springLayout}
								className="absolute inset-x-2.5 -bottom-[7px] h-0.5 rounded-full bg-primary"
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
						<span className="mt-1.5 flex min-w-0 items-baseline gap-1.5">
							<span
								className={cn("tnum shrink-0 text-md font-semibold", hoursTone)}
							>
								{seconds > 0 ? formatClock(seconds) : "—"}
							</span>
							{holidayName ? (
								<span className="min-w-0 truncate text-xs text-warn">
									{holidayName}
								</span>
							) : empty ? (
								<span className="min-w-0 truncate text-xs text-bad">
									nothing
								</span>
							) : short ? (
								<span className="tnum min-w-0 truncate text-xs text-muted-foreground">
									{formatClock(target - seconds)} short
								</span>
							) : isToday && target != null && seconds < target ? (
								<span className="tnum min-w-0 truncate text-xs text-muted-foreground">
									of {formatClock(target)}
								</span>
							) : null}
						</span>
					</Link>
				);
			})}
		</div>
	);
}
