import { TASK_GROUP_LABELS, TASK_GROUPS } from "@farmer/core/lib/task-taxonomy";
import { CheckIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
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
import { PageSection } from "#/components/ui/page-header.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { cn } from "#/lib/utils.ts";
import { queryKeys } from "#/queries/keys.ts";
import { hiddenTasksQuery, selectableTasksQuery } from "#/queries/tasks.ts";
import { setTaskHidden, showAllTasks } from "#/server/tasks.ts";

// Your tasks: the tasks a person has switched off, so the task list offers only
// the work they actually do (issue #84). One setting with two ways in —
// Preferences, and Edit list at the foot of every task picker — and both draw
// the same chips from here, so they cannot disagree about what is off.
//
// A switched-off task leaves the list AND its search; Edit list is the way
// back. It shapes the picker and nothing else: reports, the admin Tasks page,
// the API and the engines never read it.

/** The caller's switched-off task ids. Empty while loading, so a picker shows
 *  its whole list for a moment rather than nothing. */
export function useHiddenTaskIds(): ReadonlySet<string> {
	const orgSlug = useOrgSlug();
	const { data } = useQuery(hiddenTasksQuery(orgSlug));
	return useMemo(() => new Set(data), [data]);
}

type ChoosableTask = { id: string; name: string; group: string };

/**
 * The list to choose from, what is off, and the two writes. A chip saves the
 * moment it is clicked — there is no Save — so the cache is updated first and
 * put back with a toast if the server refuses.
 *
 * The refetch waits for the last of a burst of clicks: refetching after the
 * first while the second is still in flight would hand back a list without the
 * second, and its chip would flicker back for a beat.
 */
function useYourTasks() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: selectable } = useQuery(selectableTasksQuery(orgSlug));
	const hidden = useHiddenTaskIds();
	const { queryKey } = hiddenTasksQuery(orgSlug);
	const mutationKey = [...queryKeys(orgSlug).tasks, "hidden"];

	const tasks = useMemo<ChoosableTask[]>(
		() =>
			(selectable ?? [])
				.map(({ id, name, group }) => ({ id, name, group }))
				// The pickers' own order (`listForProject` sorts the same way), so a
				// chip sits where its row does.
				.sort((a, b) => a.name.localeCompare(b.name)),
		[selectable],
	);

	const settle = () => {
		if (queryClient.isMutating({ mutationKey }) === 1) {
			return queryClient.invalidateQueries({ queryKey });
		}
	};

	const toggle = useMutation({
		mutationKey,
		mutationFn: (data: { taskId: string; hidden: boolean }) =>
			setTaskHidden({ data }),
		onMutate: async ({ taskId, hidden: off }) => {
			await queryClient.cancelQueries({ queryKey });
			const previous = queryClient.getQueryData(queryKey);
			queryClient.setQueryData(queryKey, (ids = []) =>
				off
					? [...ids.filter((id) => id !== taskId), taskId]
					: ids.filter((id) => id !== taskId),
			);
			return { previous };
		},
		onError: (error: Error, _data, context) => {
			queryClient.setQueryData(queryKey, context?.previous);
			toast.error(error.message);
		},
		onSettled: settle,
	});

	const showAll = useMutation({
		mutationKey,
		mutationFn: () => showAllTasks(),
		onMutate: async () => {
			await queryClient.cancelQueries({ queryKey });
			const previous = queryClient.getQueryData(queryKey);
			queryClient.setQueryData(queryKey, []);
			return { previous };
		},
		onError: (error: Error, _data, context) => {
			queryClient.setQueryData(queryKey, context?.previous);
			toast.error(error.message);
		},
		onSettled: settle,
	});

	// Counted over the list on screen, not the stored ids: a task switched off
	// and later archived is still a row, but nothing anybody can see.
	const offCount = tasks.filter((t) => hidden.has(t.id)).length;

	return {
		tasks,
		hidden,
		offCount,
		setHidden: (taskId: string, off: boolean) =>
			toggle.mutate({ taskId, hidden: off }),
		showAll: () => showAll.mutate(),
	};
}

/**
 * One chip per task under its group, ticked while it is on. The look is
 * Preferences' own chips (Colors, Scale); the tick is what carries the state,
 * so on and off never rest on a tint alone.
 */
function TaskChips({
	tasks,
	hidden,
	onToggle,
}: {
	tasks: ChoosableTask[];
	hidden: ReadonlySet<string>;
	onToggle: (taskId: string, off: boolean) => void;
}) {
	const groups = TASK_GROUPS.map((group) => ({
		group,
		tasks: tasks.filter((t) => t.group === group),
	})).filter((g) => g.tasks.length > 0);

	return (
		<div className="grid gap-5">
			{groups.map(({ group, tasks: inGroup }) => (
				<fieldset key={group} className="min-w-0">
					<legend className="eyebrow mb-2.5">{TASK_GROUP_LABELS[group]}</legend>
					<div className="flex flex-wrap gap-1.5">
						{inGroup.map((task) => {
							const on = !hidden.has(task.id);
							return (
								<button
									key={task.id}
									type="button"
									aria-pressed={on}
									onClick={() => onToggle(task.id, on)}
									className={cn(
										"inline-flex h-7.5 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors duration-(--dur-fast) outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
										on
											? "border-line bg-secondary pl-2 font-medium text-foreground"
											: "border-line2 text-muted-foreground",
									)}
								>
									{on && (
										<CheckIcon
											weight="bold"
											aria-hidden
											className="size-3.5 shrink-0"
										/>
									)}
									{task.name}
								</button>
							);
						})}
					</div>
				</fieldset>
			))}
		</div>
	);
}

const DESCRIPTION =
	"Tasks you switch off leave the task list, search included, wherever you log time.";

/** Preferences → Your tasks. */
export function YourTasksSection() {
	const { tasks, hidden, offCount, setHidden, showAll } = useYourTasks();
	if (tasks.length === 0) return null;

	return (
		<PageSection
			title="Your tasks"
			description={`${DESCRIPTION} Edit list, at the bottom of any task list, changes the same thing.`}
			action={
				<div className="flex shrink-0 items-center gap-2.5">
					<span className="mono text-sm text-muted-foreground">
						{tasks.length - offCount} of {tasks.length} on
					</span>
					{offCount > 0 && (
						<Button variant="outline" size="sm" onClick={showAll}>
							Show all
						</Button>
					)}
				</div>
			}
		>
			<TaskChips tasks={tasks} hidden={hidden} onToggle={setHidden} />
		</PageSection>
	);
}

/** The same chips, over whatever form the task list was opened from. */
export function YourTasksDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { tasks, hidden, offCount, setHidden, showAll } = useYourTasks();

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Your tasks</DialogTitle>
					<DialogDescription>{DESCRIPTION}</DialogDescription>
				</DialogHeader>
				<TaskChips tasks={tasks} hidden={hidden} onToggle={setHidden} />
				<DialogFooter className="sm:justify-between">
					{offCount > 0 ? (
						<Button variant="ghost" onClick={showAll}>
							Show all
						</Button>
					) : (
						<span />
					)}
					<Button onClick={() => onOpenChange(false)}>Done</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
