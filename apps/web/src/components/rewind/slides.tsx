import type { Rewind } from "@farmer/core/services";
import { animate, motion, useReducedMotion } from "motion/react";
import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";

import { ProjectIcon } from "#/components/projects/project-icon.tsx";
import { easeOut } from "#/lib/motion.ts";

// The slides of a Rewind. Each is a full screen of one color and one idea,
// set large: the serif names the moment, the mono carries the number.

export type RewindTheme = { bg: string; fg: string; accent: string };

// Fixed colors rather than the app's palette: a Rewind is an occasion, and
// it reads the same in light and dark.
export const THEMES = {
	violet: { bg: "#5b3aa8", fg: "#fbf8ff", accent: "#ffd27a" },
	ink: { bg: "#15130f", fg: "#f3efe6", accent: "#b69cff" },
	moss: { bg: "#27513d", fg: "#eef5ea", accent: "#f6c85f" },
	amber: { bg: "#f0b43c", fg: "#1b1a17", accent: "#5b3aa8" },
	coral: { bg: "#cf553f", fg: "#fff6f1", accent: "#1b1a17" },
	cobalt: { bg: "#22418f", fg: "#eef2ff", accent: "#ffb86b" },
	paper: { bg: "#f6f2ea", fg: "#1b1a17", accent: "#5b3aa8" },
} as const satisfies Record<string, RewindTheme>;

const EASE = easeOut;

// ── Formatting ──────────────────────────────────────────────────────────────

const numbers = new Intl.NumberFormat("en");
const MONTH = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" });
const LONG_DAY = new Intl.DateTimeFormat("en", {
	weekday: "long",
	day: "numeric",
	month: "long",
	timeZone: "UTC",
});
const SHORT_DAY = new Intl.DateTimeFormat("en", {
	day: "numeric",
	month: "short",
	timeZone: "UTC",
});
const WEEKDAY = new Intl.DateTimeFormat("en", {
	weekday: "long",
	timeZone: "UTC",
});

export const wholeHours = (seconds: number): string =>
	numbers.format(Math.round(seconds / 3600));
const tenthHours = (seconds: number): string =>
	numbers.format(Math.round(seconds / 360) / 10);
export const monthName = (month: number): string =>
	MONTH.format(new Date(Date.UTC(2000, month - 1, 1)));
const dayOf = (key: string) => new Date(`${key}T00:00:00Z`);
// 1 January 2023 was a Sunday, so day `d` of that week is weekday `d`.
const weekdayName = (weekday: number): string =>
	WEEKDAY.format(new Date(Date.UTC(2023, 0, 1 + weekday)));
/** A share of the year as a whole percent. A sliver that rounds to nothing
 *  still reads as a sliver, not as "0%". */
const sharePercent = (seconds: number, total: number): string => {
	const percent = Math.round((seconds / total) * 100);
	return percent === 0 && seconds > 0 ? "<1%" : `${percent}%`;
};

const plural = (n: number, one: string, many = `${one}s`) =>
	`${numbers.format(n)} ${n === 1 ? one : many}`;

// ── Pieces ──────────────────────────────────────────────────────────────────

/** Children rise in one after another. Under reduced motion, `MotionConfig`
 *  in the story drops the travel and keeps the fade. */
export function Stagger({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<motion.div
			className={className}
			initial="hidden"
			animate="shown"
			variants={{
				shown: { transition: { staggerChildren: 0.16, delayChildren: 0.12 } },
			}}
		>
			{children}
		</motion.div>
	);
}

export function Rise({
	children,
	className,
	style,
}: {
	children: ReactNode;
	className?: string;
	style?: CSSProperties;
}) {
	return (
		<motion.div
			className={className}
			style={style}
			variants={{
				hidden: { opacity: 0, y: 28 },
				shown: { opacity: 1, y: 0 },
			}}
			transition={{ duration: 0.75, ease: EASE }}
		>
			{children}
		</motion.div>
	);
}

/** A number that counts up to itself once, written straight to the DOM so a
 *  second of counting is not sixty React renders. */
function CountUp({
	value,
	unit = "whole",
	delay = 0.35,
}: {
	value: number;
	unit?: "whole" | "hours";
	delay?: number;
}) {
	const ref = useRef<HTMLSpanElement>(null);
	const reduce = useReducedMotion();
	useEffect(() => {
		const node = ref.current;
		if (!node) return;
		const format = (n: number) =>
			unit === "hours" ? wholeHours(n) : numbers.format(Math.round(n));
		if (reduce) {
			node.textContent = format(value);
			return;
		}
		const controls = animate(0, value, {
			delay,
			duration: 1.6,
			ease: EASE,
			onUpdate: (n) => {
				node.textContent = format(n);
			},
		});
		return () => controls.stop();
	}, [value, unit, delay, reduce]);
	return <span ref={ref}>0</span>;
}

function Eyebrow({ children }: { children: ReactNode }) {
	return (
		<Rise className="text-sm font-medium tracking-[0.18em] uppercase opacity-75">
			{children}
		</Rise>
	);
}

function Headline({ children }: { children: ReactNode }) {
	return (
		<Rise className="serif text-5xl leading-[0.95] text-balance sm:text-7xl">
			{children}
		</Rise>
	);
}

function Big({ children }: { children: ReactNode }) {
	return (
		<Rise
			className="mono leading-none"
			// Sized to the viewport: the number is the slide.
		>
			<span
				style={{
					fontSize: "clamp(5rem, calc(22 * var(--vw)), 13rem)",
					letterSpacing: "-0.06em",
				}}
			>
				{children}
			</span>
		</Rise>
	);
}

function Line({ children }: { children: ReactNode }) {
	return (
		<Rise className="max-w-xl text-xl leading-snug text-balance sm:text-2xl">
			{children}
		</Rise>
	);
}

function Note({ children }: { children: ReactNode }) {
	return (
		<Rise className="max-w-xl text-base leading-snug opacity-70">
			{children}
		</Rise>
	);
}

function Mark({
	theme,
	children,
}: {
	theme: RewindTheme;
	children: ReactNode;
}) {
	return <span style={{ color: theme.accent }}>{children}</span>;
}

// ── Slides ──────────────────────────────────────────────────────────────────

export function IntroSlide({
	rewind,
	firstName,
	theme,
}: {
	rewind: Rewind;
	firstName: string;
	theme: RewindTheme;
}) {
	return (
		<Stagger className="flex flex-col gap-6">
			<Eyebrow>Farmer Rewind</Eyebrow>
			<Rise>
				<span
					className="serif block leading-[0.8]"
					style={{
						fontSize: "clamp(7rem, calc(34 * var(--vw)), 19rem)",
						color: theme.accent,
					}}
				>
					{rewind.year}
				</span>
			</Rise>
			<Line>{firstName}, this was your year in hours.</Line>
			{!rewind.complete && (
				<Note>
					The year is not over yet. What is still to come is projected from your
					pace so far.
				</Note>
			)}
			<Note>Tap to continue.</Note>
		</Stagger>
	);
}

export function EmptySlide({ year }: { year: number }) {
	return (
		<Stagger className="flex flex-col gap-6">
			<Eyebrow>{year}</Eyebrow>
			<Headline>Nothing logged in {year}.</Headline>
			<Line>There is no year to rewind here. Try another one.</Line>
		</Stagger>
	);
}

export function HoursSlide({
	rewind,
	theme,
}: {
	rewind: Rewind;
	theme: RewindTheme;
}) {
	const previous = rewind.previousYearWorkedSeconds;
	const change =
		previous != null
			? Math.round(((rewind.workedSeconds - previous) / previous) * 100)
			: null;
	return (
		<Stagger className="flex flex-col gap-5">
			<Eyebrow>You logged</Eyebrow>
			<Big>
				<CountUp value={rewind.workedSeconds} unit="hours" />
			</Big>
			<Headline>hours of work.</Headline>
			<Line>
				That is{" "}
				<Mark theme={theme}>
					{plural(Math.round(rewind.workedSeconds / 28_800), "working day")}
				</Mark>{" "}
				back to back.
				{change != null && change !== 0 && (
					<>
						{" "}
						{change > 0 ? `${change}% more` : `${-change}% less`} than in{" "}
						{rewind.year - 1}.
					</>
				)}
			</Line>
			{rewind.projectedWorkedSeconds != null && (
				<Note>
					At your pace, you finish {rewind.year} at about{" "}
					{wholeHours(rewind.projectedWorkedSeconds)} hours.
				</Note>
			)}
		</Stagger>
	);
}

export function DaysSlide({
	rewind,
	theme,
}: {
	rewind: Rewind;
	theme: RewindTheme;
}) {
	const streak = rewind.longestStreak;
	return (
		<Stagger className="flex flex-col gap-5">
			<Eyebrow>You showed up on</Eyebrow>
			<Big>
				<CountUp value={rewind.daysWorked} />
			</Big>
			<Headline>days.</Headline>
			{streak && streak.days > 1 && (
				<Line>
					Your longest run was{" "}
					<Mark theme={theme}>{plural(streak.days, "working day")}</Mark> in a
					row, from {SHORT_DAY.format(dayOf(streak.from))} to{" "}
					{SHORT_DAY.format(dayOf(streak.to))}.
				</Line>
			)}
			{rewind.weekendDaysWorked > 0 && (
				<Note>
					And {plural(rewind.weekendDaysWorked, "weekend day")}. We noticed.
				</Note>
			)}
		</Stagger>
	);
}

// The chart's own height, in px. Bars are sized against it directly, which is
// sturdier than a percentage of a flex item.
const CHART_PX = 220;

export function MonthsSlide({
	rewind,
	theme,
}: {
	rewind: Rewind;
	theme: RewindTheme;
}) {
	const max = Math.max(
		1,
		...rewind.months.map((m) => m.seconds + m.projectedSeconds),
	);
	const busiest = rewind.months.reduce((best, m) =>
		m.seconds > best.seconds ? m : best,
	);
	const projected = rewind.months.some((m) => m.projectedSeconds > 0);
	const px = (seconds: number) => Math.round((seconds / max) * CHART_PX);
	return (
		<Stagger className="flex flex-col gap-8">
			<Eyebrow>Month by month</Eyebrow>
			<Headline>
				<Mark theme={theme}>{monthName(busiest.month)}</Mark> was your biggest
				month.
			</Headline>
			<Rise>
				<div
					className="flex items-end gap-1.5 sm:gap-3"
					style={{ height: CHART_PX + 28 }}
				>
					{rewind.months.map((m, i) => (
						<div
							key={m.month}
							className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
						>
							<motion.div
								className="flex w-full max-w-12 origin-bottom flex-col justify-end"
								initial={{ scaleY: 0 }}
								animate={{ scaleY: 1 }}
								transition={{
									delay: 0.45 + i * 0.05,
									duration: 0.9,
									ease: EASE,
								}}
							>
								{m.projectedSeconds > 0 && (
									<div
										className="rounded-t-[3px] border border-b-0 border-dashed"
										style={{
											height: px(m.projectedSeconds),
											borderColor: theme.fg,
											backgroundImage: `repeating-linear-gradient(135deg, ${theme.fg}40 0 5px, transparent 5px 10px)`,
										}}
									/>
								)}
								<div
									className={
										m.projectedSeconds > 0 ? undefined : "rounded-t-[3px]"
									}
									style={{
										height: Math.max(px(m.seconds), m.seconds > 0 ? 3 : 1),
										background:
											m.month === busiest.month ? theme.accent : theme.fg,
										opacity:
											m.month === busiest.month || m.seconds === 0 ? 1 : 0.55,
									}}
								/>
							</motion.div>
							<span className="mono text-xs opacity-70">
								{monthName(m.month).slice(0, 1)}
							</span>
						</div>
					))}
				</div>
			</Rise>
			<Line>
				{wholeHours(busiest.seconds)} hours in {monthName(busiest.month)}.
				{projected && " The striped part is still to come."}
			</Line>
		</Stagger>
	);
}

export function BigDaySlide({
	rewind,
	theme,
}: {
	rewind: Rewind;
	theme: RewindTheme;
}) {
	const day = rewind.busiestDay;
	const strongest = rewind.weekdays.indexOf(Math.max(...rewind.weekdays));
	return (
		<Stagger className="flex flex-col gap-6">
			<Eyebrow>Your biggest day</Eyebrow>
			{day && (
				<>
					<Headline>{LONG_DAY.format(dayOf(day.date))}</Headline>
					<Line>
						<Mark theme={theme}>{tenthHours(day.seconds)} hours</Mark> in one
						day.
					</Line>
				</>
			)}
			<Line>
				{weekdayName(strongest)}s were your strongest day of the week.
			</Line>
			{rewind.overtimeSeconds > 0 && (
				<Note>
					{wholeHours(rewind.overtimeSeconds)} hours of it was overtime.
				</Note>
			)}
		</Stagger>
	);
}

export function ProjectsSlide({
	rewind,
	theme,
}: {
	rewind: Rewind;
	theme: RewindTheme;
}) {
	const top = rewind.projects[0]?.seconds ?? 1;
	return (
		<Stagger className="flex flex-col gap-7">
			<Eyebrow>Where your hours went</Eyebrow>
			<div className="flex flex-col gap-5">
				{rewind.projects.map((p, i) => (
					<Rise key={p.id} className="flex items-center gap-4">
						<span className="serif w-7 shrink-0 text-4xl opacity-60">
							{i + 1}
						</span>
						<ProjectIcon icon={p.icon} name={p.name} />
						<div className="min-w-0 flex-1">
							<div className="truncate text-xl font-medium sm:text-2xl">
								{p.name}
							</div>
							{p.clientName && p.clientName !== p.name && (
								<div className="truncate text-sm opacity-70">
									{p.clientName}
								</div>
							)}
							<div
								className="mt-2 h-1 overflow-hidden rounded-full"
								style={{ background: `${theme.fg}26` }}
							>
								<motion.div
									className="h-full rounded-full"
									style={{ background: theme.accent }}
									initial={{ width: 0 }}
									animate={{ width: `${(p.seconds / top) * 100}%` }}
									transition={{
										delay: 0.6 + i * 0.12,
										duration: 1,
										ease: EASE,
									}}
								/>
							</div>
						</div>
						<span className="mono shrink-0 text-lg sm:text-xl">
							{wholeHours(p.seconds)}h
						</span>
					</Rise>
				))}
			</div>
			<Note>
				{plural(rewind.projectCount, "project")} for{" "}
				{plural(rewind.clientCount, "client")} this year.
			</Note>
		</Stagger>
	);
}

const GROUP_LABELS = {
	engineering: "Engineering",
	product: "Product",
	learning: "Learning",
	general: "General",
	time_off: "Time off",
} satisfies Record<Rewind["groups"][number]["group"], string>;

const GROUP_COLORS = ["#5b3aa8", "#cf553f", "#27513d", "#f0b43c", "#22418f"];

export function TasksSlide({
	rewind,
	theme,
}: {
	rewind: Rewind;
	theme: RewindTheme;
}) {
	const total = Math.max(1, rewind.workedSeconds);
	return (
		<Stagger className="flex flex-col gap-7">
			<Eyebrow>How you spent it</Eyebrow>
			<Rise>
				<div className="flex h-5 overflow-hidden rounded-full">
					{rewind.groups.map((g, i) => (
						<motion.div
							key={g.group}
							style={{ background: GROUP_COLORS[i % GROUP_COLORS.length] }}
							initial={{ width: 0 }}
							animate={{ width: `${(g.seconds / total) * 100}%` }}
							transition={{ delay: 0.4 + i * 0.1, duration: 1, ease: EASE }}
						/>
					))}
				</div>
				<div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
					{rewind.groups.map((g, i) => (
						<span key={g.group} className="flex items-center gap-2 text-sm">
							<span
								className="size-2.5 rounded-full"
								style={{ background: GROUP_COLORS[i % GROUP_COLORS.length] }}
							/>
							{GROUP_LABELS[g.group]}
							<span className="mono opacity-60">
								{sharePercent(g.seconds, total)}
							</span>
						</span>
					))}
				</div>
			</Rise>
			<div className="flex flex-col">
				{rewind.tasks.map((t, i) => (
					<Rise
						key={t.id}
						className="flex items-baseline justify-between gap-4 py-2.5"
						style={i > 0 ? { borderTop: `1px solid ${theme.fg}26` } : undefined}
					>
						<span className="serif truncate text-3xl">{t.name}</span>
						<span className="mono shrink-0 text-lg">
							{wholeHours(t.seconds)}h
						</span>
					</Rise>
				))}
			</div>
			{rewind.meetingSeconds > 0 && (
				<Note>
					{wholeHours(rewind.meetingSeconds)} hours of meetings
					{rewind.codeReviewSeconds > 0 &&
						`, and ${wholeHours(rewind.codeReviewSeconds)} hours reviewing other people's code`}
					.
				</Note>
			)}
		</Stagger>
	);
}

export function WordsSlide({
	rewind,
	theme,
}: {
	rewind: Rewind;
	theme: RewindTheme;
}) {
	const most = rewind.words[0]?.count ?? 1;
	return (
		<Stagger className="flex flex-col gap-6">
			<Eyebrow>Your year in {rewind.words.length} words</Eyebrow>
			<div className="flex flex-col">
				{rewind.words.map((w, i) => (
					<Rise key={w.word} className="flex items-baseline gap-4">
						<span
							className="serif leading-[1.05]"
							style={{
								fontSize: `clamp(2.5rem, ${6 + (w.count / most) * 6}vw, ${4 + (w.count / most) * 4}rem)`,
								color: i === 0 ? theme.accent : undefined,
							}}
						>
							{w.word}
						</span>
						<span className="mono text-sm opacity-60">×{w.count}</span>
					</Rise>
				))}
			</div>
			<Note>The words you wrote most in your notes.</Note>
		</Stagger>
	);
}

export function GithubSlide({
	rewind,
	theme,
}: {
	rewind: Rewind;
	theme: RewindTheme;
}) {
	const figures = [
		{ label: "commits", value: rewind.commits },
		{ label: "pull requests opened", value: rewind.pullRequests.opened },
		{ label: "merged", value: rewind.pullRequests.merged },
		{ label: "reviews", value: rewind.pullRequests.reviewed },
	].filter((f) => f.value > 0);
	return (
		<Stagger className="flex flex-col gap-8">
			<Eyebrow>From GitHub</Eyebrow>
			<Headline>You shipped.</Headline>
			<div className="grid grid-cols-2 gap-x-6 gap-y-8">
				{figures.map((f) => (
					<Rise key={f.label}>
						<div
							className="mono leading-none"
							style={{
								fontSize: "clamp(3rem, calc(12 * var(--vw)), 6rem)",
								color: theme.accent,
							}}
						>
							<CountUp value={f.value} delay={0.6} />
						</div>
						<div className="mt-2 text-lg opacity-80">{f.label}</div>
					</Rise>
				))}
			</div>
		</Stagger>
	);
}

export function TimeOffSlide({
	rewind,
	theme,
}: {
	rewind: Rewind;
	theme: RewindTheme;
}) {
	const { vacationDays, sickDays, otherDays, aheadDays } = rewind.timeOff;
	const days = (n: number) =>
		`${numbers.format(n)} ${n === 1 ? "day" : "days"}`;
	return (
		<Stagger className="flex flex-col gap-6">
			<Eyebrow>Time away</Eyebrow>
			{vacationDays > 0 && (
				<Headline>
					<Mark theme={theme}>{days(vacationDays)}</Mark> of vacation.
				</Headline>
			)}
			{sickDays > 0 && (
				<Line>{days(sickDays)} of sick leave. Hope you are well.</Line>
			)}
			{otherDays > 0 && <Line>{days(otherDays)} of other leave.</Line>}
			{aheadDays > 0 ? (
				<Note>Still ahead of you: {days(aheadDays)}. Enjoy it.</Note>
			) : (
				<Note>Rest is part of the work.</Note>
			)}
		</Stagger>
	);
}

const PERSONAS = {
	engineering: {
		title: "The Builder",
		line: "Most of your year went into making things.",
	},
	product: {
		title: "The Strategist",
		line: "You spent the year deciding what gets made, and why.",
	},
	learning: {
		title: "The Scholar",
		line: "You gave more hours to learning than most people plan to.",
	},
	general: {
		title: "The All-Rounder",
		line: "No single lane. A bit of everything, all year.",
	},
	time_off: {
		title: "The Traveller",
		line: "A year well rested.",
	},
} satisfies Record<
	Rewind["groups"][number]["group"],
	{ title: string; line: string }
>;

/** Who the year says you are: the Connector when meetings took over a third
 *  of it, otherwise the group most of the hours went to. */
export const personaFor = (rewind: Rewind) => {
	if (rewind.meetingSeconds / Math.max(1, rewind.workedSeconds) > 1 / 3) {
		return {
			title: "The Connector",
			line: "A third of your year was meetings. The calendar knows you well.",
		};
	}
	const group = rewind.groups[0]?.group ?? "general";
	return PERSONAS[group];
};

export function PersonaSlide({
	rewind,
	theme,
}: {
	rewind: Rewind;
	theme: RewindTheme;
}) {
	const persona = personaFor(rewind);
	return (
		<Stagger className="flex flex-col gap-6">
			<Eyebrow>Your {rewind.year}, in one name</Eyebrow>
			<Rise>
				<span
					className="serif block leading-[0.85] text-balance"
					style={{
						fontSize: "clamp(4.5rem, calc(17 * var(--vw)), 11rem)",
						color: theme.accent,
					}}
				>
					{persona.title}
				</span>
			</Rise>
			<Line>{persona.line}</Line>
		</Stagger>
	);
}

/** The year in six figures — the summary slide and the shared image both
 *  read them from here, so the picture never disagrees with the screen. */
export const summaryTiles = (rewind: Rewind) => {
	const busiest = rewind.months.reduce((best, m) =>
		m.seconds > best.seconds ? m : best,
	);
	return [
		{ label: "Hours", value: wholeHours(rewind.workedSeconds) },
		{ label: "Days", value: numbers.format(rewind.daysWorked) },
		{ label: "Top project", value: rewind.projects[0]?.name ?? "None" },
		{ label: "Biggest month", value: monthName(busiest.month) },
		{
			label: "Longest run",
			value: rewind.longestStreak
				? plural(rewind.longestStreak.days, "day")
				: "None",
		},
		{ label: "You are", value: personaFor(rewind).title },
	];
};

export function SummarySlide({
	rewind,
	theme,
	actions,
}: {
	rewind: Rewind;
	theme: RewindTheme;
	actions: ReactNode;
}) {
	const tiles = summaryTiles(rewind);
	return (
		<Stagger className="flex flex-col gap-8">
			<Eyebrow>Farmer Rewind {rewind.year}</Eyebrow>
			{/* The card settles in as one piece, a slow fade with no travel: after
			    a dozen slides of movement the last one holds still. The gap is
			    the rule: each tile is painted the slide's color over a grid
			    filled with the line color. */}
			<motion.div
				className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border"
				style={{ borderColor: `${theme.fg}33`, background: `${theme.fg}33` }}
				variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}
				transition={{ duration: 1.1, ease: EASE }}
			>
				{tiles.map((t) => (
					<div
						key={t.label}
						className="min-w-0 px-5 py-5 sm:px-6"
						style={{ background: theme.bg }}
					>
						<div className="text-xs tracking-[0.16em] uppercase opacity-60">
							{t.label}
						</div>
						<div className="serif mt-2 truncate text-3xl sm:text-4xl">
							{t.value}
						</div>
					</div>
				))}
			</motion.div>
			{/* The slide ignores the pointer so a tap anywhere turns the page;
			    the actions are the one part that takes it back. */}
			<Rise className="pointer-events-auto flex flex-wrap gap-3">
				{actions}
			</Rise>
		</Stagger>
	);
}
