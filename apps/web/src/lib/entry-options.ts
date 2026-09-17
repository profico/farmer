import { z } from "zod";

// How the Log time dialog last saw you work, so an entry somebody logs the same
// way every day opens already set. Per device, in localStorage: it is how the
// form opens, not a fact about any entry.
//
// Two memories. The last project + task picked, per org and per dialog; and
// what "More options" was last saved with, per project + task. Repeat is left
// out of the second on purpose — it creates a standing rule, and a switch that
// did that without being touched would be a surprise rather than a shortcut.

const entryOptions = z.object({
	fillsDay: z.boolean(),
	overtime: z.boolean(),
});

export type EntryOptions = z.infer<typeof entryOptions>;

const lastPick = z.object({
	projectId: z.string().min(1),
	taskId: z.string().min(1),
});

export type LastPick = z.infer<typeof lastPick>;

function read<T>(key: string, schema: z.ZodType<T>): T | null {
	try {
		const raw = window.localStorage.getItem(key);

		if (raw === null) return null;
		const parsed = schema.safeParse(JSON.parse(raw));

		return parsed.success ? parsed.data : null;
	} catch {
		// Disabled storage or a value that is not JSON: nothing remembered.
		return null;
	}
}

function write(key: string, value: EntryOptions | LastPick): void {
	try {
		window.localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Private mode / full storage: the next entry just opens with defaults.
	}
}

const optionsKey = (orgSlug: string, projectId: string, taskId: string) =>
	`farmer:entry-options:${orgSlug}:${projectId}:${taskId}`;

// Each dialog that picks a project + task keeps its own last pick: the entry
// you log and the row you add to the week grid are different habits.
export type PickSurface = "entry" | "week-row";

const lastPickKey = (surface: PickSurface, orgSlug: string) =>
	`farmer:${surface}-last-pick:${orgSlug}`;

export const readEntryOptions = (
	orgSlug: string,
	projectId: string,
	taskId: string,
): EntryOptions | null =>
	read(optionsKey(orgSlug, projectId, taskId), entryOptions);

export const rememberEntryOptions = (
	orgSlug: string,
	projectId: string,
	taskId: string,
	options: EntryOptions,
): void => write(optionsKey(orgSlug, projectId, taskId), options);

export const readLastPick = (
	surface: PickSurface,
	orgSlug: string,
): LastPick | null => read(lastPickKey(surface, orgSlug), lastPick);

export const rememberLastPick = (
	surface: PickSurface,
	orgSlug: string,
	pick: LastPick,
): void => write(lastPickKey(surface, orgSlug), pick);
