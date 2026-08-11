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
import { projectTasksQuery } from "#/queries/projects.ts";
import { selectableTasksQuery } from "#/queries/tasks.ts";
import { setProjectTasks } from "#/server/tasks.ts";

const sameSet = (a: string[], b: string[]) =>
	a.length === b.length && a.every((id) => b.includes(id));

/** Mirror of `isUniversalTask` in services/guards.ts. Site-scoped non-absence
 *  built-ins are on every project without being picked, so they are neither
 *  togglable here nor part of the saved set — showing them as pills you could
 *  untick would be a lie the server then silently corrects. */
const isUniversal = (t: { scope: string; isAbsence: boolean }) =>
	t.scope === "site" && !t.isAbsence;

/** Edit which of the global tasks a project offers, after the project exists —
 *  the picker that used to be reachable only inside the create form. */
export function ManageProjectTasksDialog({
	projectId,
	projectName,
	onOpenChange,
}: {
	projectId: string | null;
	projectName: string | null;
	onOpenChange: (open: boolean) => void;
}) {
	const open = projectId !== null;
	const queryClient = useQueryClient();

	// The draft is tagged with the project it belongs to, so opening the dialog on
	// a different row shows that row's tasks rather than the last row's edits.
	const [draft, setDraft] = useState<{ pid: string; ids: string[] } | null>(
		null,
	);

	const { data: allTasks } = useQuery({
		...selectableTasksQuery(),
		enabled: open,
	});
	const { data: picked } = useQuery({
		...projectTasksQuery(projectId ?? ""),
		enabled: open && !!projectId,
	});

	// The two universal shapes are both excluded from the baseline: absence tasks
	// can never be on a project, and built-ins are on every one of them. Neither
	// is something this dialog decides, so neither counts as picked.
	const universalIds = useMemo(
		() => new Set((allTasks ?? []).filter(isUniversal).map((t) => t.id)),
		[allTasks],
	);
	const baseline = useMemo(
		() =>
			(picked ?? [])
				.filter((t) => !t.isAbsence && !universalIds.has(t.id))
				.map((t) => t.id),
		[picked, universalIds],
	);

	// Shown as a static line rather than pills, so it reads as "these come with
	// the project" instead of "someone already ticked these for you".
	const builtIns = (allTasks ?? []).filter(isUniversal);
	const pickable = (allTasks ?? []).filter((t) => !isUniversal(t));

	const loaded = allTasks !== undefined && picked !== undefined;
	const selected = draft?.pid === projectId ? draft.ids : baseline;
	const dirty = loaded && !sameSet(selected, baseline);

	const toggle = (taskId: string) => {
		if (!projectId) return;
		setDraft({
			pid: projectId,
			ids: selected.includes(taskId)
				? selected.filter((id) => id !== taskId)
				: [...selected, taskId],
		});
	};

	const saveMutation = useMutation({
		mutationFn: () =>
			setProjectTasks({
				data: { projectId: projectId ?? "", taskIds: selected },
			}),
		onSuccess: async () => {
			// Both halves of the join are cached under these two roots: the projects
			// list embeds each project's tasks, and every entry form's task picker
			// hangs off ["tasks", …].
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["projects"] }),
				queryClient.invalidateQueries({ queryKey: ["tasks"] }),
			]);
			setDraft(null);
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not update tasks");
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
					<DialogTitle>Tasks on {projectName ?? "this project"}</DialogTitle>
					<DialogDescription>
						Tasks are one global list; a project opts into the subset that
						applies to it. Apart from the built-ins noted below, people can
						only log time against the tasks picked here.
					</DialogDescription>
				</DialogHeader>

				{!loaded ? (
					<p className="py-2 text-sm text-muted-foreground">Loading tasks…</p>
				) : pickable.length === 0 ? (
					<p className="py-2 text-sm text-muted-foreground">
						No tasks exist yet. An admin can add them under Settings → Tasks.
					</p>
				) : (
					<div className="scrollbar-stable -mx-1 max-h-72 overflow-y-auto px-1 py-1">
						<PillToggleGroup
							items={pickable.map((t) => ({ id: t.id, label: t.name }))}
							selectedIds={selected}
							onToggle={toggle}
							disabled={saveMutation.isPending}
						/>
					</div>
				)}

				{builtIns.length > 0 && (
					<p className="text-xs text-muted-foreground">
						{builtIns.map((t) => t.name).join(" and ")}{" "}
						{builtIns.length === 1 ? "is" : "are"} available on every project
						and can't be turned off.
					</p>
				)}

				<DialogFooter>
					{/* Unpicking every task is a legitimate end state (the project stops
					    accepting new entries), so an empty selection still saves. */}
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
