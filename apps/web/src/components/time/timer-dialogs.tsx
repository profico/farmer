import { descriptionRequiredFor } from "@farmer/core/lib/task-rules";
import {
	dayKeyInTz,
	parseDuration,
	snapToQuarterHour,
} from "@farmer/core/lib/time";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ProjectPicker } from "#/components/pickers/project-picker.tsx";
import { TaskPicker } from "#/components/pickers/task-picker.tsx";
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
import { formatClock } from "#/lib/format-hours.ts";
import { queryKeys } from "#/queries/keys.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { tasksForProjectQuery } from "#/queries/tasks.ts";
import type { getTimer } from "#/server/timer.ts";
import { confirmTimer, discardTimer, startTimer } from "#/server/timer.ts";

export type RunningTimer = NonNullable<Awaited<ReturnType<typeof getTimer>>>;

/** Everything a timer write touches. The entry is the only row that lands on a
 *  timesheet, so the time-entries family goes with it. */
const invalidateAfterTimer = async (
	queryClient: ReturnType<typeof useQueryClient>,
	orgSlug: string,
	wroteAnEntry: boolean,
) => {
	await queryClient.invalidateQueries({
		queryKey: [...queryKeys(orgSlug).timer],
	});
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
	const queryClient = useQueryClient();

	useEffect(() => {
		if (open) {
			setProjectId(defaultProjectId ?? null);
			setTaskId("");
			setDescription("");
		}
	}, [open, defaultProjectId]);

	const projectsQ = useQuery({ ...myProjectsQuery(orgSlug), enabled: open });
	const tasksQ = useQuery({
		...tasksForProjectQuery(orgSlug, projectId ?? undefined),
		enabled: open,
	});

	// Time off is a span somebody books, not something a stopwatch measures —
	// the service refuses it, so the picker does not offer it.
	const tasks = (tasksQ.data ?? []).filter((t) => !t.isAbsence);
	const selectedTask = tasks.find((t) => t.id === taskId) ?? null;

	const mutation = useMutation({
		mutationFn: () =>
			startTimer({
				data: {
					projectId: projectId ?? undefined,
					taskId,
					description: description.trim() || undefined,
				},
			}),
		onSuccess: async () => {
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
				</div>

				<DialogFooter>
					<Button
						type="button"
						onClick={() => {
							mutation.mutate();
						}}
						disabled={!taskId || mutation.isPending}
					>
						{mutation.isPending ? "Starting…" : "Start"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Stopping it (issue #59).
 *
 * The measured time is shown snapped, in a field the person can correct, and
 * nothing is written until they press Log. That is the answer to the objection
 * on the issue: a stopwatch here cannot produce 2:12, and it cannot produce a
 * figure nobody looked at.
 *
 * The timer survives every refusal — a full day, a missing note, a task
 * archived while it ran — because `timersService.confirm` writes the entry and
 * clears the timer in one transaction. So this dialog stays open on an error
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
	const startDay = dayKeyInTz(timer.startedAt, timezone);

	const [duration, setDuration] = useState(formatClock(timer.snappedSeconds));
	const [date, setDate] = useState(startDay);
	const [projectId, setProjectId] = useState<string | null>(timer.projectId);
	const [taskId, setTaskId] = useState(timer.taskId);
	const [description, setDescription] = useState(timer.description);

	// Every opening reads the timer as it stands now: the figure grew while the
	// dialog was closed, and the person is about to confirm this one.
	useEffect(() => {
		if (open) {
			setDuration(formatClock(timer.snappedSeconds));
			setDate(dayKeyInTz(timer.startedAt, timezone));
			setProjectId(timer.projectId);
			setTaskId(timer.taskId);
			setDescription(timer.description);
		}
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
					date,
					projectId: projectId ?? undefined,
					taskId,
					description: description.trim() || undefined,
					durationSeconds: seconds,
					overtime: false,
				},
			}),
		onSuccess: async () => {
			await invalidateAfterTimer(queryClient, orgSlug, true);
			toast.success(`Logged ${formatClock(seconds)}`);
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

	const busy = confirm.isPending || discard.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Log the time</DialogTitle>
					<p className="text-sm text-muted-foreground">
						{`Measured ${formatClock(timer.elapsedSeconds)}, rounded to the nearest 15 minutes. Change anything here before it goes on your timesheet.`}
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
						{confirm.isPending ? "Logging…" : `Log ${formatClock(seconds)}`}
					</Button>
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
