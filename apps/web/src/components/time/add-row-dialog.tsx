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
import { myProjectsQuery } from "#/queries/projects.ts";
import { recentTasksQuery, tasksForProjectQuery } from "#/queries/tasks.ts";

const NO_PROJECT = "__none__";

export type DraftRow = {
	key: string;
	projectId: string | null;
	taskId: string;
	heading: string;
	taskName: string;
	color: string | null;
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
	const [projectId, setProjectId] = useState(NO_PROJECT);
	const [taskId, setTaskId] = useState("");

	const { data: projects } = useSuspenseQuery(myProjectsQuery(orgSlug));
	const { data: tasks = [] } = useQuery({
		...tasksForProjectQuery(
			orgSlug,
			projectId === NO_PROJECT ? undefined : projectId,
		),
		enabled: open,
	});
	const { data: recentIds = [] } = useQuery({
		...recentTasksQuery(orgSlug, projectId),
		enabled: open && projectId !== NO_PROJECT,
	});

	const selectedProject = projects.find((p) => p.id === projectId) ?? null;
	const selectedTask = tasks.find((t) => t.id === taskId) ?? null;
	// The work is the whole form now — a row with no hours in it is scaffolding,
	// not an entry, so there is nothing yet for a note to describe.
	const canAdd = taskId !== "";

	const reset = () => {
		setProjectId(NO_PROJECT);
		setTaskId("");
	};

	const submit = () => {
		if (!selectedTask) return;
		const resolvedProjectId = projectId === NO_PROJECT ? null : projectId;
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
		});
		reset();
		setOpen(false);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) reset();
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
							noProject="No project (absence)"
							value={projectId === NO_PROJECT ? null : projectId}
							onValueChange={(next) => {
								setProjectId(next ?? NO_PROJECT);
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
							tasks={tasks}
							recentIds={recentIds}
							grouped={projectId !== NO_PROJECT}
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
