/**
 * `GET /api/v1/meta` — the one unauthenticated answer, and the first request
 * `farmer login` makes. It confirms three things before the person is sent to a
 * browser: the URL is a Farmer server, this deployment runs the CLI, and the
 * binary asking is new enough to read the answers.
 */

/**
 * The oldest CLI that can read this server's responses.
 *
 * Raise it when a response shape changes in a way an installed binary cannot
 * read — a removed or renamed field, a changed type, a renamed error code. An
 * added field is not such a change: the projections in this folder are what
 * keep a new database column from being one.
 */
export const MIN_CLI_VERSION = "0.1.0";

export type ApiMeta = {
	app: "farmer";
	cliEnabled: boolean;
	minCliVersion: string;
};

const parts = (version: string): [number, number, number] | null => {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
};

/**
 * Whether `version` is at least `minimum`, compared as `major.minor.patch`.
 *
 * A pre-release or build suffix is ignored, so `0.2.0-dev` counts as `0.2.0`.
 * A version that does not parse is refused: a binary that cannot say what it is
 * cannot be told whether it is new enough.
 */
export const isCliVersionSupported = (
	version: string,
	minimum: string = MIN_CLI_VERSION,
): boolean => {
	const have = parts(version);
	const need = parts(minimum);
	if (!have || !need) return false;
	for (let i = 0; i < 3; i++) {
		const a = have[i] ?? 0;
		const b = need[i] ?? 0;
		if (a !== b) return a > b;
	}
	return true;
};
