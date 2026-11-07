import {
	ArrowLeftIcon,
	ArrowRightIcon,
	ArrowUpIcon,
	CalendarBlankIcon,
	CaretDoubleLeftIcon,
	ChartLineIcon,
	CheckIcon,
	ClockIcon,
	CoffeeIcon,
	DownloadSimpleIcon,
	FolderSimpleIcon,
	GearSixIcon,
	GitCommitIcon,
	GithubLogoIcon,
	GitPullRequestIcon,
	LockSimpleIcon,
	MagicWandIcon,
	MinusIcon,
	PlusIcon,
	SmileyIcon,
	SparkleIcon,
	SquaresFourIcon,
	UmbrellaIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";

/*
 * The product mock-ups the front page draws: the home screen in the hero
 * window, "Assemble my day", the week timesheet and the Tracking report.
 *
 * Every figure, person and project here is made up. They are pictures of the
 * product, so each one is a labelled `<figure>` whose drawing is `aria-hidden`, and nothing
 * inside is in the tab order — a screen reader hears what the picture shows rather
 * than forty cells of invented hours.
 */

type Source =
	| { kind: "calendar" }
	| { kind: "commits"; count: number }
	| { kind: "pulls"; count: number }
	| { kind: "fill" };

type MockEntry = {
	icon: string;
	project: string;
	task: string;
	note?: string;
	time: string;
	source?: Source;
};

const ACME = { icon: "🎨", project: "[ACM] Acme Rebrand (Acme Corp)" };
const HARBOR = { icon: "⚓", project: "[HRB] Harbor App (Harbor Labs)" };
const INTERNAL = { icon: "🌾", project: "[INT] Internal (Profico)" };

function SourceMark({ source }: { source: Source }) {
	switch (source.kind) {
		case "calendar":
			return (
				<CalendarBlankIcon weight="duotone" size={14} className="fp-gcal" />
			);
		case "commits":
			return (
				<span className="fp-tag fm-mono">
					<GitCommitIcon size={11} />
					{source.count}
				</span>
			);
		case "pulls":
			return (
				<span className="fp-tag fm-mono">
					<GitPullRequestIcon size={11} />
					{source.count}
				</span>
			);
		case "fill":
			return <span className="fp-tag">Rest of day</span>;
	}
}

function Entry({
	entry,
	dashed,
	aside,
}: {
	entry: MockEntry;
	dashed?: boolean;
	/** Drawn in place of the time. */
	aside?: ReactNode;
}) {
	return (
		<div className={dashed ? "fp-entry fp-entry-dashed" : "fp-entry"}>
			<span className="fp-project-icon">{entry.icon}</span>
			<div className="fp-entry-main">
				<div className="fp-entry-title">
					<span className="fp-entry-name">{entry.project}</span>
					{entry.source ? <SourceMark source={entry.source} /> : null}
				</div>
				<div className="fp-small">{entry.task}</div>
				{entry.note ? <div className="fp-small">{entry.note}</div> : null}
			</div>
			{aside ?? <span className="fm-mono fp-entry-time">{entry.time}</span>}
		</div>
	);
}

function Metric({
	label,
	value,
	of,
	sub,
	percent,
	status,
}: {
	label: string;
	value: string;
	of: string;
	sub: ReactNode;
	percent: number;
	status?: string;
}) {
	return (
		<div className="fp-metric">
			<div className="fp-metric-head">
				<span className="fm-eyebrow">{label}</span>
				{status ? <span className="fp-status">{status}</span> : null}
			</div>
			<div className="fp-metric-value">
				<span className="fm-mono">{value}</span>
				<span className="fp-small">/ {of}</span>
			</div>
			<div className="fp-small">{sub}</div>
			<div className="fp-rail-bar">
				<span style={{ width: `${percent}%` }} />
			</div>
		</div>
	);
}

// ---- The hero window: the home screen ---------------------------------

const todayEntries: MockEntry[] = [
	{
		...ACME,
		task: "Meetings",
		note: "Design review",
		time: "1:00",
		source: { kind: "calendar" },
	},
	{
		...HARBOR,
		task: "Development",
		note: "Session token refresh",
		time: "2:30",
		source: { kind: "commits", count: 12 },
	},
	{
		...HARBOR,
		task: "Code review",
		time: "1:00",
		source: { kind: "pulls", count: 2 },
	},
	{ ...INTERNAL, task: "Meetings", note: "Daily stand-up", time: "0:15" },
	{ ...INTERNAL, task: "Planning", time: "1:15", source: { kind: "fill" } },
];

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/*
 * The mock-ups play along when you click them: "Log time" fills the day,
 * "Accept day" writes the proposal, the week arrows move, the CSV downloads.
 * The drawing stays `aria-hidden`, so each control is out of the tab order.
 */
function Play({ className, ...props }: ComponentProps<"button">) {
	return (
		<button
			type="button"
			tabIndex={-1}
			className={className ? `fp-play ${className}` : "fp-play"}
			{...props}
		/>
	);
}

/** A value that falls back to null `ms` after it is set. */
function useFlash<T>(ms: number) {
	const [value, setValue] = useState<T | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	const flash = (next: T) => {
		clearTimeout(timer.current);
		setValue(next);
		timer.current = setTimeout(() => setValue(null), ms);
	};
	return [value, flash] as const;
}

/** Minutes as `h:mm`. */
const clock = (minutes: number) =>
	`${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/** How far the hours are from what is due by the end of today. */
function dueText(short: number, due: string) {
	if (short > 0)
		return `${short.toFixed(2)} short of the ${due} due by the end of today`;
	if (short === 0) return `On target for the ${due} due by the end of today`;
	return `${(-short).toFixed(2)} ahead of the ${due} due by the end of today`;
}

const SIDEBAR = [
	SquaresFourIcon,
	ClockIcon,
	FolderSimpleIcon,
	ChartLineIcon,
	GearSixIcon,
];

/** "Log time" adds a quarter hour, up to the 8 hours of the day. */
const MAX_QUARTERS = 8;

export function HomePreview() {
	const [quarters, setQuarters] = useState(0);
	const [assembled, setAssembled] = useState(0);
	const [shake, flashShake] = useFlash<true>(500);
	const today = 6 + quarters / 4;
	return (
		<figure
			className="fp-window fp-figure"
			data-shake={shake ? "" : undefined}
			aria-label="The Farmer home screen, with made-up entries: today's time filled in from a calendar and from GitHub, and the week so far."
		>
			<div className="fp-window-bar" aria-hidden>
				<Play className="fp-window-dot" onClick={() => flashShake(true)} />
				<Play className="fp-window-dot" onClick={() => flashShake(true)} />
				<Play className="fp-window-dot" onClick={() => flashShake(true)} />
				<span className="fm-mono fp-window-url">farmer.profi.co</span>
			</div>
			<div className="fp-window-body fp-mock" aria-hidden>
				<HomeSidebar />
				<div className="fp-page">
					<div className="fp-page-head">
						<div style={{ flex: 1, minWidth: 200 }}>
							<div className="fm-eyebrow">Fri, Jul 10, 2026</div>
							<div className="fp-greeting">Good morning, Omar</div>
						</div>
						<Play
							className="fp-chip-btn"
							onClick={() => setAssembled((n) => n + 1)}
						>
							<SparkleIcon weight="duotone" />
							Assemble my day
						</Play>
						<Play
							className="fp-chip-btn fp-chip-btn-acc"
							disabled={quarters >= MAX_QUARTERS}
							onClick={() => setQuarters((n) => n + 1)}
						>
							<PlusIcon />
							Log time
						</Play>
					</div>
					<HomeMetrics today={today} quarters={quarters} />
					<div style={{ display: "flex", flexWrap: "wrap" }}>
						<div style={{ flex: "1.7 1 360px", minWidth: 0 }}>
							<div className="fp-list-head">
								<span className="fm-eyebrow">Today's entries</span>
								<span className="fp-small" style={{ marginLeft: "auto" }}>
									<span className="fm-mono">{clock(360 + 15 * quarters)}</span>{" "}
									logged
								</span>
							</div>
							<div
								key={assembled}
								className={assembled ? "fp-replay" : undefined}
							>
								{todayEntries.map((entry, i) => (
									<div
										key={`${entry.project}-${entry.task}`}
										style={{ animationDelay: `${i * 70}ms` }}
									>
										<Entry
											entry={
												entry.source?.kind === "fill"
													? { ...entry, time: clock(75 + 15 * quarters) }
													: entry
											}
										/>
									</div>
								))}
							</div>
						</div>
						<HomeWeek today={today} />
					</div>
				</div>
			</div>
		</figure>
	);
}

function HomeSidebar() {
	const [active, setActive] = useState(0);
	return (
		<aside className="fp-sidebar fm-sm-hide">
			<span className="fp-sidebar-org">P</span>
			{SIDEBAR.map((SidebarIcon, i) => (
				<Play
					key={SidebarIcon.displayName ?? i}
					className="fp-sidebar-icon"
					data-active={i === active ? "" : undefined}
					onClick={() => setActive(i)}
				>
					<SidebarIcon weight="duotone" size={19} />
				</Play>
			))}
			<div style={{ flex: 1, minHeight: 40 }} />
			<span className="fp-sidebar-icon">
				<CaretDoubleLeftIcon weight="duotone" size={19} />
			</span>
			<span className="fp-sidebar-icon">
				<GithubLogoIcon weight="duotone" size={19} />
			</span>
			<span className="fp-sidebar-rule" />
			<span className="fp-sidebar-avatar" />
		</aside>
	);
}

function HomeMetrics({ today, quarters }: { today: number; quarters: number }) {
	const short = 1.75 - quarters / 4;
	return (
		<div className="fp-metrics">
			<Metric
				label="Today"
				value={today.toFixed(2)}
				of="8.00"
				sub={today >= 8 ? "Done for today" : `${(8 - today).toFixed(2)} to go`}
				percent={(today / 8) * 100}
			/>
			<Metric
				label="This week"
				value={(38.25 + quarters / 4).toFixed(2)}
				of="40.00"
				sub={dueText(short, "40.00")}
				percent={Math.min(100, ((38.25 + quarters / 4) / 40) * 100)}
			/>
			<Metric
				label="This month"
				value={(62.25 + quarters / 4).toFixed(2)}
				of="184.00"
				sub={`${dueText(short, "64.00")} · 7 of 23 working days done`}
				percent={((62.25 + quarters / 4) / 184) * 100}
			/>
		</div>
	);
}

function HomeWeek({ today }: { today: number }) {
	const hours = ["7.75", "8.25", "8.00", "8.25", today.toFixed(2), "–", "–"];
	const heights = [97, 100, 100, 100, (today / 8) * 100];
	return (
		<div className="fp-week">
			<div style={{ display: "flex", alignItems: "center" }}>
				<span className="fm-eyebrow">This week by day</span>
				<span className="fm-mono" style={{ marginLeft: "auto", fontSize: 13 }}>
					{(32.25 + today).toFixed(2)}
				</span>
			</div>
			<div className="fp-week-plot">
				<div className="fp-week-target" />
				<div className="fp-week-cols">
					{heights.map((height, i) => (
						<div
							key={DAYS[i]}
							className="fp-week-bar"
							data-today={i === 4 ? "" : undefined}
							style={{ height: `${height}%` }}
						/>
					))}
				</div>
			</div>
			<div className="fp-week-days">
				{DAYS.map((day, i) => (
					<span key={day} style={i === 4 ? { color: "var(--acc)" } : undefined}>
						{day}
					</span>
				))}
			</div>
			<div className="fp-week-hours fm-mono">
				{hours.map((value, i) => (
					<span
						key={DAYS[i]}
						className={i === 4 && today < 8 ? "fp-under" : undefined}
					>
						{value}
					</span>
				))}
			</div>
			<span className="fp-link">
				Open the timesheet <ArrowRightIcon />
			</span>
		</div>
	);
}

// ---- 01: Assemble my day ----------------------------------------------

const proposed: MockEntry[] = [
	{ ...INTERNAL, task: "Meetings", note: "Daily stand-up", time: "0:15" },
	{
		...HARBOR,
		task: "Development",
		note: "Session token refresh",
		time: "3:15",
		source: { kind: "commits", count: 9 },
	},
	{
		...ACME,
		task: "Meetings",
		note: "Weekly sync · filed by rule",
		time: "1:00",
		source: { kind: "calendar" },
	},
	{
		...HARBOR,
		task: "Code review",
		note: "PR #214",
		time: "3:15",
		source: { kind: "pulls", count: 1 },
	},
];

/** Screenshots of the app on the demo instance. The data is made up. */
export function PhoneShots() {
	return (
		<div className="fp-phones">
			<PhoneShot
				name="timer"
				alt="The Time screen of the app: the week against its target, the days of the week, and a running timer with Pause and Stop."
			/>
			<PhoneShot
				name="reports"
				alt="The Reports screen of the app: total hours for the month and the hours of each project."
			/>
		</div>
	);
}

/** One screen in a light and a dark capture; CSS shows the one that matches
 *  `data-theme`. */
function PhoneShot({ name, alt }: { name: string; alt: string }) {
	return (
		<div className="fp-phone">
			{(["light", "dark"] as const).map((theme) => (
				<img
					key={theme}
					className={`fp-phone-${theme}`}
					src={`/_site/mobile/${name}-${theme}.webp`}
					width={600}
					height={1224}
					loading="lazy"
					alt={alt}
				/>
			))}
		</div>
	);
}

const toMinutes = (time: string) => {
	const [hours = "0", minutes = "0"] = time.split(":");
	return Number(hours) * 60 + Number(minutes);
};

/** Where each piece of confetti lands, from the middle of the smiley. */
const CONFETTI = Array.from({ length: 14 }, (_, i) => {
	const angle = (i / 14) * Math.PI * 2;
	const reach = 70 + (i % 3) * 22;
	return {
		x: Math.round(Math.cos(angle) * reach),
		y: Math.round(Math.sin(angle) * reach * 0.7),
	};
});

function Stepper({
	minutes,
	onChange,
}: {
	minutes: number;
	onChange: (minutes: number) => void;
}) {
	return (
		<span className="fp-stepper fm-mono">
			<Play onClick={() => onChange(Math.max(15, minutes - 15))}>
				<MinusIcon size={11} />
			</Play>
			{clock(minutes)}
			<Play onClick={() => onChange(Math.min(480, minutes + 15))}>
				<PlusIcon size={11} />
			</Play>
		</span>
	);
}

function DayAccepted({ hours }: { hours: string }) {
	return (
		<div className="fp-accepted">
			{CONFETTI.map(({ x, y }, i) => (
				<span
					key={`${x}-${y}`}
					className="fp-confetti"
					style={{ translate: `${x}px ${y}px`, animationDelay: `${i * 12}ms` }}
				/>
			))}
			<SmileyIcon weight="duotone" size={64} className="fp-accepted-face" />
			<div className="fm-serif fp-accepted-title">Day accepted</div>
			<div className="fp-small" style={{ fontSize: 13.5 }}>
				<span className="fm-mono">{hours}</span> hours on Fri, Jul 10. Enjoy the
				rest of your day.
			</div>
		</div>
	);
}

export function AssembleMock() {
	const [mode, setMode] = useState<"proposed" | "editing" | "accepted">(
		"proposed",
	);
	const [times, setTimes] = useState(() =>
		proposed.map((entry) => toMinutes(entry.time)),
	);
	const hours = (times.reduce((sum, value) => sum + value, 0) / 60).toFixed(2);
	return (
		<figure
			className="fm-frame fp-figure"
			aria-label="Assemble my day, with made-up entries: a stand-up, commits, a calendar meeting and a pull request, proposed and waiting to be accepted."
		>
			<div className="fm-island fp-mock" aria-hidden>
				<div className="fp-mock-head">
					<MagicWandIcon weight="duotone" size={20} className="fp-acc" />
					<div style={{ flex: 1 }}>
						<div className="fp-mock-title">Assemble my day</div>
						<div className="fp-small" style={{ fontSize: 12 }}>
							Fri, Jul 10 · proposed from 3 sources
						</div>
					</div>
					<span
						className="fm-mono"
						style={{ fontSize: 18, color: "var(--acc)" }}
					>
						{hours}
					</span>
				</div>
				<div className="fp-assemble-body" data-mode={mode}>
					<div className="fp-assemble-list">
						{proposed.map((entry, i) => (
							<Entry
								key={`${entry.project}-${entry.task}-${entry.note}`}
								entry={{ ...entry, time: clock(times[i] ?? 0) }}
								dashed
								aside={
									mode === "editing" ? (
										<Stepper
											minutes={times[i] ?? 0}
											onChange={(minutes) =>
												setTimes((all) =>
													all.map((value, j) => (j === i ? minutes : value)),
												)
											}
										/>
									) : undefined
								}
							/>
						))}
					</div>
					{mode === "accepted" ? <DayAccepted hours={hours} /> : null}
				</div>
				<div className="fp-mock-foot">
					<span className="fp-small" style={{ flex: 1, minWidth: 180 }}>
						{mode === "accepted"
							? "Saved. Change an entry in the day view."
							: mode === "editing"
								? "Change a time, then accept."
								: "Nothing is written until you accept."}
					</span>
					{mode === "accepted" ? (
						<Play className="fp-chip-btn" onClick={() => setMode("proposed")}>
							Undo
						</Play>
					) : (
						<>
							<Play
								className="fp-chip-btn"
								data-active={mode === "editing" ? "" : undefined}
								onClick={() =>
									setMode(mode === "editing" ? "proposed" : "editing")
								}
							>
								{mode === "editing" ? "Done" : "Edit"}
							</Play>
							<Play
								className="fp-chip-btn fp-chip-btn-acc"
								style={{ fontWeight: 500 }}
								onClick={() => setMode("accepted")}
							>
								<CheckIcon />
								Accept day
							</Play>
						</>
					)}
				</div>
			</div>
		</figure>
	);
}

// ---- 02: The week timesheet -------------------------------------------

type SheetRow = {
	icon: string;
	project: string;
	task: string;
	hours: string[];
	/** Made by automation: locked in the week, edited in the day view. */
	auto?: boolean;
	source?: Source;
};

const sheet: SheetRow[] = [
	{
		...ACME,
		task: "Design",
		hours: ["2:00", "3:30", "1:00", "4:00", "", "", ""],
	},
	{
		...HARBOR,
		task: "Development",
		hours: ["4:30", "2:30", "5:00", "3:00", "5:15", "", ""],
	},
	{
		...ACME,
		task: "Meetings",
		hours: ["1:00", "1:00", "", "1:00", "", "", ""],
		auto: true,
		source: { kind: "calendar" },
	},
	{
		...INTERNAL,
		task: "Meetings · daily stand-up",
		hours: ["0:15", "0:15", "0:15", "0:15", "0:15", "", ""],
		auto: true,
	},
	{
		...INTERNAL,
		task: "Planning",
		hours: ["", "1:00", "1:45", "", "0:30", "", ""],
		auto: true,
		source: { kind: "fill" },
	},
];

type View = "Day" | "Week" | "Month";
const VIEWS: View[] = ["Day", "Week", "Month"];

/** "Today" in the pictures. */
const TODAY = new Date(2026, 6, 10);
const dayOf = (date: Date) => (date.getDay() + 6) % 7;
const shift = (date: Date, days: number) =>
	new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const weekStart = (date: Date) => shift(date, -dayOf(date));
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const format = (date: Date, options: Intl.DateTimeFormatOptions) =>
	date.toLocaleDateString("en-US", options);

/**
 * The made-up hours of a row on a date. Every past week repeats the week of
 * July 6. A later week is empty until "Copy from previous week" fills it.
 */
type Hours = (row: SheetRow, date: Date) => string;

function rangeLabel(view: View, cursor: Date) {
	if (view === "Day") {
		return format(cursor, {
			weekday: "short",
			month: "long",
			day: "numeric",
			year: "numeric",
		});
	}
	if (view === "Month")
		return format(cursor, { month: "long", year: "numeric" });
	const start = weekStart(cursor);
	const end = shift(start, 6);
	const tail =
		start.getMonth() === end.getMonth()
			? `${end.getDate()}`
			: `${format(end, { month: "long" })} ${end.getDate()}`;
	return `${format(start, { month: "long" })} ${start.getDate()} – ${tail}, ${end.getFullYear()}`;
}

function step(view: View, cursor: Date, by: 1 | -1) {
	if (view === "Day") return shift(cursor, by);
	if (view === "Week") return shift(cursor, 7 * by);
	return new Date(cursor.getFullYear(), cursor.getMonth() + by, 1);
}

const dayMinutes = (hours: Hours, date: Date) =>
	sheet.reduce((sum, row) => sum + toMinutes(hours(row, date) || "0:00"), 0);

export function TimesheetMock() {
	const [view, setView] = useState<View>("Week");
	const [cursor, setCursor] = useState(TODAY);
	// The week starts that "Copy from previous week" has filled.
	const [copied, setCopied] = useState<string[]>([]);
	const filled = (date: Date) =>
		date <= TODAY || copied.includes(weekStart(date).toDateString());
	const hours: Hours = (row, date) =>
		filled(date) ? (row.hours[dayOf(date)] ?? "") : "";
	const start = weekStart(cursor);
	const weekFilled = filled(start);
	return (
		<figure
			className="fm-frame fp-figure"
			aria-label="The week timesheet, with made-up projects: 38.25 of 40 hours logged, and the rows automation made locked."
			style={{ marginTop: 48 }}
		>
			<div className="fm-island fp-ts" aria-hidden>
				<div className="fp-ts-head">
					<span className="fm-serif" style={{ fontSize: 30, lineHeight: 1 }}>
						Timesheet
					</span>
					<span className="fp-ts-views">
						{VIEWS.map((name) => (
							<Play
								key={name}
								data-active={name === view ? "" : undefined}
								onClick={() => setView(name)}
							>
								{name}
							</Play>
						))}
					</span>
				</div>
				<div className="fp-metrics fp-ts-metrics">
					<Metric
						label="This week"
						status="On track"
						value="38.25"
						of="40.00"
						sub="1.75 short of the 40.00 due by the end of today"
						percent={96}
					/>
					<Metric
						label="This month"
						value="62.25"
						of="184.00"
						sub="1.75 short of the 64.00 due by the end of today"
						percent={34}
					/>
				</div>
				<div className="fp-ts-tools">
					<span className="fp-ts-add">
						<PlusIcon />
					</span>
					<span className="fp-ts-range">
						<Play onClick={() => setCursor(step(view, cursor, -1))}>
							<ArrowLeftIcon />
						</Play>
						<span className="fp-ts-range-label">
							<CalendarBlankIcon weight="duotone" color="var(--mut)" />
							{rangeLabel(view, cursor)}
						</span>
						<Play onClick={() => setCursor(step(view, cursor, 1))}>
							<ArrowRightIcon />
						</Play>
					</span>
					<span className="fp-chip-btn" style={{ marginLeft: "auto" }}>
						<UmbrellaIcon weight="duotone" />
						Time off
					</span>
				</div>
				<div key={view} className="fp-ts-view">
					{view === "Day" ? (
						<TsDay cursor={cursor} hours={hours} onPick={setCursor} />
					) : null}
					{view === "Week" ? <TsWeek start={start} hours={hours} /> : null}
					{view === "Month" ? (
						<TsMonth
							cursor={cursor}
							hours={hours}
							onPick={(date) => {
								setCursor(date);
								setView("Day");
							}}
						/>
					) : null}
				</div>
				{view === "Week" ? (
					<div className="fp-ts-actions">
						<span className="fp-chip-btn">
							<PlusIcon />
							Add row
						</span>
						<Play
							className="fp-chip-btn"
							disabled={weekFilled || !filled(shift(start, -7))}
							onClick={() =>
								setCopied((weeks) => [...weeks, start.toDateString()])
							}
						>
							Copy from previous week
						</Play>
					</div>
				) : null}
			</div>
		</figure>
	);
}

function RowLabel({ row }: { row: SheetRow }) {
	return (
		<div className="fp-ts-project">
			<span className="fp-project-icon">{row.icon}</span>
			<div style={{ minWidth: 0, flex: 1 }}>
				<div
					style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}
				>
					<span className="fp-ts-project-name">{row.project}</span>
					{row.source ? <SourceMark source={row.source} /> : null}
				</div>
				<div className="fp-small" style={{ fontSize: 12 }}>
					{row.task}
				</div>
			</div>
			{row.auto ? (
				<LockSimpleIcon color="var(--faint)" style={{ flex: "none" }} />
			) : null}
		</div>
	);
}

function TsWeek({ start, hours }: { start: Date; hours: Hours }) {
	const dates = DAYS.map((_, i) => shift(start, i));
	const total = (minutes: number) => (minutes ? clock(minutes) : "");
	const week = dates.reduce((sum, date) => sum + dayMinutes(hours, date), 0);
	return (
		<div className="fp-ts-scroll">
			<div className="fp-ts-grid">
				<div className="fp-ts-row fp-ts-labels">
					<span />
					{dates.map((date, i) => (
						<span key={DAYS[i]} className="fp-ts-day">
							{DAYS[i]}
							<span>{date.getDate()}</span>
						</span>
					))}
					<span className="fp-ts-day fp-ts-total">TOTAL</span>
				</div>
				{sheet.map((row) => (
					<div
						key={`${row.project}-${row.task}`}
						className="fp-ts-row"
						data-auto={row.auto ? "" : undefined}
					>
						<RowLabel row={row} />
						{dates.map((date, i) => (
							<span key={DAYS[i]} className="fm-mono fp-ts-cell">
								{hours(row, date)}
							</span>
						))}
						<span className="fm-mono fp-ts-total">
							{total(
								dates.reduce(
									(sum, date) => sum + toMinutes(hours(row, date) || "0:00"),
									0,
								),
							)}
						</span>
					</div>
				))}
				<div className="fp-ts-row fp-ts-foot">
					<span style={{ paddingLeft: 18, color: "var(--mut)" }}>Total</span>
					{dates.map((date, i) => (
						<span key={DAYS[i]} className="fm-mono fp-ts-cell">
							{total(dayMinutes(hours, date))}
						</span>
					))}
					<span
						className="fm-mono fp-ts-total"
						style={{ color: "var(--acc)", fontWeight: 500 }}
					>
						{clock(week)}
					</span>
				</div>
			</div>
		</div>
	);
}

function TsDay({
	cursor,
	hours,
	onPick,
}: {
	cursor: Date;
	hours: Hours;
	onPick: (date: Date) => void;
}) {
	const start = weekStart(cursor);
	const rows = sheet.filter((row) => hours(row, cursor));
	const weekend = dayOf(cursor) > 4;
	return (
		<div>
			<div className="fp-ts-strip">
				{DAYS.map((day, i) => {
					const date = shift(start, i);
					const minutes = dayMinutes(hours, date);
					return (
						<Play
							key={day}
							data-active={sameDay(date, cursor) ? "" : undefined}
							onClick={() => onPick(date)}
						>
							<span>
								{day} {date.getDate()}
							</span>
							<span className="fm-mono">{minutes ? clock(minutes) : "–"}</span>
						</Play>
					);
				})}
			</div>
			{rows.length ? (
				rows.map((row) => (
					<Entry
						key={`${row.project}-${row.task}`}
						entry={{ ...row, time: hours(row, cursor) }}
					/>
				))
			) : (
				<div className="fp-ts-empty">
					<CoffeeIcon weight="duotone" size={40} className="fp-acc" />
					<span className="fm-serif" style={{ fontSize: 22 }}>
						{weekend ? "Weekend." : "Nothing here yet."}
					</span>
					<span className="fp-small">
						{weekend
							? `Nothing to log on a ${format(cursor, { weekday: "long" })}.`
							: "Farmer fills this day in from your calendar and GitHub."}
					</span>
				</div>
			)}
		</div>
	);
}

function TsMonth({
	cursor,
	hours,
	onPick,
}: {
	cursor: Date;
	hours: Hours;
	onPick: (date: Date) => void;
}) {
	const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
	const length = new Date(
		cursor.getFullYear(),
		cursor.getMonth() + 1,
		0,
	).getDate();
	const dates = Array.from({ length }, (_, i) => shift(first, i));
	return (
		<div className="fp-ts-month">
			{DAYS.map((day) => (
				<span key={day} className="fp-ts-day">
					{day}
				</span>
			))}
			{dates.map((date, i) => {
				const minutes = dayMinutes(hours, date);
				return (
					<Play
						key={date.toDateString()}
						style={i === 0 ? { gridColumnStart: dayOf(date) + 1 } : undefined}
						data-today={sameDay(date, TODAY) ? "" : undefined}
						data-off={dayOf(date) > 4 ? "" : undefined}
						onClick={() => onPick(date)}
					>
						<span>{date.getDate()}</span>
						{minutes ? <span className="fm-mono">{clock(minutes)}</span> : null}
						<i style={{ height: `${Math.min(100, (minutes / 480) * 100)}%` }} />
					</Play>
				);
			})}
		</div>
	);
}

// ---- 03: The Tracking report ------------------------------------------

const tracking: {
	name: string;
	kind?: string;
	work: number;
	absence?: number;
	logged: string;
	over?: boolean;
}[] = [
	{ name: "Omar Zunic", work: 98, logged: "164.50" },
	{ name: "Marko Kovač", work: 100, logged: "176.00", over: true },
	{ name: "Iva Perić", work: 76, absence: 14, logged: "151.00" },
	{ name: "Luka Babić", kind: "Student", work: 61, logged: "51.00" },
];

/** The CSV button downloads the made-up rows of the picture. */
function downloadTracking() {
	const lines = [
		"Person,Type,Logged,Target",
		...tracking.map(
			(person) =>
				`${person.name},${person.kind ?? "Employee"},${person.logged},168.00`,
		),
	];
	const url = URL.createObjectURL(
		new Blob([`${lines.join("\n")}\n`], { type: "text/csv" }),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = "tracking-2026-06.csv";
	link.click();
	URL.revokeObjectURL(url);
}

export function TrackingMock() {
	return (
		<figure
			className="fm-frame fp-figure"
			aria-label="The Tracking report for a month, with made-up people: each one's logged hours against the month's target, split into work and absence."
		>
			<div className="fm-island fp-mock" aria-hidden>
				<div className="fp-report-head">
					<span className="fm-serif" style={{ fontSize: 22 }}>
						Tracking
					</span>
					<span className="fp-report-month">June 2026</span>
					<Play
						className="fp-chip-btn"
						style={{ marginLeft: "auto", height: "auto", padding: "5px 10px" }}
						onClick={downloadTracking}
					>
						<DownloadSimpleIcon weight="duotone" />
						CSV
					</Play>
				</div>
				<div className="fp-report-row fp-report-labels">
					<span>Person</span>
					<span>Against the 168.00 target</span>
					<span style={{ textAlign: "right" }}>Logged</span>
				</div>
				{tracking.map((person) => (
					<div key={person.name} className="fp-report-row">
						<span>
							{person.name}{" "}
							{person.kind ? (
								<span className="fp-report-kind">{person.kind}</span>
							) : null}
						</span>
						<div className="fp-report-bar">
							<span style={{ width: `${person.work}%` }} />
							{person.absence ? (
								<span style={{ width: `${person.absence}%` }} />
							) : null}
						</div>
						<span
							className="fm-mono"
							style={{
								textAlign: "right",
								color: person.over ? "var(--warn)" : undefined,
							}}
						>
							{person.logged}
						</span>
					</div>
				))}
				<div className="fp-legend">
					<span>
						<span className="fp-swatch" />
						Work
					</span>
					<span>
						<span
							className="fp-swatch"
							style={{ background: "var(--acc-mid)" }}
						/>
						Absence
					</span>
					<span style={{ color: "var(--warn)" }}>
						<ArrowUpIcon />
						Overtime
					</span>
				</div>
			</div>
		</figure>
	);
}
