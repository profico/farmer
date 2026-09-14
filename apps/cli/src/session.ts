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
import type { Output } from "./output";
import { pickOne } from "./prompts";
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

export type Session = {
	runtime: Runtime;
	out: Output;
	config: Config;
	server: ServerEntry;
	api: ApiClient;
};

export const connect = async (
	runtime: Runtime,
	out: Output,
): Promise<Session> => {
	const config = await readConfig(runtime.paths);
	const origin = currentOrigin(runtime, config);
	if (!origin) {
		throw new CliError("You are not logged in. Run `farmer login`.");
	}
	const store = credentialStoreFor(runtime);
	const token = await store.get(origin);
	if (!token) {
		throw new CliError(
			`You are not logged in to ${origin}. Run \`farmer login\`.`,
		);
	}
	const api = new ApiClient({
		transport: transportFor(runtime, origin),
		token,
		forgetToken: () => store.delete(origin),
	});
	return { runtime, out, config, server: serverEntryFor(config, origin), api };
};

export const saveConfig = (session: Session) =>
	writeConfig(session.runtime.paths, session.config);

export const orgPath = (slug: string, suffix: string) =>
	`/api/v1/orgs/${encodeURIComponent(slug)}${suffix}`;

/** Replaces the cached organization list with `/me`'s, keeping the cached
 *  timezones of the organizations that are still there. */
export const refreshOrganizations = async (
	session: Session,
): Promise<ApiMe> => {
	const me = await session.api.get<ApiMe>("/api/v1/me");
	const { server } = session;
	server.orgs = me.organizations.map((org) => ({
		slug: org.slug,
		name: org.name,
		timeZone:
			server.orgs.find((cached) => cached.slug === org.slug)?.timeZone ?? null,
	}));
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
			throw new UsageError(
				`You are not a member of "${wanted}" on ${session.api.origin}. Your organizations: ${slugList(me) || "none"}.`,
			);
		}
	}

	if (!entry.timeZone) {
		const whoami = await session.api.get<ApiWhoami>(
			orgPath(entry.slug, "/whoami"),
		);
		entry.timeZone = whoami.timezone;
		changed = true;
	}
	if (changed) await saveConfig(session);

	const resolved = entry.slug;
	return {
		slug: resolved,
		name: entry.name,
		clock: { timeZone: entry.timeZone, now: session.runtime.now() },
		path: (suffix) => orgPath(resolved, suffix),
	};
};

export const openOrg = async (
	runtime: Runtime,
	out: Output,
	requested: string | undefined,
) => {
	const session = await connect(runtime, out);
	const scope = await scopeOrg(session, requested);
	return { session, scope };
};
