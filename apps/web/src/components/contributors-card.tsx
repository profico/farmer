import { ArrowUpRightIcon, GithubLogoIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
	type CSSProperties,
	useEffect,
	useState,
	useSyncExternalStore,
} from "react";

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
import { GITHUB_CONTRIBUTORS_URL, PROJECT_TAGLINE } from "#/lib/links.ts";
import { springProductive } from "#/lib/motion.ts";
import { cn, getInitials } from "#/lib/utils.ts";
import { deploymentInfoQuery } from "#/queries/about.ts";
import type { Contributor } from "#/server/deployment-info.ts";

/**
 * Who built this, at the foot of Settings — and, under it, which commit the
 * deployment is running.
 *
 * It is the whole of what was going to be an About page. A page would have been
 * a destination nobody navigates to, holding three facts; the same three facts
 * sit at the bottom of a screen people already open, where "who made this" and
 * "what am I looking at" are questions somebody has while they are there.
 *
 * **Four faces and a +N, because four is what fits and eleven is what matters.**
 * The stack is a count you can see rather than read, and the number beside it is
 * the honest remainder. Opening it — by hover or by click, the same control
 * either way — is what turns the count into people, since a touch screen has no
 * hover and a stack that only answers to a pointer answers to nobody on a phone.
 *
 * The commit line is deliberately OUTSIDE the card: it is a fact about the
 * build, not about the people, and folding it in would have made one control
 * out of two unrelated things.
 *
 * Renders nothing at all when the deployment has neither — no GitHub App
 * configured and no `GIT_SHA` is a perfectly ordinary way to run this, and an
 * empty card explaining its own absence is worse than no card.
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

/** The most faces the stack draws before the rest become a number. Past about
 *  eight a row of circles stops reading as a group of people and starts reading
 *  as a texture, and `+N` says the remainder better than six more of them. */
const MAX_FACES = 8;

/** How much of a face the next one covers. A quarter keeps every avatar
 *  recognizable while the row still reads as one stack and not as a list. */
const OVERLAP = 0.25;

/** The range a face may be drawn at while filling the row it is given. The
 *  floor keeps a face a face in the sidebar's narrow column; the ceiling stops
 *  a short roster in a full-width card becoming a row of portraits. */
const MIN_FACE = 22;
const MAX_FACE = 44;

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
	const commit = data?.commit ?? null;

	// The stored answer is on the DEVICE, so the server cannot know it and
	// renders nothing. Held back until the document is hydrated, the two agree —
	// without this, a repeat visitor's first client render adds a card the
	// server's HTML does not have, which is a hydration mismatch and costs the
	// whole subtree a re-render. `useSyncExternalStore` is how the rest of the
	// app asks this question (`lib/nav-collapse.ts`, `lib/theme.ts`).
	const hydrated = useSyncExternalStore(neverChanges, onClient, onServer);

	const ready = hydrated && (contributors.length > 0 || commit !== null);

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
					className={cn("flex flex-col gap-2", className)}
				>
					{contributors.length > 0 && (
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
										className="group/card flex w-full flex-col gap-2 rounded-xl border px-3 py-2.5 text-left ring-sidebar-ring transition-colors duration-(--dur-fast) outline-hidden hover:bg-muted focus-visible:ring-2"
									>
										<span className="flex items-center gap-2">
											<GithubLogoIcon
												weight="fill"
												aria-hidden
												className="size-3.5 shrink-0 text-muted-foreground transition-colors duration-(--dur-fast) group-hover/card:text-foreground"
											/>
											<span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
												{contributors.length} contributor
												{contributors.length === 1 ? "" : "s"}
											</span>
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
									href={GITHUB_CONTRIBUTORS_URL}
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
					)}

					{commit && (
						// A link, because the only useful thing to do with a short sha is go
						// and look at what it was. `title` carries the full one, for pasting
						// into a bug report.
						<a
							href={commit.url}
							target="_blank"
							rel="noreferrer"
							title={commit.sha}
							className="px-1 font-mono text-2xs text-faint ring-ring outline-hidden transition-colors duration-(--dur-fast) hover:text-muted-foreground focus-visible:ring-2"
						>
							Running {commit.shortSha}
						</a>
					)}
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
 * **It is sized to fill whatever it is given.** The same card sits in a 240px
 * sidebar column and across a full-width phone screen, and a stack drawn at one
 * fixed size is either cramped in the first or a short smudge in the second.
 * The row is measured and the face size solved from it, so the stack ends where
 * the card ends in both places.
 *
 * **Most commits at the BOTTOM of the pile.** Nothing sets a `z-index` — later
 * siblings paint over earlier ones — so the order is the DOM order and the
 * person with the most commits is the one the rest are stacked onto. Each face
 * still shows three quarters of itself, so "who is in here" stays an answerable
 * question rather than a row of crescents.
 *
 * Each face carries a ring in the surface's own color so the overlap reads as
 * depth rather than as circles touching. `ring-card` and not the card's hover
 * fill: the hover is `--sel`, four and a half percent of the ink, and matching
 * it would mean animating a ring color for a difference nobody can see.
 */
function ContributorStack({ contributors }: { contributors: Contributor[] }) {
	const shown = contributors.slice(0, MAX_FACES);
	const rest = contributors.length - shown.length;
	const items = shown.length + (rest > 0 ? 1 : 0);

	// Measured rather than read off a breakpoint: this component does not know
	// which of the two cards it is in, and the phone one is as wide as the phone.
	const [row, setRow] = useState<HTMLElement | null>(null);
	const [width, setWidth] = useState(0);
	useEffect(() => {
		if (!row) return;
		const observer = new ResizeObserver((entries) => {
			setWidth(entries[0]?.contentRect.width ?? 0);
		});
		observer.observe(row);
		return () => observer.disconnect();
	}, [row]);

	// A row of overlapping faces is one whole face plus the uncovered part of
	// each of the others. `span` is that width in face-widths, so dividing the
	// room by it gives the face size that ends exactly at the far edge. Before
	// the first measurement it draws at the floor rather than at zero, so the
	// card does not grow a face-sized gap on its first frame.
	const span = 1 + (1 - OVERLAP) * (items - 1);
	const size = Math.round(
		Math.min(MAX_FACE, Math.max(MIN_FACE, (width || MIN_FACE * span) / span)),
	);
	const overlap = Math.round(size * OVERLAP);

	return (
		<span ref={setRow} className="flex w-full">
			{shown.map((person, index) => (
				<ContributorAvatar
					key={person.login}
					person={person}
					className="shrink-0 ring-2 ring-card"
					style={{
						width: size,
						height: size,
						marginLeft: index > 0 ? -overlap : undefined,
					}}
				/>
			))}
			{rest > 0 && (
				<span
					className="flex shrink-0 items-center justify-center rounded-full bg-secondary font-medium text-muted-foreground ring-2 ring-card"
					style={{
						width: size,
						height: size,
						marginLeft: shown.length > 0 ? -overlap : undefined,
						fontSize: Math.max(10, Math.round(size * 0.3)),
					}}
				>
					+{rest}
				</span>
			)}
		</span>
	);
}
