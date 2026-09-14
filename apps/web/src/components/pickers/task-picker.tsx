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
	recent: boolean;
};

type Group = { value: string; label: string | null; items: Item[] };

const RECENT = "recent";

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
			recent,
		});
		if (!grouped) {
			return [{ value: "all", label: null, items: tasks.map((t) => item(t)) }];
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
			? [{ value: RECENT, label: "Recent", items: recent }, ...grouped_]
			: grouped_;
	}, [tasks, recentIds, grouped]);

	const [query, setQuery] = useState("");
	const filtered = useMemo(() => {
		if (query.trim() === "") return groups;
		return groups
			.filter((g) => g.value !== RECENT)
			.map((g) => ({
				...g,
				items: g.items.filter((i) => matchesSearch(query, [i.label])),
			}))
			.filter((g) => g.items.length > 0);
	}, [groups, query]);

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
					{(item: Item | null) => (
						<span className="truncate">{item ? item.label : placeholder}</span>
					)}
				</ComboboxValue>
			</ComboboxTrigger>
			<ComboboxContent
				searchPlaceholder={grouped ? "Search tasks…" : false}
				className={grouped ? undefined : "w-auto min-w-(--anchor-width)"}
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
