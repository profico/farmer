import type { Rewind } from "@farmer/core/services";
import {
	CaretLeftIcon,
	CaretRightIcon,
	PauseIcon,
	PlayIcon,
	ShareNetworkIcon,
	XIcon,
} from "@phosphor-icons/react";
import {
	AnimatePresence,
	type MotionValue,
	MotionConfig,
	motion,
	useMotionValue,
} from "motion/react";
import {
	type MouseEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";

import { easeOut } from "#/lib/motion.ts";

import {
	BigDaySlide,
	DaysSlide,
	EmptySlide,
	GithubSlide,
	HoursSlide,
	IntroSlide,
	MonthsSlide,
	PersonaSlide,
	ProjectsSlide,
	type RewindTheme,
	SummarySlide,
	TasksSlide,
	THEMES,
	TimeOffSlide,
	WordsSlide,
} from "./slides.tsx";

// The Rewind is a story: one slide at a time, full screen, advancing on its
// own. Tap the right of the screen (or press →) for the next slide and the
// left for the previous one; hold to pause; Escape closes.
//
// It is a fixed layer over the workspace rather than a route outside it, so
// the `/$orgSlug` guard still stands in front of it.

const SLIDE_MS = 7000;

/** How long a press must last to read as "hold to pause" rather than a tap. */
const HOLD_MS = 220;

const EASE = easeOut;

type Slide = {
	key: string;
	theme: RewindTheme;
	content: ReactNode;
	/** How long the slide stays; null waits for the reader. */
	ms?: number | null;
};

const buildSlides = (
	rewind: Rewind,
	firstName: string,
	actions: ReactNode,
): Slide[] => {
	const intro: Slide = {
		key: "intro",
		theme: THEMES.violet,
		content: (
			<IntroSlide rewind={rewind} firstName={firstName} theme={THEMES.violet} />
		),
	};

	if (rewind.workedSeconds === 0) {
		return [
			intro,
			{
				key: "empty",
				theme: THEMES.ink,
				ms: null,
				content: (
					<div className="flex flex-col gap-8">
						<EmptySlide year={rewind.year} />
						<div className="pointer-events-auto flex flex-wrap gap-3">
							{actions}
						</div>
					</div>
				),
			},
		];
	}

	const slides: Slide[] = [
		intro,
		{
			key: "hours",
			theme: THEMES.ink,
			content: <HoursSlide rewind={rewind} theme={THEMES.ink} />,
		},
		{
			key: "days",
			theme: THEMES.moss,
			content: <DaysSlide rewind={rewind} theme={THEMES.moss} />,
		},
		{
			key: "months",
			theme: THEMES.amber,
			ms: 8000,
			content: <MonthsSlide rewind={rewind} theme={THEMES.amber} />,
		},
	];

	if (rewind.busiestDay) {
		slides.push({
			key: "big-day",
			theme: THEMES.coral,
			content: <BigDaySlide rewind={rewind} theme={THEMES.coral} />,
		});
	}

	if (rewind.projects.length > 0) {
		slides.push({
			key: "projects",
			theme: THEMES.cobalt,
			ms: 9000,
			content: <ProjectsSlide rewind={rewind} theme={THEMES.cobalt} />,
		});
	}

	if (rewind.tasks.length > 0) {
		slides.push({
			key: "tasks",
			theme: THEMES.paper,
			ms: 9000,
			content: <TasksSlide rewind={rewind} theme={THEMES.paper} />,
		});
	}

	if (rewind.words.length >= 3) {
		slides.push({
			key: "words",
			theme: THEMES.violet,
			content: <WordsSlide rewind={rewind} theme={THEMES.violet} />,
		});
	}

	const { pullRequests } = rewind;

	if (
		rewind.commits +
			pullRequests.opened +
			pullRequests.merged +
			pullRequests.reviewed >
		0
	) {
		slides.push({
			key: "github",
			theme: THEMES.ink,
			content: <GithubSlide rewind={rewind} theme={THEMES.ink} />,
		});
	}

	const { vacationDays, sickDays, otherDays } = rewind.timeOff;

	if (vacationDays + sickDays + otherDays > 0) {
		slides.push({
			key: "time-off",
			theme: THEMES.moss,
			content: <TimeOffSlide rewind={rewind} theme={THEMES.moss} />,
		});
	}

	slides.push(
		{
			key: "persona",
			theme: THEMES.amber,
			content: <PersonaSlide rewind={rewind} theme={THEMES.amber} />,
		},
		{
			key: "summary",
			theme: THEMES.ink,
			ms: null,
			content: (
				<SummarySlide rewind={rewind} theme={THEMES.ink} actions={actions} />
			),
		},
	);

	return slides;
};

/** The current slide's progress, 0 to 1, advanced on animation frames and
 *  held while paused. A motion value, so the bar moves without a render. */
function useSlideClock(
	slideKey: string,
	ms: number | null,
	paused: boolean,
	onDone: () => void,
): MotionValue<number> {
	const progress = useMotionValue(0);
	const pausedRef = useRef(paused);
	const doneRef = useRef(onDone);
	useEffect(() => {
		pausedRef.current = paused;
		doneRef.current = onDone;
	});
	useEffect(() => {
		if (ms === null) {
			progress.set(1);

			return;
		}

		progress.set(0);
		let elapsed = 0;
		let last = performance.now();
		let frame = 0;

		const tick = (now: number) => {
			if (!pausedRef.current) elapsed += now - last;
			last = now;
			progress.set(Math.min(1, elapsed / ms));

			if (elapsed >= ms) {
				doneRef.current();

				return;
			}

			frame = requestAnimationFrame(tick);
		};

		frame = requestAnimationFrame(tick);

		return () => cancelAnimationFrame(frame);
	}, [slideKey, ms, progress]);

	return progress;
}

/** A pill on a colored slide: filled for the main action, outlined else. */
export const pillStyle = (theme: RewindTheme, filled: boolean) =>
	filled
		? { background: theme.fg, color: theme.bg }
		: { boxShadow: `inset 0 0 0 1.5px ${theme.fg}66`, color: theme.fg };

export const PILL =
	"inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-base font-medium transition-opacity duration-(--dur-base) hover:opacity-85";

/** The full-screen colored layer, with the slow drifting light behind it. */
export function RewindFrame({
	theme,
	label,
	children,
}: {
	theme: RewindTheme;
	label: string;
	children: ReactNode;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		ref.current?.focus();
		// The workspace under the layer must not scroll with the wheel.
		const root = document.documentElement;
		const previous = root.style.overflow;
		root.style.overflow = "hidden";

		return () => {
			root.style.overflow = previous;
		};
	}, []);

	return (
		<MotionConfig reducedMotion="user">
			{/* Rendered open rather than through showModal(), so the server
			    renders it and a reload lands straight on the story. The resets
			    undo the user agent's centred, bordered dialog box. */}
			<motion.dialog
				ref={ref}
				open
				aria-modal
				aria-label={label}
				tabIndex={-1}
				className="fixed inset-0 z-100 m-0 flex size-full max-h-none max-w-none flex-col overflow-hidden border-0 p-0 outline-none select-none"
				initial={false}
				animate={{ backgroundColor: theme.bg, color: theme.fg }}
				transition={{ duration: 0.6, ease: EASE }}
			>
				<div
					aria-hidden
					className="pointer-events-none absolute inset-0 overflow-hidden"
				>
					<motion.div
						className="absolute -top-[25%] -right-[20%] size-[70vmax] rounded-full opacity-20 blur-3xl"
						initial={false}
						animate={{
							backgroundColor: theme.accent,
							x: [0, -60, 0],
							y: [0, 40, 0],
						}}
						transition={{
							backgroundColor: { duration: 0.6 },
							x: { duration: 19, repeat: Infinity, ease: "easeInOut" },
							y: { duration: 23, repeat: Infinity, ease: "easeInOut" },
						}}
					/>
					<motion.div
						className="absolute -bottom-[30%] -left-[20%] size-[60vmax] rounded-full opacity-10 blur-3xl"
						initial={false}
						animate={{
							backgroundColor: theme.fg,
							x: [0, 70, 0],
							y: [0, -40, 0],
						}}
						transition={{
							backgroundColor: { duration: 0.6 },
							x: { duration: 25, repeat: Infinity, ease: "easeInOut" },
							y: { duration: 17, repeat: Infinity, ease: "easeInOut" },
						}}
					/>
				</div>
				{children}
			</motion.dialog>
		</MotionConfig>
	);
}

/** A Rewind with nothing to tap through: not open yet, loading, or failed. */
export function RewindMessage({
	title,
	line,
	actions,
}: {
	title: string;
	line?: string;
	actions?: ReactNode;
}) {
	const theme = THEMES.violet;

	return (
		<RewindFrame theme={theme} label={title}>
			<div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-5 sm:px-8">
				<span className="text-sm font-medium tracking-[0.18em] uppercase opacity-75">
					Farmer Rewind
				</span>
				<h1 className="serif text-5xl leading-[0.95] text-balance sm:text-7xl">
					{title}
				</h1>
				{line && <p className="max-w-xl text-xl opacity-80">{line}</p>}
				{actions && <div className="flex flex-wrap gap-3">{actions}</div>}
			</div>
		</RewindFrame>
	);
}

export function RewindStory({
	rewind,
	firstName,
	onClose,
	extraActions,
}: {
	rewind: Rewind;
	firstName: string;
	onClose: () => void;
	/** Shown beside "Watch again" on the last slide — another year, say. */
	extraActions?: (theme: RewindTheme) => ReactNode;
}) {
	const [index, setIndex] = useState(0);
	const [userPaused, setUserPaused] = useState(false);
	const [held, setHeld] = useState(false);
	const [hidden, setHidden] = useState(false);
	const holdTimer = useRef<number | null>(null);
	const heldRef = useRef(false);
	const [sharing, setSharing] = useState(false);

	const share = async () => {
		setSharing(true);

		try {
			const { shareRewindCard } = await import("./share-card.ts");
			const outcome = await shareRewindCard(rewind, firstName);

			if (outcome === "downloaded")
				toast.success("Saved your Rewind as an image.");
		} catch {
			toast.error("Could not make the image. Try again.");
		} finally {
			setSharing(false);
		}
	};

	const actions = (
		<>
			<button
				type="button"
				className={PILL}
				style={pillStyle(THEMES.ink, true)}
				disabled={sharing}
				onClick={() => void share()}
			>
				<ShareNetworkIcon weight="bold" className="size-4.5" />
				{sharing ? "Preparing…" : "Share"}
			</button>
			<button
				type="button"
				className={PILL}
				style={pillStyle(THEMES.ink, false)}
				onClick={() => setIndex(0)}
			>
				Watch again
			</button>
			{extraActions?.(THEMES.ink)}
			<button
				type="button"
				className={PILL}
				style={pillStyle(THEMES.ink, false)}
				onClick={onClose}
			>
				Close
			</button>
		</>
	);

	const slides = buildSlides(rewind, firstName, actions);
	const last = slides.length - 1;
	const current = Math.min(index, last);
	const slide = slides[current] ?? slides[0];
	const theme = slide?.theme ?? THEMES.violet;
	const ms = slide?.ms === undefined ? SLIDE_MS : slide.ms;

	const next = () => setIndex((i) => Math.min(i + 1, last));
	const prev = () => setIndex((i) => Math.max(i - 1, 0));

	const progress = useSlideClock(
		slide?.key ?? "none",
		ms,
		userPaused || held || hidden,
		next,
	);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
			else if (event.key === "ArrowRight") next();
			else if (event.key === "ArrowLeft") prev();
			else if (event.key === " ") {
				// Space on a focused button is that button's.
				if (
					event.target instanceof Element &&
					event.target.closest("button, a")
				)
					return;
				event.preventDefault();
				setUserPaused((p) => !p);
			}
		};

		const onVisibility = () => setHidden(document.visibilityState === "hidden");
		window.addEventListener("keydown", onKey);
		document.addEventListener("visibilitychange", onVisibility);

		return () => {
			window.removeEventListener("keydown", onKey);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	});

	// A press that lasts pauses the story; the click that ends it must not
	// then also turn the page.
	const zone = (go: () => void) => ({
		// Keeps focus off the zone, so Space is never the zone's click.
		onMouseDown: (event: MouseEvent) => event.preventDefault(),
		onPointerDown: () => {
			heldRef.current = false;
			holdTimer.current = window.setTimeout(() => {
				heldRef.current = true;
				setHeld(true);
			}, HOLD_MS);
		},
		onPointerUp: () => {
			if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
			setHeld(false);
		},
		onPointerLeave: () => {
			if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
			setHeld(false);
		},
		onClick: () => {
			if (heldRef.current) {
				heldRef.current = false;

				return;
			}

			go();
		},
	});

	return (
		<RewindFrame theme={theme} label={`Farmer Rewind ${rewind.year}`}>
			<header className="relative z-30 mx-auto w-full max-w-3xl px-5 pt-[calc(var(--safe-t)+1rem)] sm:px-8">
				<div className="flex gap-1.5">
					{slides.map((s, i) => (
						<div
							key={s.key}
							className="h-[3px] flex-1 overflow-hidden rounded-full"
							style={{ background: `${theme.fg}33` }}
						>
							{i < current && (
								<div className="size-full" style={{ background: theme.fg }} />
							)}
							{i === current && (
								<motion.div
									className="size-full origin-left"
									style={{ scaleX: progress, background: theme.fg }}
								/>
							)}
						</div>
					))}
				</div>
				<div className="mt-3 flex items-center justify-between">
					<span className="text-sm font-medium opacity-80">
						Farmer Rewind · {rewind.year}
					</span>
					<div className="-mr-2 flex items-center">
						{ms !== null && (
							<button
								type="button"
								aria-label={userPaused ? "Play" : "Pause"}
								className="grid size-10 place-items-center rounded-full transition-opacity hover:opacity-70"
								onClick={() => setUserPaused((p) => !p)}
							>
								{userPaused ? (
									<PlayIcon weight="fill" className="size-5" />
								) : (
									<PauseIcon weight="fill" className="size-5" />
								)}
							</button>
						)}
						<button
							type="button"
							aria-label="Close"
							className="grid size-10 place-items-center rounded-full transition-opacity hover:opacity-70"
							onClick={onClose}
						>
							<XIcon weight="bold" className="size-5" />
						</button>
					</div>
				</div>
			</header>

			<div className="relative flex-1">
				<button
					type="button"
					tabIndex={-1}
					aria-label="Previous slide"
					className="absolute inset-y-0 left-0 z-10 w-[30%] cursor-default outline-none"
					{...zone(prev)}
				/>
				<button
					type="button"
					tabIndex={-1}
					aria-label="Next slide"
					className="absolute inset-y-0 right-0 z-10 w-[70%] cursor-default outline-none"
					{...zone(next)}
				/>
				<div className="pointer-events-none relative z-20 mx-auto flex h-full w-full max-w-3xl flex-col justify-center px-5 pb-[calc(var(--safe-b)+2.5rem)] sm:px-8">
					<AnimatePresence mode="wait">
						<motion.div
							key={slide?.key}
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0, transition: { duration: 0.18 } }}
						>
							{slide?.content}
						</motion.div>
					</AnimatePresence>
				</div>

				{/* Pointer users on a wide screen get visible arrows; the tap
				    zones under them still work everywhere. */}
				{current > 0 && (
					<button
						type="button"
						aria-label="Previous slide"
						className="absolute top-1/2 left-4 z-30 hidden size-12 -translate-y-1/2 place-items-center rounded-full transition-opacity hover:opacity-70 lg:grid"
						style={{ boxShadow: `inset 0 0 0 1.5px ${theme.fg}40` }}
						onClick={prev}
					>
						<CaretLeftIcon weight="bold" className="size-5" />
					</button>
				)}
				{current < last && (
					<button
						type="button"
						aria-label="Next slide"
						className="absolute top-1/2 right-4 z-30 hidden size-12 -translate-y-1/2 place-items-center rounded-full transition-opacity hover:opacity-70 lg:grid"
						style={{ boxShadow: `inset 0 0 0 1.5px ${theme.fg}40` }}
						onClick={next}
					>
						<CaretRightIcon weight="bold" className="size-5" />
					</button>
				)}
			</div>
		</RewindFrame>
	);
}
