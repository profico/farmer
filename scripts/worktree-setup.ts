/**
 * `bun run worktree:setup` - the `.env` links a new git worktree needs.
 *
 * A worktree is a fresh checkout, and `.env` is ignored by git, so it has none.
 * This script links, and nothing more:
 *
 *  1. The root `.env` to the `.env` of the main checkout, only in a linked
 *     worktree, only when the root has no `.env`, and only when the main
 *     checkout has one.
 *  2. The `.env` of each workspace to `../../.env`, as `scripts/setup.ts` does.
 *
 * It never writes a real `.env` and never makes a secret: `bun run setup` does
 * that. It prints one line for each link it makes, and nothing otherwise. It
 * always exits 0, because a SessionStart hook runs it and a failure must not
 * block a session.
 *
 * No `@farmer/core` import on purpose, so it runs before `bun install` too.
 */

import { lstat, symlink } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");

/** Whether anything, a dangling link included, is at `file`. */
const present = (file: string) =>
	lstat(file).then(
		() => true,
		() => false,
	);

/** The output of `git rev-parse <flag>` in the root, as an absolute path. */
const gitPath = async (flag: string) => {
	const child = Bun.spawn(["git", "rev-parse", flag], {
		cwd: root,
		stdout: "pipe",
		stderr: "ignore",
	});
	const out = (await new Response(child.stdout).text()).trim();
	if ((await child.exited) !== 0 || out === "") return null;
	return path.resolve(root, out);
};

/** The main checkout when `root` is a linked worktree, else null. */
const mainCheckout = async () => {
	const common = await gitPath("--git-common-dir");
	const own = await gitPath("--git-dir");
	if (common === null || own === null || common === own) return null;
	return path.dirname(common);
};

const linkRootEnv = async () => {
	const link = path.join(root, ".env");
	if (await present(link)) return;
	const main = await mainCheckout();
	if (main === null) return;
	const target = path.join(main, ".env");
	if (!(await Bun.file(target).exists())) return;
	await symlink(target, link);
	console.log(`[worktree] Linked .env to ${target}.`);
};

const linkWorkspaceEnv = async () => {
	for (const workspace of ["apps/web", "apps/cli", "packages/core"]) {
		const link = path.join(root, workspace, ".env");
		if (await present(link)) continue;
		await symlink("../../.env", link);
		console.log(`[worktree] Linked ${workspace}/.env to the root .env.`);
	}
};

try {
	await linkRootEnv();
	await linkWorkspaceEnv();
} catch (error) {
	const reason = error instanceof Error ? error.message : String(error);
	console.error(`[worktree] Setup failed: ${reason}`);
}
