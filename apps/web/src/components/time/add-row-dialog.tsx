import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { tasksForProjectQuery } from "#/queries/tasks.ts";

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

	const projectItems = [
		{ value: NO_PROJECT, label: "No project (absence)" },
		...projects.map((p) => ({
			value: p.id,
			label: p.code ? `[${p.code}] ${p.name}` : p.name,
		})),
	];
	const taskItems = tasks.map((t) => ({ value: t.id, label: t.name }));

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
				<div className="grid gap-4">
					<div className="grid gap-1.5">
						<Label>Project</Label>
						<Select
							items={projectItems}
							value={projectId}
							onValueChange={(value: string | null) => {
								setProjectId(value ?? NO_PROJECT);
								// The task list is project-scoped, so a project change can
								// leave a task selected that no longer applies.
								setTaskId("");
							}}
						>
							<SelectTrigger className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{projectItems.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="grid gap-1.5">
						<Label>Task</Label>
						<Select
							items={taskItems}
							value={taskId}
							onValueChange={(value: string | null) => setTaskId(value ?? "")}
							disabled={taskItems.length === 0}
						>
							<SelectTrigger className="w-full">
								<SelectValue
									placeholder={
										taskItems.length === 0
											? "No tasks available"
											: "Pick a task"
									}
								/>
							</SelectTrigger>
							<SelectContent>
								{taskItems.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
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
