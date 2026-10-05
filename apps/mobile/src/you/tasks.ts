import type { Task, TaskList } from "@farmer/api-client";

import { TASK_GROUP_ORDER, taskGroupLabel } from "./format";

/** Every task a person can choose when they log time, work and time off,
 *  in the order of the task pickers. */
export const selectableTasks = (list: TaskList): Task[] => {
	const seen = new Set<string>();
	return [...list.tasks, ...list.absenceTasks]
		.filter((task) => {
			if (seen.has(task.id)) return false;
			seen.add(task.id);
			return true;
		})
		.sort((a, b) => a.name.localeCompare(b.name));
};

/** The tasks in their groups, in the order of the web app. */
export const tasksByGroup = (tasks: Task[]) => {
	const rank = (group: string) => {
		const index = TASK_GROUP_ORDER.indexOf(group);
		return index === -1 ? TASK_GROUP_ORDER.length : index;
	};
	const groups = new Map<string, Task[]>();
	for (const task of tasks) {
		groups.set(task.group, [...(groups.get(task.group) ?? []), task]);
	}
	return [...groups.entries()]
		.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
		.map(([group, members]) => ({
			group,
			label: taskGroupLabel(group),
			tasks: members,
		}));
};
