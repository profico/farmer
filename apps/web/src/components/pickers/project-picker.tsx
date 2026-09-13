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
import { matchesSearch } from "#/lib/search.ts";
import { cn } from "#/lib/utils.ts";

/** What the picker needs of a project — the shape `myProjectsQuery` returns,
 *  narrowed so a test or another list can hand it something smaller. */
export type PickableProject = {
	id: string;
	name: string;
	code: string | null;
	status: string;
	client: { name: string } | null;
};

type Item = {
	/** Unique within the list; the project id, or the no-project sentinel. */
	value: string;
	id: string | null;
	label: string;
	code: string | null;
	clientName: string | null;
};

type Group = { value: string; label: string | null; items: Item[] };

const NONE = "__none__";

/**
 * The project picker every entry form shares — Harvest's layout: clients as
 * headers, their projects alphabetical underneath, one search box over all of
 * it that matches project and client names together ("heg" finds every Hegnar
 * project). Internal work is under the internal client like any other.
 *
 * The "no project" row, when the form allows one, sits first and above the
 * clients: it is chosen like a project, and the task list that follows it is
 * the project-less one (time off and the built-ins).
 *
 * Archived projects are not offered. The one exception is a project already on
 * the entry being edited, which stays in the list so the field can show it —
 * otherwise opening an old entry would silently read as "no project".
 */
export function ProjectPicker({
	projects,
	value,
	onValueChange,
	noProject,
	placeholder = "Pick a project",
	disabled,
	className,
	...triggerProps
}: {
	projects: PickableProject[];
	/** The chosen project id; `null` is "no project". */
	value: string | null;
	onValueChange: (projectId: string | null) => void;
	/** The label of the "no project" row. Omit to require a project. */
	noProject?: string;
	placeholder?: string;
	disabled?: boolean;
	className?: string;
} & Omit<
	ComponentPropsWithRef<"button">,
	"value" | "onChange" | "children" | "className" | "disabled" | "type"
>) {
	const groups = useMemo<Group[]>(() => {
		const byClient = new Map<string, Item[]>();
		for (const p of projects) {
			if (p.status !== "active" && p.id !== value) continue;
			const clientName = p.client?.name ?? "";
			const items = byClient.get(clientName) ?? [];
			items.push({
				value: p.id,
				id: p.id,
				label: p.name,
				code: p.code,
				clientName: p.client?.name ?? null,
			});
			byClient.set(clientName, items);
		}
		const clients = [...byClient.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([clientName, items]) => ({
				value: `client:${clientName}`,
				label: clientName || null,
				items: items.sort((a, b) => a.label.localeCompare(b.label)),
			}));
		if (!noProject) return clients;
		return [
			{
				value: NONE,
				label: null,
				items: [
					{
						value: NONE,
						id: null,
						label: noProject,
						code: null,
						clientName: null,
					},
				],
			},
			...clients,
		];
	}, [projects, value, noProject]);

	const [query, setQuery] = useState("");
	const filtered = useMemo(() => {
		if (query.trim() === "") return groups;
		return groups
			.map((g) => ({
				...g,
				items: g.items.filter((i) =>
					matchesSearch(query, [i.label, i.code, i.clientName]),
				),
			}))
			.filter((g) => g.items.length > 0);
	}, [groups, query]);

	const selected =
		value === null
			? noProject
				? (groups[0]?.items[0] ?? null)
				: null
			: (groups.flatMap((g) => g.items).find((i) => i.id === value) ?? null);

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
			disabled={disabled}
		>
			<ComboboxTrigger className={cn("w-full", className)} {...triggerProps}>
				<ComboboxValue placeholder={placeholder}>
					{(item: Item | null) =>
						item ? (
							<>
								{item.clientName && (
									<span className="truncate text-xs text-muted-foreground">
										{item.clientName}
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
			<ComboboxContent searchPlaceholder="Search projects and clients…">
				<ComboboxEmpty>No project matches.</ComboboxEmpty>
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
										{item.code && (
											<span className="mono shrink-0 text-xs text-muted-foreground">
												{item.code}
											</span>
										)}
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
