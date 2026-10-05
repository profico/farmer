/**
 * The instance's configuration: one value per name, from three sources.
 *
 * **The environment wins, then the database, then the default.** The rule and
 * the reason are in `docs/adr/0004-environment-overrides-the-database.md`;
 * read it before adding a second way to set anything listed here. In short: a
 * value set in the environment locks the matching field on the Infrastructure
 * pages, so an operator who pins a value in a deploy manifest is never
 * overridden by somebody with a browser.
 *
 * **Read synchronously, loaded asynchronously.** `setting()` is synchronous and
 * reads an in-memory snapshot, so the readers that used to read `process.env`
 * per call (`objectStore()`, the three feature flags, the mail transport) stay
 * synchronous and cost nothing on a hot path such as `/api/files`. The
 * snapshot is filled by `refreshInstanceSettings` in
 * `services/instance-settings.service.ts`, which every entry point awaits
 * before it reads: the web app's global request middleware
 * (`apps/web/src/start.ts`), each scheduler tick (`jobs/scheduler.ts`) and
 * the worker's start. The refresh is cached for a few seconds and shared by
 * concurrent callers, so a request pays for at most one small query.
 *
 * This module has no database import on purpose. The flags and the storage
 * module import it, and they must stay importable from code that never opens a
 * connection (a unit test, the build).
 *
 * The name of a setting IS its environment variable. One name per value, in
 * the environment, in the `instance_setting` table and on the page, so nobody
 * has to translate between them.
 */

export type SettingSection =
	| "sign-in"
	| "email"
	| "storage"
	| "integrations"
	| "features";

export type SettingKind =
	| "text"
	| "secret"
	| "multiline"
	| "boolean"
	| "select"
	| "port";

/** A kind whose value is sealed at rest and never sent back to a browser. */
export const isSecretKind = (setting: { kind: SettingKind }): boolean =>
	setting.kind === "secret" || setting.kind === "multiline";

export type SettingDefinition = {
	/** The environment variable, and the row's key. */
	name: string;
	section: SettingSection;
	/** A sub-heading inside the section. */
	group: string;
	label: string;
	kind: SettingKind;
	/** Used when neither the environment nor the database holds a value. */
	defaultValue?: string;
	/** For `select`: the allowed values. The empty string means "not set". */
	options?: readonly string[];
	/** One line under the field. */
	hint?: string;
	/**
	 * Settings that only make sense together. When the environment sets any
	 * one of them, every one is locked, not only that name.
	 *
	 * The reason is a secret that leaves the process. With `SMTP_PASS` pinned
	 * in the environment and `SMTP_HOST` open on the page, a platform admin
	 * could point the host at their own server and receive the password in the
	 * next AUTH command. The S3 group gets the same rule: SigV4 never sends the
	 * secret, but a half-pinned store is one nobody can reason about.
	 */
	lockGroup?: "smtp" | "s3";
};

const BOOL = { kind: "boolean" } as const;

/**
 * Every value the Infrastructure pages can set. The operational values (pool
 * size, job intervals, timeouts, `PORT`) are deliberately not here: a web
 * container and a worker container need different ones out of one database,
 * so they stay in the environment only.
 */
export const INSTANCE_SETTINGS = [
	// Sign-in
	{
		name: "REGISTRATION_OPEN",
		section: "sign-in",
		group: "Registration",
		label: "Anyone can create an account",
		...BOOL,
		defaultValue: "false",
		hint: "Off: after the first account, only a person with a pending invitation can sign up.",
	},
	{
		name: "SINGLE_ORG_SLUG",
		section: "sign-in",
		group: "Registration",
		label: "Single-organization slug",
		kind: "text",
		hint: "Set it to make this instance one workspace. Treat it as fixed once anyone has signed up.",
	},
	{
		name: "GOOGLE_CLIENT_ID",
		section: "sign-in",
		group: "Google",
		label: "Client ID",
		kind: "text",
		hint: "Redirect URIs: {origin}/api/auth/callback/google and {origin}/api/auth/oauth2/callback/google-calendar",
	},
	{
		name: "GOOGLE_CLIENT_SECRET",
		section: "sign-in",
		group: "Google",
		label: "Client secret",
		kind: "secret",
	},
	// Email
	{
		name: "EMAIL_PROVIDER",
		section: "email",
		group: "Sender",
		label: "Provider",
		kind: "select",
		options: ["", "resend", "smtp"],
		hint: "Empty: Resend when it has a key, else SMTP when it has a host.",
	},
	{
		name: "EMAIL_FROM",
		section: "email",
		group: "Sender",
		label: "From",
		kind: "text",
		hint: 'For example "Farmer <farmer@example.com>". With Resend, the domain must be verified.',
	},
	{
		name: "RESEND_API_KEY",
		section: "email",
		group: "Resend",
		label: "API key",
		kind: "secret",
	},
	{
		name: "SMTP_HOST",
		section: "email",
		group: "SMTP",
		lockGroup: "smtp",
		label: "Host",
		kind: "text",
	},
	{
		name: "SMTP_PORT",
		section: "email",
		group: "SMTP",
		lockGroup: "smtp",
		label: "Port",
		kind: "port",
		defaultValue: "465",
		hint: "465 uses TLS from the start. Other ports require STARTTLS, except on localhost.",
	},
	// In the lock group: with SMTP_PASS pinned in the environment, switching
	// this off from the page would let anybody on the path read the password.
	{
		name: "SMTP_REQUIRE_TLS",
		section: "email",
		group: "SMTP",
		lockGroup: "smtp",
		label: "Require STARTTLS",
		...BOOL,
		defaultValue: "true",
		hint: "Off: send without TLS when the server offers no STARTTLS. Only for a relay on a network you trust, such as another container.",
	},
	{
		name: "SMTP_USER",
		section: "email",
		group: "SMTP",
		lockGroup: "smtp",
		label: "User",
		kind: "text",
	},
	{
		name: "SMTP_PASS",
		section: "email",
		group: "SMTP",
		lockGroup: "smtp",
		label: "Password",
		kind: "secret",
	},
	{
		name: "SMTP_FROM",
		section: "email",
		group: "SMTP",
		label: "From (SMTP only)",
		kind: "text",
		hint: "Used when From above is empty.",
	},
	// Storage
	{
		name: "S3_ENDPOINT",
		section: "storage",
		group: "S3-compatible store",
		lockGroup: "s3",
		label: "Endpoint",
		kind: "text",
		hint: "For example http://localhost:3900 for the Garage in docker-compose.yml.",
	},
	{
		name: "S3_REGION",
		section: "storage",
		group: "S3-compatible store",
		lockGroup: "s3",
		label: "Region",
		kind: "text",
		defaultValue: "us-east-1",
		hint: "Must match the store's own region. Garage: `s3_region` in garage.toml, often `garage`.",
	},
	{
		name: "S3_BUCKET",
		section: "storage",
		group: "S3-compatible store",
		lockGroup: "s3",
		label: "Bucket",
		kind: "text",
	},
	{
		name: "S3_ACCESS_KEY_ID",
		section: "storage",
		group: "S3-compatible store",
		lockGroup: "s3",
		label: "Access key ID",
		kind: "text",
	},
	{
		name: "S3_SECRET_ACCESS_KEY",
		section: "storage",
		group: "S3-compatible store",
		lockGroup: "s3",
		label: "Secret access key",
		kind: "secret",
	},
	// Integrations
	{
		name: "GITHUB_CLIENT_ID",
		section: "integrations",
		group: "GitHub OAuth app",
		label: "Client ID",
		kind: "text",
		hint: "Callback URL: {origin}/api/auth/callback/github",
	},
	{
		name: "GITHUB_CLIENT_SECRET",
		section: "integrations",
		group: "GitHub OAuth app",
		label: "Client secret",
		kind: "secret",
	},
	{
		name: "GITHUB_APP_ID",
		section: "integrations",
		group: "GitHub App",
		label: "App ID",
		kind: "text",
		hint: "Setup URL: {origin}/api/github/setup",
	},
	{
		name: "GITHUB_APP_SLUG",
		section: "integrations",
		group: "GitHub App",
		label: "App slug",
		kind: "text",
	},
	{
		name: "GITHUB_APP_PRIVATE_KEY",
		section: "integrations",
		group: "GitHub App",
		label: "Private key",
		kind: "multiline",
		hint: "The PEM file, or its base64 encoding.",
	},
	{
		name: "GITHUB_WEBHOOK_SECRET",
		section: "integrations",
		group: "GitHub App",
		label: "Webhook secret",
		kind: "secret",
		hint: "Webhook URL: {origin}/api/github/webhook",
	},
	{
		name: "SLACK_CLIENT_ID",
		section: "integrations",
		group: "Slack app",
		label: "Client ID",
		kind: "text",
		hint: "Redirect URL: {origin}/api/slack/callback",
	},
	{
		name: "SLACK_CLIENT_SECRET",
		section: "integrations",
		group: "Slack app",
		label: "Client secret",
		kind: "secret",
	},
	// Features
	{
		name: "HOMEPAGE_ENABLED",
		section: "features",
		group: "Features",
		label: "Public homepage",
		...BOOL,
		defaultValue: "false",
		hint: "On: / shows the Farmer product page. Off: / opens the workspace, or sign-in first.",
	},
	{
		name: "ASSISTANT_ENABLED",
		section: "features",
		group: "Features",
		label: "Assistant",
		...BOOL,
		defaultValue: "true",
	},
	{
		name: "MCP_ENABLED",
		section: "features",
		group: "Features",
		label: "MCP server",
		...BOOL,
		defaultValue: "true",
	},
	{
		name: "CLI_ENABLED",
		section: "features",
		group: "Features",
		label: "Command-line tool",
		...BOOL,
		defaultValue: "true",
		hint: "Also the REST API and personal API tokens. Off, they answer 404 and Preferences hides API tokens.",
	},
	{
		name: "CLI_RELEASES_REPO",
		section: "features",
		group: "Features",
		label: "CLI releases repository",
		kind: "text",
		hint: "owner/name on GitHub. The install script downloads the CLI from its releases.",
	},
	{
		name: "VAPID_PUBLIC_KEY",
		section: "features",
		group: "Web push",
		label: "Public key",
		kind: "text",
		hint: "Make a key pair with: bunx web-push generate-vapid-keys",
	},
	{
		name: "VAPID_PRIVATE_KEY",
		section: "features",
		group: "Web push",
		label: "Private key",
		kind: "secret",
	},
	{
		name: "VAPID_SUBJECT",
		section: "features",
		group: "Web push",
		label: "Subject",
		kind: "text",
		hint: "A mailto: or https: URL that identifies you to the push service.",
	},
	// Native push to the mobile app goes through Profico's relay (ADR 0006).
	// Off by default: an operator who does not want a third party in the path
	// leaves it off, and the app then works without remote push.
	{
		name: "PUSH_RELAY_ENABLED",
		section: "features",
		group: "Mobile push",
		label: "Send native push through the relay",
		...BOOL,
		defaultValue: "false",
		hint: "On: the server sends encrypted pushes to the mobile app through the relay. The relay cannot read them.",
	},
	{
		name: "PUSH_RELAY_URL",
		section: "features",
		group: "Mobile push",
		label: "Relay URL",
		kind: "text",
		defaultValue: "https://push.farmer.profi.co",
		hint: "Change it only for a relay that you run yourself.",
	},
	{
		name: "POSTHOG_PROJECT_TOKEN",
		section: "features",
		group: "PostHog",
		label: "Project token",
		kind: "text",
		hint: "Public: it ships in the page. Never put a personal API key here.",
	},
	{
		name: "POSTHOG_HOST",
		section: "features",
		group: "PostHog",
		label: "Host",
		kind: "text",
	},
	{
		name: "POSTHOG_AI_CAPTURE_CONTENT",
		section: "features",
		group: "PostHog",
		label: "Send assistant and MCP content",
		...BOOL,
		defaultValue: "false",
		hint: "On copies prompts, answers and tool results (people's timesheets) to PostHog.",
	},
] as const satisfies readonly SettingDefinition[];

export type SettingName = (typeof INSTANCE_SETTINGS)[number]["name"];

const DEFINITIONS = new Map<string, SettingDefinition>(
	INSTANCE_SETTINGS.map((definition) => [definition.name, definition]),
);

export const settingDefinition = (name: string): SettingDefinition | null =>
	DEFINITIONS.get(name) ?? null;

export const isSettingName = (name: string): name is SettingName =>
	DEFINITIONS.has(name);

export type SettingSource = "env" | "db" | "default";

export type ResolvedSetting = {
	value: string | undefined;
	source: SettingSource;
	/** Set by the environment, itself or through its lock group, so the page
	 *  shows the field disabled. */
	locked: boolean;
	/** For a value locked through its lock group: the variable that locks it. */
	lockedBy: string | null;
};

/** The database half, as the last refresh read it. Secrets are opened. */
let snapshot: ReadonlyMap<string, string> = new Map();

/** A test's values, which replace the database half while set. */
let snapshotForTests: ReadonlyMap<string, string> | undefined;

/** An empty or blank variable is "not set". `.env.example` lists names with
 *  nothing after the `=`, and a copied file must not lock every field. */
const fromEnv = (name: string): string | undefined => {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
};

/** The first other member of `name`'s lock group that the environment sets. */
const groupLockedBy = (definition: SettingDefinition): string | null => {
	if (!definition.lockGroup) return null;
	for (const other of DEFINITIONS.values()) {
		if (
			other.lockGroup === definition.lockGroup &&
			fromEnv(other.name) !== undefined
		) {
			return other.name;
		}
	}
	return null;
};

export const resolveSetting = (name: SettingName): ResolvedSetting => {
	const env = fromEnv(name);
	if (env !== undefined) {
		return { value: env, source: "env", locked: true, lockedBy: null };
	}
	const definition = DEFINITIONS.get(name);
	// A locked sibling still reads the database: the lock stops a change, and
	// a value stored before the environment was set keeps working.
	const lockedBy = definition ? groupLockedBy(definition) : null;
	const locked = lockedBy !== null;
	const stored = (snapshotForTests ?? snapshot).get(name);
	if (stored !== undefined) {
		return { value: stored, source: "db", locked, lockedBy };
	}
	return {
		value: definition?.defaultValue,
		source: "default",
		locked,
		lockedBy,
	};
};

/** The value of one setting, or undefined when nothing sets it. */
export const setting = (name: SettingName): string | undefined =>
	resolveSetting(name).value;

/** A boolean setting. Only the string "true" is on, as with the old flags. */
export const settingEnabled = (name: SettingName): boolean =>
	setting(name) === "true";

/** Replace the database half. Only the loader calls this. */
export const replaceSettingsSnapshot = (
	values: ReadonlyMap<string, string>,
): void => {
	snapshot = values;
};

/** Pin the database half for a test file. `undefined` restores the loaded
 *  snapshot. The environment still wins, as it does in production. */
export const setInstanceSettingsForTests = (
	values: Record<string, string> | undefined,
): void => {
	snapshotForTests = values ? new Map(Object.entries(values)) : undefined;
};
