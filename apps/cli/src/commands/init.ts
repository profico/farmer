import { join } from "node:path";

import type { ApiProject, ApiTaskList } from "@farmer/core/api";

import { CancelledError, CliError } from "../errors";
import { createOutput, note, print, printJson } from "../output";
import { chooseProject, chooseTaskOrNone } from "../pick";
import { askConfirm, requireInteractive } from "../prompts";
import {
	DEFAULTS_FILE,
	formatDefaults,
	gitRoot,
	originRepository,
	shownPath,
} from "../repository-defaults";
import { connect, type OrgScope, scopeOrg, type Session } from "../session";
import { type Command, parseCommandArgs } from "./command";

const INIT_USAGE =
	"farmer init [-p project] [-t task | -t none] [--here] [--yes]";

/** The projects linked to the repository's GitHub remote. Only a suggestion,
 *  so any failure is no suggestion — including the 404 of a server older than
 *  the route. */
const suggestedProjects = async (
	session: Session,
	scope: OrgScope,
	repository: string | null,
): Promise<Set<string>> => {
	if (repository === null) return new Set();
	try {
		const rows = await session.api.get<ApiProject[]>(
			scope.path(`/repository-projects?${new URLSearchParams({ repository })}`),
		);
		return new Set(rows.map((row) => row.id));
	} catch (error) {
		if (error instanceof CliError) return new Set();
		throw error;
	}
};

export const init: Command = {
	name: "init",
	usage: INIT_USAGE,
	summary: "Write .farmer.jsonc, the defaults for this repository.",
	help: [
		"  -p, --project  A project name, code or client. The list puts the",
		"                 projects linked to this repository's GitHub remote first.",
		"  -t, --task     A task name, or `none` for no default task.",
		"  --here         Write in this directory, not at the git root. For one",
		"                 package of a monorepo.",
		"  --yes          Replace the file without asking.",
		"",
		"The file holds the organization, the project id and the task id, with the",
		"names as comments. Inside the repository, `farmer log` uses them when -p",
		"or -t is missing, and every command uses the organization unless --org is",
		"given. Commit the file.",
	],
	run: async (args, runtime) => {
		const { values } = parseCommandArgs(
			args,
			{
				project: { type: "string", short: "p" },
				task: { type: "string", short: "t" },
				here: { type: "boolean" },
				yes: { type: "boolean" },
			},
			0,
			INIT_USAGE,
		);
		const out = createOutput(values.json === true, runtime.env);

		const root = await gitRoot(runtime.cwd);
		if (root === null) {
			throw new CliError(
				"This is not a git repository. Repository defaults apply only inside one.",
			);
		}
		const path = join(values.here ? runtime.cwd : root, DEFAULTS_FILE);
		const shown = shownPath(runtime.cwd, path);

		if ((await Bun.file(path).exists()) && values.yes !== true) {
			requireInteractive(out, `${shown} exists. Pass --yes to replace it.`);
			if (!(await askConfirm(`Replace ${shown}?`))) throw new CancelledError();
		}
		if (values.here !== true && runtime.cwd !== root) {
			// A file in the wrong directory applies only there, and nobody notices.
			note(
				`Writing ${path}, at the git root. Pass --here to write in this directory.`,
			);
		}

		// Not `openOrg`: the old file is never read, so a broken one can be
		// replaced.
		const session = await connect(runtime, out);
		const scope = await scopeOrg(session, values.org);
		const repository = await originRepository(runtime, root);
		const [projects, taskList, suggested] = await Promise.all([
			session.api.get<ApiProject[]>(scope.path("/projects")),
			session.api.get<ApiTaskList>(scope.path("/tasks")),
			suggestedProjects(session, scope, repository),
		]);
		const project = await chooseProject(
			out,
			projects,
			values.project,
			suggested,
		);
		const task = await chooseTaskOrNone(out, taskList.tasks, values.task);

		await Bun.write(path, formatDefaults({ org: scope.slug, project, task }));

		if (out.json) {
			printJson({
				path,
				org: scope.slug,
				project: { id: project.id, name: project.name },
				task: task ? { id: task.id, name: task.name } : null,
			});
			return;
		}
		const names = [scope.slug, project.name, ...(task ? [task.name] : [])];
		print(`Wrote ${shown}: ${names.join(", ")}.`);
		print("Commit it, so everyone who works here logs to the same project.");
	},
};
