/**
 * Repository defaults: the `.farmer.jsonc` a repository tracks in git, naming
 * the organization, project and task its time goes to. The design, and why it
 * holds ids rather than codes, is `docs/adr/0002-repository-defaults-file.md`.
 */

import { stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { z } from "zod";

import { CliError } from "./errors";
import type { Runtime } from "./runtime";

export const DEFAULTS_FILE = ".farmer.jsonc";

// Strict, so the file cannot quietly grow a token or a per-person setting.
const defaultsFile = z.strictObject({
	org: z.string().trim().min(1),
	project: z.guid(),
	task: z.guid().optional(),
});

export type RepositoryDefaults = z.infer<typeof defaultsFile> & {
	/** The path relative to the working directory, as messages show it. */
	shown: string;
};

const exists = (path: string) =>
	stat(path).then(
		() => true,
		() => false,
	);

/** The nearest directory holding `.git`, or null outside a repository. `.git`
 *  is a directory in a clone and a file in a worktree or a submodule. */
export const gitRoot = async (start: string): Promise<string | null> => {
	let dir = start;
	for (;;) {
		// oxlint-disable-next-line no-await-in-loop -- each step decides whether the next one runs
		if (await exists(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
};

/** The nearest `.farmer.jsonc` from `start` up to the git root. Outside a git
 *  repository none applies; files are never merged. */
export const findDefaultsFile = async (
	start: string,
): Promise<string | null> => {
	const root = await gitRoot(start);
	if (root === null) return null;
	let dir = start;
	for (;;) {
		const candidate = join(dir, DEFAULTS_FILE);
		// oxlint-disable-next-line no-await-in-loop -- the nearest file wins, so the walk stops at the first
		if (await Bun.file(candidate).exists()) return candidate;
		if (dir === root) return null;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
};

export const shownPath = (cwd: string, path: string) =>
	relative(cwd, path) || DEFAULTS_FILE;

export const parseDefaults = (text: string, shown: string) => {
	const rewrite = "Fix it, or run `farmer init` to write it again.";
	let raw: ReturnType<typeof Bun.JSONC.parse>;
	try {
		raw = Bun.JSONC.parse(text);
	} catch {
		throw new CliError(`${shown} is not valid JSON. ${rewrite}`);
	}
	const parsed = defaultsFile.safeParse(raw);
	if (!parsed.success) {
		const problems = parsed.error.issues
			.map((issue) =>
				issue.path.length > 0
					? `${issue.path.join(".")}: ${issue.message}`
					: issue.message,
			)
			.join("; ");
		throw new CliError(`${shown} is not valid (${problems}). ${rewrite}`);
	}
	const defaults: RepositoryDefaults = { ...parsed.data, shown };
	return defaults;
};

/** The defaults that apply in the working directory, or null. A file that does
 *  not parse is an error, never skipped: skipping it would run the command in
 *  the personal default organization. */
export const loadDefaults = async (
	runtime: Pick<Runtime, "cwd">,
): Promise<RepositoryDefaults | null> => {
	const path = await findDefaultsFile(runtime.cwd);
	if (path === null) return null;
	return parseDefaults(
		await Bun.file(path).text(),
		shownPath(runtime.cwd, path),
	);
};

/** The row the file names, among the rows the caller may use. Never a fallback
 *  to the picker: a stale id is a message that names the file. */
export const defaultRow = <T extends { id: string }>(
	rows: T[],
	id: string,
	defaults: RepositoryDefaults,
	noun: "project" | "task",
	flag: string,
): T => {
	const found = rows.find((row) => row.id === id);
	if (!found) {
		throw new CliError(
			`${defaults.shown}: the ${noun} ${id} is archived or not available to you. Pass ${flag}, or run \`farmer init\` to choose another.`,
		);
	}
	return found;
};

type Named = { id: string; name: string };

/** A comment holds one line; a name never should need more. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** The file `farmer init` writes. The names are comments for a reviewer: the
 *  CLI never reads them, and they go stale on a rename while the ids do not. */
export const formatDefaults = (values: {
	org: string;
	project: Named;
	task: Named | null;
}) => {
	const rows: [string, string, string | null][] = [
		["org", values.org, null],
		["project", values.project.id, values.project.name],
	];
	if (values.task) rows.push(["task", values.task.id, values.task.name]);
	const lines = rows.map(([key, value, name], index) => {
		const comma = index < rows.length - 1 ? "," : "";
		const comment = name === null ? "" : ` // ${oneLine(name)}`;
		return `\t${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}${comment}`;
	});
	return `{\n${lines.join("\n")}\n}\n`;
};

/** "Using organization acme, project Web and task Frontend from ../.farmer.jsonc". */
export const defaultsNotice = (shown: string, used: string[]) => {
	const list =
		used.length > 1
			? `${used.slice(0, -1).join(", ")} and ${used.at(-1)}`
			: (used[0] ?? "");
	return `Using ${list} from ${shown}.`;
};

const GITHUB_REMOTE =
	/^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/|[^@\s/]+@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

/** `owner/name` from a github.com remote URL, SSH or HTTPS; null for any other
 *  host. */
export const parseGithubRemote = (url: string): string | null => {
	const match = GITHUB_REMOTE.exec(url.trim());
	if (!match?.[1] || !match[2]) return null;
	return `${match[1]}/${match[2]}`;
};

/** The GitHub repository of `origin`, or null when there is none, git is not
 *  installed or the remote is on another host. Only feeds a suggestion, so no
 *  failure here is worth a message. */
export const originRepository = async (
	runtime: Pick<Runtime, "env" | "spawn">,
	root: string,
): Promise<string | null> => {
	try {
		const result = await runtime.spawn(
			["git", "-C", root, "config", "--get", "remote.origin.url"],
			{ env: runtime.env, capture: true },
		);
		return result.exitCode === 0 ? parseGithubRemote(result.stdout) : null;
	} catch {
		return null;
	}
};
