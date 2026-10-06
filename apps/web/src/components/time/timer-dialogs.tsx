import { descriptionRequiredFor } from "@farmer/core/lib/task-rules";
import {
	dayKeyInTz,
	parseDuration,
	parseHeadStart,
	snapToQuarterHour,
} from "@farmer/core/lib/time";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ProjectPicker } from "#/components/pickers/project-picker.tsx";
import { TaskPicker } from "#/components/pickers/task-picker.tsx";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { DatePicker } from "#/components/ui/date-picker.tsx";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { readLastPick, rememberLastPick } from "#/lib/entry-options.ts";
import { formatClock } from "#/lib/format-hours.ts";
import { stopPayloadFields } from "#/lib/timer-stop.ts";
import { queryKeys } from "#/queries/keys.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { tasksForProjectQuery } from "#/queries/tasks.ts";
import { invalidateTimer, timerSettingsQuery } from "#/queries/timer.ts";
import type { getTimer } from "#/server/timer.ts";
import {
	confirmTimer,
	discardTimer,
	pauseTimer,
	resumeTimer,
	startTimer,
} from "#/server/timer.ts";

export type RunningTimer = NonNullable<Awaited<ReturnType<typeof getTimer>>>;

/** Everything a timer write touches. The entry is the only row that lands on a
 *  timesheet, so the time-entries family goes with it. */
const invalidateAfterTimer = async (
	queryClient: ReturnType<typeof useQueryClient>,
	orgSlug: string,
	wroteAnEntry: boolean,
) => {
	await invalidateTimer(queryClient, orgSlug);
	if (wroteAnEntry) {
		await queryClient.invalidateQueries({
			queryKey: [...queryKeys(orgSlug).timeEntries],
		});
		await queryClient.invalidateQueries({
			queryKey: [...queryKeys(orgSlug).compliance],
		});
	}
};

/**
 * Hold the clock, and let it go again.
 *
 * Both controls live here rather than in the card, because the card is not the
 * only thing that pauses: opening the Log dialog holds the clock too, so the
 * figure somebody is correcting cannot grow while they type. Both mutations
 * answer an already-held or already-running timer with the row as it stands
 * (see `timersService.pause`), so nothing here has to guess the state first.
 */
export function useTimerControls(orgSlug: string) {
	const queryClient = useQueryClient();

	const pause = useMutation({
		mutationFn: () => pauseTimer({}),
		onSuccess: () => invalidateAfterTimer(queryClient, orgSlug, false),
		onError: (error: Error) =>
			toast.error(error.message ?? "Could not pause the timer"),
	});

	const resume = useMutation({
		mutationFn: () => resumeTimer({}),
		onSuccess: () => invalidateAfterTimer(queryClient, orgSlug, false),
		onError: (error: Error) =>
			toast.error(error.message ?? "Could not resume the timer"),
	});

	return { pause, resume };
}

/**
 * Starting the clock (issue #59).
 *
 * The project and the task are asked for here rather than at the end, because
 * they are also what the row in the sidebar has to say while it runs — "2:14 on
 * Development" is a timer somebody can trust, "2:14" is a number. Both can
 * still be changed when it stops.
 */
export function StartTimerDialog({
	orgSlug,
	defaultProjectId,
	trigger,
}: {
	orgSlug: string;
	defaultProjectId?: string;
	trigger: React.ReactElement;
}) {
	const [open, setOpen] = useState(false);
	const [projectId, setProjectId] = useState<string | null>(
		defaultProjectId ?? null,
	);
	const [taskId, setTaskId] = useState("");
	const [description, setDescription] = useState("");
	// Time already worked before somebody remembered the timer (issue #107).
	// Empty is no head start; it is added to what the clock measures, and the
	// sum is what gets snapped when it stops.
	const [headStart, setHeadStart] = useState("");
	// The ceiling `timersService.start` enforces is the person's timer limit,
	// not a day, so it is read here: "13" against a 12-hour limit is refused
	// in the field, in the service's own words, rather than as a toast. Until
	// the limit arrives the day is the ceiling, and the service still checks.
	const settingsQ = useQuery({
		...timerSettingsQuery(orgSlug),
		enabled: open,
	});
	const headStartReading = headStart.trim()
		? parseHeadStart(headStart, settingsQ.data?.maxSeconds)
		: null;
	const headStartSeconds = headStartReading?.ok ? headStartReading.seconds : 0;
	const headStartError =
		headStartReading && !headStartReading.ok ? headStartReading.error : null;
	const queryClient = useQueryClient();

	// The dialog opens on the pair you last measured, the way the Log time
	// dialog opens on the pair you last logged. A stopwatch is started mid-task,
	// with the work already in front of you — two pickers between you and the
	// clock is the friction the feature exists to remove.
	//
	// The description is deliberately NOT remembered: it describes one stretch
	// of work, and yesterday's sentence on today's measurement is worse than an
	// empty box.
	useEffect(() => {
		if (!open) return;
		setDescription("");
		setHeadStart("");

		const last = readLastPick("timer", orgSlug);
		if (defaultProjectId) {
			// A caller that named the project wins; only the task comes from the
			// memory, and only when it was picked on that same project.
			setProjectId(defaultProjectId);
			setTaskId(last && last.projectId === defaultProjectId ? last.taskId : "");
			return;
		}
		setProjectId(last?.projectId ?? null);
		setTaskId(last?.taskId ?? "");
	}, [open, defaultProjectId, orgSlug]);

	const projectsQ = useQuery({ ...myProjectsQuery(orgSlug), enabled: open });
	const tasksQ = useQuery({
		...tasksForProjectQuery(orgSlug, projectId ?? undefined),
		enabled: open,
	});

	// Time off is a span somebody books, not something a stopwatch measures —
	// the service refuses it, so the picker does not offer it.
	const tasks = (tasksQ.data ?? []).filter((t) => !t.isAbsence);
	const selectedTask = tasks.find((t) => t.id === taskId) ?? null;

	// The memory is read before either list arrives, so a remembered pick has to
	// answer to them once they do: a project that was archived since, or a task
	// the project no longer offers, is dropped rather than shown as a choice the
	// server would then refuse. Both lists are checked only once loaded, so a
	// slow request never clears a valid pick.
	const projects = projectsQ.data;
	useEffect(() => {
		if (!open || !projects || projectId == null) return;
		const live = projects.some(
			(project) => project.id === projectId && project.status === "active",
		);
		if (!live) {
			setProjectId(null);
			setTaskId("");
		}
	}, [open, projects, projectId]);

	useEffect(() => {
		if (!open || !tasksQ.data || !taskId) return;
		if (!tasks.some((task) => task.id === taskId)) setTaskId("");
	}, [open, tasksQ.data, tasks, taskId]);

	const mutation = useMutation({
		mutationFn: () =>
			startTimer({
				data: {
					projectId: projectId ?? undefined,
					taskId,
					description: description.trim() || undefined,
					headStartSeconds: headStartSeconds || undefined,
				},
			}),
		onSuccess: async () => {
			// Only a pair. A timer measuring against a task with no project is an
			// unfiled measurement, which says nothing about where the next one
			// belongs — so it leaves the previous memory alone rather than
			// clearing it.
			if (projectId) rememberLastPick("timer", orgSlug, { projectId, taskId });
			await invalidateAfterTimer(queryClient, orgSlug, false);
			setOpen(false);
		},
		onError: (error: Error) =>
			toast.error(error.message ?? "Could not start the timer"),
	});

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={trigger} />
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Start a timer</DialogTitle>
					<p className="text-sm text-muted-foreground">
						Farmer measures while you work. Stopping shows you the figure,
						rounded to the nearest 15 minutes, before anything is logged.
					</p>
				</DialogHeader>

				<div className="grid gap-4">
					<div className="grid gap-2">
						<Label>Project</Label>
						<ProjectPicker
							projects={projectsQ.data ?? []}
							value={projectId}
							onValueChange={(next) => {
								setProjectId(next);
								setTaskId("");
							}}
							noProject="No project yet"
						/>
					</div>
					<div className="grid gap-2">
						<Label>Task</Label>
						<TaskPicker
							tasks={tasks}
							value={taskId}
							onValueChange={setTaskId}
							grouped={projectId != null}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="timer-description">
							What are you working on?
							{selectedTask && !descriptionRequiredFor(selectedTask) && (
								<span className="text-muted-foreground"> (optional)</span>
							)}
						</Label>
						<Textarea
							id="timer-description"
							value={description}
							onChange={(e) => {
								setDescription(e.target.value);
							}}
							placeholder="You can fill this in when you stop"
							rows={2}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="timer-head-start">
							Timer starts from
							<span className="text-muted-foreground"> (optional)</span>
						</Label>
						<Input
							id="timer-head-start"
							value={headStart}
							onChange={(e) => {
								setHeadStart(e.target.value);
							}}
							onBlur={() => {
								// The blur shows what was read, as the Log dialog's duration
								// does: "0.5" becomes "0:30". Not snapped — the sum is.
								if (headStartSeconds) {
									setHeadStart(formatClock(headStartSeconds));
								}
							}}
							placeholder="0:30"
							inputMode="decimal"
							aria-invalid={headStartError !== null}
							aria-describedby={
								headStartError ? "timer-head-start-error" : undefined
							}
						/>
						{headStartError && (
							<p
								id="timer-head-start-error"
								className="text-xs text-destructive"
							>
								{headStartError}
							</p>
						)}
					</div>
				</div>

				<DialogFooter>
					<Button
						type="button"
						onClick={() => {
							mutation.mutate();
						}}
						disabled={!taskId || headStartError !== null || mutation.isPending}
					>
						{mutation.isPending ? "Starting…" : "Start"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

type StopFormValues = {
	duration: string;
	date: string;
	projectId: string | null;
	taskId: string;
	description: string;
};

/**
 * Stopping it (issue #59).
 *
 * The measured time is shown snapped, in a field the person can correct, and
 * nothing is written until they press Log. That is the answer to the objection
 * on the issue: a stopwatch here cannot produce 2:12, and it cannot produce a
 * figure nobody looked at.
 *
 * Opening it HOLDS the clock, which is why the third button says Resume: the
 * figure somebody is correcting must not grow while they type, and a person who
 * opened the form to look at it has not decided to stop. Closing the dialog any
 * other way leaves the timer paused, and the sidebar card says so.
 *
 * The timer survives every refusal — a full day, a missing note, a task
 * archived while it ran — because `timersService.confirm` writes the entry and
 * clears the timer in one transaction.
 *
 * A timer that continues an entry (issue #107) opens on that entry's day and
 * saves over it, so the words say "update" rather than "log". So this dialog stays open on an error
 * and the measurement is still there to correct.
 */
export function StopTimerDialog({
	orgSlug,
	timezone,
	timer,
	open,
	onOpenChange,
}: {
	orgSlug: string;
	timezone: string;
	timer: RunningTimer;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const continuing = timer.timeEntryId != null;
	const startDay = timer.entryDate ?? dayKeyInTz(timer.startedAt, timezone);

	const [duration, setDuration] = useState(formatClock(timer.snappedSeconds));
	const [date, setDate] = useState(startDay);
	const [projectId, setProjectId] = useState<string | null>(timer.projectId);
	const [taskId, setTaskId] = useState(timer.taskId);
	const [description, setDescription] = useState(timer.description);

	// The form follows the timer prop while the dialog is open. Opening fills
	// every field from it. A later change of the prop (the refetch that the
	// pause behind this dialog starts, a refetch on window focus, an edit of the
	// entry saved elsewhere) takes a field only if the person has not edited it:
	// a field that still holds the value the form was last filled with takes the
	// new server value, and an edited field stays (issue #121). The dialog starts
	// no refetch of its own. One that raced with the pause's invalidation would
	// be cancelled, and the form would keep the stale note.
	const filledFrom = useRef<StopFormValues | null>(null);
	useEffect(() => {
		if (!open) {
			filledFrom.current = null;
			return;
		}
		const next: StopFormValues = {
			duration: formatClock(timer.snappedSeconds),
			date: timer.entryDate ?? dayKeyInTz(timer.startedAt, timezone),
			projectId: timer.projectId,
			taskId: timer.taskId,
			description: timer.description,
		};
		const from = filledFrom.current;
		filledFrom.current = next;
		if (!from) {
			setDuration(next.duration);
			setDate(next.date);
			setProjectId(next.projectId);
			setTaskId(next.taskId);
			setDescription(next.description);
			return;
		}
		const keep =
			<T,>(was: T, now: T) =>
			(value: T) =>
				value === was ? now : value;
		setDuration(keep(from.duration, next.duration));
		setDate(keep(from.date, next.date));
		setProjectId(keep(from.projectId, next.projectId));
		setTaskId(keep(from.taskId, next.taskId));
		setDescription(keep(from.description, next.description));
	}, [open, timer, timezone]);

	const projectsQ = useQuery({ ...myProjectsQuery(orgSlug), enabled: open });
	const tasksQ = useQuery({
		...tasksForProjectQuery(orgSlug, projectId ?? undefined),
		enabled: open,
	});
	const tasks = (tasksQ.data ?? []).filter((t) => !t.isAbsence);
	const selectedTask = tasks.find((t) => t.id === taskId) ?? null;
	const needsDescription = selectedTask
		? descriptionRequiredFor(selectedTask)
		: true;

	const seconds = snapToQuarterHour(parseDuration(duration) ?? 0);

	const confirm = useMutation({
		mutationFn: () =>
			confirmTimer({
				data: {
					// A field the person did not edit is left out, so the server
					// fills it with the live value. Null and "" still clear the
					// project and the note.
					...stopPayloadFields({
						form: { duration, date, projectId, taskId, description },
						filled: filledFrom.current,
						seconds,
						entrySeconds: timer.entrySeconds,
					}),
					overtime: false,
				},
			}),
		onSuccess: async (entry) => {
			// What was LOGGED is the habit, not what was started: somebody who
			// starts on one project and files the measurement against another has
			// told you where the next timer belongs.
			if (projectId) rememberLastPick("timer", orgSlug, { projectId, taskId });
			await invalidateAfterTimer(queryClient, orgSlug, true);
			toast.success(
				continuing
					? `Updated the entry to ${formatClock(entry.durationSeconds)}`
					: `Logged ${formatClock(entry.durationSeconds)}`,
			);
			onOpenChange(false);
		},
		onError: (error: Error) =>
			toast.error(error.message ?? "Could not log the time"),
	});

	const discard = useMutation({
		mutationFn: () => discardTimer({}),
		onSuccess: async () => {
			await invalidateAfterTimer(queryClient, orgSlug, false);
			onOpenChange(false);
		},
		onError: (error: Error) =>
			toast.error(error.message ?? "Could not discard the timer"),
	});

	const { resume } = useTimerControls(orgSlug);
	const busy = confirm.isPending || discard.isPending || resume.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{continuing ? "Update the entry" : "Log the time"}
					</DialogTitle>
					<p className="text-sm text-muted-foreground">
						{continuing
							? `The entry held ${formatClock(timer.entrySeconds)}. With the time measured since, the clock is held at ${formatClock(timer.elapsedSeconds)}, rounded to the nearest 15 minutes. Change anything here before it is saved, or resume and keep measuring.`
							: `The clock is held at ${formatClock(timer.elapsedSeconds)}, rounded to the nearest 15 minutes. Change anything here before it goes on your timesheet, or resume and keep measuring.`}
					</p>
				</DialogHeader>

				<div className="grid gap-4">
					<div className="grid grid-cols-2 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="timer-duration">Duration</Label>
							<Input
								id="timer-duration"
								value={duration}
								onChange={(e) => {
									setDuration(e.target.value);
								}}
								onBlur={() => {
									// The blur IS the feedback, as it is in the entry dialog:
									// you see the snapped figure rather than read a note about
									// rounding.
									if (seconds > 0) setDuration(formatClock(seconds));
								}}
							/>
						</div>
						<div className="grid gap-2">
							<Label>Day</Label>
							<DatePicker
								value={date}
								onValueChange={(next) => {
									if (next) setDate(next);
								}}
							/>
						</div>
					</div>
					<div className="grid gap-2">
						<Label>Project</Label>
						<ProjectPicker
							projects={projectsQ.data ?? []}
							value={projectId}
							onValueChange={(next) => {
								setProjectId(next);
							}}
							noProject="File it later"
						/>
					</div>
					<div className="grid gap-2">
						<Label>Task</Label>
						<TaskPicker
							tasks={tasks}
							value={taskId}
							onValueChange={setTaskId}
							grouped={projectId != null}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="timer-stop-description">
							What did you work on?
							{!needsDescription && (
								<span className="text-muted-foreground"> (optional)</span>
							)}
						</Label>
						<Textarea
							id="timer-stop-description"
							value={description}
							onChange={(e) => {
								setDescription(e.target.value);
							}}
							rows={2}
						/>
					</div>
				</div>

				{/* Three ways out, and the gap says which is which: throwing the
				    measurement away stands apart on the left, and the two that keep
				    it sit together on the right under the one filled button. */}
				<DialogFooter className="sm:justify-between">
					<Button
						type="button"
						variant="ghost"
						onClick={() => {
							discard.mutate();
						}}
						disabled={busy}
					>
						Discard
					</Button>
					<div className="flex items-center gap-2">
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								resume.mutate(undefined, {
									onSuccess: () => {
										onOpenChange(false);
									},
								});
							}}
							disabled={busy}
						>
							{resume.isPending ? "Resuming…" : "Resume"}
						</Button>
						<Button
							type="button"
							onClick={() => {
								confirm.mutate();
							}}
							disabled={
								busy ||
								seconds <= 0 ||
								!taskId ||
								(needsDescription && !description.trim())
							}
						>
							{confirm.isPending
								? continuing
									? "Saving…"
									: "Logging…"
								: `${continuing ? "Save" : "Log"} ${formatClock(seconds)}`}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * The notice a dropped timer leaves (issues #59, #43).
 *
 * `jobs/timer-sweep.ts` never logs the time — a figure nobody chose is the one
 * thing a stopwatch must not write — so this says what was measured and leaves
 * the logging to the person. It is shown where they work, because a push
 * notification reaches nobody who never granted one.
 */
export function DroppedTimerDialog({
	orgSlug,
	timezone,
	timer,
	open,
	onOpenChange,
}: {
	orgSlug: string;
	timezone: string;
	timer: RunningTimer;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const dismiss = useMutation({
		mutationFn: () => discardTimer({}),
		onSuccess: async () => {
			await invalidateAfterTimer(queryClient, orgSlug, false);
			onOpenChange(false);
		},
		onError: (error: Error) =>
			toast.error(error.message ?? "Could not dismiss the notice"),
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Your timer was dropped</DialogTitle>
					<p className="text-sm text-muted-foreground">
						{`It started on ${dayKeyInTz(timer.startedAt, timezone)} on ${timer.taskName} and ran past your limit, so nothing was logged. Log the time by hand if you still want it.`}
					</p>
				</DialogHeader>
				<DialogFooter>
					<Button
						type="button"
						onClick={() => {
							dismiss.mutate();
						}}
						disabled={dismiss.isPending}
					>
						Dismiss
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Throwing a running timer away (issue #59).
 *
 * The Log dialog carries Discard as well, but reaching it there means opening
 * the whole entry form for a measurement somebody has already decided not to
 * keep. This is the same mutation behind one question, for the button on the
 * sidebar card. It asks, because the measurement is the only copy: nothing was
 * written while the clock ran.
 */
export function DiscardTimerDialog({
	orgSlug,
	measured,
	continuing = false,
	open,
	onOpenChange,
}: {
	orgSlug: string;
	/** The figure as the card shows it, so the question names what is lost. */
	measured: string;
	/** The timer continues an entry, which keeps what it held before. */
	continuing?: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const discard = useMutation({
		mutationFn: () => discardTimer({}),
		onSuccess: async () => {
			await invalidateAfterTimer(queryClient, orgSlug, false);
			onOpenChange(false);
		},
		onError: (error: Error) =>
			toast.error(error.message ?? "Could not discard the timer"),
	});

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Discard this timer?</AlertDialogTitle>
					<AlertDialogDescription>
						{continuing
							? `The clock is at ${measured}. Discarding throws away what it measured, and the entry keeps what it held before.`
							: `${measured} was measured and nothing has been logged yet. Discarding throws the measurement away.`}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Keep it running</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						onClick={() => {
							discard.mutate();
						}}
						disabled={discard.isPending}
					>
						Discard
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
