/**
 * The error body every `/api/v1` route answers with, and the headers the CLI
 * and the server agree on.
 *
 * `code` is what a client branches on; `error` is a sentence for a person and
 * may change wording at any time. A binary already installed on somebody's
 * laptop reads `code`, so a new code is an addition and a renamed one is a
 * breaking change (see `MIN_CLI_VERSION`).
 */

export type ApiErrorCode =
	/** No credential, a bad or expired one, an unknown slug, or an ex-member —
	 *  one answer on purpose, as for MCP. The CLI deletes its token. */
	| "unauthorized"
	/** A service refused: not assigned to the project, not an absence task. */
	| "forbidden"
	| "not_found"
	/** The Zod parse failed, or a service rejected the values (a full day). */
	| "invalid_input"
	| "rate_limited"
	/** The CLI is older than `minCliVersion`. The person must update. */
	| "cli_outdated"
	| "server_error";

export type ApiIssue = { path: string; message: string };

export type ApiError = {
	error: string;
	code: ApiErrorCode;
	issues?: ApiIssue[];
};

/** The OAuth client id of the CLI in the device flow. */
export const CLI_CLIENT_ID = "farmer-cli";

/** The OAuth client id of the mobile app in the device flow. It is the
 *  fallback for a sign-in provider that fails in the system auth sheet. */
export const MOBILE_CLIENT_ID = "farmer-mobile";

/** Every client id that the device flow accepts. Nothing else may start a
 *  code. */
export const DEVICE_CLIENT_IDS: readonly string[] = [
	CLI_CLIENT_ID,
	MOBILE_CLIENT_ID,
];

/** Sent by the CLI on every request, so the server can refuse a binary that
 *  can no longer read its answers before it misreads one. */
export const CLI_VERSION_HEADER = "x-farmer-cli-version";

/** The prefix of the CLI's `User-Agent`. A session created by the device flow
 *  records it, which is how Preferences → Signed-in devices names the row. */
export const CLI_USER_AGENT_PREFIX = "farmer-cli/";
