/**
 * Turning what a person typed (`-p acme`, `-t dev`, an id prefix) into the one
 * row it means, and asking when it means several.
 */

import type { ApiProject, ApiTask, ApiTimeEntry } from "@farmer/core/api";
import { foldForSearch, matchesSearch } from "@farmer/core/lib/search";

import { formatHours } from "./duration";
import { CliError, UsageError } from "./errors";
import type { Output } from "./output";
import { type Choice, pickOne, requireInteractive } from "./prompts";
import { entryWhat } from "./render";

/** What `-p none` and `-t none` type, and the value of the list row that
 *  stands for it. */
const NONE = "none";

/** The row for "none" when it is an answer. */
type NoneChoice = { label: string; hint: string };

type Pickable = {
	id: string;
	label: string;
	hint: string;
	/** Words that count as an exact answer, which settles a query that also
	 *  matches longer names: `-p web` picks "Web" over "Web Shop". */
	exact: string[];
};

const resolvePick = async (
	out: Output,
	noun: string,
	flag: string,
	items: Pickable[],
	query: string | undefined,
	none: NoneChoice | null,
): Promise<string> => {
	let initialSearch: string | undefined;
	if (query !== undefined) {
		const folded = foldForSearch(query);
		if (none && folded === NONE) return NONE;
		const byId = items.find((item) => item.id === query);
		if (byId) return byId.id;

		const matches = items.filter((item) =>
			matchesSearch(query, [item.label, item.hint]),
		);
		const exact = matches.filter((item) =>
			item.exact.some((word) => foldForSearch(word) === folded),
		);
		const only =
			matches.length === 1
				? matches[0]
				: exact.length === 1
					? exact[0]
					: undefined;
		if (only) return only.id;

		if (!out.interactive) {
			const names = matches.slice(0, 5).map((item) => item.label);
			throw new UsageError(
				matches.length === 0
					? `No ${noun} matches "${query}".`
					: `"${query}" matches ${matches.length} ${noun}s (${names.join(", ")}${matches.length > 5 ? ", …" : ""}). Be more specific.`,
			);
		}
		if (matches.length > 0) initialSearch = query;
	} else {
		requireInteractive(
			out,
			`Pass ${flag} <${noun}>${none ? ` (or ${flag} none)` : ""}.`,
		);
	}

	if (items.length === 0 && !none) {
		throw new CliError(`There is no ${noun} you can use.`);
	}
	const choices: Choice[] = items.map((item) => ({
		value: item.id,
		label: item.label,
		hint: item.hint || undefined,
	}));
	if (none) choices.unshift({ value: NONE, ...none });
	return pickOne(`Choose a ${noun}`, choices, initialSearch);
};

/** `suggested` go first, marked: the projects linked to the repository's git
 *  remote, which `farmer init` offers without choosing for the person. */
const projectPickables = (
	projects: ApiProject[],
	suggested: ReadonlySet<string> = new Set(),
): Pickable[] =>
	projects
		.map((project) => {
			const hint = project.code
				? `${project.code} · ${project.client.name}`
				: project.client.name;
			return {
				id: project.id,
				label: project.name,
				hint: suggested.has(project.id)
					? `matches the git remote · ${hint}`
					: hint,
				exact: project.code ? [project.name, project.code] : [project.name],
			};
		})
		.sort((a, b) => Number(suggested.has(b.id)) - Number(suggested.has(a.id)));

const byId = <T extends { id: string }>(rows: T[], id: string): T => {
	const found = rows.find((row) => row.id === id);
	if (!found) throw new CliError(`Nothing has the id ${id}.`);
	return found;
};

export const chooseProject = async (
	out: Output,
	projects: ApiProject[],
	query: string | undefined,
	suggested?: ReadonlySet<string>,
): Promise<ApiProject> =>
	byId(
		projects,
		await resolvePick(
			out,
			"project",
			"-p",
			projectPickables(projects, suggested),
			query,
			null,
		),
	);

/** As `chooseProject`, with "no project" as an answer — for a Break, or for
 *  worked time somebody will file later. */
export const chooseProjectOrNone = async (
	out: Output,
	projects: ApiProject[],
	query: string | undefined,
): Promise<ApiProject | null> => {
	const id = await resolvePick(
		out,
		"project",
		"-p",
		projectPickables(projects),
		query,
		{ label: "No project", hint: "a Break, or time to file later" },
	);
	return id === NONE ? null : byId(projects, id);
};

const taskPickables = (tasks: ApiTask[]): Pickable[] =>
	tasks.map((task) => ({
		id: task.id,
		label: task.name,
		hint: task.group,
		exact: [task.name],
	}));

export const chooseTask = async (
	out: Output,
	tasks: ApiTask[],
	query: string | undefined,
	flag: string,
): Promise<ApiTask> =>
	byId(
		tasks,
		await resolvePick(out, "task", flag, taskPickables(tasks), query, null),
	);

/** As `chooseTask`, with "no default task" as an answer — for `farmer init`,
 *  where the task is optional. */
export const chooseTaskOrNone = async (
	out: Output,
	tasks: ApiTask[],
	query: string | undefined,
): Promise<ApiTask | null> => {
	const id = await resolvePick(out, "task", "-t", taskPickables(tasks), query, {
		label: "No default task",
		hint: "pass -t on each farmer log",
	});
	return id === NONE ? null : byId(tasks, id);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (text: string) => UUID.test(text);

/** The row whose id is `idOrPrefix` or starts with it. Null when none does;
 *  an error when the prefix is too short to say which. */
export const findByIdPrefix = <T extends { id: string }>(
	rows: T[],
	idOrPrefix: string,
): T | null => {
	const needle = idOrPrefix.toLowerCase();
	const matches = rows.filter((row) => row.id.startsWith(needle));
	if (matches.length > 1 && !matches.some((row) => row.id === needle)) {
		throw new UsageError(
			`"${idOrPrefix}" matches ${matches.length} entries. Type more of the id.`,
		);
	}
	return matches.find((row) => row.id === needle) ?? matches[0] ?? null;
};

export type SelectedEntry = {
	id: string;
	/** Null for a full id that is not among the day's entries: the command
	 *  can still send it, but has nothing to show or prefill. */
	entry: ApiTimeEntry | null;
};

/** The entry `edit` or `rm` acts on: the id given, or a choice from the
 *  day's entries. */
export const selectEntry = async (
	out: Output,
	entries: ApiTimeEntry[],
	id: string | undefined,
	day: string,
	verb: string,
): Promise<SelectedEntry> => {
	if (id !== undefined) {
		const found = findByIdPrefix(entries, id);
		if (found) return { id: found.id, entry: found };
		if (isUuid(id)) return { id: id.toLowerCase(), entry: null };
		throw new UsageError(
			`No entry on ${day} has an id that starts with "${id}". Pass -d <date> for another day.`,
		);
	}
	if (entries.length === 0) {
		throw new CliError(`There are no entries on ${day} to ${verb}.`);
	}
	requireInteractive(
		out,
		`Pass the id of the entry to ${verb}. \`farmer ls\` shows the ids.`,
	);
	const picked = await pickOne(
		`Which entry do you want to ${verb}?`,
		entries.map((entry) => ({
			value: entry.id,
			label: `${formatHours(entry.durationSeconds)}  ${entryWhat(entry)}`,
			hint: entry.description || undefined,
		})),
	);
	return {
		id: picked,
		entry: entries.find((entry) => entry.id === picked) ?? null,
	};
};
