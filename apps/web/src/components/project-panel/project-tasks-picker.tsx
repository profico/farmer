import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button.tsx";
import { PillToggleGroup } from "#/components/ui/pill-toggle-group.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { queryKeys } from "#/queries/keys.ts";
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

/**
 * Which of the org's tasks this project offers.
 *
 * Lives inside the detail panel's Edit tab rather than on a tab of its own: the
 * task subset is a property of the project in the same way its name is, and a
 * tab per field is how a panel turns into a filing cabinet. It keeps its own
 * Save button because it is its own write (`setProjectTasks`) against a
 * different service from the name/colour patch — one button spanning two
 * mutations would have to invent what a half-failure means.
 */
export function ProjectTasksPicker({
	projectId,
}: {
	projectId: string | null;
}) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();

	// The draft is tagged with the project it belongs to, so selecting another
	// row shows that row's tasks rather than the last row's edits.
	const [draft, setDraft] = useState<{ pid: string; ids: string[] } | null>(
		null,
	);

	const { data: allTasks } = useQuery({
		...selectableTasksQuery(orgSlug),
		enabled: !!projectId,
	});
	const { data: picked } = useQuery({
		...projectTasksQuery(orgSlug, projectId ?? ""),
		enabled: !!projectId,
	});

	// The two universal shapes are both excluded from the baseline: absence tasks
	// can never be on a project, and built-ins are on every one of them. Neither
	// is something this picker decides, so neither counts as picked.
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
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).projects],
				}),
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).tasks],
				}),
			]);
			setDraft(null);
			toast.success("Tasks updated");
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not update tasks");
		},
	});

	return (
		<div className="grid gap-3">
			<div>
				<p className="eyebrow">Tasks</p>
				<p className="mt-2 text-sm leading-normal text-muted-foreground">
					Tasks are one global list; a project opts into the subset that applies
					to it. Apart from the built-ins below, people can only log time
					against the tasks picked here.
				</p>
			</div>

			{!loaded ? (
				<p className="text-sm text-muted-foreground">Loading tasks…</p>
			) : pickable.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No tasks exist yet. An admin can add them under Settings → Tasks.
				</p>
			) : (
				<div className="-mx-1 px-1 py-1">
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
					{builtIns.length === 1 ? "is" : "are"} available on every project and
					can't be turned off.
				</p>
			)}

			{/* Unpicking every task is a legitimate end state (the project stops
			    accepting new entries), so an empty selection still saves. */}
			<Button
				className="w-full"
				disabled={!dirty || saveMutation.isPending}
				onClick={() => saveMutation.mutate()}
			>
				{saveMutation.isPending ? "Saving…" : "Save tasks"}
			</Button>
		</div>
	);
}
