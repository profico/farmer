import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";

import { ProjectPicker } from "#/components/pickers/project-picker.tsx";
import { TaskPicker } from "#/components/pickers/task-picker.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import { Label } from "#/components/ui/label.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { readLastPick, rememberLastPick } from "#/lib/entry-options.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { recentTasksQuery, tasksForProjectQuery } from "#/queries/tasks.ts";

// Time off is chosen where a project would be, and narrows the tasks to the
// leave kinds — the same shape as the Log time dialog.
const TIME_OFF = "__time_off__";

export type DraftRow = {
	key: string;
	projectId: string | null;
	taskId: string;
	heading: string;
	taskName: string;
	color: string | null;
	/** The chosen project, for the row's icon; null for a time-off row. */
	project: { name: string; icon?: string | null } | null;
};

/**
 * Adds an empty row to the week grid — the work, and nothing else.
 *
 * The note used to be captured here, on the theory that asking once up front
 * beat prompting on every keystroke. Both are wrong: you are picking a row to
 * fill in, and you do not yet know what you will have done on Thursday. This is
 * the order Harvest uses and the one people expect — add the row empty, type
 * the hours, and describe each day afterwards through the row's note button,
 * which only appears once there is time for a note to attach to.
 */
export function AddRowDialog({
	existingKeys,
	onAdd,
	trigger,
}: {
	existingKeys: Set<string>;
	onAdd: (row: DraftRow) => void;
	trigger: ReactElement;
}) {
	const orgSlug = useOrgSlug();
	const [open, setOpen] = useState(false);
	const [projectId, setProjectId] = useState(TIME_OFF);
	const [taskId, setTaskId] = useState("");

	const { data: projects } = useSuspenseQuery(myProjectsQuery(orgSlug));
	const { data: tasks = [] } = useQuery({
		...tasksForProjectQuery(
			orgSlug,
			projectId === TIME_OFF ? undefined : projectId,
		),
		enabled: open,
	});
	const { data: recentIds = [] } = useQuery({
		...recentTasksQuery(orgSlug, projectId),
		enabled: open && projectId !== TIME_OFF,
	});

	const isTimeOff = projectId === TIME_OFF;
	const pickableTasks = isTimeOff ? tasks.filter((t) => t.isAbsence) : tasks;
	const selectedProject = projects.find((p) => p.id === projectId) ?? null;
	const selectedTask = tasks.find((t) => t.id === taskId) ?? null;
	// The work is the whole form now — a row with no hours in it is scaffolding,
	// not an entry, so there is nothing yet for a note to describe. Checked
	// against the offered list rather than for a non-empty id, because a
	// remembered task may since have been archived.
	const canAdd = pickableTasks.some((t) => t.id === taskId);

	const reset = () => {
		setProjectId(TIME_OFF);
		setTaskId("");
	};

	// The dialog opens on the row last added, while its project can still take
	// time and the row is not already on this week — prefilling a duplicate
	// would only set up the "already a row" refusal.
	const prefill = () => {
		const last = readLastPick("week-row", orgSlug);
		if (!last) return;
		const live = projects.some(
			(p) => p.id === last.projectId && p.status === "active",
		);
		if (!live || existingKeys.has(`${last.projectId}|${last.taskId}`)) return;
		setProjectId(last.projectId);
		setTaskId(last.taskId);
	};

	const submit = () => {
		if (!selectedTask) return;
		const resolvedProjectId = projectId === TIME_OFF ? null : projectId;
		const key = `${resolvedProjectId ?? "none"}|${taskId}`;
		if (existingKeys.has(key)) {
			toast.error("That project and task is already a row this week");
			return;
		}
		const code = selectedProject?.code ? `[${selectedProject.code}] ` : "";
		const client = selectedProject?.client
			? ` (${selectedProject.client.name})`
			: "";
		onAdd({
			key,
			projectId: resolvedProjectId,
			taskId,
			heading: selectedProject
				? `${code}${selectedProject.name}${client}`
				: selectedTask.name,
			taskName: selectedProject ? selectedTask.name : "",
			color: selectedTask.color,
			project: selectedProject,
		});
		// Time off is never remembered: a week of leave is not the next row.
		if (resolvedProjectId) {
			rememberLastPick("week-row", orgSlug, {
				projectId: resolvedProjectId,
				taskId,
			});
		}
		reset();
		setOpen(false);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) prefill();
				else reset();
			}}
		>
			<DialogTrigger render={trigger} />
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add a row</DialogTitle>
				</DialogHeader>
				<div className="grid grid-cols-[minmax(0,1fr)] gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="add-row-project">Project</Label>
						<ProjectPicker
							id="add-row-project"
							projects={projects}
							noProject="Time-off"
							value={projectId === TIME_OFF ? null : projectId}
							onValueChange={(next) => {
								setProjectId(next ?? TIME_OFF);
								// The task list follows the project, so a project change can
								// leave a task selected that no longer applies.
								setTaskId("");
							}}
						/>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="add-row-task">Task</Label>
						<TaskPicker
							id="add-row-task"
							tasks={pickableTasks}
							recentIds={recentIds}
							grouped={!isTimeOff}
							value={taskId}
							onValueChange={setTaskId}
							placeholder={
								tasks.length === 0 ? "Loading tasks…" : "Pick a task"
							}
						/>
					</div>
				</div>
				<DialogFooter>
					<Button disabled={!canAdd} onClick={submit}>
						Add row
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
