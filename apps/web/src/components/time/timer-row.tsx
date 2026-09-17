import { PlayIcon, StopIcon, WarningIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "#/components/ui/button.tsx";
import { useTimer } from "#/hooks/use-timer.ts";
import { cn } from "#/lib/utils.ts";

import {
	DroppedTimerDialog,
	StartTimerDialog,
	StopTimerDialog,
} from "./timer-dialogs.tsx";

/** `H:MM:SS` — a stopwatch shows its seconds, which is the whole difference
 *  between a clock that is running and a number on a screen. */
export const formatStopwatch = (totalSeconds: number): string => {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

/**
 * The running timer, in the sidebar's foot (issue #59).
 *
 * It is here rather than on the timesheet because a stopwatch is the one piece
 * of state in this app that is true while you are looking at something else.
 * The unfiled badge is in the column for the same reason.
 *
 * A timer belongs to the person, not to a workspace, so this row also appears
 * in a workspace it is not running in — and says which one it is running in.
 * Pressing it there would have to leave the page, so it does not: it tells you
 * and stops.
 */
export function TimerRow({
	orgSlug,
	timezone,
	className,
}: {
	orgSlug: string;
	timezone: string;
	className?: string;
}) {
	const { timer, elapsedSeconds } = useTimer(orgSlug);
	const [open, setOpen] = useState(false);

	if (!timer) return null;

	const dropped = timer.droppedAt != null;
	const elsewhere = !timer.here;
	const label = dropped
		? "Timer dropped"
		: elsewhere
			? `Running in ${timer.organizationName}`
			: formatStopwatch(elapsedSeconds);

	return (
		<>
			<button
				type="button"
				onClick={() => {
					if (!elsewhere || dropped) setOpen(true);
				}}
				aria-label={
					dropped
						? "Your timer was dropped"
						: elsewhere
							? `A timer is running in ${timer.organizationName}`
							: `Stop the timer — ${label} on ${timer.taskName}`
				}
				className={cn(
					className,
					"text-left",
					dropped && "text-warn hover:bg-warn/10 hover:text-warn",
				)}
			>
				{dropped ? (
					<WarningIcon weight="fill" className="relative size-4.5 shrink-0" />
				) : (
					<StopIcon
						weight="fill"
						className={cn(
							"relative size-4.5 shrink-0",
							!elsewhere && "text-ok",
						)}
					/>
				)}
				<span className="nav-label">
					<span className="min-w-0 flex-1 truncate text-base tabular-nums">
						{label}
					</span>
					{!dropped && !elsewhere && (
						<span className="min-w-0 truncate text-xs text-muted-foreground">
							{timer.taskName}
						</span>
					)}
				</span>
			</button>

			{/* A dropped timer is a notice, not a measurement: it opens the one
			    dialog that offers nothing but Dismiss. */}
			{dropped ? (
				<DroppedTimerDialog
					orgSlug={orgSlug}
					timezone={timezone}
					timer={timer}
					open={open}
					onOpenChange={setOpen}
				/>
			) : (
				!elsewhere && (
					<StopTimerDialog
						orgSlug={orgSlug}
						timezone={timezone}
						timer={timer}
						open={open}
						onOpenChange={setOpen}
					/>
				)
			)}
		</>
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
	const [open, setOpen] = useState(false);

	if (timer && timer.droppedAt == null && timer.here) {
		return (
			<>
				<Button
					type="button"
					variant="outline"
					onClick={() => {
						setOpen(true);
					}}
				>
					<StopIcon weight="fill" className="size-4 text-ok" />
					<span className="tabular-nums">
						{formatStopwatch(elapsedSeconds)}
					</span>
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
