import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";

import { readConfig } from "../config";
import { CliError, UsageError } from "../errors";
import { normalizeOrigin, updateCommand, userAgent } from "../http";
import { createOutput, print, printJson } from "../output";
import type { Runtime, SpawnResult } from "../runtime";
import { currentOrigin, transportFor } from "../session";
import { CLI_VERSION } from "../version";
import { type Command, parseCommandArgs } from "./command";

/**
 * `farmer update` runs the server's own install script over this binary,
 * rather than downloading a release itself. The script already knows which
 * asset fits this machine (musl, Rosetta), verifies SHA256SUMS and knows how
 * to replace a running exe on Windows; a second copy of that logic here would
 * drift from the one `curl | sh` runs.
 */

const UPDATE_USAGE = "farmer update [url]";

const SCRIPT_TIMEOUT_MS = 30_000;

/** The directory the install script writes into. The script always names the
 *  binary `farmer` (`farmer.exe`), so for a renamed binary it would write a
 *  second one beside it that the person never runs. */
export const installDirFor = (
	executable: string,
	platform: NodeJS.Platform,
	origin: string,
): string => {
	const path = platform === "win32" ? win32 : posix;
	const expected = platform === "win32" ? "farmer.exe" : "farmer";
	const name = path.basename(executable);

	const matches =
		platform === "win32" ? name.toLowerCase() === expected : name === expected;

	if (!matches) {
		throw new CliError(
			`farmer update installs ${expected}, and this binary is named ${name}. Rename it to ${expected}, or install again with:\n  ${updateCommand(origin, platform)}`,
		);
	}

	return path.dirname(executable);
};

export const installScriptName = (platform: NodeJS.Platform) =>
	platform === "win32" ? "install.ps1" : "install.sh";

export const installerCommand = (
	platform: NodeJS.Platform,
	scriptPath: string,
): string[] =>
	platform === "win32"
		? [
				"powershell.exe",
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				scriptPath,
			]
		: ["sh", scriptPath];

export const installerEnv = (
	env: NodeJS.ProcessEnv,
	installDir: string,
): NodeJS.ProcessEnv => ({
	...env,
	FARMER_INSTALL_DIR: installDir,
	// FARMER_UPDATE alone is enough for the script this version of the server
	// serves. FARMER_NO_LOGIN keeps an older server's script from starting a
	// login in the middle of an update.
	FARMER_NO_LOGIN: "1",
	FARMER_UPDATE: "1",
});

/** `farmer 0.2.0` → `0.2.0`. */
export const parseVersionOutput = (output: string): string | null =>
	/^farmer (\S+)$/.exec(output.trim())?.[1] ?? null;

const fetchInstallScript = async (
	runtime: Runtime,
	origin: string,
): Promise<string> => {
	const url = `${origin}/cli/${installScriptName(runtime.platform)}`;
	let response: Response;

	try {
		response = await runtime.fetch(url, {
			headers: { "User-Agent": userAgent(transportFor(runtime, origin)) },
			signal: AbortSignal.timeout(SCRIPT_TIMEOUT_MS),
		});
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new CliError(`Could not reach ${origin}: ${reason}`);
	}

	const body = await response.text();

	if (!response.ok) {
		const detail = body.trim();
		throw new CliError(
			`${origin} answered ${response.status} for ${url}.${detail ? `\n${detail}` : ""}`,
		);
	}

	return body;
};

const runInstaller = async (
	runtime: Runtime,
	scriptPath: string,
	installDir: string,
): Promise<SpawnResult> => {
	const command = installerCommand(runtime.platform, scriptPath);

	try {
		return await runtime.spawn(command, {
			env: installerEnv(runtime.env, installDir),
			capture: false,
		});
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new CliError(`Could not run ${command[0]}: ${reason}`);
	}
};

export const update: Command = {
	name: "update",
	usage: UPDATE_USAGE,
	summary: "Replace this farmer with the newest release from the server.",
	help: [
		"The server address comes from the argument, then FARMER_URL, then the",
		"last server you used.",
		"",
		"farmer runs the server's install script, which checks the download",
		"against SHA256SUMS before it replaces this binary.",
	],
	run: async (args, runtime) => {
		const { values, positionals } = parseCommandArgs(args, {}, 1, UPDATE_USAGE);
		const out = createOutput(values.json === true, runtime.env);
		const config = await readConfig(runtime.paths);

		const origin = positionals[0]
			? normalizeOrigin(positionals[0])
			: currentOrigin(runtime, config);

		if (!origin) {
			throw new UsageError(`Pass the server address.\nUsage: ${UPDATE_USAGE}`);
		}

		const { executable } = runtime;

		if (!executable) {
			throw new CliError(
				"This farmer runs from source, so there is no binary to replace. Update the checkout instead.",
			);
		}

		const installDir = installDirFor(executable, runtime.platform, origin);

		const script = await fetchInstallScript(runtime, origin);
		const dir = await mkdtemp(join(tmpdir(), "farmer-update-"));
		let result: SpawnResult;

		try {
			const scriptPath = join(dir, installScriptName(runtime.platform));
			await Bun.write(scriptPath, script);
			result = await runInstaller(runtime, scriptPath, installDir);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}

		if (result.exitCode !== 0) {
			throw new CliError(
				`The update did not finish, so farmer ${CLI_VERSION} is still installed.`,
			);
		}

		// Asked of the new binary, because this process is still the old one.
		const after = await runtime
			.spawn([executable, "--version"], { env: runtime.env, capture: true })
			.catch(() => null);

		const version =
			after?.exitCode === 0 ? parseVersionOutput(after.stdout) : null;

		if (out.json) {
			printJson({
				server: origin,
				path: executable,
				previousVersion: CLI_VERSION,
				version,
			});

			return;
		}

		if (version === CLI_VERSION) {
			print(`farmer ${CLI_VERSION} is the newest release on ${origin}.`);
		} else if (version) {
			print(`Updated farmer from ${CLI_VERSION} to ${version}.`);
		} else {
			print(`Updated farmer from ${CLI_VERSION}.`);
		}
	},
};
