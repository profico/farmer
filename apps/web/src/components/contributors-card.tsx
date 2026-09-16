import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { type CSSProperties, useSyncExternalStore } from "react";

import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "#/components/ui/avatar.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover.tsx";
import { GITHUB_URL, PROJECT_TAGLINE } from "#/lib/links.ts";
import { springProductive } from "#/lib/motion.ts";
import { cn, getInitials } from "#/lib/utils.ts";
import { deploymentInfoQuery } from "#/queries/about.ts";
import type { Contributor } from "#/server/deployment-info.ts";

/**
 * Who built this, at the foot of Settings.
 *
 * It is the whole of what was going to be an About page. A page would have been
 * a destination nobody navigates to, holding one fact; the same fact sits at
 * the bottom of a screen people already open, where "who made this" is a
 * question somebody has while they are there.
 *
 * **A band, not a card, and the account row's band exactly.** It takes
 * `--footer-h` and its own hairline, so the rule that closes the panel and the
 * rule that closes the nav column beside it are ONE line across the app's foot
 * — the same way the timesheet's footer aligns to it. A bordered box floating
 * inside a 240px column read as a widget somebody dropped in, and a band of its
 * own height read as a near miss, which is worse than either.
 *
 * The fixed height is what decides the contents: one row, the count on the
 * left and the faces pushed to the right edge, so the band reads across the
 * column rather than as a clump at one end of it. There is no GitHub mark and
 * no second line — a stack of faces beside the word "contributors" says whose
 * repository it is without a logo, and a colophon does not need to introduce
 * itself twice. The count is muted: it labels the faces, and the faces are the
 * thing.
 *
 * `--colophon-px` is the horizontal margin the contents sit on, because the
 * padding has to be on the CONTROL rather than on the block for the fill to
 * reach the edges — so a caller that bleeds the band to a wider gutter
 * (Settings, below `md`) moves the two together instead of nesting one inside
 * the other.
 *
 * **A few faces and a +N, because a few is what fits and eleven is what
 * matters.** The stack is a count you can see rather than read, and the number
 * beside it is the honest remainder. Opening it — by hover or by click, the
 * same control either way — is what turns the count into people, since a touch
 * screen has no hover and a stack that only answers to a pointer answers to
 * nobody on a phone.
 *
 * Renders nothing at all when the deployment has nobody to show — no GitHub
 * App configured is a perfectly ordinary way to run this, and an empty band
 * explaining its own absence is worse than none.
 *
 * **It arrives, it does not appear.** Nothing here is worth interrupting the
 * page for, so the question is only whether the reader sees it turn up. Two
 * answers, in this order: after a first visit it is drawn from the stored
 * answer in the first frame and there is nothing to see (`queries/about.ts`),
 * and when it genuinely does arrive late it rises the house four pixels into
 * place on `springProductive` rather than switching itself on. It rises rather
 * than falls because it is docked to the bottom of what it sits in, so it
 * enters from the edge it belongs to.
 */

/** The most faces the stack draws before the rest become a number. Five and
 *  the remainder is what leaves the label its room on one 240px row — the row
 *  is the constraint now, not the reader's patience for circles. */
const MAX_FACES = 5;

/** How much of a face the next one covers. A quarter keeps every avatar
 *  recognizable while the row still reads as one stack and not as a list. */
const OVERLAP = 0.25;

/** How big a face is drawn, in pixels. One size in both bands rather than a
 *  size solved from the room each one has: the stack is a COUNT, and a count
 *  drawn at portrait size in a page's measure asks to be looked at instead of
 *  read past. Smaller than the account row's mark beside it, because this row
 *  is about a group and that one is about you. */
const FACE = 18;

/** How much of a face the next one covers, in pixels. */
const FACE_OVERLAP = Math.round(FACE * OVERLAP);

/** How far the colophon travels as it arrives. The same four pixels `FadeSwap`
 *  moves the panels through, because it is the same house entrance. */
const ENTER_TRAVEL = 4;

const neverChanges = () => () => {};
const onClient = () => true;
const onServer = () => false;

export function ContributorsCard({ className }: { className?: string }) {
	// Not a suspense query: this is a footer on a screen whose contents are the
	// point, and it reaches GitHub. It arrives when it arrives.
	const { data } = useQuery(deploymentInfoQuery());
	const contributors = data?.contributors ?? [];

	// The stored answer is on the DEVICE, so the server cannot know it and
	// renders nothing. Held back until the document is hydrated, the two agree —
	// without this, a repeat visitor's first client render adds a card the
	// server's HTML does not have, which is a hydration mismatch and costs the
	// whole subtree a re-render. `useSyncExternalStore` is how the rest of the
	// app asks this question (`lib/nav-collapse.ts`, `lib/theme.ts`).
	const hydrated = useSyncExternalStore(neverChanges, onClient, onServer);

	const ready = hydrated && contributors.length > 0;

	return (
		// Its own `AnimatePresence`, and that is not decoration. In the sidebar
		// this sits inside `FadeSwap`, whose `<AnimatePresence initial={false}>`
		// puts `initial: false` on the context every motion component under it
		// reads — so without a presence scope of its own the card would skip its
		// entrance and blink on at full opacity, which is the exact thing being
		// fixed. It also buys a symmetric exit: the card leaves the way it came.
		<AnimatePresence>
			{ready && (
				<motion.div
					// Reduced motion is the root `<MotionConfig reducedMotion="user">`:
					// it drops the travel and leaves the fade, which is the whole point
					// of putting the movement in motion rather than in a keyframe.
					initial={{ opacity: 0, y: ENTER_TRAVEL }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: ENTER_TRAVEL }}
					transition={springProductive}
					className={cn(
						"flex h-(--footer-h) shrink-0 items-center border-t [--colophon-px:1rem]",
						className,
					)}
				>
					<Popover>
						<PopoverTrigger
							// `openOnHover` AND a click, which is one control with two ways
							// in rather than two behaviours: the pointer gets the roster for
							// free on the way past, and a finger gets it by tapping. The
							// delay is the tooltip's, so brushing the card on the way to a
							// settings row does not open anything.
							openOnHover
							delay={300}
							closeDelay={100}
							render={
								<button
									type="button"
									// The fill runs edge to edge, so the focus ring has to be
									// drawn INSIDE it: a ring on a box whose sides are the
									// column's sides is clipped down to its top and bottom.
									className="group/card flex h-full w-full items-center justify-between gap-2.5 px-(--colophon-px) text-left ring-sidebar-ring transition-colors duration-(--dur-fast) outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset"
								>
									<span className="min-w-0 truncate text-sm text-muted-foreground transition-colors duration-(--dur-fast) group-hover/card:text-foreground">
										{contributors.length} contributor
										{contributors.length === 1 ? "" : "s"}
									</span>
									<ContributorStack contributors={contributors} />
								</button>
							}
						/>
						<PopoverContent
							side="top"
							align="start"
							className="flex w-64 flex-col gap-2 p-3"
						>
							<div className="eyebrow">
								{contributors.length} contributor
								{contributors.length === 1 ? "" : "s"}
							</div>
							<p className="text-sm leading-snug text-muted-foreground">
								{PROJECT_TAGLINE}
							</p>
							{/* Scrolls rather than growing: the list is however long the
								    repository's history says it is, and a popover taller than the
								    sidebar has nowhere to be drawn.

								    `overflow-x-hidden` explicitly, for the reason the sidebar's own
								    scroller carries it: CSS forces `overflow-x` to `auto` once
								    `overflow-y` is, and the rows' negative margins then put a
								    horizontal scrollbar across the foot of the list. */}
							<ul className="-mx-1.5 flex max-h-56 flex-col overflow-x-hidden overflow-y-auto px-1.5">
								{contributors.map((person) => (
									<li key={person.login}>
										<a
											href={person.profileUrl}
											target="_blank"
											rel="noreferrer"
											className="-mx-1.5 flex items-center gap-2 rounded-lg px-1.5 py-1 ring-ring outline-hidden transition-colors duration-(--dur-fast) hover:bg-muted focus-visible:ring-2"
										>
											<ContributorAvatar person={person} className="size-5" />
											<span className="min-w-0 flex-1 truncate text-sm">
												{person.name}
											</span>
										</a>
									</li>
								))}
							</ul>
							<a
								href={GITHUB_URL}
								target="_blank"
								rel="noreferrer"
								className="flex items-center gap-1 text-2xs text-muted-foreground ring-ring outline-hidden transition-colors duration-(--dur-fast) hover:text-foreground focus-visible:ring-2"
							>
								View the repository on GitHub
								<ArrowUpRightIcon
									weight="regular"
									className="size-3 shrink-0"
								/>
							</a>
						</PopoverContent>
					</Popover>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

function ContributorAvatar({
	person,
	className,
	style,
}: {
	person: Contributor;
	className?: string;
	style?: CSSProperties;
}) {
	return (
		<Avatar size="sm" className={className} style={style}>
			<AvatarImage src={person.avatarUrl} alt="" referrerPolicy="no-referrer" />
			<AvatarFallback>{getInitials(person.name)}</AvatarFallback>
		</Avatar>
	);
}

/**
 * The overlapping row of faces, most commits first, ending in the remainder.
 *
 * **Most commits at the BOTTOM of the pile.** Nothing sets a `z-index` — later
 * siblings paint over earlier ones — so the order is the DOM order and the
 * person with the most commits is the one the rest are stacked onto. Each face
 * still shows three quarters of itself, so "who is in here" stays an answerable
 * question rather than a row of crescents.
 *
 * Each face carries a ring in the surface's own color so the overlap reads as
 * depth rather than as circles touching. `ring-background` and not the band's
 * hover fill: the hover is `--sel`, four and a half percent of the ink, and
 * matching it would mean animating a ring color for a difference nobody can
 * see.
 */
function ContributorStack({ contributors }: { contributors: Contributor[] }) {
	const shown = contributors.slice(0, MAX_FACES);
	const rest = contributors.length - shown.length;

	return (
		<span className="flex">
			{shown.map((person, index) => (
				<ContributorAvatar
					key={person.login}
					person={person}
					className="shrink-0 ring-2 ring-background"
					style={{
						width: FACE,
						height: FACE,
						marginLeft: index > 0 ? -FACE_OVERLAP : undefined,
					}}
				/>
			))}
			{rest > 0 && (
				<span
					className="flex shrink-0 items-center justify-center rounded-full bg-secondary text-[9px] font-medium text-muted-foreground ring-2 ring-background"
					style={{
						width: FACE,
						height: FACE,
						marginLeft: shown.length > 0 ? -FACE_OVERLAP : undefined,
					}}
				>
					+{rest}
				</span>
			)}
		</span>
	);
}
