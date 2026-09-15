import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";

import { formatClock } from "#/lib/format-hours.ts";
import { springLayout } from "#/lib/motion.ts";
import { cn } from "#/lib/utils.ts";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayOfWeek = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const isWeekday = (date: string) => {
	const day = dayOfWeek(date);
	return day !== 0 && day !== 6;
};
/** "14" from "2026-09-14", without constructing a Date to ask. */
const dayOfMonth = (date: string) => date.slice(8).replace(/^0/, "");

/**
 * The seven days of the week, as the tabs the Day view is read through.
 *
 * It exists so a person filling in Tuesday can see, without navigating, that
 * Thursday is still empty — which is the whole reason Harvest puts a strip
 * there. It used to be seven columns of "0:00" in three different type styles
 * (caps label, mono figure, red "short"), which is a lot of ink for a row that
 * mostly says nothing: the eye could not find today, and the red on a day still
 * being worked read as a scold rather than as information.
 *
 * Each day is now one tab: its name and date, what is on it against the day's
 * worth, and a hairline rail. The active one is a lift plus a sliding accent
 * underline, the same pair the sidebar and the segmented control use to say
 * "this one".
 *
 * **Today is never short.** A day is only compared against the day's worth once
 * it is over, so "2:00 short" appears on Monday evening and never on Tuesday
 * morning. Today says what it has and what it is aiming at instead.
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
		<div className="-mx-4 grid grid-cols-7 gap-1 border-b px-4 pb-1.5 sm:-mx-8 sm:px-8">
			{dates.map((date) => {
				const seconds = secondsByDay.get(date) ?? 0;
				const isActive = date === activeDate;
				const isToday = date === today;
				const holidayName = holidays.get(date);
				const weekend = !isWeekday(date);
				const target = dayTargetSeconds ?? null;
				const past = today != null && date < today;
				const short =
					target != null &&
					!holidayName &&
					!weekend &&
					past &&
					seconds < target;
				const met =
					target != null &&
					!holidayName &&
					!weekend &&
					past &&
					seconds >= target;
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
						// The whole tab is the hit target, including its figure — the
						// strip used to be a 16px-wide column of text on a phone.
						className={cn(
							"relative min-w-0 rounded-lg px-2 pt-2 pb-2.5 transition-colors duration-(--dur-fast) outline-none focus-visible:ring-3 focus-visible:ring-ring/16",
							isActive ? "bg-secondary" : "hover:bg-muted",
							weekend && !isActive && "opacity-55",
						)}
					>
						{isActive && (
							<motion.span
								aria-hidden
								layoutId="week-strip-active-day"
								// Same shared-element move, same spring, as the Day/Week/Month
								// pill in the SegmentedControl directly above this strip —
								// `reducedMotion="user"` on the root <MotionConfig> makes it
								// jump instead of glide. It sits on the strip's own bottom
								// rule, which is what ties the tab to the list under it.
								transition={springLayout}
								className="absolute inset-x-2 -bottom-1.5 h-0.5 rounded-full bg-primary"
							/>
						)}
						<span className="eyebrow flex items-baseline gap-1">
							<span className={cn(isActive && "text-foreground")}>
								{WEEKDAY_LABELS[dayOfWeek(date)]}
							</span>
							<span
								className={cn(
									"text-2xs tracking-normal normal-case",
									isToday ? "font-medium text-primary" : "text-faint",
								)}
							>
								{dayOfMonth(date)}
							</span>
						</span>
						<span
							className={cn(
								"tnum mt-1.5 block truncate text-base font-medium",
								seconds > 0 ? "text-foreground" : "text-faint",
							)}
						>
							{seconds > 0 ? formatClock(seconds) : "—"}
						</span>
						<span className="mt-0.5 block h-4 truncate text-2xs">
							{holidayName ? (
								<span className="text-warn">{holidayName}</span>
							) : short ? (
								<span className="text-bad">
									{formatClock(target - seconds)} short
								</span>
							) : met ? (
								<span className="text-ok">done</span>
							) : isToday && target != null && seconds < target ? (
								<span className="text-muted-foreground">
									of {formatClock(target)}
								</span>
							) : (
								<span>&nbsp;</span>
							)}
						</span>
						{/* A hairline rail rather than a number: seven of these read as a
						    week's shape at a glance, which seven figures do not. */}
						{target != null && target > 0 && !weekend && !holidayName && (
							<span className="mt-1.5 block h-[3px] overflow-hidden rounded-full bg-line2">
								<span
									className={cn(
										"rail-fill block h-full rounded-full",
										short ? "bg-bad/70" : "bg-primary",
									)}
									style={{ width: `${fill}%` }}
								/>
							</span>
						)}
					</Link>
				);
			})}
		</div>
	);
}
