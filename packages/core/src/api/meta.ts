/**
 * `GET /api/v1/meta` — the one unauthenticated answer, and the first request
 * `farmer login` makes. It confirms three things before the person is sent to a
 * browser: the URL is a Farmer server, this deployment runs the CLI, and the
 * binary asking is new enough to read the answers.
 */

import type { ApiPushRelay } from "./mobile";

/**
 * The oldest CLI that can read this server's responses.
 *
 * Raise it when a response shape changes in a way an installed binary cannot
 * read — a removed or renamed field, a changed type, a renamed error code. An
 * added field is not such a change: the projections in this folder are what
 * keep a new database column from being one.
 */
export const MIN_CLI_VERSION = "0.1.0";

/**
 * The version of the `/api/v1` contract. A `/meta` answer with no
 * `apiVersion` comes from a server older than the mobile app: treat it as
 * version 1, which is the member's time loop that the CLI uses.
 *
 * Raise it when a route group is added that the mobile app must find. Version
 * 2 adds capabilities in `whoami`, the clients list and the sign-in methods in
 * `/meta`. Version 3 adds the routes of the web app's last screens: "Assemble
 * my day", the calendar picker and its notice, GitHub on an entry and on a
 * project, image uploads, the organization policy, the holiday switch, and
 * `/me/...` for a person before a workspace. Version 4 adds the signed-in
 * devices (`/me/sessions`) and the API tokens (`/orgs/$slug/api-tokens`).
 */
export const API_VERSION = 4;

/** The oldest mobile app that can read this server's responses. Raise it for
 *  the same reasons as `MIN_CLI_VERSION`. */
export const MIN_MOBILE_VERSION = "0.1.0";

/** `social` is a built-in provider such as Google. `oidc` is an OpenID
 *  Connect source that an administrator added. */
export type ApiSignInMethod = {
	id: string;
	name: string;
	kind: "social" | "oidc";
};

export type ApiMeta = {
	app: "farmer";
	cliEnabled: boolean;
	minCliVersion: string;
	apiVersion: number;
	minMobileVersion: string;
	/** The provider buttons, in the order the login page draws them. */
	signInMethods: ApiSignInMethod[];
	/** Whether this server offers an email and password form. */
	passwordSignIn: boolean;
	/** Whether this server sends native push, and through which relay. A
	 *  server from before the mobile push sends no `pushRelay`, so a client
	 *  reads it as optional and treats its absence as off. */
	pushRelay: ApiPushRelay;
	/** Whether this server stores uploaded images (a project icon, an
	 *  organization logo). Without a store, `POST …/uploads` refuses each
	 *  file. A server before API version 3 sends no field: read it as off. */
	uploadsEnabled: boolean;
	/** Whether a person may make a new workspace (`POST /me/organizations`).
	 *  False in single-org mode. A server before API version 3 sends no
	 *  field: read it as off. */
	organizationCreation: boolean;
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
