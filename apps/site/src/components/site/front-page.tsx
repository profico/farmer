import {
	ArrowRightIcon,
	BellRingingIcon,
	BracketsCurlyIcon,
	CalendarCheckIcon,
	CalendarDotsIcon,
	ChatCircleDotsIcon,
	ClockIcon,
	FoldersIcon,
	FunnelIcon,
	GitPullRequestIcon,
	GithubLogoIcon,
	HourglassMediumIcon,
	IdentificationBadgeIcon,
	IslandIcon,
	PackageIcon,
	PlugsConnectedIcon,
	PlugsIcon,
	RepeatIcon,
	ScalesIcon,
	TargetIcon,
	TerminalWindowIcon,
	TimerIcon,
	TrendUpIcon,
	TruckIcon,
	UmbrellaIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import {
	CONTACT_EMAIL,
	githubLinks,
	LICENSE_NAME,
	REPOSITORY,
} from "#/lib/links.ts";
import type { ReleaseNote } from "#/lib/releases.ts";

import {
	AssembleMock,
	HomePreview,
	TimesheetMock,
	TrackingMock,
} from "./front-mocks.tsx";
import { SiteCta, SitePage } from "./site-chrome.tsx";

import "./front.css";

/** The public front page: what Farmer does, in six parts. */
export function FrontPage({
	release,
}: {
	/** The newest release note, for the pill above the headline. */
	release: ReleaseNote | null;
}) {
	const links = githubLinks(REPOSITORY);
	return (
		<SitePage>
			<Hero release={release} github={links.home} />
			<section className="fm-container" aria-label="Product preview">
				<HomePreview />
			</section>
			<Automation />
			<Timesheet />
			<Reports />
			<EverythingElse />
			<Developers />
			<SelfHosting repository={REPOSITORY} github={links.home} />
			<EarlyAccess />
		</SitePage>
	);
}

function Hero({
	release,
	github,
}: {
	release: ReleaseNote | null;
	github: string;
}) {
	return (
		<section className="fm-container fp-hero">
			{release ? (
				<Link
					to="/changelog"
					search={{ kind: release.kind }}
					className="fp-release"
				>
					<span className="fm-mono fp-release-tag">v{release.version}</span>
					Latest release note
					<ArrowRightIcon size={12} aria-hidden />
				</Link>
			) : null}
			<h1 className="fp-display">
				Do less tracking,
				<br />
				do more <em className="fm-em">doing.</em>
			</h1>
			<p className="fm-lede fp-hero-lede">
				Farmer reads your calendar and your Git history and fills in the
				timesheet for you. You check the day, fix what's off, and get back to
				work. Open source, on your own server.
			</p>
			<div className="fp-actions">
				<SiteCta />
				<Link to="/self-hosting" className="fm-btn fm-btn-outline">
					<PackageIcon weight="duotone" size={18} aria-hidden />
					Self-host it
				</Link>
				<a href={github} className="fm-btn fm-btn-outline">
					<GithubLogoIcon size={18} aria-hidden />
					Star on GitHub
				</a>
			</div>
		</section>
	);
}

function Point({
	icon: PointIcon,
	title,
	children,
}: {
	icon: Icon;
	title: string;
	children: string;
}) {
	return (
		<div className="fp-point">
			<PointIcon weight="duotone" size={24} className="fp-acc" aria-hidden />
			<div>
				<div className="fp-point-title">{title}</div>
				<div className="fp-point-body">{children}</div>
			</div>
		</div>
	);
}

function Automation() {
	return (
		<section id="features" className="fm-container fp-section">
			<div className="fp-intro">
				<h2 className="fp-h2-xl">
					Most of your day is <em className="fm-em">already written down.</em>
				</h2>
				<p className="fm-lede" style={{ maxWidth: 600 }}>
					Meetings live in the calendar. Code lives in Git. Farmer reads both,
					adds the things that happen every day, and proposes a timesheet. You
					only correct it.
				</p>
			</div>
			<div
				className="fp-split"
				style={{ marginTop: 56, alignItems: "stretch" }}
			>
				<div className="fp-points">
					<Point icon={CalendarCheckIcon} title="Google Calendar meetings">
						Accepted meetings become time entries. No typing.
					</Point>
					<Point
						icon={GitPullRequestIcon}
						title="GitHub commits and pull requests"
					>
						Grouped into work-time blocks on the right project.
					</Point>
					<Point icon={RepeatIcon} title="Recurring blocks">
						The daily stand-up fills itself in.
					</Point>
					<Point icon={FunnelIcon} title="Filing rules">
						A recurring meeting goes to the same project every time.
					</Point>
					<Point icon={HourglassMediumIcon} title="24 hours, no more">
						A day can't hold more than 24 hours. Automation respects that.
					</Point>
				</div>
				<AssembleMock />
			</div>
		</section>
	);
}

function Timesheet() {
	return (
		<section id="timesheet" className="fm-container fp-section">
			<div
				className="fp-split fp-split-sm"
				style={{ gap: "18px 48px", alignItems: "end" }}
			>
				<h2 className="fm-h2">
					A timesheet you <em className="fm-em">review,</em> not write.
				</h2>
				<div className="fm-stack" style={{ gap: 14 }}>
					<p className="fm-lede" style={{ fontSize: 17 }}>
						Day, week and month views. Every entry is a date and a duration
						under client, project and task, in 15-minute steps. Rows that
						automation made stay locked in the week; you adjust them in the day
						view.
					</p>
					<div className="fp-chips">
						<span className="fm-pill">
							<TimerIcon weight="duotone" className="fp-acc" aria-hidden />
							Stopwatch in web and CLI
						</span>
						<span className="fm-pill">
							<UmbrellaIcon weight="duotone" className="fp-acc" aria-hidden />
							Time off is just another entry
						</span>
					</div>
				</div>
			</div>
			<TimesheetMock />
			<p
				className="fm-muted"
				style={{
					margin: "20px 0 0",
					fontSize: 15,
					maxWidth: 640,
					textWrap: "pretty",
				}}
			>
				Vacation, sick leave and paid leave are ordinary entries against
				built-in tasks, so absence reports come from the same data as work.
			</p>
		</section>
	);
}

const reportKinds: { icon: Icon; label: string }[] = [
	{ icon: ClockIcon, label: "Time" },
	{ icon: TrendUpIcon, label: "Overtime" },
	{ icon: TargetIcon, label: "Tracking" },
	{ icon: IslandIcon, label: "Absence" },
];

function Reports() {
	return (
		<section
			className="fm-container fp-section fp-split fp-split-sm"
			style={{ alignItems: "center" }}
		>
			<div className="fm-stack" style={{ gap: 18 }}>
				<h2 className="fm-h2">
					Month-end is <em className="fm-em">a CSV away.</em>
				</h2>
				<p className="fm-lede" style={{ fontSize: 17 }}>
					Time by client, project or teammate. Overtime. Tracking, which is
					logged time against the month's target. Absence. Pick a week, month,
					quarter, year or any range, then export.
				</p>
				<div className="fm-cells fp-report-kinds">
					{reportKinds.map(({ icon: KindIcon, label }) => (
						<div key={label}>
							<KindIcon weight="duotone" className="fp-acc" aria-hidden />
							{label}
						</div>
					))}
				</div>
			</div>
			<TrackingMock />
		</section>
	);
}

const features: { icon: Icon; title: string; body: string }[] = [
	{
		icon: CalendarDotsIcon,
		title: "Hours",
		body: "A monthly hour fund, public holidays for your country, and working hours per person.",
	},
	{
		icon: IdentificationBadgeIcon,
		title: "People",
		body: "Employees, students and contractors. Billable, overhead or hourly. Admins, Team Leads, PMs and per-project roles.",
	},
	{
		icon: FoldersIcon,
		title: "Projects",
		body: "A page per project with its hours, team and settings. Emoji or your own icon.",
	},
	{
		icon: BellRingingIcon,
		title: "Reminders",
		body: "Slack DMs, a month-end nudge and an admin digest. Web push if you prefer the browser.",
	},
	{
		icon: PlugsConnectedIcon,
		title: "Integrations",
		body: "A GitHub App per organization, Google Calendar per person, Slack per organization, and outbound webhooks.",
	},
	{
		icon: TruckIcon,
		title: "Moving from Harvest",
		body: "Drop your Harvest CSV exports in Settings. Importing the same files twice changes nothing, and the last run can be undone.",
	},
];

function EverythingElse() {
	return (
		<section className="fm-container fp-section">
			<h2 className="fm-h2" style={{ maxWidth: 640 }}>
				Hours, people, projects <em className="fm-em">and the reminders.</em>
			</h2>
			<div className="fm-cells fp-features">
				{features.map(({ icon: FeatureIcon, title, body }) => (
					<div key={title} className="fp-feature">
						<FeatureIcon
							weight="duotone"
							size={26}
							className="fp-acc"
							aria-hidden
						/>
						<h3 className="fp-feature-title fm-serif" style={{ margin: 0 }}>
							{title}
						</h3>
						<p>{body}</p>
					</div>
				))}
			</div>
		</section>
	);
}

function Developers() {
	return (
		// `data-header-ink`: the site header turns ink while it floats over this.
		<section className="fp-ink" data-header-ink>
			<div className="fm-container fp-ink-inner">
				<div className="fp-intro" style={{ maxWidth: 720 }}>
					<h2 className="fp-h2-xl">
						Your timesheet, <em className="fm-em">from the terminal.</em>
					</h2>
					<p className="fm-lede fp-ink-mut">
						A CLI, a REST API, an MCP server and an assistant, all acting as you
						and nothing more. Each can be switched off per deployment.
					</p>
				</div>
				<div className="fp-dev-grid">
					<div className="fp-terminal">
						<div className="fp-terminal-bar">
							<TerminalWindowIcon weight="duotone" size={16} aria-hidden />
							CLI
							<span className="fm-mono" style={{ marginLeft: "auto" }}>
								zsh
							</span>
						</div>
						{/* An illustration, not output: the addresses are Profico's own
						    instance and the entries are made up. */}
						<pre>
							<span className="fp-ink-mut">$</span> curl -fsSL
							https://farmer.profi.co/cli | sh{"\n"}
							<span className="fp-ink-mut">$</span> farmer login{"\n"}
							<span className="fp-ink-mut">
								{"  "}Open farmer.profi.co/device and enter
							</span>{" "}
							<span className="fp-ink-acc">WDJB-MJHT</span>
							{"\n"}
							<span className="fp-ink-ok">
								{"  "}✓ Signed in as person@example.com · Profico
							</span>
							{"\n"}
							<span className="fp-ink-mut">$</span> farmer start "Code review"
							-p harbor-app{"\n"}
							<span className="fp-ink-acc">{"  "}● Timer running</span>
							<span className="fp-ink-mut"> · Harbor App › Development</span>
							{"\n"}
							<span className="fp-ink-mut">$</span> farmer today{"\n"}
							<span className="fp-ink-mut">
								{"  Design review    Acme Rebrand › Meetings   "}
							</span>{" "}
							1:00{"\n"}
							<span className="fp-ink-mut">
								{"  Auth refactor    Harbor App › Development  "}
							</span>{" "}
							2:30{"\n"}
							<span className="fp-ink-mut">
								{"  Sprint planning  Internal › Planning       "}
							</span>{" "}
							1:30{"\n"}
							<span className="fp-ink-mut">
								{"                                       total"}
							</span>
							{"  "}
							<span className="fp-ink-acc">5:00</span>
						</pre>
					</div>
					<div className="fp-dev-side">
						<div className="fp-ink-card">
							<div className="fp-ink-card-title">
								<PlugsIcon
									weight="duotone"
									size={20}
									className="fp-ink-acc"
									aria-hidden
								/>
								<h3 className="fm-serif" style={{ margin: 0, fontSize: 24 }}>
									MCP server
								</h3>
								<span
									className="fm-mono fp-ink-mut"
									style={{ marginLeft: "auto", fontSize: 12 }}
								>
									/api/mcp/&lt;org-slug&gt;
								</span>
							</div>
							<p>The same tools for Claude Code or any MCP client.</p>
							<pre className="fp-ink-snippet">
								<span className="fp-ink-mut">&gt;</span> log 2h yesterday on
								Harbor App, code review{"\n"}
								<span className="fp-ink-acc">⏺ farmer.create_time_entry</span>
								<span className="fp-ink-mut">
									(date: "2026-07-08", durationSeconds: 7200)
								</span>
								{"\n"}
								<span className="fp-ink-ok">
									{"  "}Logged 2:00 · Tue, Jul 8
								</span>
							</pre>
						</div>
						<div className="fp-ink-card">
							<div className="fp-ink-card-title">
								<ChatCircleDotsIcon
									weight="duotone"
									size={20}
									className="fp-ink-acc"
									aria-hidden
								/>
								<h3 className="fm-serif" style={{ margin: 0, fontSize: 24 }}>
									Assistant
								</h3>
							</div>
							<div className="fp-bubble">
								How much went into Acme Rebrand in June?
							</div>
							<div className="fp-answer">
								<span className="fm-mono fp-ink-acc">142.50</span> across 6
								people. Design <span className="fm-mono">61.00</span>,
								development <span className="fm-mono">43.00</span>, meetings{" "}
								<span className="fm-mono">38.50</span>.
							</div>
							<p className="fp-ink-note">
								Runs on your organization's OpenRouter key. It can do only what
								the person asking can do.
							</p>
						</div>
					</div>
				</div>
				<a href="/api-docs" className="fp-rest">
					<span
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 8,
							color: "var(--ink-fg)",
						}}
					>
						<BracketsCurlyIcon
							weight="duotone"
							size={18}
							className="fp-ink-acc"
							aria-hidden
						/>
						REST API
					</span>
					<code>POST /api/v1/orgs/acme/time-entries</code>
					<span className="fp-rest-more">
						Everything the CLI does. Read the API docs
						<ArrowRightIcon size={14} aria-hidden />
					</span>
				</a>
			</div>
		</section>
	);
}

function SelfHosting({
	repository,
	github,
}: {
	repository: string;
	github: string;
}) {
	// The image CI publishes: `ghcr.io/${{ github.repository }}`, which GHCR
	// stores lowercased. A fork's front page names the fork's image.
	const image = `ghcr.io/${repository.toLowerCase()}`;
	return (
		<section className="fm-container fp-section">
			<h2 className="fp-h2-xl" style={{ marginBottom: 40 }}>
				Built in the open. <em className="fm-em">Yours to run.</em>
			</h2>
			<div className="fp-split" style={{ alignItems: "start" }}>
				<div className="fm-stack" style={{ gap: 18 }}>
					<p className="fm-lede" style={{ fontSize: 17 }}>
						One Docker image. Postgres is the only dependency. Three environment
						variables to start, and an administrator sets up the rest from
						inside the app.
					</p>
					<div className="fp-license">
						<ScalesIcon
							weight="duotone"
							size={24}
							className="fp-acc"
							aria-hidden
						/>
						<div>
							<div style={{ fontWeight: 600 }}>{LICENSE_NAME}</div>
							<div className="fm-muted" style={{ fontSize: 15 }}>
								Free to use, change and self-host. Changes to a hosted version
								must stay open.
							</div>
						</div>
					</div>
					<div className="fp-host-actions">
						<Link to="/self-hosting" className="fm-btn">
							Install guide
							<ArrowRightIcon size={16} aria-hidden />
						</Link>
						<a href={github} className="fm-btn fm-btn-outline">
							<GithubLogoIcon size={18} aria-hidden />
							View on GitHub
						</a>
					</div>
				</div>
				<div className="fm-stack" style={{ gap: 12 }}>
					<div className="fm-codeblock fp-codeblock">
						<div className="fm-codeblock-bar">
							<span className="fm-mono">docker</span>
						</div>
						<pre>
							docker run -d -p 3000:3000 \{"\n"}
							{"  "}-e <span className="fm-var">DATABASE_URL</span>
							=postgres://… \{"\n"}
							{"  "}-e <span className="fm-var">BETTER_AUTH_SECRET</span>=… \
							{"\n"}
							{"  "}-e <span className="fm-var">BETTER_AUTH_URL</span>
							=https://time.example.com \{"\n"}
							{"  "}
							{image}
						</pre>
					</div>
					<div className="fm-cells fp-stats">
						<div>
							<div className="fp-small">Required</div>
							<div className="fm-mono fp-stat-value">3 env vars</div>
						</div>
						<div>
							<div className="fp-small">Depends on</div>
							<div className="fm-mono fp-stat-value">Postgres</div>
						</div>
						<div>
							<div className="fp-small">Sign-in</div>
							<div style={{ fontSize: 14, marginTop: 4 }}>
								Google or any OIDC
							</div>
						</div>
					</div>
					<p
						className="fm-muted"
						style={{ margin: "4px 0 0", fontSize: 14, textWrap: "pretty" }}
					>
						Single-organization mode gives you one invite-only workspace with
						your own logo on the sign-in page. Light and dark themes, a custom
						accent and high contrast come built in.
					</p>
				</div>
			</div>
		</section>
	);
}

function EarlyAccess() {
	return (
		<section className="fm-container fp-section fp-bottom">
			<div className="fp-early">
				<div className="fm-stack" style={{ gap: 14 }}>
					<h2
						className="fm-h2"
						style={{ fontSize: "clamp(36px, 4.4vw, 56px)" }}
					>
						Rather not run <em className="fm-em">a server?</em>
					</h2>
					<p className="fm-lede" style={{ fontSize: 17, maxWidth: 480 }}>
						We're preparing a hosted Farmer, run by Profico. There are no plans
						or prices yet. Join the list and we'll write when there's something
						to try.
					</p>
				</div>
				<div className="fp-early-actions">
					<Link to="/early-access" className="fm-btn">
						Get early access
						<ArrowRightIcon size={16} aria-hidden />
					</Link>
					<a href={`mailto:${CONTACT_EMAIL}`} className="fm-btn fm-btn-outline">
						Talk to us
					</a>
				</div>
			</div>
		</section>
	);
}
