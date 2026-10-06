// Pure helpers of the "Signed-in devices" and "API tokens" screens. They
// import nothing from React Native, so `bun test` can run them. A date goes
// through a `format` the caller gives, so the text does not depend on the
// locale of the machine that runs the test.

import type {
	NewPersonalToken,
	PersonalToken,
	Session,
} from "@farmer/api-client";

import type { IconName } from "../ui/icons";

type Format = (iso: string) => string;

/** The icon of a sign-in, from what the server says holds it. A kind that
 *  the app does not know (a newer server) draws as a browser. */
export const sessionIcon = (kind: string): IconName =>
	kind === "mobile" ? "phone" : kind === "cli" ? "terminal" : "browser";

/** Two lines under the name of a device: when it signed in, and when the
 *  server last renewed the session. The server renews at most once a day,
 *  so "Last active" is the day and not the minute. */
export const sessionSubtitle = (session: Session, format: Format): string =>
	[
		`Signed in ${format(session.createdAt)}${session.ipAddress ? ` from ${session.ipAddress}` : ""}`,
		`Last active ${format(session.updatedAt)}`,
	].join("\n");

/** What happens to the device when its session ends, for the confirm. */
export const sessionRevokeMessage = (session: Session): string => {
	if (session.kind === "cli") {
		return "The terminal is signed out at its next command, and it asks you to run farmer login again.";
	}
	if (session.kind === "mobile") {
		return "The app is signed out the next time it asks the server for data, and it asks you to sign in again.";
	}
	return "That browser is signed out the next time it loads a page.";
};

export const TOKEN_SCOPES: {
	value: NewPersonalToken["scope"];
	label: string;
	subtitle: string;
}[] = [
	{
		value: "read",
		label: "Read only",
		subtitle: "The token cannot add, change or delete anything.",
	},
	{
		value: "write",
		label: "Read and write",
		subtitle: "The token can do what you can do.",
	},
];

export const TOKEN_WORKSPACES: {
	value: NewPersonalToken["workspace"];
	label: string;
}[] = [
	{ value: "this", label: "Only this workspace" },
	{ value: "all", label: "All my workspaces" },
];

export const TOKEN_LIFETIMES: {
	value: NewPersonalToken["expiresInDays"];
	label: string;
}[] = [
	{ value: 30, label: "30 days" },
	{ value: 90, label: "90 days" },
	{ value: 365, label: "1 year" },
	{ value: null, label: "Never" },
];

/** The same defaults as the web form. */
export const newTokenDraft = (): NewPersonalToken => ({
	name: "",
	scope: "read",
	workspace: "this",
	expiresInDays: 90,
});

export const TOKEN_NAME_MAX = 80;

/** The server's rule for a name, so the form says it before the request. */
export const tokenNameProblem = (name: string): string | null => {
	const trimmed = name.trim();
	if (trimmed === "") return "Give the token a name.";
	if (trimmed.length > TOKEN_NAME_MAX) {
		return `Use ${TOKEN_NAME_MAX} characters or fewer.`;
	}
	return null;
};

export const scopeLabel = (scope: string): string =>
	scope === "write" ? "Read and write" : "Read only";

/** Three lines under the name of a token: what it is and where it works,
 *  when it was last used, and when it ends. */
export const tokenSubtitle = (token: PersonalToken, format: Format): string =>
	[
		`…${token.hint} · ${scopeLabel(token.scope)} · ${token.workspace ? token.workspace.name : "All workspaces"}`,
		token.lastUsedAt ? `Last used ${format(token.lastUsedAt)}` : "Never used",
		token.expiresAt
			? `${token.expired ? "Expired" : "Expires"} ${format(token.expiresAt)}`
			: "Never expires",
	].join("\n");
