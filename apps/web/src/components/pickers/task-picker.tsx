import { matchesSearch } from "@farmer/core/lib/search";
import { TASK_GROUP_LABELS, TASK_GROUPS } from "@farmer/core/lib/task-taxonomy";
import { type ComponentPropsWithRef, useMemo, useState } from "react";

import {
	Combobox,
	ComboboxCollection,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxGroup,
	ComboboxGroupLabel,
	ComboboxItem,
	ComboboxList,
	ComboboxTrigger,
	ComboboxValue,
} from "#/components/ui/combobox.tsx";
import { cn } from "#/lib/utils.ts";

/** What the picker needs of a task — the shape `tasksForProjectQuery` returns. */
export type PickableTask = {
	id: string;
	name: string;
	group: string;
};

type Item = {
	/** Unique within the list: a task appears twice when it is also recent. */
	value: string;
	id: string;
	label: string;
	/** The group's own name, shown over the task on the trigger — the line the
	 *  project picker gives its client. Null for a group this build does not
	 *  know, which is a task row from a newer taxonomy, not an error. */
	groupLabel: string | null;
	recent: boolean;
};

/** The group's display name, without asserting the stored string is one of
 *  ours. `find` over `TASK_GROUPS` narrows it, so an unknown group comes back
 *  null and the trigger simply shows one line. */
const groupLabelOf = (group: string): string | null => {
	const known = TASK_GROUPS.find((candidate) => candidate === group);
	return known ? TASK_GROUP_LABELS[known] : null;
};

type Group = { value: string; label: string | null; items: Item[] };

const RECENT = "recent";
const NONE = "__none__";

/**
 * The task picker every entry form shares. With a project it is the whole
 * global list under its group headers — Recent first (the person's last three
 * tasks on this project, or anywhere if they are new to it), then Engineering,
 * Product, Learning, General — with one search over all of it and the first
 * match ready for Enter. Without a project it is the short project-less list
 * (time off and the built-ins), flat, with nothing to search.
 *
 * Recent is a shortcut, not a second home: it disappears while a query is
 * typed, so a search never shows the same task twice.
 */
export function TaskPicker({
	tasks,
	recentIds = [],
	value,
	onValueChange,
	grouped,
	noTask,
	placeholder = "Pick a task",
	disabled,
	className,
	...triggerProps
}: {
	tasks: PickableTask[];
	/** Task ids, most recent first; anything not in `tasks` is ignored. */
	recentIds?: string[];
	/** The chosen task id, or "" for none. */
	value: string;
	onValueChange: (taskId: string) => void;
	/** Group headers and recents (a project is chosen), or one flat list. */
	grouped: boolean;
	/** The label of a "no task" row, chosen as "". Omit to require a task. */
	noTask?: string;
	placeholder?: string;
	disabled?: boolean;
	className?: string;
} & Omit<
	ComponentPropsWithRef<"button">,
	"value" | "onChange" | "children" | "className" | "disabled" | "type"
>) {
	const groups = useMemo<Group[]>(() => {
		const item = (t: PickableTask, recent = false): Item => ({
			value: recent ? `${RECENT}:${t.id}` : t.id,
			id: t.id,
			label: t.name,
			groupLabel: groupLabelOf(t.group),
			recent,
		});
		// First and above everything, like the project picker's "no project" row.
		const none: Group[] = noTask
			? [
					{
						value: NONE,
						label: null,
						items: [
							{
								value: NONE,
								id: "",
								label: noTask,
								groupLabel: null,
								recent: false,
							},
						],
					},
				]
			: [];
		if (!grouped) {
			return [
				...none,
				{ value: "all", label: null, items: tasks.map((t) => item(t)) },
			];
		}
		const byId = new Map(tasks.map((t) => [t.id, t]));
		const recent = recentIds
			.map((id) => byId.get(id))
			.filter((t): t is PickableTask => t !== undefined)
			.map((t) => item(t, true));
		const grouped_ = TASK_GROUPS.map((g) => ({
			value: g,
			label: TASK_GROUP_LABELS[g],
			items: tasks.filter((t) => t.group === g).map((t) => item(t)),
		})).filter((g) => g.items.length > 0);
		return recent.length > 0
			? [
					...none,
					{ value: RECENT, label: "Recent", items: recent },
					...grouped_,
				]
			: [...none, ...grouped_];
	}, [tasks, recentIds, grouped, noTask]);

	const [query, setQuery] = useState("");
	const filtered = useMemo(() => {
		if (query.trim() === "") return groups;
		return groups
			.filter((g) => g.value !== RECENT && g.value !== NONE)
			.map((g) => ({
				...g,
				items: g.items.filter((i) => matchesSearch(query, [i.label])),
			}))
			.filter((g) => g.items.length > 0);
	}, [groups, query]);

	// Harvest's habit: a search narrowed to one task, then Tab, takes that task
	// and moves on. Recent is hidden while a query is typed, so one match is one
	// task, never the same task twice.
	const matches = query.trim() === "" ? [] : filtered.flatMap((g) => g.items);
	const soleMatch = matches.length === 1 ? matches[0] : undefined;

	// The group row, not the recent one, so the tick shows in one place.
	const selected =
		groups.flatMap((g) => g.items).find((i) => i.id === value && !i.recent) ??
		null;

	return (
		<Combobox
			items={groups}
			filteredItems={filtered}
			value={selected}
			onValueChange={(item: Item | null) => {
				if (item) onValueChange(item.id);
			}}
			isItemEqualToValue={(a: Item, b: Item) => a.value === b.value}
			itemToStringLabel={(item: Item) => item.label}
			inputValue={query}
			onInputValueChange={setQuery}
			onOpenChange={(open) => {
				if (!open) setQuery("");
			}}
			autoHighlight
			disabled={disabled || tasks.length === 0}
		>
			<ComboboxTrigger className={cn("w-full", className)} {...triggerProps}>
				<ComboboxValue placeholder={placeholder}>
					{(item: Item | null) =>
						item ? (
							<>
								{/* The group over the task, which is the shape the project
								    picker already uses for its client — and what makes the
								    two triggers beside each other on the entry form read as
								    one row rather than two boxes of different heights. Only
								    when the list is grouped: without a project the list is
								    flat and every row is time off or a built-in, so a header
								    over each would name a grouping the picker is not
								    showing. */}
								{grouped && item.groupLabel && (
									<span className="truncate text-xs text-muted-foreground">
										{item.groupLabel}
									</span>
								)}
								<span className="truncate">{item.label}</span>
							</>
						) : (
							placeholder
						)
					}
				</ComboboxValue>
			</ComboboxTrigger>
			<ComboboxContent
				searchPlaceholder={grouped ? "Search tasks…" : false}
				className={grouped ? undefined : "w-auto min-w-(--popup-anchor-width)"}
				onSearchTab={() => {
					if (soleMatch) onValueChange(soleMatch.id);
				}}
			>
				<ComboboxEmpty>No task matches.</ComboboxEmpty>
				<ComboboxList>
					{(group: Group) => (
						<ComboboxGroup key={group.value} items={group.items}>
							{group.label && (
								<ComboboxGroupLabel>{group.label}</ComboboxGroupLabel>
							)}
							<ComboboxCollection>
								{(item: Item) => (
									<ComboboxItem key={item.value} value={item}>
										<span className="truncate">{item.label}</span>
									</ComboboxItem>
								)}
							</ComboboxCollection>
						</ComboboxGroup>
					)}
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}
