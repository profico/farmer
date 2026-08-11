import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog.tsx";
import { PillToggleGroup } from "#/components/ui/pill-toggle-group.tsx";
import { projectsQuery } from "#/queries/projects.ts";
import { projectsForTaskQuery } from "#/queries/tasks.ts";
import { setTaskProjects } from "#/server/tasks.ts";

const sameSet = (a: string[], b: string[]) =>
	a.length === b.length && a.every((id) => b.includes(id));

/** The mirror of ManageProjectTasksDialog: pick the projects a task appears on,
 *  from the task's own row in Settings. Same join, opposite direction. */
export function ManageTaskProjectsDialog({
	taskId,
	taskName,
	onOpenChange,
}: {
	taskId: string | null;
	taskName: string | null;
	onOpenChange: (open: boolean) => void;
}) {
	const open = taskId !== null;
	const queryClient = useQueryClient();

	const [draft, setDraft] = useState<{ tid: string; ids: string[] } | null>(
		null,
	);

	const { data: projects } = useQuery({ ...projectsQuery(), enabled: open });
	const { data: linked } = useQuery({
		...projectsForTaskQuery(taskId ?? ""),
		enabled: open && !!taskId,
	});

	const baseline = useMemo(() => linked ?? [], [linked]);
	const loaded = projects !== undefined && linked !== undefined;
	const selected = draft?.tid === taskId ? draft.ids : baseline;
	const dirty = loaded && !sameSet(selected, baseline);

	// An archived project is dormant, not gone: it isn't offered as a new choice,
	// but one that already carries the task stays listed so you can still take it
	// off — otherwise the link would be uneditable until someone unarchived.
	const items = useMemo(() => {
		const current = new Set(baseline);
		return (projects ?? [])
			.filter((p) => p.status === "active" || current.has(p.id))
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((p) => ({
				id: p.id,
				label: p.name,
				hint:
					p.status === "archived" ? "archived" : (p.client?.name ?? undefined),
			}));
	}, [projects, baseline]);

	const toggle = (projectId: string) => {
		if (!taskId) return;
		setDraft({
			tid: taskId,
			ids: selected.includes(projectId)
				? selected.filter((id) => id !== projectId)
				: [...selected, projectId],
		});
	};

	const saveMutation = useMutation({
		mutationFn: () =>
			setTaskProjects({ data: { taskId: taskId ?? "", projectIds: selected } }),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["projects"] }),
				queryClient.invalidateQueries({ queryKey: ["tasks"] }),
			]);
			setDraft(null);
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not update projects");
		},
	});

	const close = (next: boolean) => {
		if (!next) setDraft(null);
		onOpenChange(next);
	};

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Projects using {taskName ?? "this task"}</DialogTitle>
					<DialogDescription>
						Pick the projects that offer this task. Removing it from a project
						only takes it off that project's picker — time already logged
						against it is untouched.
					</DialogDescription>
				</DialogHeader>

				{!loaded ? (
					<p className="py-2 text-sm text-muted-foreground">
						Loading projects…
					</p>
				) : items.length === 0 ? (
					<p className="py-2 text-sm text-muted-foreground">
						No active projects to add this task to.
					</p>
				) : (
					<div className="-mx-1 px-1 py-1">
						<PillToggleGroup
							items={items}
							selectedIds={selected}
							onToggle={toggle}
							disabled={saveMutation.isPending}
						/>
					</div>
				)}

				<DialogFooter>
					<Button
						variant="ghost"
						onClick={() => close(false)}
						disabled={saveMutation.isPending}
					>
						Cancel
					</Button>
					<Button
						onClick={() => saveMutation.mutate()}
						disabled={!dirty || saveMutation.isPending}
					>
						{saveMutation.isPending ? "Saving…" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
