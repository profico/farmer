import type { ApiMe, ApiWhoami } from "@farmer/core/api";

import {
	type Config,
	readConfig,
	type ServerEntry,
	serverEntryFor,
	writeConfig,
} from "./config";
import { createCredentialStore } from "./credentials";
import type { OrgClock } from "./dates";
import { CliError, UsageError } from "./errors";
import { ApiClient, normalizeOrigin, type Transport } from "./http";
import { note, type Output } from "./output";
import { pickOne } from "./prompts";
import { defaultsNotice, loadDefaults } from "./repository-defaults";
import type { Runtime } from "./runtime";
import { CLI_VERSION } from "./version";

export const transportFor = (runtime: Runtime, origin: string): Transport => ({
	origin,
	fetch: runtime.fetch,
	sleep: runtime.sleep,
	version: CLI_VERSION,
	platform: runtime.platform,
	arch: runtime.arch,
});

export const credentialStoreFor = (runtime: Runtime) =>
	createCredentialStore(runtime.keyring, runtime.paths.credentials);

/** `FARMER_URL` wins over the last server, so a script can point one command
 *  at another server without changing what the person's shell uses. */
export const currentOrigin = (
	runtime: Runtime,
	config: Config,
): string | null =>
	runtime.env.FARMER_URL
		? normalizeOrigin(runtime.env.FARMER_URL)
		: config.lastServer;

/** An API token from the environment, for a script or a CI job. It wins over
 *  the stored login, the way `FARMER_URL` wins over the last server. */
export const environmentToken = (runtime: Runtime): string | null =>
	runtime.env.FARMER_TOKEN?.trim() || null;

export type Session = {
	runtime: Runtime;
	out: Output;
	config: Config;
	server: ServerEntry;
	api: ApiClient;
	/** True when the token came from `FARMER_TOKEN`. Such a session leaves the
	 *  config alone: a token bound to one workspace sees only that workspace,
	 *  and a script must not replace the person's cached organizations and
	 *  default with that view. */
	fromEnvironment: boolean;
};

export const connect = async (
	runtime: Runtime,
	out: Output,
): Promise<Session> => {
	const config = await readConfig(runtime.paths);
	const origin = currentOrigin(runtime, config);
	const fromEnvironment = environmentToken(runtime);
	if (!origin) {
		throw new CliError(
			fromEnvironment
				? "FARMER_TOKEN is set, but no server is. Set FARMER_URL as well."
				: "You are not logged in. Run `farmer login`.",
		);
	}
	const store = credentialStoreFor(runtime);
	const token = fromEnvironment ?? (await store.get(origin));
	if (!token) {
		throw new CliError(
			`You are not logged in to ${origin}. Run \`farmer login\`.`,
		);
	}
	const api = new ApiClient({
		transport: transportFor(runtime, origin),
		token,
		// Never delete the stored login because a token somebody else supplied
		// was refused.
		forgetToken: fromEnvironment
			? async () => undefined
			: () => store.delete(origin),
		tokenSource: fromEnvironment ? "environment" : "stored",
	});
	return {
		runtime,
		out,
		config,
		server: serverEntryFor(config, origin),
		api,
		fromEnvironment: fromEnvironment !== null,
	};
};

export const saveConfig = async (session: Session) => {
	if (session.fromEnvironment) return;
	await writeConfig(session.runtime.paths, session.config);
};

export const orgPath = (slug: string, suffix: string) =>
	`/api/v1/orgs/${encodeURIComponent(slug)}${suffix}`;

/** Replaces the cached organization list with `/me`'s, keeping the cached
 *  timezones and week starts of the organizations that are still there. */
export const refreshOrganizations = async (
	session: Session,
): Promise<ApiMe> => {
	const me = await session.api.get<ApiMe>("/api/v1/me");
	const { server } = session;
	server.orgs = me.organizations.map((org) => {
		const cached = server.orgs.find((entry) => entry.slug === org.slug);
		return {
			slug: org.slug,
			name: org.name,
			timeZone: cached?.timeZone ?? null,
			weekStartsOn: cached?.weekStartsOn ?? null,
		};
	});
	if (server.org && !server.orgs.some((org) => org.slug === server.org)) {
		server.org = null;
	}
	return me;
};

const slugList = (me: ApiMe) =>
	me.organizations.map((org) => org.slug).join(", ");

const chooseOrganization = async (
	session: Session,
	me: ApiMe,
): Promise<string> => {
	const [only, ...others] = me.organizations;
	if (!only) {
		throw new CliError(
			`Your account is not a member of any organization on ${session.api.origin}. Ask an admin to invite you.`,
		);
	}
	if (others.length === 0) return only.slug;
	if (!session.out.interactive) {
		throw new UsageError(
			`Pass --org <slug>, or set a default with \`farmer org use <slug>\`. Your organizations: ${slugList(me)}.`,
		);
	}
	return pickOne(
		"Which organization?",
		me.organizations.map((org) => ({
			value: org.slug,
			label: org.name,
			hint: org.slug,
		})),
	);
};

export type OrgScope = {
	slug: string;
	name: string;
	clock: OrgClock;
	/** `/api/v1/orgs/<slug><suffix>`. */
	path: (suffix: string) => string;
};

/**
 * The organization a command runs in: `--org`, else the server's default,
 * else the only one, else a choice (which becomes the default).
 *
 * A slug the cache does not know is checked against `/me` before any org route
 * sees it. The org routes answer 401 for a slug the caller is not in, which is
 * also how a dead token looks, and a typo in `--org` must not read as "your
 * session ended".
 */
export const scopeOrg = async (
	session: Session,
	requested: string | undefined,
	/** The file `requested` came from, for the error when it is wrong. */
	source: string | null = null,
): Promise<OrgScope> => {
	const { server } = session;
	let changed = false;
	let slug = requested ?? server.org;
	let entry = server.orgs.find((org) => org.slug === slug);

	if (!entry) {
		const me = await refreshOrganizations(session);
		changed = true;
		if (!slug) {
			slug = await chooseOrganization(session, me);
			server.org = slug;
		}
		const wanted = slug;
		entry = server.orgs.find((org) => org.slug === wanted);
		if (!entry) {
			const problem = `You are not a member of "${wanted}" on ${session.api.origin}. Your organizations: ${slugList(me) || "none"}.`;
			// A slug from the file must say so, or the person looks for a flag
			// they never typed.
			throw new UsageError(
				source === null
					? problem
					: `${source}: ${problem} Fix the file, or pass --org.`,
			);
		}
	}

	let { timeZone, weekStartsOn } = entry;
	if (!timeZone || weekStartsOn === null) {
		const whoami = await session.api.get<ApiWhoami>(
			orgPath(entry.slug, "/whoami"),
		);
		timeZone = whoami.timezone;
		weekStartsOn = whoami.weekStartsOn;
		entry.timeZone = timeZone;
		entry.weekStartsOn = weekStartsOn;
		changed = true;
	}
	if (changed) await saveConfig(session);

	const resolved = entry.slug;
	return {
		slug: resolved,
		name: entry.name,
		clock: { timeZone, weekStartsOn, now: session.runtime.now() },
		path: (suffix) => orgPath(resolved, suffix),
	};
};

/**
 * `scopeOrg` behind the repository defaults: without `--org`, the nearest
 * `.farmer.jsonc` names the organization, ahead of `farmer org use`. `--org`
 * turns the file off for the command, so `defaults` is null then.
 *
 * The organization it took is announced unless `announce` is false, for a
 * command that names more of the file's values in one line of its own.
 */
export const openOrg = async (
	runtime: Runtime,
	out: Output,
	requested: string | undefined,
	{ announce = true }: { announce?: boolean } = {},
) => {
	// Read before any request, so a broken file costs nothing.
	const defaults = requested === undefined ? await loadDefaults(runtime) : null;
	const session = await connect(runtime, out);
	const scope = await scopeOrg(
		session,
		requested ?? defaults?.org,
		defaults?.shown ?? null,
	);
	if (defaults && announce) {
		note(defaultsNotice(defaults.shown, [`organization ${scope.slug}`]));
	}
	return { session, scope, defaults };
};
