import {
	ArrowRightIcon,
	CalendarBlankIcon,
	CalendarDotsIcon,
	CaretUpDownIcon,
	ChartLineIcon,
	ClockIcon,
	FolderIcon,
	GitBranchIcon,
	GitCommitIcon,
	PlusIcon,
	SignOutIcon,
	SparkleIcon,
	SquaresFourIcon,
	UsersIcon,
} from "@phosphor-icons/react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { getSession } from "#/server/auth.ts";
import { getPublicAppConfig } from "#/server/config.ts";
import { getDefaultOrgSlugForSession } from "#/server/organization.ts";

export const Route = createFileRoute("/")({
	// Public marketing homepage — rendered for everyone, signed in or not (no
	// redirect, so a logged-in user can still visit `/`). The loader resolves the
	// viewer's default org slug (null when logged out / org-less) so the CTAs can
	// point at the dashboard when there is one, and at login otherwise.
	//
	// In single-org mode there is no marketing page: `/` is just the front door
	// of the one workspace, so every branch below redirects and the component
	// never renders.
	loader: async (): Promise<{ orgSlug: string | null }> => {
		const config = await getPublicAppConfig();
		const session = await getSession();
		if (config.singleOrgMode) {
			if (!session) throw redirect({ to: "/login" });
			const orgSlug = await getDefaultOrgSlugForSession();
			// Signed in with no membership: invitation revoked, or an account that
			// predates the mode being switched on. A dead end, not a bounce back to
			// `/` — that would loop.
			if (!orgSlug) throw redirect({ to: "/no-access" });
			throw redirect({ to: "/$orgSlug", params: { orgSlug } });
		}
		if (!session) return { orgSlug: null };
		// Server fn resolves userId/activeOrganizationId from the session itself —
		// it no longer accepts a client-supplied identity.
		const orgSlug = await getDefaultOrgSlugForSession();
		return { orgSlug };
	},
	component: Home,
});

const GITHUB_URL = "https://github.com/profico/farmer";
const PROFICO_URL = "https://profi.co";

// The page's one CTA, in the product's own button: straight into the viewer's
// workspace when they have an org, otherwise to login. Rendered identically in
// the header and in the body — same component, same class, same label — so the
// action never changes shape as you scroll past it.
function DashButton({
	orgSlug,
	className = "fm-btn",
}: {
	orgSlug: string | null;
	className?: string;
}) {
	const label = orgSlug ? "Open dashboard" : "Log in";
	const content = (
		<>
			{label}
			<ArrowRightIcon weight="regular" size={15} data-icon="inline-end" />
		</>
	);
	return orgSlug ? (
		<Link className={className} to="/$orgSlug" params={{ orgSlug }}>
			{content}
		</Link>
	) : (
		<Link className={className} to="/login">
			{content}
		</Link>
	);
}

// Scoped landing-page styles. Kept in an inline <style> (no `precedence`, so
// React unmounts it with the route) rather than in the global stylesheet, so
// these marketing-only helpers and the smooth-scroll behaviour don't leak into
// the dense product UI.
//
// The colour literals below are the product's own tokens (styles.css), spelled
// out rather than read through `var(--…)` because this page deliberately does
// not inherit the app theme — but they are the same values, so the landing and
// the app read as one product: --bg #faf9f6, --ground #efece5, --bg2 #f4f2ed,
// --fg #1b1a17, --mut #79736a, --faint #a9a296, --line rgba(27,26,23,.11),
// --line2 rgba(27,26,23,.055), --sel rgba(27,26,23,.045), --acc #6f4ebe.
const landingCss = `
.fm-landing{background:#faf9f6;color:#1b1a17;font-family:'Instrument Sans',system-ui,sans-serif;line-height:1.5;overflow-x:hidden;min-height:100vh;user-select:none;cursor:default}
.fm-landing *{box-sizing:border-box;cursor:default}
.fm-landing a,.fm-landing button,.fm-landing [role="button"]{cursor:pointer}
.fm-landing .self-host-card{text-decoration:none;color:inherit}
.fm-landing .self-host-card:hover .u-link::after{transform:scaleX(1)}
.fm-landing ::selection{background:rgba(27,26,23,.045)}
.fm-landing .fm-serif{font-family:'Instrument Serif',Georgia,serif;font-weight:400;letter-spacing:.01em}
html:has(.fm-landing){scroll-behavior:smooth}
.fm-landing .u-link{position:relative;color:#1b1a17;text-decoration:none}
.fm-landing .u-link::after{content:"";position:absolute;left:0;right:0;bottom:-2px;height:1px;background:currentColor;transform:scaleX(0);transform-origin:left;transition:transform .25s}
.fm-landing .u-link:hover::after{transform:scaleX(1)}

/* The product's Button (components/ui/button.tsx), transcribed: the same 32px
   height, 5px corner, 13px medium label and single violet fill. One button, used
   everywhere a CTA appears — header and body — so the page's main action looks
   like the action it leads to rather than a marketing pill. */
.fm-landing .fm-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 10px 0 12px;border:1px solid transparent;border-radius:5px;background:#6f4ebe;color:#faf9f6;font:500 13px/1 'Instrument Sans',sans-serif;text-decoration:none;white-space:nowrap;transition:background-color .15s,border-color .15s,color .15s,transform .15s}
.fm-landing .fm-btn:has([data-icon="inline-start"]){padding:0 12px 0 10px}
.fm-landing .fm-btn:hover{background:color-mix(in srgb,#6f4ebe 86%,#1b1a17)}
.fm-landing .fm-btn:active{transform:scale(.985)}
.fm-landing .fm-btn-outline{background:transparent;color:#1b1a17;border-color:rgba(27,26,23,.11)}
.fm-landing .fm-btn-outline:hover{background:rgba(27,26,23,.045);border-color:rgba(121,115,106,.6)}

/* The app's .eyebrow and .mono, at the reduced sizes the UI mock is drawn to. */
.fm-landing .fm-eyebrow{font:400 9.5px/1 'Instrument Sans',sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#a9a296}
.fm-landing .fm-mono{font-family:'Geist Mono',ui-monospace,monospace;font-weight:400;letter-spacing:-.03em;font-variant-numeric:tabular-nums}

/* ---- Mobile ------------------------------------------------------------
   The layout is built with fixed-pixel inline styles, so the responsive
   overrides live here and win with !important. Breakpoint at 768px. */
@media (max-width:768px){
  .fm-landing .fm-header-inner{padding:14px 20px !important}
  .fm-landing .fm-nav{gap:16px !important}
  .fm-landing .fm-nav-section{display:none !important}
  .fm-landing .fm-hero{padding:52px 20px 28px !important}
  .fm-landing .fm-hero-title{font-size:46px !important}
  .fm-landing .fm-hero-sub{font-size:16px !important}
  .fm-landing .fm-hero-cta{flex-direction:column !important;gap:16px !important}
  .fm-landing .fm-appwindow-section{padding:0 20px !important}
  .fm-landing .fm-preview-sidebar{display:none !important}
  .fm-landing .fm-preview-body{height:auto !important}
  .fm-landing .fm-preview-split{flex-direction:column !important}
  .fm-landing .fm-preview-col{width:auto !important;border-right:0 !important;border-bottom:1px solid rgba(27,26,23,.11)}
  .fm-landing .fm-features-section{padding:72px 20px 0 !important}
  .fm-landing .fm-section-title{font-size:34px !important}
  .fm-landing .fm-bento{grid-template-columns:1fr !important;grid-auto-rows:auto !important}
  .fm-landing .fm-tile-lg,.fm-landing .fm-tile-wide{grid-column:auto !important;grid-row:auto !important}
  .fm-landing .fm-tile-wide-body{min-height:200px}
  .fm-landing .fm-os-section{padding:72px 20px 0 !important}
  .fm-landing .fm-os-title{font-size:40px !important}
  .fm-landing .fm-os-actions{width:100%;flex-direction:column !important;align-items:stretch}
  .fm-landing .fm-hero-cta .fm-btn,.fm-landing .fm-os-actions .fm-btn{width:100%}
  .fm-landing .fm-footer-inner{padding:26px 20px !important}
}
`;


// ---- App-preview mock data -------------------------------------------------

type PreviewNavItem = {
	Icon: typeof SquaresFourIcon;
	label: string;
	active?: boolean;
};

const previewNavGroups: { label: string; items: PreviewNavItem[] }[] = [
	{
		label: "Workspace",
		items: [
			{ Icon: SquaresFourIcon, label: "Home", active: true },
			{ Icon: FolderIcon, label: "Projects" },
			{ Icon: ClockIcon, label: "Time" },
			{ Icon: CalendarDotsIcon, label: "My schedule" },
		],
	},
	{
		label: "Admin",
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
		dot: "#6b7f6a",
		title: "Design review",
		sub: "Acme Rebrand · Meetings",
		badge: { Icon: CalendarBlankIcon, text: "Synced" },
		hours: "1.0h",
	},
	{
		dot: "#8a6a1f",
		title: "Auth refactor",
		sub: "Harbor App · Development",
		badge: { Icon: GitCommitIcon, text: "12" },
		hours: "2.5h",
	},
	{
		dot: "#55707d",
		title: "Sprint planning",
		sub: "Internal · Planning",
		badge: null,
		hours: "1.5h",
	},
];

function Home() {
	const { orgSlug } = Route.useLoaderData();
	return (
		<MotionConfig reducedMotion="user">
			<div className="fm-landing">
				<style
					// biome-ignore lint/security/noDangerouslySetInnerHtml: static, self-authored CSS
					dangerouslySetInnerHTML={{ __html: landingCss }}
				/>

				{/* ============ HEADER ============ */}
				{/* Painted with the page's own paper rather than a translucent wash of
				    a slightly different white — the tint used to show as a seam across
				    the top of the hero the moment anything scrolled under it. */}
				<header
					style={{
						position: "sticky",
						top: 0,
						zIndex: 50,
						background: "#faf9f6",
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
						<a href="#top" style={{ display: "block" }}>
							<img
								src="/logo.svg"
								alt="Farmer"
								style={{ height: "30px", width: "auto", display: "block" }}
							/>
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
								style={{ color: "rgba(38,35,43,.6)" }}
							>
								Open source
							</a>
							<DashButton orgSlug={orgSlug} />
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
						<span style={{ fontStyle: "italic", color: "#6f4ebe" }}>
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
							color: "rgba(38,35,43,.62)",
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
						<DashButton orgSlug={orgSlug} />
						<a className="fm-btn fm-btn-outline" href={GITHUB_URL}>
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
							border: "1px solid rgba(27,26,23,.11)",
							background: "#efece5",
							boxShadow: "0 1px 3px rgba(27,26,23,.05)",
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "12px",
								padding: "11px 16px",
								borderBottom: "1px solid rgba(27,26,23,.055)",
							}}
						>
							<div style={{ display: "flex", gap: "6px" }}>
								<span
									style={{
										width: "10px",
										height: "10px",
										borderRadius: "50%",
										background: "rgba(27,26,23,.11)",
									}}
								/>
								<span
									style={{
										width: "10px",
										height: "10px",
										borderRadius: "50%",
										background: "rgba(27,26,23,.11)",
									}}
								/>
								<span
									style={{
										width: "10px",
										height: "10px",
										borderRadius: "50%",
										background: "rgba(27,26,23,.11)",
									}}
								/>
							</div>
							<div
								className="fm-mono"
								style={{
									flex: 1,
									textAlign: "center",
									fontSize: "12px",
									color: "#79736a",
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
									background: "#faf9f6",
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
												background: "#6f4ebe",
												color: "#faf9f6",
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
											color="#79736a"
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
														color: active ? "#1b1a17" : "#79736a",
														background: active
															? "rgba(27,26,23,.045)"
															: undefined,
														boxShadow: active
															? "0 1px 2px rgba(27,26,23,.05)"
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
										borderTop: "1px solid rgba(27,26,23,.11)",
									}}
								>
									<span
										style={{
											width: "20px",
											height: "20px",
											borderRadius: "50%",
											background: "rgba(27,26,23,.08)",
											color: "#79736a",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											fontSize: "9px",
											fontWeight: 500,
											flex: "none",
										}}
									>
										OZ
									</span>
									<span style={{ flex: 1, fontSize: "11px", fontWeight: 500 }}>
										Omar Zunic
									</span>
									<SignOutIcon weight="regular" size={12} color="#a9a296" />
								</div>
							</aside>
							{/* The page island — a facsimile of $orgSlug/index.tsx. */}
							<main
								style={{
									flex: 1,
									minWidth: 0,
									background: "#faf9f6",
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
												background: "#6f4ebe",
												color: "#faf9f6",
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
										Good morning, Omar
									</div>
								</div>
								<div
									className="fm-preview-split"
									style={{
										display: "flex",
										flex: 1,
										minHeight: 0,
										borderTop: "1px solid rgba(27,26,23,.11)",
										borderBottom: "1px solid rgba(27,26,23,.11)",
									}}
								>
									<div
										className="fm-preview-col"
										style={{
											width: "53%",
											flex: "none",
											borderRight: "1px solid rgba(27,26,23,.11)",
										}}
									>
										{/* The two figures, mono over an eyebrow — the app's Metric. */}
										<div
											style={{
												display: "grid",
												gridTemplateColumns: "1fr 1fr",
												borderBottom: "1px solid rgba(27,26,23,.11)",
											}}
										>
											<div
												style={{
													padding: "12px 16px",
													borderRight: "1px solid rgba(27,26,23,.11)",
												}}
											>
												<div
													className="fm-mono"
													style={{
														fontSize: "22px",
														lineHeight: 1,
														letterSpacing: "-.04em",
														color: "#6f4ebe",
													}}
												>
													3.0h
												</div>
												<div
													className="fm-eyebrow"
													style={{ marginTop: "9px", color: "#79736a" }}
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
													style={{ marginTop: "9px", color: "#79736a" }}
												>
													This week
												</div>
											</div>
										</div>
										{/* The app's one progress rail: 2px, hairline ground, accent fill. */}
										<div
											style={{
												padding: "11px 16px",
												borderBottom: "1px solid rgba(27,26,23,.11)",
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
													style={{ fontSize: "10px", color: "#79736a" }}
												>
													37.5 / 40.0h{" "}
													<span style={{ color: "#1b1a17" }}>94%</span>
												</div>
											</div>
											<div
												style={{
													position: "relative",
													height: "2px",
													marginTop: "10px",
													background: "rgba(27,26,23,.055)",
													overflow: "hidden",
												}}
											>
												<span
													style={{
														position: "absolute",
														inset: "0 auto 0 0",
														width: "94%",
														background: "#6f4ebe",
													}}
												/>
											</div>
										</div>
										<div
											style={{
												padding: "11px 16px",
												borderBottom: "1px solid rgba(27,26,23,.11)",
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
																		? "#6f4ebe"
																		: b.px > 2
																			? "rgba(111,78,190,.4)"
																			: "rgba(27,26,23,.11)",
																}}
															/>
														</div>
														<span
															className="fm-eyebrow"
															style={{
																color: b.today ? "#1b1a17" : undefined,
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
													<Icon size={13} color="#79736a" />
													<div style={{ flex: 1, minWidth: 0 }}>
														<div style={{ fontSize: "11.5px" }}>{title}</div>
														<div
															style={{
																marginTop: "1px",
																fontSize: "10px",
																color: "#a9a296",
															}}
														>
															{sub}
														</div>
													</div>
													<span
														className="fm-mono"
														style={{ fontSize: "11px" }}
													>
														{hours}
													</span>
												</div>
											))}
										</div>
									</div>
									<div style={{ flex: 1, minWidth: 0, padding: "13px 0 4px" }}>
										<div
											className="fm-eyebrow"
											style={{ padding: "0 16px 5px" }}
										>
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
														i === 0
															? undefined
															: "1px solid rgba(27,26,23,.055)",
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
														<span
															style={{ fontSize: "11.5px", fontWeight: 500 }}
														>
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
																	background: "rgba(27,26,23,.045)",
																	color: "#79736a",
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
															color: "#79736a",
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
											color: "#6f4ebe",
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
									background: "rgba(111,78,190,.08)",
									border: "1px solid rgba(111,78,190,.16)",
									borderRadius: "999px",
									font: "500 12px 'Instrument Sans',sans-serif",
									color: "#6f4ebe",
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
								<span style={{ fontStyle: "italic", color: "#6f4ebe" }}>
									Yours to run.
								</span>
							</h2>
						</div>
						<div
							className="fm-os-actions"
							style={{ display: "flex", gap: "10px" }}
						>
							<DashButton orgSlug={orgSlug} />
							<a className="fm-btn fm-btn-outline" href={GITHUB_URL}>
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
						<a href="#top" style={{ display: "block" }}>
							<img
								src="/logo.svg"
								alt="Farmer"
								style={{ height: "26px", width: "auto", display: "block" }}
							/>
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
								style={{ color: "rgba(38,35,43,.6)" }}
							>
								Features
							</a>
							<a
								className="u-link"
								href="#integrations"
								style={{ color: "rgba(38,35,43,.6)" }}
							>
								Integrations
							</a>
							<a
								className="u-link"
								href="#opensource"
								style={{ color: "rgba(38,35,43,.6)" }}
							>
								Open source
							</a>
						</div>
						<div style={{ flex: 1 }} />
						<div style={{ fontSize: "13px", color: "rgba(38,35,43,.55)" }}>
							© 2026 · MIT · Maintained by{" "}
							<a
								className="u-link"
								href={PROFICO_URL}
								style={{ fontWeight: 600, color: "#1b1a17" }}
							>
								Profico ↗
							</a>
						</div>
					</div>
				</footer>
			</div>
		</MotionConfig>
	);
}
