import { homedir } from "node:os";

import { configPaths, type Paths } from "./config";
import { type Keyring, systemKeyring } from "./credentials";
import type { FetchLike } from "./http";

/**
 * What the commands reach the outside world through. Built once in `main`;
 * the seams exist so a command's collaborators can be exercised without
 * module mocking.
 */
export type Runtime = {
	env: NodeJS.ProcessEnv;
	platform: NodeJS.Platform;
	arch: string;
	paths: Paths;
	/** Where `.farmer.jsonc` is looked for. */
	cwd: string;
	keyring: Keyring | null;
	fetch: FetchLike;
	sleep: (ms: number) => Promise<void>;
	now: () => Date;
	/** The binary `farmer update` replaces, or null when farmer runs from
	 *  source (`bun run src/main.ts`) and there is no binary to replace. */
	executable: string | null;
	spawn: (command: string[], options: SpawnOptions) => Promise<SpawnResult>;
};

/** Without `capture`, the program's stdout goes to this process's stderr, so
 *  it cannot mix with `--json` output; with it, stdout is returned. stdin and
 *  stderr are the terminal's either way. */
export type SpawnOptions = { env: NodeJS.ProcessEnv; capture: boolean };
export type SpawnResult = { exitCode: number; stdout: string };

/** A compiled Bun binary runs its code from an embedded file system, whose root
 *  is `/$bunfs/`, or `B:\~BUN\` on Windows. From source, `Bun.main` is the
 *  path of `main.ts` on disk, and `execPath` is Bun itself. */
export const compiledExecutable = (
	main: string,
	execPath: string,
): string | null =>
	/^(\/\$bunfs\/|B:[\\/]~BUN[\\/])/.test(main) ? execPath : null;

const spawn = async (
	command: string[],
	{ env, capture }: SpawnOptions,
): Promise<SpawnResult> => {
	if (capture) {
		const child = Bun.spawn(command, {
			env,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "inherit",
		});
		const [stdout, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			child.exited,
		]);
		return { exitCode, stdout };
	}
	const child = Bun.spawn(command, {
		env,
		stdin: "inherit",
		stdout: 2,
		stderr: "inherit",
	});
	return { exitCode: await child.exited, stdout: "" };
};

export const systemRuntime = (): Runtime => ({
	env: process.env,
	platform: process.platform,
	arch: process.arch,
	paths: configPaths(process.env, process.platform, homedir()),
	cwd: process.cwd(),
	// FARMER_NO_KEYRING=1 skips the system keyring and keeps the token in
	// credentials.json — for a machine whose keyring exists but is locked or
	// prompts on a display nobody is looking at.
	keyring: process.env.FARMER_NO_KEYRING === "1" ? null : systemKeyring,
	fetch: (url, init) => fetch(url, init),
	sleep: (ms) => Bun.sleep(ms),
	now: () => new Date(),
	executable: compiledExecutable(Bun.main, process.execPath),
	spawn,
});
