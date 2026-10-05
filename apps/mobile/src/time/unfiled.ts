import type { NewTimeEntry, UnfiledEntry } from "@farmer/api-client";

/**
 * The time with no project, as the web's filing dialog shows it: the same
 * piece of recurring work in one group (same task, same title, same
 * length), so a weekly meeting is one answer and not forty.
 */

export type UnfiledGroup = {
	key: string;
	title: string;
	taskName: string;
	entries: UnfiledEntry[];
	seconds: number;
};

export const groupUnfiled = (entries: readonly UnfiledEntry[]) => {
	const groups = new Map<string, UnfiledGroup>();
	for (const entry of entries) {
		const title = entry.description || entry.task.name;
		const key = `${entry.task.id}|${title.trim().toLowerCase()}|${entry.durationSeconds}`;
		const group = groups.get(key);
		if (group) {
			group.entries.push(entry);
			group.seconds += entry.durationSeconds;
		} else {
			groups.set(key, {
				key,
				title,
				taskName: entry.task.name,
				entries: [entry],
				seconds: entry.durationSeconds,
			});
		}
	}
	// The biggest backlog first: the meeting with thirty rows is the one to
	// answer, and it must not be under the single entries.
	return [...groups.values()].sort(
		(a, b) => b.entries.length - a.entries.length || b.seconds - a.seconds,
	);
};

/** How much of a group is selected. */
export const selectionOf = (
	selected: ReadonlySet<string>,
	ids: readonly string[],
): "all" | "some" | "none" => {
	const count = ids.filter((id) => selected.has(id)).length;
	if (count === 0) return "none";
	return count === ids.length ? "all" : "some";
};

/** Selects a group, or clears it when all of it is selected. */
export const toggleIds = (
	selected: ReadonlySet<string>,
	ids: readonly string[],
) => {
	const next = new Set(selected);
	const clear = selectionOf(selected, ids) === "all";
	for (const id of ids) {
		if (clear) next.delete(id);
		else next.add(id);
	}
	return next;
};

/** The body that puts a removed entry back, for Undo. It has no project:
 *  it had none when it was removed. */
export const restoreBody = (entry: UnfiledEntry): NewTimeEntry => ({
	date: entry.date,
	taskId: entry.task.id,
	description: entry.description || undefined,
	durationSeconds: entry.durationSeconds,
	meetingUrl: entry.meetingUrl ?? undefined,
});

/** "3 entries this week need a project." */
export const unfiledHeadline = (count: number, scope: string) =>
	count === 1
		? `1 entry ${scope} needs a project.`
		: `${count} entries ${scope} need a project.`;
