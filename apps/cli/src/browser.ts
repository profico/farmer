/** How long to wait for the opener to report back. Some openers stay alive
 *  while the browser starts; past this, the attempt counts as a success. */
const OPEN_TIMEOUT_MS = 5_000;

/**
 * The command that opens `url` in the default browser, or null when there is
 * nothing to open it in.
 */
export const browserCommand = (
	url: string,
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
): string[] | null => {
	if (platform === "darwin") return ["open", url];
	// `start` runs through cmd.exe, which reads the `&` in a query string as a
	// command separator and cuts the URL short. rundll32 passes the URL to the
	// default browser as one argument, with no shell in between.
	if (platform === "win32") {
		return ["rundll32", "url.dll,FileProtocolHandler", url];
	}
	// Without a display this is an SSH session or a server. xdg-open would at
	// best start a text browser inside the terminal that shows the code.
	if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return null;
	return ["xdg-open", url];
};

/** Opens `url`, and says whether it did. Never throws: the caller prints the
 *  URL when this answers false. */
export const openBrowser = async (
	url: string,
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
): Promise<boolean> => {
	const cmd = browserCommand(url, platform, env);
	if (!cmd) return false;
	try {
		const child = Bun.spawn(cmd, {
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
		});
		child.unref();
		const exitCode = await Promise.race([
			child.exited,
			Bun.sleep(OPEN_TIMEOUT_MS).then(() => 0),
		]);
		return exitCode === 0;
	} catch {
		return false;
	}
};
