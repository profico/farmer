import {
	ArrowLeftIcon,
	ArrowRightIcon,
	ArrowUpIcon,
	CalendarBlankIcon,
	CaretDoubleLeftIcon,
	ChartLineIcon,
	CheckIcon,
	ClockIcon,
	DownloadSimpleIcon,
	FolderSimpleIcon,
	GearSixIcon,
	GitCommitIcon,
	GithubLogoIcon,
	GitPullRequestIcon,
	LockSimpleIcon,
	MagicWandIcon,
	PlusIcon,
	SparkleIcon,
	SquaresFourIcon,
	UmbrellaIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

/*
 * The product mock-ups the front page draws: the home screen in the hero
 * window, "Assemble my day", the week timesheet and the Tracking report.
 *
 * Every figure, person and project here is made up. They are pictures of the
 * product, so each one is a labelled `<figure>` whose drawing is `aria-hidden`, and nothing
 * inside is focusable — a screen reader hears what the picture shows rather
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

function Entry({ entry, dashed }: { entry: MockEntry; dashed?: boolean }) {
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
			<span className="fm-mono fp-entry-time">{entry.time}</span>
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
	{ ...INTERNAL, task: "Planning", time: "1:45", source: { kind: "fill" } },
];

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export function HomePreview() {
	return (
		<figure
			className="fp-window fp-figure"
			aria-label="The Farmer home screen, with made-up entries: today's time filled in from a calendar and from GitHub, and the week so far."
		>
			<div className="fp-window-bar" aria-hidden>
				<span className="fp-window-dot" />
				<span className="fp-window-dot" />
				<span className="fp-window-dot" />
				<span className="fm-mono fp-window-url">farmer.profi.co</span>
			</div>
			<div className="fp-window-body fp-mock" aria-hidden>
				<aside className="fp-sidebar fm-sm-hide">
					<span className="fp-sidebar-org">P</span>
					<span className="fp-sidebar-icon" data-active>
						<SquaresFourIcon weight="duotone" size={19} />
					</span>
					<span className="fp-sidebar-icon">
						<ClockIcon weight="duotone" size={19} />
					</span>
					<span className="fp-sidebar-icon">
						<FolderSimpleIcon weight="duotone" size={19} />
					</span>
					<span className="fp-sidebar-icon">
						<ChartLineIcon weight="duotone" size={19} />
					</span>
					<span className="fp-sidebar-icon">
						<GearSixIcon weight="duotone" size={19} />
					</span>
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
				<div className="fp-page">
					<div className="fp-page-head">
						<div style={{ flex: 1, minWidth: 200 }}>
							<div className="fm-eyebrow">Tue, Jul 8, 2026</div>
							<div className="fp-greeting">Good morning, Omar</div>
						</div>
						<span className="fp-chip-btn">
							<SparkleIcon weight="duotone" />
							Assemble my day
						</span>
						<span className="fp-chip-btn fp-chip-btn-acc">
							<PlusIcon />
							Log time
						</span>
					</div>
					<div className="fp-metrics">
						<Metric
							label="Today"
							value="6.50"
							of="8.00"
							sub="1.50 to go"
							percent={81}
						/>
						<Metric
							label="This week"
							value="14.50"
							of="40.00"
							sub="25.50 to go"
							percent={36}
						/>
						<Metric
							label="This month"
							value="38.00"
							of="184.00"
							sub="day 6 of 23"
							percent={21}
						/>
					</div>
					<div style={{ display: "flex", flexWrap: "wrap" }}>
						<div style={{ flex: "1.7 1 360px", minWidth: 0 }}>
							<div className="fp-list-head">
								<span className="fm-eyebrow">Today's entries</span>
								<span className="fp-small" style={{ marginLeft: "auto" }}>
									<span className="fm-mono">6:30</span> logged
								</span>
							</div>
							{todayEntries.map((entry) => (
								<Entry key={`${entry.project}-${entry.task}`} entry={entry} />
							))}
						</div>
						<div className="fp-week">
							<div style={{ display: "flex", alignItems: "center" }}>
								<span className="fm-eyebrow">This week by day</span>
								<span
									className="fm-mono"
									style={{ marginLeft: "auto", fontSize: 13 }}
								>
									14.50
								</span>
							</div>
							<div className="fp-week-plot">
								<div className="fp-week-target" />
								<div className="fp-week-cols">
									<div className="fp-week-bar" style={{ height: "100%" }} />
									<div
										className="fp-week-bar"
										data-today
										style={{ height: "81%" }}
									/>
								</div>
							</div>
							<div className="fp-week-days">
								{DAYS.map((day, i) => (
									<span
										key={day}
										style={i === 1 ? { color: "var(--acc)" } : undefined}
									>
										{day}
									</span>
								))}
							</div>
							<div className="fp-week-hours fm-mono">
								<span>8.00</span>
								<span className="fp-under">6.50</span>
								<span>–</span>
								<span>–</span>
								<span>–</span>
								<span>–</span>
								<span>–</span>
							</div>
							<span className="fp-link">
								Open the timesheet <ArrowRightIcon />
							</span>
						</div>
					</div>
				</div>
			</div>
		</figure>
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

export function AssembleMock() {
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
							Wed, Jul 9 · proposed from 3 sources
						</div>
					</div>
					<span
						className="fm-mono"
						style={{ fontSize: 18, color: "var(--acc)" }}
					>
						7.75
					</span>
				</div>
				{proposed.map((entry) => (
					<Entry
						key={`${entry.project}-${entry.task}-${entry.note}`}
						entry={entry}
						dashed
					/>
				))}
				<div className="fp-mock-foot">
					<span className="fp-small" style={{ flex: 1, minWidth: 180 }}>
						Nothing is written until you accept.
					</span>
					<span className="fp-chip-btn">Edit</span>
					<span
						className="fp-chip-btn fp-chip-btn-acc"
						style={{ fontWeight: 500 }}
					>
						<CheckIcon />
						Accept day
					</span>
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
	total: string;
	/** Made by automation: locked in the week, edited in the day view. */
	auto?: boolean;
	source?: Source;
};

const sheet: SheetRow[] = [
	{
		...ACME,
		task: "Design",
		hours: ["2:00", "3:30", "1:00", "4:00", "", "", ""],
		total: "10:30",
	},
	{
		...HARBOR,
		task: "Development",
		hours: ["4:30", "2:30", "5:00", "3:00", "5:15", "", ""],
		total: "20:15",
	},
	{
		...ACME,
		task: "Meetings",
		hours: ["1:00", "1:00", "", "1:00", "", "", ""],
		total: "3:00",
		auto: true,
		source: { kind: "calendar" },
	},
	{
		...INTERNAL,
		task: "Meetings · daily stand-up",
		hours: ["0:15", "0:15", "0:15", "0:15", "0:15", "", ""],
		total: "1:15",
		auto: true,
	},
	{
		...INTERNAL,
		task: "Planning",
		hours: ["", "1:00", "1:45", "", "0:30", "", ""],
		total: "3:15",
		auto: true,
		source: { kind: "fill" },
	},
];

const sheetTotals = ["7:45", "8:15", "8:00", "8:15", "6:00", "", ""];

export function TimesheetMock() {
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
						<span>Day</span>
						<span data-active>Week</span>
						<span>Month</span>
					</span>
				</div>
				<div className="fp-metrics fp-ts-metrics">
					<Metric
						label="This week"
						status="Behind"
						value="38.25"
						of="40.00"
						sub={
							<>
								<span style={{ color: "var(--bad)" }}>1.75 short</span> of
								today's 40.00
							</>
						}
						percent={96}
					/>
					<Metric
						label="This month"
						value="62.25"
						of="184.00"
						sub="day 9 of 23"
						percent={34}
					/>
				</div>
				<div className="fp-ts-tools">
					<span className="fp-ts-add">
						<PlusIcon />
					</span>
					<span className="fp-ts-range">
						<span>
							<ArrowLeftIcon />
						</span>
						<span className="fp-ts-range-label">
							<CalendarBlankIcon weight="duotone" color="var(--mut)" />
							July 7 – 13, 2026
						</span>
						<span>
							<ArrowRightIcon />
						</span>
					</span>
					<span className="fp-chip-btn" style={{ marginLeft: "auto" }}>
						<UmbrellaIcon weight="duotone" />
						Time off
					</span>
				</div>
				<div className="fp-ts-scroll">
					<div className="fp-ts-grid">
						<div className="fp-ts-row fp-ts-labels">
							<span />
							{DAYS.map((day, i) => (
								<span key={day} className="fp-ts-day">
									{day}
									<span>{7 + i}</span>
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
								<div className="fp-ts-project">
									<span className="fp-project-icon">{row.icon}</span>
									<div style={{ minWidth: 0, flex: 1 }}>
										<div
											style={{
												display: "flex",
												alignItems: "center",
												gap: 6,
												minWidth: 0,
											}}
										>
											<span className="fp-ts-project-name">{row.project}</span>
											{row.source ? <SourceMark source={row.source} /> : null}
										</div>
										<div className="fp-small" style={{ fontSize: 12 }}>
											{row.task}
										</div>
									</div>
									{row.auto ? (
										<LockSimpleIcon
											color="var(--faint)"
											style={{ flex: "none" }}
										/>
									) : null}
								</div>
								{row.hours.map((value, i) => (
									<span key={DAYS[i]} className="fm-mono fp-ts-cell">
										{value}
									</span>
								))}
								<span className="fm-mono fp-ts-total">{row.total}</span>
							</div>
						))}
						<div className="fp-ts-row fp-ts-foot">
							<span style={{ paddingLeft: 18, color: "var(--mut)" }}>
								Total
							</span>
							{sheetTotals.map((value, i) => (
								<span key={DAYS[i]} className="fm-mono fp-ts-cell">
									{value}
								</span>
							))}
							<span
								className="fm-mono fp-ts-total"
								style={{ color: "var(--acc)", fontWeight: 500 }}
							>
								38:15
							</span>
						</div>
					</div>
				</div>
				<div className="fp-ts-actions">
					<span className="fp-chip-btn">
						<PlusIcon />
						Add row
					</span>
					<span className="fp-chip-btn">Copy from previous week</span>
				</div>
			</div>
		</figure>
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
					<span
						className="fp-chip-btn"
						style={{ marginLeft: "auto", height: "auto", padding: "5px 10px" }}
					>
						<DownloadSimpleIcon weight="duotone" />
						CSV
					</span>
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
