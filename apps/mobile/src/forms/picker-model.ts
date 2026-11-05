import type { Project, Task } from "@farmer/api-client";

// The pure part of the project picker and the task picker: the search, the
// sort and the sections of the list. The screens only draw the result.

/** One row of the project list. */
export type ProjectItem =
	| { kind: "none" }
	| { kind: "project"; project: Project };

/** A group of rows under one title. A section with no title is the one row
 *  that sits above the clients. */
export type PickerSection<Item> = {
	key: string;
	title: string | null;
	data: Item[];
};

const same = (a: string, b: string) =>
	a.localeCompare(b, undefined, { sensitivity: "base" });

export const normalize = (search: string) => search.trim().toLowerCase();

/** A project matches when the search is in its name, its code or the name
 *  of its client. An empty search matches each project. */
export const matchesProject = (project: Project, search: string) => {
	const needle = normalize(search);
	if (!needle) return true;
	return [project.name, project.code ?? "", project.client.name].some((text) =>
		text.toLowerCase().includes(needle),
	);
};

/** The "No project" row shows when the search is empty or names it. */
export const showsNoProject = (search: string) => {
	const needle = normalize(search);
	return !needle || "no project".includes(needle);
};

/** A project is offered when it is active. The chosen project always shows,
 *  so that a person can see and clear it after it is archived. */
export const isOffered = (project: Project, chosenId: string | null) =>
	project.status === "active" || project.id === chosenId;

/** The projects by client. The clients and the projects in each client are
 *  sorted by name, with no regard to case. With `allowNone`, the "No project"
 *  row comes first. A project that is not active shows only when it is the
 *  chosen project. */
export function projectSections(
	projects: Project[],
	search: string,
	allowNone: boolean,
	chosenId: string | null = null,
): PickerSection<ProjectItem>[] {
	const clients = new Map<string, { name: string; projects: Project[] }>();
	for (const project of projects) {
		if (!isOffered(project, chosenId)) continue;
		if (!matchesProject(project, search)) continue;
		const client = clients.get(project.client.id) ?? {
			name: project.client.name,
			projects: [],
		};
		client.projects.push(project);
		clients.set(project.client.id, client);
	}
	// `sort`, not `toSorted`: Hermes has no `toSorted`. Both arrays are
	// copies that this function made.
	const sections: PickerSection<ProjectItem>[] = [...clients.entries()]
		.sort(([, a], [, b]) => same(a.name, b.name))
		.map(([id, client]) => ({
			key: `client:${id}`,
			title: client.name,
			data: client.projects
				.sort((a, b) => same(a.name, b.name))
				.map((project) => ({ kind: "project", project })),
		}));
	if (allowNone && showsNoProject(search)) {
		sections.unshift({
			key: "none",
			title: null,
			data: [{ kind: "none" }],
		});
	}
	return sections;
}

/** The tasks that the list offers. The tasks that the person hid do not
 *  show, but the chosen task always shows. With `includeAbsence`, the time
 *  off tasks come after the work tasks. */
export function offeredTasks(
	work: Task[],
	absence: Task[],
	hiddenIds: ReadonlySet<string>,
	chosenId: string | null,
	includeAbsence: boolean,
) {
	const all = includeAbsence ? [...work, ...absence] : work;
	return all.filter((task) => !hiddenIds.has(task.id) || task.id === chosenId);
}

/** The tasks by group, in the order of the server. */
export const byGroup = (tasks: Task[]) => {
	const groups = new Map<string, Task[]>();
	for (const task of tasks) {
		groups.set(task.group, [...(groups.get(task.group) ?? []), task]);
	}
	return [...groups.entries()];
};

/** A task matches when the search is in its name or its group. */
export const matchesTask = (task: Task, search: string) => {
	const needle = normalize(search);
	if (!needle) return true;
	return [task.name, task.group].some((text) =>
		text.toLowerCase().includes(needle),
	);
};

/** The sections of the task list, one for each group. */
export function taskSections(
	offered: Task[],
	search: string,
): PickerSection<Task>[] {
	return byGroup(offered.filter((task) => matchesTask(task, search))).map(
		([group, data]) => ({ key: `group:${group}`, title: group, data }),
	);
}
