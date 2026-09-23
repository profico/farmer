import {
	ArrowRightIcon,
	ArrowUpRightIcon,
	CalendarBlankIcon,
	CalendarDotsIcon,
	CaretUpDownIcon,
	ChartLineIcon,
	ClockIcon,
	FolderSimpleIcon,
	GitBranchIcon,
	GitCommitIcon,
	PlusIcon,
	SignOutIcon,
	SparkleIcon,
	SquaresFourIcon,
	UsersIcon,
} from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { FarmerLogo } from "#/components/farmer-logo.tsx";
import { githubLinks } from "#/lib/links.ts";
import { getSession } from "#/server/auth.ts";
import { getPublicAppConfig } from "#/server/config.ts";
import { getDefaultOrgSlugForSession } from "#/server/organization.ts";

// Marketing-only styles, every rule scoped under `.fm-landing`. See the header
// of that file for why it is a stylesheet rather than the inline <style> it was.
import "./landing.css";

export const Route = createFileRoute("/")({
	// Public homepage — rendered for everyone, signed in or not, in every mode.
	// It never redirects. Single-org mode used to bounce every visitor straight
	// through to the workspace (and, signed out, on to `/login` and from there to
	// Google), which meant a deployment had no reachable front door at all: no
	// address you could type to get a page instead of a round trip, and nowhere
	// for a sign-in screen offering anything other than Google to live.
	//
	// So the loader resolves who the viewer is and lets the CTAs say it: their
	// workspace when they have one, `/no-access` when they are signed in without
	// a membership (invitation revoked, or an account predating single-org mode),
	// and `/login` when they are not signed in.
	loader: async (): Promise<{
		orgSlug: string | null;
		signedIn: boolean;
		/** `owner/name`, for the "View on GitHub" links. A fork links to itself. */
		repository: string;
	}> => {
		const [session, config] = await Promise.all([
			getSession(),
			getPublicAppConfig(),
		]);
		const { repository } = config;
		if (!session) return { orgSlug: null, signedIn: false, repository };
		// Server fn resolves userId/activeOrganizationId from the session itself —
		// it no longer accepts a client-supplied identity.
		const orgSlug = await getDefaultOrgSlugForSession();
		return { orgSlug, signedIn: true, repository };
	},
	component: Home,
});

const PROFICO_URL = "https://profi.co";

// The page's one CTA, in the product's own button: straight into the viewer's
// workspace when they have an org, otherwise to login. Rendered identically in
// the header and in the body — same component, same class, same label — so the
// action never changes shape as you scroll past it.
function DashButton({
	orgSlug,
	signedIn,
	className = "fm-btn",
}: {
	orgSlug: string | null;
	// Signed in with no workspace is its own destination, not "log in again":
	// `/no-access` is the screen that explains why and lists any live
	// invitations. Sending them to `/login` would hand them a Google button that
	// signs them into the account they are already in and returns them here.
	signedIn: boolean;
	className?: string;
}) {
	const label = orgSlug ? "Open dashboard" : signedIn ? "Continue" : "Log in";
	const content = (
		<>
			{label}
			<ArrowRightIcon weight="regular" size={15} data-icon="inline-end" />
		</>
	);
	if (orgSlug) {
		return (
			<Link className={className} to="/$orgSlug" params={{ orgSlug }}>
				{content}
			</Link>
		);
	}
	return (
		<Link className={className} to={signedIn ? "/no-access" : "/login"}>
			{content}
		</Link>
	);
}

// ---- App-preview mock data -------------------------------------------------

type PreviewNavItem = {
	Icon: typeof SquaresFourIcon;
	label: string;
	active?: boolean;
};

// Mirrors the real sidebar's three groups (lib/nav-items.ts): Work, You and
// Manage. It used to show the old Workspace/Admin split, which no longer exists.
const previewNavGroups: { label: string; items: PreviewNavItem[] }[] = [
	{
		label: "Work",
		items: [
			{ Icon: SquaresFourIcon, label: "Home", active: true },
			{ Icon: ClockIcon, label: "Time" },
			{ Icon: FolderSimpleIcon, label: "Projects" },
		],
	},
	{
		label: "You",
		items: [{ Icon: CalendarDotsIcon, label: "My schedule" }],
	},
	{
		label: "Manage",
		items: [
			{ Icon: ChartLineIcon, label: "Reports" },
			{ Icon: UsersIcon, label: "People" },
		],
	},
];

const previewWeek = [
	{ d: "Mon", px: 22 },
	{ d: "Tue", px: 34, today: true },
	{ d: "Wed", px: 27 },
	{ d: "Thu", px: 31 },
	{ d: "Fri", px: 19 },
	{ d: "Sat", px: 2 },
	{ d: "Sun", px: 2 },
];

const autoTracked = [
	{
		Icon: CalendarBlankIcon,
		title: "2 meetings synced",
		sub: "Google Calendar",
		hours: "3.0h",
	},
	{
		Icon: GitCommitIcon,
		title: "12 commits",
		sub: "across 3 blocks",
		hours: "2.5h",
	},
];

const recentEntries = [
	{
		dot: "var(--chart-2)",
		title: "Design review",
		sub: "Acme Rebrand · Meetings",
		badge: { Icon: CalendarBlankIcon, text: "Synced" },
		hours: "1.0h",
	},
	{
		dot: "var(--warn)",
		title: "Auth refactor",
		sub: "Harbor App · Development",
		badge: { Icon: GitCommitIcon, text: "12" },
		hours: "2.5h",
	},
	{
		dot: "var(--chart-5)",
		title: "Sprint planning",
		sub: "Internal · Planning",
		badge: null,
		hours: "1.5h",
	},
];

function Home() {
	const { orgSlug, signedIn, repository } = Route.useLoaderData();
	const githubUrl = githubLinks(repository).home;
	return (
		// No <MotionConfig> here: `__root.tsx` already wraps the whole app in an
		// identical one, and this route holds no `motion.*` element for it to
		// configure. It only cost the landing page — which should be the cheapest
		// and most cacheable in the app — a Motion import.
		<div className="fm-landing">
			{/* ============ HEADER ============ */}
			{/* Painted with the page's own paper rather than a translucent wash of
				    a slightly different white — the tint used to show as a seam across
				    the top of the hero the moment anything scrolled under it. */}
			<header
				style={{
					position: "sticky",
					top: 0,
					zIndex: 50,
					background: "var(--bg)",
				}}
			>
				<div
					className="fm-header-inner"
					style={{
						maxWidth: "1140px",
						margin: "0 auto",
						padding: "16px 40px",
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					<a href="#top" style={{ display: "block", color: "var(--fg)" }}>
						<FarmerLogo height={30} />
					</a>
					<div
						className="fm-nav"
						style={{
							display: "flex",
							alignItems: "center",
							gap: "26px",
							fontSize: "14px",
							fontWeight: 500,
						}}
					>
						<a
							className="u-link fm-nav-section"
							href="#opensource"
							style={{ color: "var(--mut)" }}
						>
							Open source
						</a>
						<DashButton orgSlug={orgSlug} signedIn={signedIn} />
					</div>
				</div>
			</header>

			{/* ============ HERO ============ */}
			<section
				id="top"
				className="fm-hero"
				style={{
					maxWidth: "1140px",
					margin: "0 auto",
					padding: "74px 40px 34px",
					textAlign: "center",
				}}
			>
				<h1
					className="fm-serif fm-hero-title"
					style={{
						margin: "0 auto",
						maxWidth: "840px",
						fontSize: "80px",
						lineHeight: 0.98,
						letterSpacing: "-.015em",
						textWrap: "balance",
					}}
				>
					Do less tracking,
					<br />
					do more{" "}
					<span style={{ fontStyle: "italic", color: "var(--acc)" }}>
						doing.
					</span>
				</h1>
				<p
					className="fm-hero-sub"
					style={{
						margin: "24px auto 0",
						maxWidth: "540px",
						fontSize: "17px",
						lineHeight: 1.6,
						color: "var(--mut)",
					}}
				>
					Farmer is calendar-first time tracking that logs your meetings from
					Google Calendar and your commits from GitHub — automatically. Spend
					your attention on the work, not the timesheet.
				</p>
				<div
					className="fm-hero-cta"
					style={{
						display: "flex",
						justifyContent: "center",
						alignItems: "center",
						gap: "10px",
						marginTop: "30px",
					}}
				>
					<DashButton orgSlug={orgSlug} signedIn={signedIn} />
					<a className="fm-btn fm-btn-outline" href={githubUrl}>
						<GitBranchIcon size={15} data-icon="inline-start" />
						Star on GitHub
					</a>
				</div>
			</section>

			{/* ============ APP WINDOW ============ */}
			{/* A facsimile of the real product, drawn against the app's own tokens:
				    the ground with two islands standing on it — the sidebar and the
				    page — separated by the gap rather than by a border, captions in the
				    faint uppercase eyebrow, and every figure in the mono face. The app
				    names things in the serif and measures them in mono; so does this. */}
			<section
				id="features"
				className="fm-appwindow-section"
				style={{
					maxWidth: "1140px",
					margin: "22px auto 0",
					padding: "0 40px",
				}}
			>
				<div
					style={{
						borderRadius: "16px",
						overflow: "hidden",
						border: "1px solid var(--line)",
						background: "var(--ground)",
						boxShadow: "var(--fm-shadow-window)",
					}}
				>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "12px",
							padding: "11px 16px",
							borderBottom: "1px solid var(--line2)",
						}}
					>
						<div style={{ display: "flex", gap: "6px" }}>
							<span
								style={{
									width: "10px",
									height: "10px",
									borderRadius: "50%",
									background: "var(--line)",
								}}
							/>
							<span
								style={{
									width: "10px",
									height: "10px",
									borderRadius: "50%",
									background: "var(--line)",
								}}
							/>
							<span
								style={{
									width: "10px",
									height: "10px",
									borderRadius: "50%",
									background: "var(--line)",
								}}
							/>
						</div>
						<div
							className="fm-mono"
							style={{
								flex: 1,
								textAlign: "center",
								fontSize: "12px",
								color: "var(--mut)",
							}}
						>
							farmer.profi.co
						</div>
					</div>
					{/* The frame: ground, with the two islands floating in it. */}
					<div
						className="fm-preview-body"
						style={{
							display: "flex",
							gap: "10px",
							padding: "10px",
							// Tall enough for the summary column's natural height: the
							// island clips, so a few pixels short silently cropped the
							// last auto-tracked row.
							height: "492px",
						}}
					>
						<aside
							className="fm-preview-sidebar"
							style={{
								width: "186px",
								flex: "none",
								background: "var(--bg)",
								borderRadius: "12px",
								overflow: "hidden",
								display: "flex",
								flexDirection: "column",
							}}
						>
							<div style={{ padding: "7px" }}>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: "7px",
										padding: "5px 6px",
										borderRadius: "8px",
									}}
								>
									<span
										style={{
											width: "19px",
											height: "19px",
											borderRadius: "4px",
											background: "var(--acc)",
											color: "var(--bg)",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											fontSize: "9.5px",
											fontWeight: 500,
											flex: "none",
										}}
									>
										P
									</span>
									<span
										style={{ flex: 1, fontSize: "11.5px", fontWeight: 500 }}
									>
										Profico
									</span>
									<CaretUpDownIcon
										weight="regular"
										size={11}
										color="var(--mut)"
									/>
								</div>
							</div>
							<div
								style={{
									padding: "0 7px",
									display: "flex",
									flexDirection: "column",
									gap: "7px",
								}}
							>
								{previewNavGroups.map((group) => (
									<div key={group.label}>
										<div
											className="fm-eyebrow"
											style={{
												display: "flex",
												alignItems: "center",
												height: "20px",
												padding: "0 6px",
											}}
										>
											{group.label}
										</div>
										{group.items.map(({ Icon, label, active }) => (
											<span
												key={label}
												style={{
													display: "flex",
													alignItems: "center",
													gap: "8px",
													padding: "5px 7px",
													borderRadius: "8px",
													fontSize: "12px",
													fontWeight: active ? 500 : 400,
													color: active ? "var(--fg)" : "var(--mut)",
													background: active ? "var(--sel)" : undefined,
													boxShadow: active
														? "var(--fm-shadow-chip)"
														: undefined,
												}}
											>
												<Icon size={14} />
												{label}
											</span>
										))}
									</div>
								))}
							</div>
							<div
								style={{
									marginTop: "auto",
									display: "flex",
									alignItems: "center",
									gap: "8px",
									padding: "10px 11px",
									borderTop: "1px solid var(--line)",
								}}
							>
								<span
									style={{
										width: "20px",
										height: "20px",
										borderRadius: "50%",
										background: "color-mix(in srgb, var(--fg) 8%, transparent)",
										color: "var(--mut)",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										fontSize: "9px",
										fontWeight: 500,
										flex: "none",
									}}
								>
									AH
								</span>
								<span style={{ flex: 1, fontSize: "11px", fontWeight: 500 }}>
									Ana Horvat
								</span>
								<SignOutIcon weight="regular" size={12} color="var(--faint)" />
							</div>
						</aside>
						{/* The page island — a facsimile of $orgSlug/index.tsx. */}
						<main
							style={{
								flex: 1,
								minWidth: 0,
								background: "var(--bg)",
								borderRadius: "12px",
								overflow: "hidden",
								display: "flex",
								flexDirection: "column",
							}}
						>
							<div style={{ padding: "15px 20px 14px" }}>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										gap: "12px",
									}}
								>
									<div
										className="fm-eyebrow"
										style={{ letterSpacing: ".14em" }}
									>
										Tue, Jul 8 · 3h logged
									</div>
									<span
										style={{
											display: "inline-flex",
											alignItems: "center",
											gap: "4px",
											height: "21px",
											padding: "0 7px 0 8px",
											borderRadius: "4px",
											background: "var(--acc)",
											color: "var(--bg)",
											fontSize: "10.5px",
											fontWeight: 500,
											flex: "none",
										}}
									>
										<PlusIcon weight="regular" size={11} />
										Add block
									</span>
								</div>
								<div
									className="fm-serif"
									style={{
										marginTop: "11px",
										fontSize: "24px",
										lineHeight: 1.1,
									}}
								>
									Good morning, Ana
								</div>
							</div>
							<div
								className="fm-preview-split"
								style={{
									display: "flex",
									flex: 1,
									minHeight: 0,
									borderTop: "1px solid var(--line)",
									borderBottom: "1px solid var(--line)",
								}}
							>
								<div
									className="fm-preview-col"
									style={{
										width: "53%",
										flex: "none",
										borderRight: "1px solid var(--line)",
									}}
								>
									{/* The two figures, mono over an eyebrow — the app's Metric. */}
									<div
										style={{
											display: "grid",
											gridTemplateColumns: "1fr 1fr",
											borderBottom: "1px solid var(--line)",
										}}
									>
										<div
											style={{
												padding: "12px 16px",
												borderRight: "1px solid var(--line)",
											}}
										>
											<div
												className="fm-mono"
												style={{
													fontSize: "22px",
													lineHeight: 1,
													letterSpacing: "-.04em",
													color: "var(--acc)",
												}}
											>
												3.0h
											</div>
											<div
												className="fm-eyebrow"
												style={{ marginTop: "9px", color: "var(--mut)" }}
											>
												Logged today
											</div>
										</div>
										<div style={{ padding: "12px 16px" }}>
											<div
												className="fm-mono"
												style={{
													fontSize: "22px",
													lineHeight: 1,
													letterSpacing: "-.04em",
												}}
											>
												37.5h
											</div>
											<div
												className="fm-eyebrow"
												style={{ marginTop: "9px", color: "var(--mut)" }}
											>
												This week
											</div>
										</div>
									</div>
									{/* The app's one progress rail: 2px, hairline ground, accent fill. */}
									<div
										style={{
											padding: "11px 16px",
											borderBottom: "1px solid var(--line)",
										}}
									>
										<div
											style={{
												display: "flex",
												alignItems: "baseline",
												justifyContent: "space-between",
												gap: "8px",
											}}
										>
											<div className="fm-eyebrow">
												This week vs. your target
											</div>
											<div
												className="fm-mono"
												style={{ fontSize: "10px", color: "var(--mut)" }}
											>
												37.5 / 40.0h{" "}
												<span style={{ color: "var(--fg)" }}>94%</span>
											</div>
										</div>
										<div
											style={{
												position: "relative",
												height: "2px",
												marginTop: "10px",
												background: "var(--line2)",
												overflow: "hidden",
											}}
										>
											<span
												style={{
													position: "absolute",
													inset: "0 auto 0 0",
													width: "94%",
													background: "var(--acc)",
												}}
											/>
										</div>
									</div>
									<div
										style={{
											padding: "11px 16px",
											borderBottom: "1px solid var(--line)",
										}}
									>
										<div className="fm-eyebrow">This week by day</div>
										<div
											style={{
												marginTop: "11px",
												display: "flex",
												gap: "6px",
											}}
										>
											{previewWeek.map((b) => (
												<div
													key={b.d}
													style={{
														flex: "1 1 0",
														minWidth: 0,
														display: "flex",
														flexDirection: "column",
														alignItems: "center",
														gap: "7px",
													}}
												>
													<div
														style={{
															display: "flex",
															width: "100%",
															height: "34px",
															alignItems: "flex-end",
															justifyContent: "center",
														}}
													>
														<span
															style={{
																width: "100%",
																maxWidth: "17px",
																height: `${b.px}px`,
																borderRadius: "2px",
																background: b.today
																	? "var(--acc)"
																	: b.px > 2
																		? "color-mix(in srgb, var(--acc) 40%, transparent)"
																		: "var(--line)",
															}}
														/>
													</div>
													<span
														className="fm-eyebrow"
														style={{
															color: b.today ? "var(--fg)" : undefined,
														}}
													>
														{b.d}
													</span>
												</div>
											))}
										</div>
									</div>
									<div>
										<div
											className="fm-eyebrow"
											style={{
												display: "flex",
												alignItems: "center",
												gap: "5px",
												padding: "12px 16px 3px",
											}}
										>
											<SparkleIcon weight="regular" size={11} />
											Auto-tracked today
										</div>
										{autoTracked.map(({ Icon, title, sub, hours }) => (
											<div
												key={title}
												style={{
													display: "flex",
													alignItems: "center",
													gap: "9px",
													padding: "7px 16px",
												}}
											>
												<Icon size={13} color="var(--mut)" />
												<div style={{ flex: 1, minWidth: 0 }}>
													<div style={{ fontSize: "11.5px" }}>{title}</div>
													<div
														style={{
															marginTop: "1px",
															fontSize: "10px",
															color: "var(--faint)",
														}}
													>
														{sub}
													</div>
												</div>
												<span className="fm-mono" style={{ fontSize: "11px" }}>
													{hours}
												</span>
											</div>
										))}
									</div>
								</div>
								<div style={{ flex: 1, minWidth: 0, padding: "13px 0 4px" }}>
									<div className="fm-eyebrow" style={{ padding: "0 16px 5px" }}>
										Today's entries
									</div>
									{recentEntries.map((e, i) => (
										<div
											key={e.title}
											style={{
												display: "flex",
												alignItems: "flex-start",
												gap: "9px",
												padding: "9px 16px",
												borderTop:
													i === 0 ? undefined : "1px solid var(--line2)",
											}}
										>
											<span
												style={{
													marginTop: "4px",
													width: "7px",
													height: "7px",
													borderRadius: "50%",
													background: e.dot,
													flex: "none",
												}}
											/>
											<div style={{ flex: 1, minWidth: 0 }}>
												<div
													style={{
														display: "flex",
														alignItems: "center",
														gap: "6px",
													}}
												>
													<span style={{ fontSize: "11.5px", fontWeight: 500 }}>
														{e.title}
													</span>
													{e.badge && (
														<span
															className="fm-eyebrow"
															style={{
																display: "inline-flex",
																alignItems: "center",
																gap: "3px",
																padding: "2px 6px",
																borderRadius: "999px",
																background: "var(--sel)",
																color: "var(--mut)",
															}}
														>
															<e.badge.Icon weight="regular" size={10} />
															{e.badge.text}
														</span>
													)}
												</div>
												<div
													style={{
														marginTop: "2px",
														fontSize: "10.5px",
														color: "var(--mut)",
													}}
												>
													{e.sub}
												</div>
											</div>
											<span
												className="fm-mono"
												style={{ fontSize: "11.5px", flex: "none" }}
											>
												{e.hours}
											</span>
										</div>
									))}
								</div>
							</div>
							{/* The page's closing action: the serif accent link. */}
							<div style={{ padding: "12px 20px" }}>
								<span
									className="fm-serif"
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: "6px",
										fontSize: "16px",
										color: "var(--acc)",
									}}
								>
									View full calendar
									<ArrowRightIcon weight="regular" size={13} />
								</span>
							</div>
						</main>
					</div>
				</div>
			</section>
			{/* ============ OPEN SOURCE + CTA ============ */}
			<section
				id="opensource"
				className="fm-os-section"
				style={{
					maxWidth: "1140px",
					margin: "0 auto",
					padding: "104px 40px 0",
					scrollMarginTop: "80px",
				}}
			>
				<div
					style={{
						paddingTop: "64px",
						display: "flex",
						alignItems: "flex-end",
						justifyContent: "space-between",
						gap: "40px",
						flexWrap: "wrap",
					}}
				>
					<div>
						<div
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: "8px",
								padding: "6px 13px",
								background: "color-mix(in srgb, var(--acc) 8%, transparent)",
								border:
									"1px solid color-mix(in srgb, var(--acc) 16%, transparent)",
								borderRadius: "999px",
								font: "500 12px 'Instrument Sans',sans-serif",
								color: "var(--acc)",
								marginBottom: "22px",
							}}
						>
							<GitBranchIcon size={14} />
							Free · MIT licensed
						</div>
						<h2
							className="fm-serif fm-os-title"
							style={{
								margin: 0,
								maxWidth: "640px",
								fontSize: "58px",
								lineHeight: 0.98,
								letterSpacing: "-.01em",
								textWrap: "balance",
							}}
						>
							Built in the open.{" "}
							<span style={{ fontStyle: "italic", color: "var(--acc)" }}>
								Yours to run.
							</span>
						</h2>
					</div>
					<div
						className="fm-os-actions"
						style={{ display: "flex", gap: "10px" }}
					>
						<DashButton orgSlug={orgSlug} signedIn={signedIn} />
						<a className="fm-btn fm-btn-outline" href={githubUrl}>
							<GitBranchIcon size={15} data-icon="inline-start" />
							View on GitHub
						</a>
					</div>
				</div>
			</section>

			{/* ============ FOOTER ============ */}
			<footer style={{ marginTop: "100px" }}>
				<div
					className="fm-footer-inner"
					style={{
						maxWidth: "1140px",
						margin: "0 auto",
						padding: "30px 40px",
						display: "flex",
						alignItems: "center",
						gap: "24px",
						flexWrap: "wrap",
					}}
				>
					<a href="#top" style={{ display: "block", color: "var(--fg)" }}>
						<FarmerLogo height={26} />
					</a>
					<div
						style={{
							display: "flex",
							gap: "22px",
							fontSize: "13.5px",
							fontWeight: 500,
						}}
					>
						<a
							className="u-link"
							href="#features"
							style={{ color: "var(--mut)" }}
						>
							Features
						</a>
						<a
							className="u-link"
							href="#opensource"
							style={{ color: "var(--mut)" }}
						>
							Open source
						</a>
					</div>
					<div style={{ flex: 1 }} />
					<div style={{ fontSize: "13px", color: "var(--mut)" }}>
						© 2026 · MIT · Maintained by{" "}
						<a
							className="u-link"
							href={PROFICO_URL}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: "3px",
								fontWeight: 600,
								color: "var(--fg)",
							}}
						>
							Profico
							<ArrowUpRightIcon weight="regular" size={12} />
						</a>
					</div>
				</div>
			</footer>
		</div>
	);
}
