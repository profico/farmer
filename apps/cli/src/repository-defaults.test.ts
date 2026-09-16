import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	DEFAULTS_FILE,
	defaultsNotice,
	findDefaultsFile,
	formatDefaults,
	gitRoot,
	parseDefaults,
	parseGithubRemote,
	shownPath,
} from "./repository-defaults";

const PROJECT = "0b6f2c1e-1f7a-4c3e-9a2b-1d2e3f4a5b6c";
const TASK = "9c1d4e2f-3a5b-4c6d-8e7f-0a1b2c3d4e5f";

describe("parseDefaults", () => {
	test("reads comments and a trailing comma", () => {
		const text = `{\n\t// the org\n\t"org": "acme",\n\t"project": "${PROJECT}", // Web\n\t"task": "${TASK}",\n}`;
		expect(parseDefaults(text, DEFAULTS_FILE)).toEqual({
			org: "acme",
			project: PROJECT,
			task: TASK,
			shown: DEFAULTS_FILE,
		});
	});

	test("the task is optional", () => {
		const parsed = parseDefaults(
			`{ "org": "acme", "project": "${PROJECT}" }`,
			DEFAULTS_FILE,
		);
		expect(parsed.task).toBeUndefined();
	});

	test("refuses an unknown key, so the file cannot grow a token", () => {
		expect(() =>
			parseDefaults(
				`{ "org": "acme", "project": "${PROJECT}", "token": "secret" }`,
				"../.farmer.jsonc",
			),
		).toThrow("../.farmer.jsonc is not valid");
	});

	test("refuses a project code where an id belongs", () => {
		expect(() =>
			parseDefaults(`{ "org": "acme", "project": "VINApps" }`, DEFAULTS_FILE),
		).toThrow("project:");
	});

	test("names the file when it is not JSON", () => {
		expect(() => parseDefaults(`{ "org": `, "../.farmer.jsonc")).toThrow(
			"../.farmer.jsonc is not valid JSON",
		);
	});
});

describe("formatDefaults", () => {
	test("writes what parseDefaults reads, with the names as comments", () => {
		const text = formatDefaults({
			org: "acme",
			project: { id: PROJECT, name: "VINApps" },
			task: { id: TASK, name: "Frontend" },
		});
		expect(text).toContain(`"project": "${PROJECT}", // VINApps`);
		expect(text).toContain(`"task": "${TASK}" // Frontend`);
		expect(parseDefaults(text, DEFAULTS_FILE)).toEqual({
			org: "acme",
			project: PROJECT,
			task: TASK,
			shown: DEFAULTS_FILE,
		});
	});

	test("leaves the task out, and keeps a name on one line", () => {
		const text = formatDefaults({
			org: "acme",
			project: { id: PROJECT, name: "Web\nShop" },
			task: null,
		});
		expect(text).not.toContain('"task"');
		expect(text).toContain("// Web Shop");
		expect(parseDefaults(text, DEFAULTS_FILE).task).toBeUndefined();
	});
});

describe("defaultsNotice", () => {
	test("lists what came from the file", () => {
		expect(defaultsNotice("../.farmer.jsonc", ["organization acme"])).toBe(
			"Using organization acme from ../.farmer.jsonc.",
		);
		expect(
			defaultsNotice(DEFAULTS_FILE, [
				"organization acme",
				"project Web",
				"task Frontend",
			]),
		).toBe(
			"Using organization acme, project Web and task Frontend from .farmer.jsonc.",
		);
	});
});

describe("finding the file", () => {
	let base = "";

	beforeEach(async () => {
		// realpath: macOS's tmpdir is a symlink, and the walk compares paths.
		base = await realpath(await mkdtemp(join(tmpdir(), "farmer-defaults-")));
	});

	afterEach(async () => {
		await rm(base, { recursive: true, force: true });
	});

	const write = (path: string) => Bun.write(path, "{}");

	test("the nearest file up to the git root wins", async () => {
		const repo = join(base, "repo");
		const deep = join(repo, "apps", "ios", "src");
		await mkdir(join(repo, ".git"), { recursive: true });
		await mkdir(deep, { recursive: true });
		await write(join(repo, DEFAULTS_FILE));
		await write(join(repo, "apps", "ios", DEFAULTS_FILE));

		expect(await findDefaultsFile(deep)).toBe(
			join(repo, "apps", "ios", DEFAULTS_FILE),
		);
		expect(await findDefaultsFile(join(repo, "apps"))).toBe(
			join(repo, DEFAULTS_FILE),
		);
		expect(shownPath(deep, join(repo, "apps", "ios", DEFAULTS_FILE))).toBe(
			join("..", DEFAULTS_FILE),
		);
	});

	test("a file above the git root does not apply", async () => {
		const repo = join(base, "repo");
		await mkdir(join(repo, ".git"), { recursive: true });
		await write(join(base, DEFAULTS_FILE));

		expect(await findDefaultsFile(repo)).toBeNull();
	});

	test("no file applies outside a git repository", async () => {
		const dir = join(base, "plain");
		await mkdir(dir, { recursive: true });
		await write(join(dir, DEFAULTS_FILE));

		expect(await gitRoot(dir)).toBeNull();
		expect(await findDefaultsFile(dir)).toBeNull();
	});

	test("a worktree's .git is a file, and still marks the root", async () => {
		const worktree = join(base, "worktree");
		await mkdir(join(worktree, "src"), { recursive: true });
		await Bun.write(join(worktree, ".git"), "gitdir: /elsewhere\n");
		await write(join(worktree, DEFAULTS_FILE));

		expect(await gitRoot(join(worktree, "src"))).toBe(worktree);
		expect(await findDefaultsFile(join(worktree, "src"))).toBe(
			join(worktree, DEFAULTS_FILE),
		);
	});
});

describe("parseGithubRemote", () => {
	test("reads the SSH and HTTPS forms", () => {
		for (const url of [
			"git@github.com:profico/farmer.git",
			"git@github.com:profico/farmer",
			"ssh://git@github.com/profico/farmer.git",
			"https://github.com/profico/farmer.git",
			"https://github.com/profico/farmer/",
			"https://user@github.com/profico/farmer\n",
		]) {
			expect(parseGithubRemote(url)).toBe("profico/farmer");
		}
		expect(parseGithubRemote("git@github.com:acme/web.app.git")).toBe(
			"acme/web.app",
		);
	});

	test("is null for another host", () => {
		expect(parseGithubRemote("git@gitlab.com:profico/farmer.git")).toBeNull();
		expect(
			parseGithubRemote("https://github.com.evil.test/profico/farmer"),
		).toBeNull();
		expect(parseGithubRemote("")).toBeNull();
	});
});
