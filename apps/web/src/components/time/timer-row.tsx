import { timeKeyInTz } from "@farmer/core/lib/time";
import {
	PauseIcon,
	PlayIcon,
	StopIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "#/components/ui/button.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/ui/tooltip.tsx";
import { useTimer } from "#/hooks/use-timer.ts";
import { formatDateKeyShort } from "#/lib/format-date.ts";
import { cn } from "#/lib/utils.ts";

import {
	DiscardTimerDialog,
	DroppedTimerDialog,
	type RunningTimer,
	StartTimerDialog,
	StopTimerDialog,
	useTimerControls,
} from "./timer-dialogs.tsx";

/** `H:MM:SS` — a stopwatch shows its seconds, which is the whole difference
 *  between a clock that is running and a number on a screen. */
export const formatStopwatch = (totalSeconds: number): string => {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

/** The same figure at rail width, where the leading `0:` is a column of
 *  nothing for the first hour. */
const formatCompact = (totalSeconds: number): string =>
	totalSeconds < 3600
		? formatStopwatch(totalSeconds).slice(2)
		: formatStopwatch(totalSeconds);

/**
 * The timer, at the foot of the sidebar (issue #59).
 *
 * It is here rather than on the timesheet because a stopwatch is the one piece
 * of state in this app that is true while you are looking at something else.
 * The unfiled badge is in this column for the same reason.
 *
 * A card rather than a row: a clock has a state to report — what it measures,
 * since when, whether it is held — and two things to do with it, and none of
 * that fits behind one icon. At rail width it keeps the figure alone and the
 * card fades out from under it (`.timer-card` in styles.css).
 *
 * A timer belongs to the person, not to a workspace, so this also draws in a
 * workspace it is not running in — and says which one it is running in. It
 * offers no controls there: stopping would have to leave the page.
 */
export function TimerCard({
	orgSlug,
	timezone,
}: {
	orgSlug: string;
	timezone: string;
}) {
	const { timer, elapsedSeconds } = useTimer(orgSlug);

	if (!timer) return null;

	// Keyed on the timer's id: the open flags of the dialogs live in the body, so
	// a timer that ends while a dialog is open takes the flag with it. A new
	// timer then starts closed, and the clock is held only by `openStop`.
	return (
		<TimerCardBody
			key={timer.id}
			orgSlug={orgSlug}
			timezone={timezone}
			timer={timer}
			elapsedSeconds={elapsedSeconds}
		/>
	);
}

function TimerCardBody({
	orgSlug,
	timezone,
	timer,
	elapsedSeconds,
}: {
	orgSlug: string;
	timezone: string;
	timer: RunningTimer;
	elapsedSeconds: number;
}) {
	const { pause, resume } = useTimerControls(orgSlug);
	const [stopOpen, setStopOpen] = useState(false);
	const [discardOpen, setDiscardOpen] = useState(false);
	const [droppedOpen, setDroppedOpen] = useState(false);

	const dropped = timer.droppedAt != null;
	const elsewhere = !timer.here;
	const figure = formatStopwatch(elapsedSeconds);
	const state = dropped ? "Dropped" : timer.paused ? "Paused" : "Running";

	// Stopping holds the clock first, so the figure in the form is the figure on
	// the card. The dialog's own Resume hands it back.
	const openStop = () => {
		if (!timer.paused) pause.mutate();
		setStopOpen(true);
	};

	return (
		<>
			<div className="timer-card -mx-2 border-y border-line2 bg-muted/40">
				<div className="timer-card-body flex flex-col justify-center gap-1.5 px-3">
					<div className="flex items-baseline justify-between gap-2">
						<span
							className={cn(
								"eyebrow truncate",
								dropped && "text-warn",
								!dropped && !elsewhere && !timer.paused && "text-ok",
							)}
						>
							{elsewhere ? `${state} in ${timer.organizationName}` : state}
						</span>
						<span className="shrink-0 text-2xs text-muted-foreground">
							since {timeKeyInTz(timer.startedAt, timezone)}
						</span>
					</div>

					<div className="min-w-0">
						<div className="truncate text-sm font-medium text-foreground">
							{timer.projectName ?? "No project"}
						</div>
						<div className="truncate text-xs text-muted-foreground">
							{timer.taskName}
							{timer.entryDate &&
								` · adds to ${formatDateKeyShort(timer.entryDate)}`}
						</div>
					</div>

					<div className="flex items-center justify-between gap-2">
						<span
							className={cn(
								"mono truncate text-xl tabular-nums",
								dropped && "text-warn",
								!dropped && timer.paused && "text-muted-foreground",
							)}
						>
							{figure}
						</span>
						{/* A dropped timer logged nothing, so the only thing left to do
						    with it is read the notice and clear it. A timer running
						    elsewhere is a notice too: its controls are in the workspace it
						    belongs to. */}
						{dropped ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => {
									setDroppedOpen(true);
								}}
							>
								Dismiss
							</Button>
						) : elsewhere ? null : (
							<span className="flex shrink-0 items-center gap-1.5">
								<CardButton
									label={timer.paused ? "Resume the timer" : "Pause the timer"}
									hint={
										timer.paused ? "Continue" : "Let's pause for a second..."
									}
									variant="outline"
									size="icon-sm"
									disabled={pause.isPending || resume.isPending}
									onClick={() => {
										if (timer.paused) resume.mutate();
										else pause.mutate();
									}}
								>
									{timer.paused ? (
										<PlayIcon weight="fill" className="size-3.5" />
									) : (
										<PauseIcon weight="fill" className="size-3.5" />
									)}
								</CardButton>
								<CardButton
									label="Discard the timer"
									hint="Throw the measurement away"
									variant="outline"
									size="icon-sm"
									onClick={() => {
										setDiscardOpen(true);
									}}
								>
									<TrashIcon weight="regular" className="size-3.5" />
								</CardButton>
								<CardButton
									label={`Stop the timer — ${figure} on ${timer.taskName}`}
									hint="Hammer time"

									size="icon"
									onClick={openStop}
								>
									<StopIcon weight="fill" className="size-4" />
								</CardButton>
							</span>
						)}
					</div>
				</div>

				{/* Rail width. The figure is the one thing that cannot be dropped:
				    everything else on the card is read once, and the figure is what
				    somebody looks at the column to see. */}
				<button
					type="button"
					aria-label={
						dropped
							? "Your timer was dropped"
							: elsewhere
								? `A timer is ${state.toLowerCase()} in ${timer.organizationName}`
								: `Stop the timer — ${figure} on ${timer.taskName}`
					}
					onClick={() => {
						if (dropped) setDroppedOpen(true);
						else if (!elsewhere) openStop();
					}}
					className="timer-card-rail flex flex-col items-center justify-center gap-0.5"
				>
					<span
						className={cn(
							"eyebrow",
							dropped && "text-warn",
							!dropped && !elsewhere && !timer.paused && "text-ok",
						)}
					>
						{dropped ? "Drop" : timer.paused ? "Held" : "Run"}
					</span>
					<span
						className={cn(
							"mono text-2xs tabular-nums",
							dropped && "text-warn",
							!dropped && timer.paused && "text-muted-foreground",
						)}
					>
						{formatCompact(elapsedSeconds)}
					</span>
				</button>
			</div>

			{dropped ? (
				<DroppedTimerDialog
					orgSlug={orgSlug}
					timezone={timezone}
					timer={timer}
					open={droppedOpen}
					onOpenChange={setDroppedOpen}
				/>
			) : (
				!elsewhere && (
					<>
						<StopTimerDialog
							orgSlug={orgSlug}
							timezone={timezone}
							timer={timer}
							open={stopOpen}
							onOpenChange={setStopOpen}
						/>
						<DiscardTimerDialog
							orgSlug={orgSlug}
							measured={figure}
							continuing={timer.timeEntryId != null}
							open={discardOpen}
							onOpenChange={setDiscardOpen}
						/>
					</>
				)
			)}
		</>
	);
}

/** One of the card's controls: an icon, its name for a reader who cannot see
 *  it, and the sentence that says what pressing it does. The sidebar is
 *  narrow, so every control here is an icon and every icon needs both. */
function CardButton({
	label,
	hint,
	children,
	...props
}: {
	label: string;
	hint: string;
	children: React.ReactNode;
} & React.ComponentProps<typeof Button>) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button type="button" aria-label={label} {...props}>
						{children}
					</Button>
				}
			/>
			<TooltipContent side="top" sideOffset={6}>
				{hint}
			</TooltipContent>
		</Tooltip>
	);
}

/**
 * "Start timer" on the timesheet, beside Log time.
 *
 * Once something is running it becomes Stop, showing the figure: two controls
 * for one clock, in two places, is how a person ends up with two timers and no
 * idea which one is theirs.
 */
export function StartTimerButton({
	orgSlug,
	timezone,
	defaultProjectId,
}: {
	orgSlug: string;
	timezone: string;
	defaultProjectId?: string;
}) {
	const { timer, elapsedSeconds } = useTimer(orgSlug);

	if (timer && timer.droppedAt == null && timer.here) {
		// Keyed on the timer's id, as `TimerCard` is: the open flag must not
		// outlive the timer, or the next one opens its Stop dialog unheld.
		return (
			<StopTimerButton
				key={timer.id}
				orgSlug={orgSlug}
				timezone={timezone}
				timer={timer}
				elapsedSeconds={elapsedSeconds}
			/>
		);
	}

	return (
		<StartTimerDialog
			orgSlug={orgSlug}
			defaultProjectId={defaultProjectId}
			trigger={
				<Button type="button" variant="outline">
					<PlayIcon weight="fill" className="size-4" />
					Start timer
				</Button>
			}
		/>
	);
}

function StopTimerButton({
	orgSlug,
	timezone,
	timer,
	elapsedSeconds,
}: {
	orgSlug: string;
	timezone: string;
	timer: RunningTimer;
	elapsedSeconds: number;
}) {
	const { pause } = useTimerControls(orgSlug);
	const [open, setOpen] = useState(false);

	return (
		<>
			<Button
				type="button"
				variant="outline"
				onClick={() => {
					if (!timer.paused) pause.mutate();
					setOpen(true);
				}}
			>
				<StopIcon
					weight="fill"
					className={cn("size-4", !timer.paused && "text-ok")}
				/>
				<span className="tabular-nums">{formatStopwatch(elapsedSeconds)}</span>
			</Button>
			<StopTimerDialog
				orgSlug={orgSlug}
				timezone={timezone}
				timer={timer}
				open={open}
				onOpenChange={setOpen}
			/>
		</>
	);
}
