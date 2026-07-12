import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	BarChart3,
	Calendar,
	Clock,
	Folder,
	GitBranch,
	LayoutDashboard,
	Pencil,
	Plus,
	Server,
	Sparkles,
	Sprout,
} from "lucide-react";
import type { Transition, Variants } from "motion/react";
import {
	animate,
	MotionConfig,
	motion,
	useInView,
	useMotionValue,
	useReducedMotion,
	useTransform,
} from "motion/react";
import { useEffect, useRef } from "react";
import { getSession } from "#/server/auth.ts";
import { getDefaultOrgSlugForSession } from "#/server/organization.ts";

export const Route = createFileRoute("/")({
	// Public marketing homepage — rendered for everyone, signed in or not (no
	// redirect, so a logged-in user can still visit `/`). The loader resolves the
	// viewer's default org slug (null when logged out / org-less) so the CTAs can
	// point at the dashboard when there is one, and at login otherwise.
	loader: async (): Promise<{ orgSlug: string | null }> => {
		const session = await getSession();
		if (!session) return { orgSlug: null };
		// Server fn resolves userId/activeOrganizationId from the session itself —
		// it no longer accepts a client-supplied identity.
		const orgSlug = await getDefaultOrgSlugForSession();
		return { orgSlug };
	},
	component: Home,
});

const GITHUB_URL = "https://github.com/profico/farmer";
const DOCS_URL = "https://github.com/profico/farmer#readme";
const PROFICO_URL = "https://profi.co";

// A CTA that leads to the app: straight to the viewer's dashboard when they
// have an org, otherwise to login (which lands on the dashboard afterwards).
function DashLink({
	orgSlug,
	className,
	style,
	children,
}: {
	orgSlug: string | null;
	className?: string;
	style?: React.CSSProperties;
	children: React.ReactNode;
}) {
	return orgSlug ? (
		<Link
			className={className}
			style={style}
			to="/$orgSlug"
			params={{ orgSlug }}
		>
			{children}
		</Link>
	) : (
		<Link className={className} style={style} to="/login">
			{children}
		</Link>
	);
}

// Scoped landing-page styles. Kept in an inline <style> (no `precedence`, so
// React unmounts it with the route) rather than in the global stylesheet, so
// these marketing-only helpers and the smooth-scroll behaviour don't leak into
// the dense product UI.
const landingCss = `
.fm-landing{background:#f7f5f1;color:#26232b;font-family:'Geist',system-ui,sans-serif;line-height:1.5;overflow-x:hidden;min-height:100vh;user-select:none;cursor:default}
.fm-landing *{box-sizing:border-box;cursor:default}
.fm-landing a,.fm-landing button,.fm-landing [role="button"]{cursor:pointer}
.fm-landing .self-host-card{text-decoration:none;color:inherit}
.fm-landing .self-host-card:hover .u-link::after{transform:scaleX(1)}
.fm-landing ::selection{background:#efeafb;color:#5b3aad}
.fm-landing .fm-serif{font-family:'Instrument Serif',Georgia,serif;font-weight:400}
html:has(.fm-landing){scroll-behavior:smooth}
.fm-landing .u-link{position:relative;color:#26232b;text-decoration:none}
.fm-landing .u-link::after{content:"";position:absolute;left:0;right:0;bottom:-2px;height:1px;background:currentColor;transform:scaleX(0);transform-origin:left;transition:transform .25s}
.fm-landing .u-link:hover::after{transform:scaleX(1)}
.fm-landing .pill{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border:1px solid #26232b;border-radius:999px;color:#26232b;text-decoration:none;font-weight:600;font-size:14px;transition:background .18s,color .18s}
.fm-landing .pill:hover{background:#26232b;color:#f7f5f1}
.fm-landing .pill-dark{background:#241c33;color:#f7f5f1;border-color:#241c33}
.fm-landing .pill-dark:hover{background:#000;color:#fff}

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
  .fm-landing .fm-features-section{padding:72px 20px 0 !important}
  .fm-landing .fm-section-title{font-size:34px !important}
  .fm-landing .fm-bento{grid-template-columns:1fr !important;grid-auto-rows:auto !important}
  .fm-landing .fm-tile-lg,.fm-landing .fm-tile-wide{grid-column:auto !important;grid-row:auto !important}
  .fm-landing .fm-tile-wide-body{min-height:200px}
  .fm-landing .fm-os-section{padding:72px 20px 0 !important}
  .fm-landing .fm-os-title{font-size:40px !important}
  .fm-landing .fm-os-actions{width:100%;flex-direction:column !important}
  .fm-landing .fm-os-actions .pill{justify-content:center}
  .fm-landing .fm-footer-inner{padding:26px 20px !important}
}
`;

// ---- Bento scroll-in demos -------------------------------------------------
// Tuned separately from the product springs in #/lib/motion.ts: these play
// once per tile as it scrolls into view, so they get a longer, more theatrical
// travel than in-app chrome. Bounce stays reserved for the "physical" beats —
// the hours badge stamping in, the active calendar block dropping onto the
// grid. Reduced-motion users get plain cross-fades via <MotionConfig
// reducedMotion="user"> (and CountUp checks the preference itself).

const tileSpring: Transition = {
	type: "spring",
	bounce: 0,
	visualDuration: 0.55,
};
const stampSpring: Transition = {
	type: "spring",
	bounce: 0.4,
	visualDuration: 0.3,
};
const fillEase: Transition = { duration: 0.9, ease: [0.22, 1, 0.36, 1] };

const rise = (delay = 0): Variants => ({
	hidden: { opacity: 0, y: 10 },
	show: { opacity: 1, y: 0, transition: { ...tileSpring, delay } },
});
const slideIn = (delay = 0): Variants => ({
	hidden: { opacity: 0, x: -18 },
	show: { opacity: 1, x: 0, transition: { ...tileSpring, delay } },
});
const stamp = (delay = 0): Variants => ({
	hidden: { opacity: 0, scale: 0.5 },
	show: { opacity: 1, scale: 1, transition: { ...stampSpring, delay } },
});
const fillIn = (delay = 0): Variants => ({
	hidden: { scaleX: 0 },
	show: { scaleX: 1, transition: { ...fillEase, delay } },
});
const fadeIn = (delay = 0): Variants => ({
	hidden: { opacity: 0 },
	show: { opacity: 1, transition: { duration: 0.4, delay } },
});
// No `hidden` state on purpose: the arrow stays visible with its row, then
// nudges toward the badge once the row has landed.
const nudge = (delay = 0): Variants => ({
	show: {
		x: [0, 6, 0],
		transition: { delay, duration: 0.7, ease: "easeInOut" },
	},
});
const drop = (delay = 0, bounce = 0): Variants => ({
	hidden: { opacity: 0, scaleY: 0 },
	show: {
		opacity: 1,
		scaleY: 1,
		transition: { type: "spring", bounce, visualDuration: 0.4, delay },
	},
});

// A bento tile that reveals itself on first scroll-in and drives its inner
// demo elements (any motion child with `variants`) through the same
// hidden → show switch.
function Tile({
	delay = 0,
	style,
	children,
	href,
	className,
}: {
	delay?: number;
	style?: React.CSSProperties;
	children: React.ReactNode;
	href?: string;
	className?: string;
}) {
	const Component = href ? motion.a : motion.div;
	return (
		<Component
			className={className}
			href={href}
			{...(href?.startsWith("http")
				? { target: "_blank", rel: "noreferrer" }
				: {})}
			variants={{
				hidden: { opacity: 0, y: 24, scale: 0.98 },
				show: {
					opacity: 1,
					y: 0,
					scale: 1,
					transition: { ...tileSpring, delay },
				},
			}}
			initial="hidden"
			whileInView="show"
			viewport={{ once: true, amount: 0.35 }}
			style={style}
		>
			{children}
		</Component>
	);
}

// Renders the target value in SSR/no-JS markup, then counts up from 0 the
// first time it scrolls into view. Skips the animation entirely under
// prefers-reduced-motion.
function CountUp({
	to,
	decimals = 1,
	delay = 0,
	className,
	style,
}: {
	to: number;
	decimals?: number;
	delay?: number;
	className?: string;
	style?: React.CSSProperties;
}) {
	const ref = useRef<HTMLSpanElement>(null);
	const inView = useInView(ref, { once: true, amount: 0.6 });
	const reducedMotion = useReducedMotion();
	const value = useMotionValue(to);
	const text = useTransform(value, (v) => v.toFixed(decimals));
	useEffect(() => {
		if (!inView || reducedMotion) return;
		value.set(0);
		const controls = animate(value, to, {
			delay,
			duration: 1.3,
			ease: [0.16, 1, 0.3, 1],
		});
		return () => controls.stop();
	}, [inView, reducedMotion, value, to, delay]);
	return (
		<motion.span ref={ref} className={className} style={style}>
			{text}
		</motion.span>
	);
}

const projects = [
	{
		name: "Acme Rebrand",
		labelColor: "#5b3aad",
		track: "#efeafb",
		fill: "#7b54d6",
		hours: "14.0h",
		pct: "78%",
	},
	{
		name: "Harbor App",
		labelColor: "#9a6a1c",
		track: "#f6ecda",
		fill: "#d98a2b",
		hours: "11.5h",
		pct: "62%",
	},
	{
		name: "Internal",
		labelColor: "#1c6b6a",
		track: "#e2f2f2",
		fill: "#2fa1a0",
		hours: "6.0h",
		pct: "34%",
	},
];

function ProjectBars() {
	return (
		<>
			{projects.map((p, i) => (
				<div key={p.name}>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							fontSize: "10.5px",
							marginBottom: "3px",
						}}
					>
						<span style={{ color: p.labelColor, fontWeight: 600 }}>
							{p.name}
						</span>
						<motion.span
							variants={rise(0.55 + i * 0.15)}
							className="fm-serif"
							style={{ fontSize: "15px" }}
						>
							{p.hours}
						</motion.span>
					</div>
					<div
						style={{ height: "7px", borderRadius: "4px", background: p.track }}
					>
						<motion.div
							variants={fillIn(0.25 + i * 0.15)}
							style={{
								width: p.pct,
								height: "100%",
								borderRadius: "4px",
								background: p.fill,
								originX: 0,
							}}
						/>
					</div>
				</div>
			))}
		</>
	);
}

const recentEntries = [
	{
		dot: "#7b54d6",
		title: "Design review",
		sub: "Acme Rebrand",
		badge: {
			Icon: Calendar,
			text: "Calendar",
			color: "#1c6b6a",
			bg: "#e2f2f2",
		},
		hours: "1.0h",
	},
	{
		dot: "#d98a2b",
		title: "Auth refactor",
		sub: "Harbor App",
		badge: { Icon: GitBranch, text: "GitHub", color: "#9a6a1c", bg: "#f6ecda" },
		hours: "2.5h",
	},
	{
		dot: "#2fa1a0",
		title: "Sprint planning",
		sub: "Internal",
		badge: { Icon: Pencil, text: "Manual", color: "#79747f", bg: "#efece8" },
		hours: "1.5h",
	},
];

const weekDays = [
	{
		label: "Mon",
		active: false,
		last: false,
		blocks: [
			{ h: 26, bg: "#e2f2f2", bl: "#2fa1a0" },
			{ h: 34, bg: "#efeafb", bl: "#7b54d6" },
		],
	},
	{
		label: "Tue",
		active: true,
		last: false,
		blocks: [
			{ h: 22, bg: "#efeafb", bl: "#7b54d6", shadow: true },
			{ h: 38, bg: "#f6ecda", bl: "#d98a2b" },
		],
	},
	{
		label: "Wed",
		active: false,
		last: false,
		blocks: [
			{ h: 18, bg: "#e2f2f2", bl: "#2fa1a0" },
			{ h: 44, bg: "#f6ecda", bl: "#d98a2b" },
		],
	},
	{
		label: "Thu",
		active: false,
		last: false,
		blocks: [
			{ h: 40, bg: "#efeafb", bl: "#7b54d6" },
			{ h: 20, bg: "#f7e7ec", bl: "#d2607a" },
		],
	},
	{
		label: "Fri",
		active: false,
		last: true,
		blocks: [
			{ h: 32, bg: "#f6ecda", bl: "#d98a2b" },
			{ h: 18, bg: "#e2f2f2", bl: "#2fa1a0" },
		],
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
				<header
					style={{
						position: "sticky",
						top: 0,
						zIndex: 50,
						background: "rgba(247,245,241,.82)",
						backdropFilter: "blur(10px)",
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
								href="#features"
								style={{ color: "rgba(38,35,43,.6)" }}
							>
								Features
							</a>
							<a
								className="u-link fm-nav-section"
								href="#integrations"
								style={{ color: "rgba(38,35,43,.6)" }}
							>
								Integrations
							</a>
							<a
								className="u-link fm-nav-section"
								href="#opensource"
								style={{ color: "rgba(38,35,43,.6)" }}
							>
								Open source
							</a>
							{orgSlug ? (
								<Link className="pill" to="/$orgSlug" params={{ orgSlug }}>
									Open dashboard <ArrowRight size={15} strokeWidth={1.6} />
								</Link>
							) : (
								<Link className="pill" to="/login">
									Log in
								</Link>
							)}
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
						<span style={{ fontStyle: "italic", color: "#6a45c8" }}>
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
							gap: "24px",
							marginTop: "30px",
							font: "600 14.5px 'Geist',sans-serif",
						}}
					>
						<DashLink
							orgSlug={orgSlug}
							className="u-link"
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: "6px",
								color: "#26232b",
							}}
						>
							Open the dashboard
							<ArrowRight size={16} strokeWidth={1.6} />
						</DashLink>
						<a
							className="u-link"
							href={GITHUB_URL}
							style={{ color: "rgba(38,35,43,.6)" }}
						>
							Star on GitHub
						</a>
					</div>
				</section>

				{/* ============ APP WINDOW ============ */}
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
							border: "1px solid #e7e3e8",
							background: "#f7f5f1",
							boxShadow: "0 1px 3px rgba(34,28,51,.05)",
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "12px",
								padding: "11px 16px",
								borderBottom: "1px solid #efece8",
								background: "#f7f5f1",
							}}
						>
							<div style={{ display: "flex", gap: "6px" }}>
								<span
									style={{
										width: "10px",
										height: "10px",
										borderRadius: "50%",
										background: "#e0dbd6",
									}}
								/>
								<span
									style={{
										width: "10px",
										height: "10px",
										borderRadius: "50%",
										background: "#e0dbd6",
									}}
								/>
								<span
									style={{
										width: "10px",
										height: "10px",
										borderRadius: "50%",
										background: "#e0dbd6",
									}}
								/>
							</div>
							<div
								style={{
									flex: 1,
									textAlign: "center",
									font: "500 12px 'Geist Mono',monospace",
									color: "#a8a3ad",
								}}
							>
								farmer.profi.co
							</div>
						</div>
						<div
							className="fm-preview-body"
							style={{
								display: "flex",
								height: "452px",
								background: "#f7f5f1",
							}}
						>
							{/* sidebar */}
							<aside
								className="fm-preview-sidebar"
								style={{
									width: "196px",
									flex: "none",
									borderRight: "1px solid #e7e3e8",
									padding: "14px 12px",
									display: "flex",
									flexDirection: "column",
									gap: "3px",
								}}
							>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: "9px",
										padding: "6px 8px",
										border: "1px solid #e7e3e8",
										background: "#fff",
										borderRadius: "8px",
										marginBottom: "10px",
									}}
								>
									<span
										style={{
											width: "22px",
											height: "22px",
											borderRadius: "6px",
											background: "#241c33",
											color: "#a9e0b0",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											flex: "none",
										}}
									>
										<Sprout size={13} strokeWidth={1.6} />
									</span>
									<span style={{ fontSize: "12px", fontWeight: 600 }}>
										Profico
									</span>
								</div>
								<div
									style={{
										font: "600 9.5px 'Geist',sans-serif",
										letterSpacing: ".09em",
										textTransform: "uppercase",
										color: "#a8a3ad",
										padding: "8px 8px 4px",
									}}
								>
									Workspace
								</div>
								<span
									style={{
										display: "flex",
										alignItems: "center",
										gap: "9px",
										padding: "6px 8px",
										borderRadius: "7px",
										background: "#fff",
										border: "1px solid #e7e3e8",
										color: "#26232b",
										fontSize: "12.5px",
										fontWeight: 600,
									}}
								>
									<LayoutDashboard
										size={15}
										strokeWidth={1.6}
										color="#6a45c8"
									/>
									Home
								</span>
								{[
									{ Icon: Folder, label: "Projects" },
									{ Icon: Clock, label: "Time" },
									{ Icon: BarChart3, label: "Reports" },
								].map(({ Icon, label }) => (
									<span
										key={label}
										style={{
											display: "flex",
											alignItems: "center",
											gap: "9px",
											padding: "6px 8px",
											borderRadius: "7px",
											color: "#79747f",
											fontSize: "12.5px",
											fontWeight: 500,
										}}
									>
										<Icon size={15} strokeWidth={1.6} />
										{label}
									</span>
								))}
								<div
									style={{
										font: "600 9.5px 'Geist',sans-serif",
										letterSpacing: ".09em",
										textTransform: "uppercase",
										color: "#a8a3ad",
										padding: "12px 8px 4px",
									}}
								>
									Integrations
								</div>
								{[
									{ Icon: Calendar, label: "Google Calendar" },
									{ Icon: GitBranch, label: "GitHub" },
								].map(({ Icon, label }) => (
									<span
										key={label}
										style={{
											display: "flex",
											alignItems: "center",
											gap: "9px",
											padding: "6px 8px",
											borderRadius: "7px",
											color: "#79747f",
											fontSize: "12.5px",
											fontWeight: 500,
										}}
									>
										<Icon size={15} strokeWidth={1.6} />
										{label}
										<span
											style={{
												marginLeft: "auto",
												width: "6px",
												height: "6px",
												borderRadius: "50%",
												background: "#4fa36b",
											}}
										/>
									</span>
								))}
								<div
									style={{
										marginTop: "auto",
										display: "flex",
										alignItems: "center",
										gap: "8px",
										paddingTop: "10px",
										borderTop: "1px solid #e7e3e8",
									}}
								>
									<span
										style={{
											width: "24px",
											height: "24px",
											borderRadius: "50%",
											background: "#e9dfce",
											color: "#8a6a2e",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											fontSize: "10px",
											fontWeight: 600,
										}}
									>
										OZ
									</span>
									<span style={{ fontSize: "11.5px", fontWeight: 600 }}>
										Omar Zunic
									</span>
								</div>
							</aside>
							{/* main — an edge-to-edge facsimile of the real dashboard home */}
							<main
								style={{
									flex: 1,
									minWidth: 0,
									display: "flex",
									flexDirection: "column",
								}}
							>
								{/* greeting */}
								<div
									style={{
										display: "flex",
										alignItems: "flex-start",
										justifyContent: "space-between",
										gap: "12px",
										padding: "18px 22px 14px",
									}}
								>
									<div>
										<div
											className="fm-serif"
											style={{ fontSize: "23px", lineHeight: 1 }}
										>
											Good morning, Omar
										</div>
										<div
											style={{
												marginTop: "5px",
												fontSize: "12px",
												color: "#a8a3ad",
											}}
										>
											Tue, Jul 8 · 3.0h logged
										</div>
									</div>
									<span
										style={{
											display: "flex",
											alignItems: "center",
											gap: "6px",
											padding: "6px 11px",
											background: "#6a45c8",
											color: "#fff",
											borderRadius: "7px",
											fontSize: "12px",
											fontWeight: 600,
											flex: "none",
										}}
									>
										<Plus size={14} strokeWidth={1.6} /> Add block
									</span>
								</div>
								{/* stat grid */}
								<div
									style={{
										display: "grid",
										gridTemplateColumns: "1fr 1fr",
										borderTop: "1px solid #e7e3e8",
										borderBottom: "1px solid #e7e3e8",
									}}
								>
									<div
										style={{
											padding: "13px 22px",
											borderRight: "1px solid #e7e3e8",
										}}
									>
										<div
											style={{
												font: "600 9.5px 'Geist',sans-serif",
												letterSpacing: ".09em",
												textTransform: "uppercase",
												color: "#a8a3ad",
											}}
										>
											Logged today
										</div>
										<div
											className="fm-serif"
											style={{
												fontSize: "30px",
												lineHeight: 1,
												marginTop: "5px",
											}}
										>
											3.0h
										</div>
									</div>
									<div style={{ padding: "13px 22px" }}>
										<div
											style={{
												font: "600 9.5px 'Geist',sans-serif",
												letterSpacing: ".09em",
												textTransform: "uppercase",
												color: "#a8a3ad",
											}}
										>
											This week
										</div>
										<div
											className="fm-serif"
											style={{
												fontSize: "30px",
												lineHeight: 1,
												marginTop: "5px",
											}}
										>
											37.5h
										</div>
									</div>
								</div>
								{/* weekly sparkline */}
								<div
									style={{
										padding: "13px 22px",
										borderBottom: "1px solid #e7e3e8",
									}}
								>
									<div
										style={{
											font: "600 9.5px 'Geist',sans-serif",
											letterSpacing: ".09em",
											textTransform: "uppercase",
											color: "#a8a3ad",
										}}
									>
										This week by day
									</div>
									<div
										style={{
											marginTop: "10px",
											display: "flex",
											alignItems: "flex-end",
											gap: "8px",
										}}
									>
										{[
											{ d: "Mon", px: 22 },
											{ d: "Tue", px: 46, active: true },
											{ d: "Wed", px: 30 },
											{ d: "Thu", px: 38 },
											{ d: "Fri", px: 26 },
											{ d: "Sat", px: 8 },
											{ d: "Sun", px: 2 },
										].map((b) => (
											<div
												key={b.d}
												style={{
													flex: 1,
													display: "flex",
													flexDirection: "column",
													alignItems: "center",
													gap: "6px",
												}}
											>
												<span
													style={{
														width: "100%",
														height: `${b.px}px`,
														borderRadius: "3px",
														background: b.active
															? "#7b54d6"
															: b.px > 2
																? "#e6def7"
																: "#efece8",
													}}
												/>
												<span
													style={{
														fontSize: "9.5px",
														fontWeight: b.active ? 600 : 500,
														color: b.active ? "#26232b" : "#a8a3ad",
													}}
												>
													{b.d}
												</span>
											</div>
										))}
									</div>
								</div>
								{/* auto-tracked today */}
								<div style={{ borderBottom: "1px solid #e7e3e8" }}>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: "6px",
											padding: "12px 22px 7px",
											font: "600 9.5px 'Geist',sans-serif",
											letterSpacing: ".09em",
											textTransform: "uppercase",
											color: "#a8a3ad",
										}}
									>
										<Sparkles size={12} strokeWidth={1.6} /> Auto-tracked today
									</div>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: "11px",
											padding: "8px 22px",
										}}
									>
										<span
											style={{
												width: "26px",
												height: "26px",
												borderRadius: "7px",
												background: "#e2f2f2",
												color: "#1c6b6a",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												flex: "none",
											}}
										>
											<Calendar size={13} strokeWidth={1.6} />
										</span>
										<div style={{ flex: 1, minWidth: 0 }}>
											<div style={{ fontSize: "12px", fontWeight: 600 }}>
												2 meetings synced
											</div>
											<div style={{ fontSize: "10.5px", color: "#a8a3ad" }}>
												Google Calendar
											</div>
										</div>
										<span className="fm-serif" style={{ fontSize: "16px" }}>
											3.0h
										</span>
									</div>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: "11px",
											padding: "8px 22px",
											borderTop: "1px solid #f2eee8",
										}}
									>
										<span
											style={{
												width: "26px",
												height: "26px",
												borderRadius: "7px",
												background: "#f6ecda",
												color: "#9a6a1c",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												flex: "none",
											}}
										>
											<GitBranch size={13} strokeWidth={1.6} />
										</span>
										<div style={{ flex: 1, minWidth: 0 }}>
											<div style={{ fontSize: "12px", fontWeight: 600 }}>
												12 commits
											</div>
											<div style={{ fontSize: "10.5px", color: "#a8a3ad" }}>
												across 3 blocks
											</div>
										</div>
										<span className="fm-serif" style={{ fontSize: "16px" }}>
											2.5h
										</span>
									</div>
								</div>
								{/* today's entries */}
								<div style={{ flex: 1 }}>
									<div
										style={{
											padding: "12px 22px 7px",
											font: "600 9.5px 'Geist',sans-serif",
											letterSpacing: ".09em",
											textTransform: "uppercase",
											color: "#a8a3ad",
										}}
									>
										Today's entries
									</div>
									{recentEntries.map((e, i) => (
										<div
											key={e.title}
											style={{
												display: "flex",
												alignItems: "center",
												gap: "11px",
												padding: "9px 22px",
												borderTop: i === 0 ? undefined : "1px solid #f2eee8",
											}}
										>
											<span
												style={{
													width: "8px",
													height: "8px",
													borderRadius: "50%",
													background: e.dot,
													flex: "none",
												}}
											/>
											<div style={{ flex: 1, minWidth: 0 }}>
												<div style={{ fontSize: "12px", fontWeight: 600 }}>
													{e.title}
												</div>
												<div style={{ fontSize: "10.5px", color: "#a8a3ad" }}>
													{e.sub}
												</div>
											</div>
											<span
												style={{
													display: "inline-flex",
													alignItems: "center",
													gap: "4px",
													fontSize: "10px",
													fontWeight: 600,
													color: e.badge.color,
													background: e.badge.bg,
													borderRadius: "5px",
													padding: "3px 6px",
												}}
											>
												<e.badge.Icon size={11} strokeWidth={1.6} />{" "}
												{e.badge.text}
											</span>
											<span
												className="fm-serif"
												style={{ fontSize: "17px", flex: "none" }}
											>
												{e.hours}
											</span>
										</div>
									))}
								</div>
							</main>
						</div>
					</div>
				</section>

				{/* ============ INTEGRATIONS + FEATURES BENTO ============ */}
				<section
					id="features"
					className="fm-features-section"
					style={{
						maxWidth: "1140px",
						margin: "0 auto",
						padding: "104px 40px 0",
					}}
				>
					<div
						id="integrations"
						style={{ maxWidth: "560px", scrollMarginTop: "90px" }}
					>
						<h2
							className="fm-serif fm-section-title"
							style={{
								margin: 0,
								fontSize: "46px",
								lineHeight: 1.02,
								letterSpacing: "-.01em",
								textWrap: "balance",
							}}
						>
							The hours track{" "}
							<span style={{ fontStyle: "italic", color: "#6a45c8" }}>
								themselves.
							</span>
						</h2>
						<p
							style={{
								margin: "16px 0 0",
								fontSize: "16px",
								lineHeight: 1.6,
								color: "rgba(38,35,43,.62)",
							}}
						>
							Connect your calendar and repos once. Farmer drafts the blocks;
							you just confirm.
						</p>
					</div>

					<div
						className="fm-bento"
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(3,1fr)",
							gridAutoRows: "198px",
							gap: "16px",
							marginTop: "40px",
						}}
					>
						{/* Integrations feature (big) */}
						<Tile
							className="fm-tile-lg"
							style={{
								gridColumn: "span 2",
								gridRow: "span 2",
								background: "#241c33",
								color: "#f7f5f1",
								borderRadius: "18px",
								padding: "34px",
								display: "flex",
								flexDirection: "column",
								position: "relative",
								overflow: "hidden",
							}}
						>
							<div
								style={{
									position: "absolute",
									top: "-50px",
									right: "-40px",
									width: "280px",
									height: "280px",
									borderRadius: "50%",
									background:
										"radial-gradient(circle,rgba(169,224,176,.13),transparent 70%)",
								}}
							/>
							<div style={{ position: "relative" }}>
								<div
									style={{
										font: "600 10.5px 'Geist Mono',monospace",
										letterSpacing: ".16em",
										textTransform: "uppercase",
										color: "#a9e0b0",
									}}
								>
									Automatic tracking
								</div>
								<h3
									className="fm-serif"
									style={{
										margin: "12px 0 0",
										fontSize: "34px",
										lineHeight: 1.02,
									}}
								>
									Meetings and commits,
									<br />
									logged for you.
								</h3>
							</div>
							<div
								style={{
									position: "relative",
									marginTop: "auto",
									display: "flex",
									flexDirection: "column",
									gap: "10px",
								}}
							>
								<motion.div
									variants={slideIn(0.25)}
									style={{
										display: "flex",
										alignItems: "center",
										gap: "12px",
										background: "rgba(247,245,241,.06)",
										border: "1px solid rgba(247,245,241,.12)",
										borderRadius: "11px",
										padding: "11px 14px",
									}}
								>
									<span
										style={{
											width: "30px",
											height: "30px",
											borderRadius: "8px",
											background: "#e2f2f2",
											color: "#1c6b6a",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											flex: "none",
										}}
									>
										<Calendar size={16} strokeWidth={1.6} />
									</span>
									<div style={{ flex: 1, minWidth: 0 }}>
										<div style={{ fontSize: "12.5px", fontWeight: 600 }}>
											Design review · Google Calendar
										</div>
										<div
											style={{
												fontSize: "11px",
												color: "rgba(247,245,241,.5)",
											}}
										>
											10:00 – 11:00 · Acme Rebrand
										</div>
									</div>
									<motion.span
										variants={nudge(0.65)}
										style={{ display: "flex", flex: "none" }}
									>
										<ArrowRight
											size={15}
											strokeWidth={1.6}
											color="rgba(247,245,241,.4)"
										/>
									</motion.span>
									<motion.span
										variants={stamp(0.9)}
										style={{
											background: "#efeafb",
											color: "#5b3aad",
											borderRadius: "7px",
											padding: "5px 9px",
											fontSize: "11px",
											fontWeight: 600,
											flex: "none",
										}}
									>
										1.0h logged
									</motion.span>
								</motion.div>
								<motion.div
									variants={slideIn(0.45)}
									style={{
										display: "flex",
										alignItems: "center",
										gap: "12px",
										background: "rgba(247,245,241,.06)",
										border: "1px solid rgba(247,245,241,.12)",
										borderRadius: "11px",
										padding: "11px 14px",
									}}
								>
									<span
										style={{
											width: "30px",
											height: "30px",
											borderRadius: "8px",
											background: "#f6ecda",
											color: "#9a6a1c",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											flex: "none",
										}}
									>
										<GitBranch size={16} strokeWidth={1.6} />
									</span>
									<div style={{ flex: 1, minWidth: 0 }}>
										<div style={{ fontSize: "12.5px", fontWeight: 600 }}>
											12 commits · GitHub
										</div>
										<div
											style={{
												fontSize: "11px",
												color: "rgba(247,245,241,.5)",
											}}
										>
											harbor-app · auth refactor
										</div>
									</div>
									<motion.span
										variants={nudge(0.85)}
										style={{ display: "flex", flex: "none" }}
									>
										<ArrowRight
											size={15}
											strokeWidth={1.6}
											color="rgba(247,245,241,.4)"
										/>
									</motion.span>
									<motion.span
										variants={stamp(1.1)}
										style={{
											background: "#f6ecda",
											color: "#9a6a1c",
											borderRadius: "7px",
											padding: "5px 9px",
											fontSize: "11px",
											fontWeight: 600,
											flex: "none",
										}}
									>
										2.5h logged
									</motion.span>
								</motion.div>
							</div>
						</Tile>

						{/* Reports tile */}
						<Tile
							delay={0.1}
							style={{
								background: "#fff",
								border: "1px solid #e7e3e8",
								borderRadius: "18px",
								padding: "22px",
								display: "flex",
								flexDirection: "column",
								gap: "13px",
							}}
						>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
								}}
							>
								<span style={{ fontSize: "12.5px", fontWeight: 600 }}>
									Reports by project
								</span>
								<BarChart3 size={15} strokeWidth={1.6} color="#a8a3ad" />
							</div>
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: "10px",
								}}
							>
								<ProjectBars />
							</div>
						</Tile>

						{/* Stat tile */}
						<Tile
							delay={0.18}
							style={{
								background: "#fff",
								border: "1px solid #e7e3e8",
								borderRadius: "18px",
								padding: "22px",
								display: "flex",
								flexDirection: "column",
								justifyContent: "space-between",
							}}
						>
							<div
								style={{
									fontSize: "12.5px",
									fontWeight: 600,
									color: "#79747f",
								}}
							>
								Logged this week
							</div>
							<div>
								<CountUp
									to={37.5}
									delay={0.35}
									className="fm-serif"
									style={{
										fontSize: "72px",
										lineHeight: 0.75,
										letterSpacing: "-.01em",
									}}
								/>
								<span
									className="fm-serif"
									style={{ fontSize: "28px", color: "#a8a3ad" }}
								>
									h
								</span>
							</div>
							<div style={{ display: "flex", gap: "4px" }}>
								<motion.span
									variants={fillIn(0.45)}
									style={{
										flex: 1,
										height: "6px",
										borderRadius: "3px",
										background: "#7b54d6",
										originX: 0,
									}}
								/>
								<motion.span
									variants={fillIn(0.6)}
									style={{
										flex: 1,
										height: "6px",
										borderRadius: "3px",
										background: "#d98a2b",
										originX: 0,
									}}
								/>
								<motion.span
									variants={fillIn(0.75)}
									style={{
										flex: 0.5,
										height: "6px",
										borderRadius: "3px",
										background: "#2fa1a0",
										originX: 0,
									}}
								/>
							</div>
						</Tile>

						{/* Calendar-first tile (wide) */}
						<Tile
							className="fm-tile-wide"
							style={{
								gridColumn: "span 2",
								background: "#fff",
								border: "1px solid #e7e3e8",
								borderRadius: "18px",
								overflow: "hidden",
								display: "flex",
								flexDirection: "column",
							}}
						>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "9px",
									padding: "14px 18px",
									borderBottom: "1px solid #efece8",
								}}
							>
								<Clock size={15} strokeWidth={1.6} color="#6a45c8" />
								<span style={{ fontSize: "13px", fontWeight: 600 }}>
									See what's done, whenever
								</span>
								<span
									style={{
										marginLeft: "auto",
										fontSize: "11px",
										color: "#a8a3ad",
									}}
								>
									Jul 7 – 11
								</span>
							</div>
							<div
								className="fm-tile-wide-body"
								style={{
									flex: 1,
									display: "grid",
									gridTemplateColumns: "repeat(5,1fr)",
								}}
							>
								{weekDays.map((d, di) => (
									<div
										key={d.label}
										style={{
											borderRight: d.last ? undefined : "1px solid #efece8",
											padding: "7px 6px",
											background: d.active ? "#efeafb" : undefined,
										}}
									>
										<motion.div
											variants={fadeIn(0.15 + di * 0.08)}
											style={{
												fontSize: "9px",
												fontWeight: 600,
												color: d.active ? "#6a45c8" : "#a8a3ad",
												textTransform: "uppercase",
											}}
										>
											{d.label}
										</motion.div>
										{d.blocks.map((b, i) => (
											<motion.div
												// biome-ignore lint/suspicious/noArrayIndexKey: static decorative blocks
												key={i}
												variants={drop(
													0.25 + di * 0.09 + i * 0.07,
													b.shadow ? 0.4 : 0,
												)}
												style={{
													marginTop: i === 0 ? "5px" : "4px",
													height: `${b.h}px`,
													background: b.bg,
													borderLeft: `2px solid ${b.bl}`,
													borderRadius: "4px",
													boxShadow: b.shadow
														? "0 1px 5px -2px rgba(34,28,51,.4)"
														: undefined,
													originY: 0,
												}}
											/>
										))}
									</div>
								))}
							</div>
						</Tile>

						{/* Self-host tile */}
						<Tile
							delay={0.12}
							href={DOCS_URL}
							className="self-host-card"
							style={{
								background: "#efeafb",
								border: "1px solid #e3d9f7",
								borderRadius: "18px",
								padding: "22px",
								display: "flex",
								flexDirection: "column",
								justifyContent: "space-between",
							}}
						>
							<motion.span
								variants={stamp(0.3)}
								style={{ display: "inline-flex", alignSelf: "flex-start" }}
							>
								<Server size={20} strokeWidth={1.6} color="#6a45c8" />
							</motion.span>
							<h3
								className="fm-serif"
								style={{
									margin: 0,
									fontSize: "27px",
									lineHeight: 1.02,
									color: "#5b3aad",
								}}
							>
								Self-hostable.
								<br />
								No lock-in.
							</h3>
							<span
								className="u-link"
								style={{
									display: "inline-flex",
									alignSelf: "flex-start",
									alignItems: "center",
									gap: "5px",
									color: "#5b3aad",
									fontWeight: 600,
									fontSize: "12.5px",
								}}
							>
								Read the docs
								<ArrowRight size={14} strokeWidth={1.6} />
							</span>
						</Tile>
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
									background: "#efeafb",
									border: "1px solid #e3d9f7",
									borderRadius: "999px",
									font: "600 12px 'Geist',sans-serif",
									color: "#5b3aad",
									marginBottom: "22px",
								}}
							>
								<GitBranch size={14} strokeWidth={1.6} />
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
								<span style={{ fontStyle: "italic", color: "#6a45c8" }}>
									Yours to run.
								</span>
							</h2>
						</div>
						<div
							className="fm-os-actions"
							style={{ display: "flex", gap: "12px" }}
						>
							<a className="pill pill-dark" href={GITHUB_URL}>
								<GitBranch size={15} strokeWidth={1.6} /> View on GitHub
							</a>
							<DashLink orgSlug={orgSlug} className="pill">
								Open dashboard <ArrowRight size={15} strokeWidth={1.6} />
							</DashLink>
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
								style={{ fontWeight: 600, color: "#26232b" }}
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
