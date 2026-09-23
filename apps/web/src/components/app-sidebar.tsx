import {
	ArrowUpRightIcon,
	CaretDoubleLeftIcon,
	CaretDoubleRightIcon,
	CaretUpDownIcon,
	GithubLogoIcon,
	MoonIcon,
	SignOutIcon,
	SunIcon,
	UserSwitchIcon,
} from "@phosphor-icons/react";
import { usePostHog } from "@posthog/react";
import { useQuery } from "@tanstack/react-query";
import {
	Link,
	useLocation,
	useNavigate,
	useRouteContext,
	useRouter,
} from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ConversationList } from "#/components/assistant/chat-rail.tsx";
import { ContributorsCard } from "#/components/contributors-card.tsx";
import { OrgSwitcher } from "#/components/org-switcher.tsx";
import { PersonAvatar } from "#/components/person-avatar.tsx";
import {
	settingsNavGroups,
	settingsSubNavItems,
} from "#/components/settings-nav.tsx";
import { TimerCard } from "#/components/time/timer-row.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { FadeSwap } from "#/components/ui/fade-swap.tsx";
import { useScrollFade } from "#/components/ui/scroll-fade.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#/components/ui/tooltip.tsx";
import { useUnfiledCount } from "#/hooks/use-unfiled-count.ts";
import { authClient } from "#/lib/auth-client.ts";
import { stopImpersonating } from "#/lib/impersonation.ts";
import { githubLinks } from "#/lib/links.ts";
import { easeOut } from "#/lib/motion.ts";
import {
	setNavCollapsed,
	useNavCollapsed,
	useNavForced,
} from "#/lib/nav-collapse.ts";
import {
	activeNavTo,
	ASSISTANT_ITEM,
	isNavItemActive,
	isNavItemHere,
	type NavItem,
	REPORTS_ITEM,
	SETTINGS_ITEM,
	WORK_ITEMS,
} from "#/lib/nav-items.ts";
import { useTheme } from "#/lib/theme.ts";
import { cn } from "#/lib/utils.ts";
import { myAccessQuery } from "#/queries/access.ts";

/**
 * The shell's left edge: a NAV column that names the sections, and a PANEL
 * beside it that lists what is inside the one you are in.
 *
 * It replaces a single labelled column that had to carry both at once — four
 * work rows, a Settings row, and twelve settings pages unrolling underneath it,
 * plus a Browse/Chat switch to reach the assistant's threads. Depth goes
 * sideways now: the nav never changes, and the panel is the section's own
 * contents.
 *
 * **The panel exists only where there is a list to put in it** — Settings (the
 * hub's two groups) and Chat (the thread list). Home, Time, Projects and
 * Reports have no second level, so the nav keeps its labels there and the page
 * takes the width back. A panel drawn empty would be a promise of depth that
 * isn't there.
 *
 * **The nav collapses to an icon rail when a panel opens** — two labelled
 * columns side by side are two sidebars, and the second one is the specific
 * one. The reader can also collapse it themselves, anywhere, and that choice
 * sticks (`lib/nav-collapse.ts`).
 *
 * Both columns live in ONE island, rather than two with ground between them:
 * the nav is not a peer of the panel, it is what the panel belongs to. One
 * paper throughout, at both widths: the rail is the same surface as the page
 * beside it, and the hairline that appears once there are two columns is the
 * only thing that marks the boundary. A tinted rail made the shell read as
 * three materials for what is one sheet with a fold in it.
 */

/** Which list the panel is showing, or `null` for a section that has none. */
type PanelKind = "settings" | "chat" | null;

export function AppSidebar({
	orgSlug,
	organizationName,
	organizationLogo,
	isAdmin,
	isPlatformAdmin,
	userName,
	userEmail,
	userImage,
	singleOrg = false,
	assistantAvailable,
	timezone,
	impersonating = null,
}: {
	orgSlug: string;
	organizationName: string;
	organizationLogo?: string | null;
	isAdmin: boolean;
	/** `user.role`, not a workspace role. It adds one row to the settings
	 *  sub-menu — the deployment's own settings. */
	isPlatformAdmin: boolean;
	userName: string;
	userEmail: string;
	/** Straight off the session rather than through the org directory: this is
	 *  the one face on screen we already hold, and the sidebar paints before any
	 *  query resolves. */
	userImage: string | null;
	singleOrg?: boolean;
	/**
	 * Whether the assistant exists for this reader at all — the deployment flag
	 * AND a connected key AND not paused for this org, resolved once in the
	 * layout route. Deliberately not just `ASSISTANT_ENABLED`: a Chat row whose
	 * destination explains that it isn't connected is a row that shouldn't be
	 * there.
	 */
	assistantAvailable: boolean;
	/** The organization's timezone, for the unfiled worklist's "today". */
	timezone: string;
	/**
	 * The name of the person this session currently IS, when a platform admin
	 * reached it by impersonation. Null the rest of the time — which is almost
	 * always, so the row it draws costs a signed-in person nothing.
	 */
	impersonating?: string | null;
}) {
	const newIssueUrl = useRouteContext({
		from: "/$orgSlug",
		select: (context) => githubLinks(context.repository).newIssue,
	});
	const pathname = useLocation({ select: (location) => location.pathname });
	const searchStr = useLocation({ select: (location) => location.searchStr });
	const navigate = useNavigate();

	const panelScrollRef = useRef<HTMLDivElement>(null);
	useScrollFade(panelScrollRef);
	const navScrollRef = useRef<HTMLDivElement>(null);
	useScrollFade(navScrollRef);

	// Not a suspense query: the shell is always mounted and shouldn't block or
	// suspend on this. Clients are gated on a per-project lead role (or a people
	// list), which the org role alone can't tell us.
	const { data: access } = useQuery(myAccessQuery(orgSlug));
	const canManageClients = isAdmin || !!access?.isLeadSomewhere;

	const inSettings = isNavItemActive(pathname, SETTINGS_ITEM.to, orgSlug);
	const onAssistant = isNavItemActive(pathname, ASSISTANT_ITEM.to, orgSlug);
	const panel: PanelKind = inSettings
		? "settings"
		: onAssistant
			? "chat"
			: null;

	// Three things collapse the column and they are not the same thing: a panel
	// (the URL's doing, and the server knows it), the reader's own choice
	// (localStorage, which the server does not) and a window under `lg` (neither
	// knows, so it is read from the window itself). The width comes off CSS
	// either way — see `.app-nav` in styles.css — and this is only what the ROWS
	// are drawn from, which is why the pref being a frame late costs nothing.
	//
	// `navCollapsed` already covers the narrow window, because that is where the
	// attribute is decided. `navForced` is the separate question the toggle asks:
	// whether the reader could expand it if they pressed.
	const navCollapsed = useNavCollapsed();
	const navForced = useNavForced();
	const collapsed = panel !== null || navCollapsed;

	// What the panel DRAWS, which is not what the panel IS: on the way out it
	// keeps the list it was showing, so a closing panel narrows around its own
	// contents instead of emptying itself first and then shrinking. `panel` is
	// still what decides whether it is open.
	const lastPanel = useRef<Exclude<PanelKind, null>>("settings");
	if (panel !== null) lastPanel.current = panel;
	const shown = panel ?? lastPanel.current;

	const settingsGroups = settingsNavGroups({
		isAdmin,
		canManageClients,
		isPlatformAdmin,
	});

	// The nav's own rows: the four work screens, then the assistant where it is
	// available. Reports joins the work group rather than standing alone — a
	// report is read off the same work the three rows above it are about.
	const navItems: NavItem[] = [
		...WORK_ITEMS,
		REPORTS_ITEM,
		...(assistantAvailable ? [ASSISTANT_ITEM] : []),
	];

	// Which single row is lit, resolved over every destination either column can
	// reach — the nav's, plus the settings pages when the panel is carrying
	// them. Longest match wins, so `/acme/settings/tasks` lights the Tasks row in
	// the panel AND the Settings row in the nav without either being a guess.
	const activeTo = activeNavTo(
		pathname,
		[
			...navItems,
			SETTINGS_ITEM,
			...(inSettings
				? settingsSubNavItems({ isAdmin, canManageClients, isPlatformAdmin })
				: []),
		],
		orgSlug,
	);
	// The nav marks the SECTION, which is the settings hub for every page under
	// it — the panel says which one.
	const activeSection = inSettings ? SETTINGS_ITEM.to : activeTo;

	// Which edge each column's active background grows from. The nav's order is
	// the order its rows are drawn in; the panel's is the settings list flattened,
	// because that is the only list `panelLink` draws.
	const navFillFrom = useFillFrom(
		[...navItems.map((item) => item.to), SETTINGS_ITEM.to],
		activeSection,
	);
	const panelFillFrom = useFillFrom(
		settingsGroups.flatMap((group) => group.items.map((item) => item.to)),
		activeTo,
	);

	// Unattributed time, on the row that leads to the screen that files it.
	// Everything the sync engines write lands project-less, so this is the one
	// number in the app that grows while nobody is looking at it.
	const unfiledCount = useUnfiledCount(orgSlug, timezone);

	// Navigate on mouse *press* rather than the full click (press + release) so
	// the nav feels instant, then swallow the trailing click so the navigation
	// does not happen twice.
	//
	// What is remembered is the ELEMENT pressed, not a boolean. A press that ends
	// somewhere else — press a row, drag off it, release — fires no click on that
	// row at all, so a boolean set on the press had nothing to clear it and
	// stayed true; the ref is shared by every row, so the next keyboard Enter on
	// ANY of them was swallowed and went nowhere. Comparing against
	// `e.currentTarget` makes an unanswered press only ever affect the one row it
	// was made on, and clearing on `keydown` closes even that: a keyboard
	// activation always sends keydown before click, a mouse press never does.
	const pressedRef = useRef<EventTarget | null>(null);
	//
	// Only the screen already on show is a no-op. A lit row is lit for every page
	// under it, and from one of those the press goes back to the section's first
	// screen — see `isNavItemHere`.
	const pressToNavigate = (item: NavItem) => {
		const isHere = isNavItemHere(pathname, searchStr, item.to, orgSlug);
		return {
			onMouseDown: (e: React.MouseEvent) => {
				pressedRef.current = null;
				// Only fast-path a plain primary-button press. Modifier / middle clicks
				// fall through so the browser can open a new tab; keyboard activation
				// has no mousedown and navigates on click below.
				if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
					return;
				pressedRef.current = e.currentTarget;
				if (!isHere) navigate({ to: item.to, params: { orgSlug } });
			},
			onKeyDown: () => {
				pressedRef.current = null;
			},
			onClick: (e: React.MouseEvent) => {
				// This row's own press already navigated on mousedown — swallow its
				// click. Keyboard Enter reaches here with the ref cleared and navigates
				// normally, except on the screen already on show, which stays a no-op.
				const pressedHere = pressedRef.current === e.currentTarget;
				pressedRef.current = null;
				if (pressedHere || isHere) e.preventDefault();
			},
		};
	};

	/** A nav row, in whichever of the column's two widths it is being drawn at. */
	const navRow = (item: NavItem, badge?: number) => {
		const isActive = activeSection === item.to;
		return (
			<Tooltip key={item.to}>
				<TooltipTrigger
					render={
						<Link
							to={item.to}
							params={{ orgSlug }}
							aria-label={item.label}
							aria-current={isActive ? "page" : undefined}
							className={navRowClass}
							{...pressToNavigate(item)}
						>
							{isActive && (
								<ActiveFill from={navFillFrom} className="rounded-xl" />
							)}
							{/* The icon and, at rail width, the count on its corner — in one
							    relative box. The row is the full width of the column now, so a
							    badge anchored to the ROW's corner would sit out in the padding
							    with nothing under it. */}
							<span className="relative flex shrink-0 items-center">
								<item.icon className="size-4.5 shrink-0" />
								{badge !== undefined && badge > 0 && (
									<Badge
										variant="secondary"
										className="nav-rail-badge absolute -top-1.5 -right-2 h-4 min-w-4 justify-center px-1 text-[10px] leading-none tabular-nums"
									>
										{badge > 99 ? "99+" : badge}
									</Badge>
								)}
							</span>
							{/* The label band — see `.nav-label` in styles.css. Always
							    mounted and OUT OF FLOW, so it can fade instead of vanishing
							    in one frame without ever being able to widen the row.

							    A count, not a dot: how much unattributed time is waiting
							    decides whether you deal with it now, and "some" does not. It
							    follows the label here; at rail width there is no label, so it
							    moves onto the icon's corner above. */}
							<span className="nav-label">
								<span className="min-w-0 flex-1 truncate text-base">
									{item.label}
								</span>
								{badge !== undefined && badge > 0 && (
									<Badge
										variant="secondary"
										className="h-5 min-w-5 shrink-0 justify-center px-1.5 text-2xs tabular-nums"
									>
										{badge > 99 ? "99+" : badge}
									</Badge>
								)}
							</span>
						</Link>
					}
				/>
				{/* Only where the label is gone. Same rule the shadcn sidebar uses:
				    the trigger is always wrapped, so collapsing does not remount the
				    row. */}
				<TooltipContent side="right" sideOffset={8} hidden={!collapsed}>
					{item.label}
				</TooltipContent>
			</Tooltip>
		);
	};

	const panelLink = (item: NavItem) => {
		const isActive = activeTo === item.to;
		return (
			<li key={item.to}>
				<Link
					to={item.to}
					params={{ orgSlug }}
					aria-current={isActive ? "page" : undefined}
					className={cn(
						"relative flex items-center rounded-lg px-2.5 py-1.5 text-base ring-sidebar-ring outline-hidden transition-colors duration-(--dur-base) focus-visible:ring-2",
						isActive
							? "font-medium text-foreground"
							: "text-sidebar-foreground hover:text-foreground",
					)}
					{...pressToNavigate(item)}
				>
					{isActive && (
						<ActiveFill from={panelFillFrom} className="rounded-lg" />
					)}
					{/* No icon, unlike the nav: the nav already carries the glyph for the
					    section these pages belong to, and a second column of them at this
					    width leaves the labels nowhere to go. */}
					<span className="relative min-w-0 truncate">{item.label}</span>
				</Link>
			</li>
		);
	};

	return (
		<TooltipProvider delay={300}>
			<div
				// Sticks to the top of the frame rather than the viewport, and stops a
				// frame-padding short of the bottom, so the island keeps ground visible
				// on all four sides as the page scrolls past it.
				// `data-panel` sits here rather than on the nav alone: BOTH columns
				// size off it (`.app-nav` and `.app-panel` in styles.css), so one
				// attribute on their common parent is one style recalculation and
				// therefore one start time for the two transitions.
				data-panel={panel ?? undefined}
				className="island sticky top-(--frame-pad) hidden h-[calc(100*var(--svh)-2*var(--frame-pad))] shrink-0 self-stretch text-sidebar-foreground md:flex"
			>
				{/* ── the nav column ───────────────────────────────────────────── */}
				<nav
					aria-label="Sections"
					// `data-panel` is what collapses it beside an open panel, and what
					// earns it the hairline: with no panel this column IS the page's own
					// surface, cut from one sheet. The hairline is a color rather than a
					// border that comes and goes — see `.app-nav` in styles.css.
					data-panel={panel ?? undefined}
					className="app-nav flex shrink-0 flex-col overflow-hidden"
				>
					<div className="flex min-h-0 flex-1 flex-col">
						{/* A ROW at both widths, holding one thing. It used to become a
						    column when collapsed so the toggle could sit under the mark, and
						    `items-center` in a flex COLUMN centres horizontally — which rode
						    the switcher in from the right as the column shut. It also made the
						    header two different heights, so every icon under it stepped down
						    when a panel opened. The toggle lives at the foot now, so there is
						    nothing left here to stack. */}
						<div className="flex shrink-0 items-center px-2 pt-2.5">
							<OrgSwitcher
								orgSlug={orgSlug}
								organizationName={organizationName}
								organizationLogo={organizationLogo}
								singleOrg={singleOrg}
							/>
						</div>
						<div
							ref={navScrollRef}
							className={cn(
								// ONE padding at both widths, and no `items-center`, and no
								// `justify-center` on the rows. Three separate reasons, one
								// rule:
								//
								// `items-center` sized each row to its CONTENT, so a collapsed
								// row was 18px — its icon — and the active pill, which is
								// `inset-0` of the row, came out as a narrow capsule pinched
								// around the glyph instead of a square behind it.
								//
								// `justify-center` re-centred the icon the instant `collapsed`
								// flipped, while the column still had its old width. Collapsing
								// therefore threw the icons into the middle of a 240px box and
								// then dragged them left as the edge came in — which reads as
								// the rail sliding in from the right rather than the column
								// closing.
								//
								// Left-aligned at one padding, the icon does not move at all:
								// it sits 18px from the column's edge whatever that column is
								// currently doing, and only the labels beside it come and go.
								// `overflow-x-hidden` because `.scroll-fade` sets `overflow-y: auto`,
								// and CSS then forces `overflow-x` to `auto` as well. Expanding
								// mounts every label while the column is still 56px wide, which
								// overflows it by 14px for a few frames — long enough for a
								// horizontal scrollbar to flash across the foot of the column.
								"scroll-fade mt-1 flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden px-2",
							)}
						>
							{navItems.map((item) =>
								navRow(
									item,
									item.to === "/$orgSlug/time" ? unfiledCount : undefined,
								),
							)}
							{/* Settings closes the list of places rather than standing apart at
							    the foot: the panel it opens is the same kind of thing the other
							    rows lead to, and a row held down by a spacer reads as a
							    different class of destination than it is. */}
							{navRow(SETTINGS_ITEM)}
							<div className="flex-1" />
							{/* The two rows the spacer holds at the foot: neither is a place in
							    the app. A nav row like every other one — same height, same
							    padding, same icon size — so they line up with the glyphs above
							    them at both widths.

							    No toggle while a panel is open: the panel IS the column's
							    expansion, and a control that would put two labelled lists side
							    by side is a control with nowhere to go. It FADES and CLOSES,
							    rather than unmounting — the two rows above it ride down into the
							    space it gives up on the column's own clock, and back up when the
							    panel shuts. Unmounting the row covered that distance in one
							    frame, and keeping the space and fading alone covered none of it:
							    the rows then stood over a 44px hole for as long as the panel was
							    open. The height belongs to `.nav-toggle-slot` in styles.css, on
							    the panel's `--dur-long`. `inert` is what "gone" means for a
							    reader who is not looking at it.

							    `navCollapsed`, not `collapsed`: a panel forces the rail, so
							    `collapsed` would flip the carets round halfway through the fade
							    for a state the button does not control. */}
							{/* Above the toggle rather than at the very foot: the two rows
							    under it are furniture that never changes, and a warning that
							    sits below the furniture reads as more of it. Nothing else is
							    moved or hidden while it is up — the app is meant to look
							    exactly as it does for the person being impersonated, which
							    is the entire point of looking at it. */}
							{/* A stopwatch is the one piece of state that is true while you
							    are looking at something else, so it lives in the furniture
							    rather than on the timesheet — the unfiled badge is in this
							    column for the same reason. It draws nothing at all unless a
							    timer is running.

							    Not a nav row: it is a control card, and it keeps its own
							    height at both widths. `.timer-card` in styles.css crosses
							    between the two on the column's own clock. */}
							<TimerCard orgSlug={orgSlug} timezone={timezone} />
							{impersonating !== null && (
								<ImpersonationRow name={impersonating} collapsed={collapsed} />
							)}
							<CollapseToggle
								collapsed={navCollapsed}
								hidden={panel !== null || navForced}
							/>
							<Tooltip>
								<TooltipTrigger
									render={
										<a
											href={newIssueUrl}
											target="_blank"
											rel="noreferrer"
											aria-label="Report a problem"
											className={cn(navRowClass, "mb-2.5")}
										>
											<GithubLogoIcon className="relative size-4.5 shrink-0" />
											<span className="nav-label">
												<span className="min-w-0 flex-1 truncate text-base">
													Report a problem
												</span>
												<ArrowUpRightIcon
													weight="regular"
													className="size-3.5 shrink-0 text-muted-foreground"
												/>
											</span>
										</a>
									}
								/>
								<TooltipContent
									side="right"
									sideOffset={8}
									hidden={!collapsed}
									className="gap-1"
								>
									Report a problem
									<ArrowUpRightIcon weight="regular" className="size-3" />
								</TooltipContent>
							</Tooltip>
						</div>
					</div>
					{/* Fixed height, not padding, and the one hairline inside the
					    column: the timesheet's own footer aligns to this rule (see
					    `--footer-h`), so the two islands close on the same line. */}
					<div
						className={cn(
							"flex h-(--footer-h) shrink-0 items-center border-t",
							"px-2",
						)}
					>
						<UserMenu
							userName={userName}
							userEmail={userEmail}
							userImage={userImage}
							isAdmin={isAdmin}
							collapsed={collapsed}
						/>
					</div>
				</nav>

				{/* ── the panel ────────────────────────────────────────────────── */}
				{/* It OPENS rather than appearing, and closes the same way, because the
				    nav column beside it is shedding its labels at that moment — the two
				    together read as the list stepping sideways out of the column rather
				    than as the shell being rebuilt.

				    Always mounted, and sized by CSS off the island's `data-panel` — see
				    `.app-panel` in styles.css for why the width cannot be a Motion value
				    beside a CSS transition. `inert` is what closing it means for anyone
				    not looking at it: at zero width the rows are still in the tree, and
				    without this they stay tabbable and readable. */}
				<div className="app-panel" inert={panel === null}>
					<div className="flex h-full w-60 flex-col">
						{/* The section's name, once, as a title — the rail beside it
						    carries no label, so without this nothing on screen says which
						    section the list belongs to. */}
						<div className="shrink-0 px-4 pt-4 pb-2">
							<h2 className="h2">
								{shown === "settings" ? "Settings" : "Chats"}
							</h2>
						</div>
						{/* `overflow-x-hidden` for the reason the nav column above carries it:
						    `.scroll-fade` sets `overflow-y: auto`, and CSS then forces
						    `overflow-x` to `auto` as well. This box is a fixed `w-60` inside an
						    `.app-panel` whose width animates from 0, and the thread rows animate
						    their own position on top of that — so opening the panel, or a thread
						    lifting back to the top of the list, leaves content wider than the box
						    for a few frames. What that cost was a horizontal scrollbar under a
						    column with nothing to scroll sideways to. */}
						<div
							ref={panelScrollRef}
							className="scroll-fade min-h-0 flex-1 overflow-x-hidden px-2.5 pb-2.5"
						>
							{/* The two lists are a swap, not a replacement — the same
							    crossfade the rest of the app uses for a panel change, because
							    that is what this is. */}
							<FadeSwap activeKey={shown} className="flex flex-col">
								{shown === "settings" ? (
									settingsGroups.map((group) => (
										<div key={group.key} className="flex flex-col">
											{/* The heading the hub uses over the same rows. Twelve
											    labels at one indent are a list; the two headings are
											    what make them two groups you can scan. */}
											<div className="eyebrow px-2.5 pt-3 pb-1.5">
												{group.label}
											</div>
											<ul className="flex flex-col gap-px">
												{group.items.map(panelLink)}
											</ul>
										</div>
									))
								) : (
									<div className="pt-1">
										<ConversationList orgSlug={orgSlug} />
									</div>
								)}
							</FadeSwap>
						</div>
						{/* The panel's foot, and the one thing in either column that is
						    about the APP rather than about this workspace: who built it,
						    and which commit is running. It closes the settings list the way
						    a colophon closes a book — below everything, at the bottom of
						    the one screen where "what is this thing" is a question somebody
						    is already having.

						    Outside the scroll area, so it stays put while twelve settings
						    rows move past it. Its own `FadeSwap` on the same key as the
						    list above, so switching to Chat takes it out with the same
						    crossfade rather than snapping it away — and, being a swap
						    rather than a hidden element, it reserves no empty band under
						    the thread list.

						    No padding from here: it is a band the width of the panel, and
						    its contents sit on the same 1rem margin the panel's own title
						    does. */}
						<FadeSwap activeKey={shown} className="shrink-0">
							{shown === "settings" && <ContributorsCard />}
						</FadeSwap>
					</div>
				</div>
			</div>
		</TooltipProvider>
	);
}

/**
 * Which edge the lit row's background grows from: the one the reader came from.
 * Moving down the column fills from the top, moving up fills from the bottom,
 * and the first paint does not fill at all.
 *
 * `null` for a render that changed nothing, which is every render except the
 * one a navigation commits — the fill element does not remount then, so its
 * `initial` is never read again and the answer costs nothing.
 */
function useFillFrom(
	order: string[],
	active: string | null,
): "top" | "bottom" | null {
	// -1 for a column with nothing lit — the chat panel draws no `panelLink` at
	// all — which compares like any other position, so arriving from it fills
	// downwards and nothing has to special-case it.
	const index = active === null ? -1 : order.indexOf(active);
	// Read during render and written after it: on the render that commits a
	// navigation this still holds where the reader WAS, which is the whole
	// question being asked.
	const previous = useRef<number | null>(null);
	useEffect(() => {
		previous.current = index;
	}, [index]);
	if (previous.current === null || previous.current === index) return null;
	return index > previous.current ? "top" : "bottom";
}

/**
 * The lit row's background.
 *
 * A background ON the row, not a pill that travels between rows. The pill was a
 * `layoutId` shared element, which put an object in the sidebar that existed
 * independently of any row and slid around behind them — and beside the
 * column's own width transition it was a second clock: it measured its
 * destination while `.app-nav` was still at its old width, glided to a box that
 * was no longer there, and snapped. Filling in place has no destination to
 * measure and nothing to keep in step with.
 *
 * `clip-path` rather than `scaleY`, which would squash the corner radius on the
 * way in. The element keeps its own radius and the clip simply uncovers it.
 */
function ActiveFill({
	from,
	className,
}: {
	from: "top" | "bottom" | null;
	className?: string;
}) {
	// The app's own "Less movement" switch reaches Motion through
	// `MotionGlobalConfig.instantAnimations`; this is the OS preference, which
	// only `useReducedMotion` can see.
	const reduced = useReducedMotion();
	return (
		<motion.span
			aria-hidden
			initial={
				from === null || reduced
					? false
					: {
							clipPath:
								from === "top" ? "inset(0 0 100% 0)" : "inset(100% 0 0 0)",
						}
			}
			animate={{ clipPath: "inset(0 0 0 0)" }}
			// 180ms is `--dur-slow`, and `easeOut` is `--ease-out`. Both are typed
			// here because a Motion transition cannot read a CSS custom property.
			transition={{ duration: 0.18, ease: easeOut }}
			className={cn("absolute inset-0 bg-sidebar-accent", className)}
		/>
	);
}

/** Every nav row's shape, at either width. `relative` carries the active fill. */
const navRowBase =
	"relative flex h-10 shrink-0 items-center gap-2.5 rounded-xl px-2.5 text-sidebar-foreground ring-sidebar-ring outline-hidden hover:text-foreground focus-visible:ring-2 active:scale-[0.97]";

/**
 * The shape plus the hover/press transition every row but one carries.
 *
 * Split from the base because a Tailwind `transition-*` class lands in
 * `@layer utilities`, which beats anything `@layer components` says about
 * `transition-property` no matter how the selector is written. A row that needs
 * CSS to fade it — `.nav-toggle`, which crosses on the panel's own clock and
 * not on this one — must therefore NOT carry this, or the stylesheet's
 * transition is silently dropped and the element snaps.
 */
const navRowClass = `${navRowBase} transition-[color,transform] duration-(--dur-base)`;

/**
 * "You are not you" — the one row in the column that is a warning.
 *
 * It has to be here, in the furniture, rather than in a banner over the page:
 * the sidebar is the one surface that is on screen on every route, and
 * impersonation is a state you can forget you are in and then act from. A
 * dismissible banner would be worse than nothing, because dismissing it is the
 * thing somebody does two minutes before they edit the wrong person's
 * timesheet.
 *
 * It carries the name, and pressing it stops. Those are deliberately the same
 * control: the row is an alarm, and an alarm with no way to silence it teaches
 * people to look past it. `--warn` rather than `--destructive`: red means an
 * error or an action that removes something, and stopping removes nothing — the
 * row marks a state to be careful in.
 *
 * At rail width the name is gone with every other label, so the tooltip
 * carries it — this is the row where "an icon you have to hover to read" is
 * least acceptable, and the amber glyph is at least unlike anything else in the
 * column.
 */
function ImpersonationRow({
	name,
	collapsed,
}: {
	name: string;
	collapsed: boolean;
}) {
	const [stopping, setStopping] = useState(false);
	const stop = () => {
		// No `finally`: on success this navigates the document away, and clearing
		// the flag would only re-enable a button on a page that is leaving.
		setStopping(true);
		stopImpersonating().catch((error: Error) => {
			setStopping(false);
			toast.error(error.message);
		});
	};
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						onClick={stop}
						disabled={stopping}
						aria-label={`Impersonating ${name} — stop`}
						className={cn(
							navRowClass,
							"text-left text-warn hover:bg-warn/10 hover:text-warn",
							"disabled:pointer-events-none disabled:opacity-60",
						)}
					>
						<UserSwitchIcon
							weight="fill"
							className="relative size-4.5 shrink-0"
						/>
						{/* Two lines in the band the other rows use for one: the state
						    and who you are in it are both load-bearing, and "Impersonating"
						    alone leaves you checking the account menu to find out who. */}
						<span className="nav-label">
							<span className="min-w-0 flex-1">
								<span className="block truncate text-2xs">
									{stopping ? "Stopping…" : "Impersonating"}
								</span>
								<span className="block truncate text-sm font-medium">
									{name}
								</span>
							</span>
							<SignOutIcon weight="fill" className="size-3.5 shrink-0" />
						</span>
					</button>
				}
			/>
			<TooltipContent side="right" sideOffset={8} hidden={!collapsed}>
				Impersonating {name} — stop
			</TooltipContent>
		</Tooltip>
	);
}

/**
 * The switch between the labelled column and the icon rail.
 *
 * Its own control rather than a keyboard shortcut alone: the rail is what the
 * app looks like inside Settings, so somebody who wants it everywhere has seen
 * it and has to be able to ask for it.
 */
function CollapseToggle({
	collapsed,
	hidden = false,
	className,
}: {
	collapsed: boolean;
	/** A panel is open, so the control has nowhere to go. It fades and closes
	 *  its own height instead of unmounting — see the call site. */
	hidden?: boolean;
	className?: string;
}) {
	const label = collapsed ? "Expand the sidebar" : "Collapse the sidebar";
	// The carets point the way the column is about to travel, so the control says
	// what it does rather than what it is: closed, they point right, because that
	// is where the edge goes when you press it.
	const Caret = collapsed ? CaretDoubleRightIcon : CaretDoubleLeftIcon;
	return (
		// The height that closes, and the only reason for a wrapper here: the
		// button carries `h-10` as a utility, which no rule in the stylesheet can
		// talk down. See `.nav-toggle-slot` in styles.css.
		<div className="nav-toggle-slot">
			<Tooltip>
				<TooltipTrigger
					render={
						<button
							type="button"
							onClick={() => setNavCollapsed(!collapsed)}
							aria-label={label}
							inert={hidden}
							// `text-left` because this row is a <button>, and a button centres its
							// text where the <a> rows beside it do not.
							// `navRowBase`, not `navRowClass`: this row's transition is the
							// stylesheet's, because it fades on the panel's `--dur-long` while
							// the rows above it hover on `--dur-base`. See `navRowClass`.
							className={cn(navRowBase, "nav-toggle text-left", className)}
						>
							<Caret
								weight="regular"
								className="relative size-4.5 shrink-0 text-muted-foreground"
							/>
							<span className="nav-label">
								<span className="min-w-0 flex-1 truncate text-base">
									Collapse
								</span>
							</span>
						</button>
					}
				/>
				<TooltipContent
					side="right"
					sideOffset={8}
					hidden={!collapsed || hidden}
				>
					{label}
				</TooltipContent>
			</Tooltip>
		</div>
	);
}

/**
 * The signed-in person, at the foot of the column.
 *
 * A menu rather than the row of controls the old sidebar had: on the rail there
 * are 56px to fit a name, a role, a theme switch and a sign-out across, and two
 * different footers for one column is two things to keep in step. Everything
 * that was on that row is in here, plus the email, which was only ever a
 * `title` attribute before.
 */
function UserMenu({
	userName,
	userEmail,
	userImage,
	isAdmin,
	collapsed,
}: {
	userName: string;
	userEmail: string;
	userImage: string | null;
	isAdmin: boolean;
	collapsed: boolean;
}) {
	const router = useRouter();
	const posthog = usePostHog();
	const { theme, toggle } = useTheme();
	// Shows the theme you'd get by choosing it, not the one you're in: the item
	// is a destination, and "Light mode" on a light page is a statement of the
	// obvious.
	const nextTheme = theme === "dark" ? "light" : "dark";
	const ThemeIcon = theme === "dark" ? SunIcon : MoonIcon;

	const handleLogout = async () => {
		await authClient.signOut();
		posthog.reset();
		await router.invalidate();
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<button
						type="button"
						aria-label={`Account: ${userName}`}
						className={cn(
							"relative flex items-center rounded-xl ring-sidebar-ring outline-hidden transition-colors duration-(--dur-base) focus-visible:ring-2",
							// `p-1.5` and the same corner at both widths, so the avatar
							// keeps its position on the left instead of centring itself in a
							// column that is about to close.
							"gap-2.5 p-1.5 text-left hover:bg-muted",
							!collapsed && "w-full",
						)}
					>
						<PersonAvatar
							name={userName}
							image={userImage}
							size="sm"
							className="size-7"
						/>
						{/* The same out-of-flow band the nav rows use, at this row's own
						    geometry — a bigger mark and less padding, so it takes the
						    modifier. See `.nav-label` in styles.css. */}
						<span className="nav-label nav-label-user">
							<span className="min-w-0 flex-1">
								<span className="block truncate text-sm font-medium">
									{userName}
								</span>
								{!isAdmin && (
									<span className="block truncate text-2xs text-muted-foreground">
										Member
									</span>
								)}
							</span>
							<CaretUpDownIcon
								weight="regular"
								className="size-3.5 shrink-0 text-muted-foreground"
							/>
						</span>
					</button>
				}
			/>
			<DropdownMenuContent side="right" align="end" className="w-56">
				{/* Base UI's GroupLabel reads a group context, so it needs the Group
				    around it — outside one it throws rather than rendering plain. */}
				<DropdownMenuGroup>
					<DropdownMenuLabel className="flex flex-col gap-0.5">
						<span className="truncate font-medium text-foreground">
							{userName}
						</span>
						<span className="truncate text-2xs font-normal text-muted-foreground">
							{userEmail}
						</span>
					</DropdownMenuLabel>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={toggle}>
					<ThemeIcon weight="fill" className="size-4" />
					Switch to {nextTheme} mode
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={handleLogout}>
					<SignOutIcon weight="fill" className="size-4" />
					Log out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
