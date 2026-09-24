/**
 * `bun run setup` — from a fresh checkout to a database the app can run on.
 *
 *   bun install
 *   docker compose up -d
 *   bun run setup
 *   bun run dev
 *
 * Every step is safe to run again, so this is also the command to run after a
 * pull that brought migrations:
 *
 *  1. `.env` from `.env.example` when there is none, with a fresh
 *     `BETTER_AUTH_SECRET`. An existing `.env` is never touched.
 *  2. The `.env` links each workspace needs: Bun does not read a parent
 *     directory's `.env` (root CLAUDE.md, "Gotchas").
 *  3. Wait for Postgres, then apply the migrations and seed the built-in tasks.
 *  4. The demo data (`db:seed`), once an organization exists. The first
 *     account makes the organization, so on a fresh database this step says
 *     what to do and a second `bun run setup` after sign-up finishes it.
 *
 * No `@farmer/core` import on purpose: Bun reads `.env` when a process starts,
 * so the database steps run as child processes started after step 1 wrote it.
 */

import { randomBytes } from "node:crypto";
import { lstat, symlink } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const core = path.join(root, "packages/core");

const step = (text: string) => console.log(`\n[setup] ${text}`);

const writeEnv = async () => {
	const env = Bun.file(path.join(root, ".env"));
	if (await env.exists()) {
		step(".env exists; left as it is.");
		return;
	}
	const example = await Bun.file(path.join(root, ".env.example")).text();
	const secret = randomBytes(32).toString("hex");
	const line = /^BETTER_AUTH_SECRET=[ \t]*$/m;
	const filled = line.test(example)
		? example.replace(line, `BETTER_AUTH_SECRET=${secret}`)
		: `${example.trimEnd()}\nBETTER_AUTH_SECRET=${secret}\n`;
	await Bun.write(env, filled);
	step("Wrote .env from .env.example, with a new BETTER_AUTH_SECRET.");
};

/** Whether anything, a dangling link included, is at `file`. */
const present = (file: string) =>
	lstat(file).then(
		() => true,
		() => false,
	);

const linkEnv = async () => {
	for (const workspace of ["apps/web", "apps/cli", "packages/core"]) {
		const link = path.join(root, workspace, ".env");
		if (await present(link)) continue;
		await symlink("../../.env", link);
		step(`Linked ${workspace}/.env to the root .env.`);
	}
};

/** Runs `bun run <script>` in packages/core and returns its exit code. */
const core$ = async (script: string, ...args: string[]) => {
	const child = Bun.spawn(["bun", "run", script, ...args], {
		cwd: core,
		stdout: "inherit",
		stderr: "inherit",
	});
	return child.exited;
};

const waitForDatabase = async () => {
	step("Waiting for Postgres (docker compose up -d starts it)...");
	for (let attempt = 1; attempt <= 30; attempt++) {
		const child = Bun.spawn(["bun", "run", "db:check"], {
			cwd: core,
			stdout: "ignore",
			stderr: "ignore",
		});
		if ((await child.exited) === 0) return;
		await Bun.sleep(1000);
	}
	throw new Error(
		"Postgres did not answer in 30 seconds. Run `docker compose up -d`, or check DATABASE_URL in .env.",
	);
};

const run = async (label: string, script: string, ...args: string[]) => {
	step(label);
	const code = await core$(script, ...args);
	if (code !== 0) throw new Error(`${script} exited with ${code}.`);
};

try {
	await writeEnv();
	await linkEnv();
	await waitForDatabase();
	await run("Applying migrations...", "db:deploy");
	await run("Seeding the built-in tasks...", "db:seed-tasks");
	await run("Seeding the demo data...", "db:seed", "--skip-without-org");
	step("Done. Start the app with `bun run dev`.");
} catch (error) {
	console.error(
		`\n[setup] ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exit(1);
}
