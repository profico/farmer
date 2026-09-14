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
	keyring: Keyring | null;
	fetch: FetchLike;
	sleep: (ms: number) => Promise<void>;
	now: () => Date;
};

export const systemRuntime = (): Runtime => ({
	env: process.env,
	platform: process.platform,
	arch: process.arch,
	paths: configPaths(process.env, process.platform, homedir()),
	// FARMER_NO_KEYRING=1 skips the system keyring and keeps the token in
	// credentials.json — for a machine whose keyring exists but is locked or
	// prompts on a display nobody is looking at.
	keyring: process.env.FARMER_NO_KEYRING === "1" ? null : systemKeyring,
	fetch: (url, init) => fetch(url, init),
	sleep: (ms) => Bun.sleep(ms),
	now: () => new Date(),
});
