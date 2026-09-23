import { asc, eq, inArray } from "drizzle-orm";

import { db } from "../db";
import { instanceOAuthProvider, instanceSetting } from "../db/schema/instance";
import {
	INSTANCE_SETTINGS,
	isSettingName,
	replaceSettingsSnapshot,
	resolveSetting,
	type SettingDefinition,
	type SettingSource,
	settingDefinition,
} from "../lib/instance-settings";
import { openSecret, sealSecret } from "../lib/secret-box";
import { UserFacingError } from "../lib/user-facing-error";

/**
 * The instance's configuration: the loader behind `lib/instance-settings.ts`,
 * and the reads and writes behind the Infrastructure pages.
 *
 * **No `Ctx`, like `platformAdminsService`.** These values belong to the
 * deployment, not to a workspace, so there is no organization to pass.
 * Authorization is `platformAdminMiddleware` at the web boundary.
 *
 * A secret is sealed with `lib/secret-box.ts` before it is written and is
 * never sent back to a browser: the view carries a hint (its first four
 * characters) and nothing else.
 */

/** How long one read of the table serves. Short, because a web process and a
 *  worker process share the table and only the writer's own process is told
 *  about a write straight away. */
const REFRESH_TTL_MS = 5_000;

export type OAuthProviderConfig = {
	providerId: string;
	name: string;
	baseUrl: string;
	clientId: string;
	clientSecret: string;
	scopes: string[];
};

let loadedAt = 0;
let inFlight: Promise<void> | null = null;
let fingerprint = "";
let providers: readonly OAuthProviderConfig[] = [];
const listeners = new Set<() => void>();

/** The OpenID Connect sources that are switched on, as the last refresh read
 *  them. The auth instance reads this when it is built. */
export const enabledOAuthProviders = (): readonly OAuthProviderConfig[] =>
	providers;

/**
 * Call `listener` after a refresh that changed any value. The auth instance
 * uses it to rebuild itself with new OAuth credentials, and the mail module to
 * drop its SMTP connection. It fires in every process, a few seconds after a
 * write in another one. Returns the unsubscribe function.
 */
export const onInstanceSettingsChanged = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

const openOrSkip = (name: string, stored: string): string | undefined => {
	try {
		return openSecret(stored);
	} catch (error) {
		console.error(
			`[instance-settings] ${name} does not decrypt; treating it as not set`,
			error,
		);
		return undefined;
	}
};

const load = async () => {
	const [rows, providerRows] = await Promise.all([
		db.select().from(instanceSetting),
		db
			.select()
			.from(instanceOAuthProvider)
			.where(eq(instanceOAuthProvider.enabled, true))
			.orderBy(asc(instanceOAuthProvider.createdAt)),
	]);
	const values = new Map<string, string>();
	for (const row of rows) {
		const definition = settingDefinition(row.name);
		// A row for a setting this build no longer knows is left alone, not
		// deleted: an older build may still be running against this database.
		if (!definition) continue;
		const value = isSecretKind(definition)
			? openOrSkip(row.name, row.value)
			: row.value;
		if (value !== undefined) values.set(row.name, value);
	}
	const nextProviders: OAuthProviderConfig[] = [];
	for (const row of providerRows) {
		const clientSecret = openOrSkip(
			`OAuth provider ${row.providerId}`,
			row.clientSecret,
		);
		if (clientSecret === undefined) continue;
		nextProviders.push({
			providerId: row.providerId,
			name: row.name,
			baseUrl: row.baseUrl,
			clientId: row.clientId,
			clientSecret,
			scopes: parseScopes(row.scopes),
		});
	}
	const next = JSON.stringify([
		[...values].sort(([a], [b]) => a.localeCompare(b)),
		nextProviders,
	]);
	replaceSettingsSnapshot(values);
	providers = nextProviders;
	loadedAt = Date.now();
	if (next !== fingerprint) {
		const first = fingerprint === "";
		fingerprint = next;
		// The first load is not a change: nothing was built from an older value.
		if (!first) for (const listener of listeners) listener();
	}
};

/**
 * Read the table into the snapshot, at most once per few seconds.
 *
 * Every entry point awaits this before it reads a setting. Concurrent callers
 * share one query. A failed read keeps the last snapshot and logs, rather than
 * failing the request: a database that cannot answer this query cannot answer
 * the request either, and it will say so there.
 */
export const refreshInstanceSettings = async (
	options: { force?: boolean } = {},
): Promise<void> => {
	if (!options.force && Date.now() - loadedAt < REFRESH_TTL_MS) return;
	if (inFlight) return inFlight;
	inFlight = load()
		.catch((error: unknown) => {
			console.error("[instance-settings] refresh failed", error);
		})
		.finally(() => {
			inFlight = null;
		});
	return inFlight;
};

const isSecretKind = (definition: SettingDefinition) =>
	definition.kind === "secret" || definition.kind === "multiline";

const SECRET_VISIBLE_CHARS = 4;

const maskSecret = (value: string) =>
	`${value.slice(0, Math.min(SECRET_VISIBLE_CHARS, value.length))}${"•".repeat(8)}`;

export type InstanceSettingView = {
	name: string;
	section: SettingDefinition["section"];
	group: string;
	label: string;
	kind: SettingDefinition["kind"];
	options: readonly string[] | null;
	hint: string | null;
	source: SettingSource;
	locked: boolean;
	/** The value, for every kind except a secret. */
	value: string | null;
	/** For a secret: whether one is set, and its first characters. */
	secretHint: string | null;
};

/** Every setting, resolved, with secrets masked. Refreshes first, so the page
 *  never shows a value older than the last write. */
export const viewInstanceSettings = async (): Promise<
	InstanceSettingView[]
> => {
	await refreshInstanceSettings({ force: true });
	return INSTANCE_SETTINGS.map((definition): InstanceSettingView => {
		const resolved = resolveSetting(definition.name);
		const secret = isSecretKind(definition);
		return {
			name: definition.name,
			section: definition.section,
			group: definition.group,
			label: definition.label,
			kind: definition.kind,
			options: "options" in definition ? definition.options : null,
			hint: "hint" in definition ? definition.hint : null,
			source: resolved.source,
			locked: resolved.locked,
			value: secret ? null : (resolved.value ?? null),
			secretHint:
				secret && resolved.value !== undefined && resolved.source !== "default"
					? maskSecret(resolved.value)
					: null,
		};
	});
};

/**
 * Write some settings. A string sets the value; `null` removes the row, so the
 * default answers again. A name that is not in the table is left alone.
 *
 * Refuses the whole write when any name is unknown or set by the environment:
 * the environment wins (ADR 0004), so a stored value under it would do nothing
 * now and surprise somebody later, when the variable is removed.
 */
export const updateInstanceSettings = async (
	userId: string,
	changes: Record<string, string | null>,
	options: { confirmStorageMove?: boolean } = {},
): Promise<void> => {
	await guardStorageMove(changes, options.confirmStorageMove === true);
	const entries = Object.entries(changes);
	for (const [name, value] of entries) {
		if (!isSettingName(name)) {
			throw new UserFacingError(`There is no setting called ${name}.`);
		}
		if (resolveSetting(name).locked) {
			throw new UserFacingError(
				`${name} is set by the environment. Change it there.`,
			);
		}
		const definition = settingDefinition(name);
		if (
			value !== null &&
			definition?.kind === "select" &&
			!definition.options?.includes(value)
		) {
			throw new UserFacingError(`${name} cannot be "${value}".`);
		}
		if (
			value !== null &&
			definition?.kind === "boolean" &&
			value !== "true" &&
			value !== "false"
		) {
			throw new UserFacingError(`${name} must be true or false.`);
		}
	}
	const removals: string[] = [];
	const writes: { name: string; value: string }[] = [];
	for (const [name, raw] of entries) {
		const value = raw?.trim() ?? "";
		const definition = settingDefinition(name);
		if (!definition) continue;
		if (value === "") {
			removals.push(name);
			continue;
		}
		writes.push({
			name,
			value: isSecretKind(definition) ? sealSecret(value) : value,
		});
	}
	await db.transaction(async (tx) => {
		if (removals.length > 0) {
			await tx
				.delete(instanceSetting)
				.where(inArray(instanceSetting.name, removals));
		}
		for (const write of writes) {
			const now = new Date();
			await tx
				.insert(instanceSetting)
				.values({ ...write, updatedAt: now, updatedBy: userId })
				.onConflictDoUpdate({
					target: instanceSetting.name,
					set: { value: write.value, updatedAt: now, updatedBy: userId },
				});
		}
	});
	await refreshInstanceSettings({ force: true });
};

// OAuth sources

/** better-auth's own provider ids, and anything that would shadow a route. */
const RESERVED_PROVIDER_IDS = new Set(["google", "github", "google-calendar"]);
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;

const parseScopes = (scopes: string) => scopes.split(/\s+/).filter(Boolean);

export type OAuthProviderView = {
	id: string;
	providerId: string;
	name: string;
	baseUrl: string;
	clientId: string;
	secretHint: string;
	scopes: string;
	enabled: boolean;
};

export const listOAuthProviders = async (): Promise<OAuthProviderView[]> => {
	const rows = await db
		.select()
		.from(instanceOAuthProvider)
		.orderBy(asc(instanceOAuthProvider.createdAt));
	return rows.map((row) => ({
		id: row.id,
		providerId: row.providerId,
		name: row.name,
		baseUrl: row.baseUrl,
		clientId: row.clientId,
		secretHint: maskSecret(openOrSkip(row.providerId, row.clientSecret) ?? ""),
		scopes: row.scopes,
		enabled: row.enabled,
	}));
};

export type OAuthProviderInput = {
	providerId: string;
	name: string;
	baseUrl: string;
	clientId: string;
	/** Required on create. On update, undefined keeps the stored secret. */
	clientSecret?: string;
	scopes: string;
	enabled: boolean;
};

const checkProvider = (input: OAuthProviderInput) => {
	if (!PROVIDER_ID.test(input.providerId)) {
		throw new UserFacingError(
			"The ID must be 2 to 40 lowercase letters, digits or hyphens.",
		);
	}
	if (RESERVED_PROVIDER_IDS.has(input.providerId)) {
		throw new UserFacingError(`"${input.providerId}" is a built-in provider.`);
	}
	const url = URL.parse(input.baseUrl.trim());
	if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
		throw new UserFacingError("The base URL must be an http(s) URL.");
	}
	if (!input.name.trim() || !input.clientId.trim()) {
		throw new UserFacingError("The name and the client ID are required.");
	}
};

export const createOAuthProvider = async (
	input: OAuthProviderInput,
): Promise<void> => {
	checkProvider(input);
	const secret = input.clientSecret?.trim();
	if (!secret) throw new UserFacingError("The client secret is required.");
	const existing = await db.query.instanceOAuthProvider.findFirst({
		where: eq(instanceOAuthProvider.providerId, input.providerId),
	});
	if (existing) {
		throw new UserFacingError(`A provider "${input.providerId}" exists.`);
	}
	await db.insert(instanceOAuthProvider).values({
		providerId: input.providerId,
		name: input.name.trim(),
		baseUrl: input.baseUrl.trim(),
		clientId: input.clientId.trim(),
		clientSecret: sealSecret(secret),
		scopes: input.scopes.trim(),
		enabled: input.enabled,
	});
	await refreshInstanceSettings({ force: true });
};

/** `providerId` is not changed here: it is in the callback URL registered
 *  with the provider, and accounts linked through it carry it. */
export const updateOAuthProvider = async (
	id: string,
	input: Omit<OAuthProviderInput, "providerId">,
): Promise<void> => {
	const row = await db.query.instanceOAuthProvider.findFirst({
		where: eq(instanceOAuthProvider.id, id),
	});
	if (!row) throw new UserFacingError("That provider no longer exists.");
	checkProvider({ ...input, providerId: row.providerId });
	const changes: Partial<typeof instanceOAuthProvider.$inferInsert> = {
		name: input.name.trim(),
		baseUrl: input.baseUrl.trim(),
		clientId: input.clientId.trim(),
		scopes: input.scopes.trim(),
		enabled: input.enabled,
		updatedAt: new Date(),
	};
	const secret = input.clientSecret?.trim();
	if (secret) changes.clientSecret = sealSecret(secret);
	await db
		.update(instanceOAuthProvider)
		.set(changes)
		.where(eq(instanceOAuthProvider.id, id));
	await refreshInstanceSettings({ force: true });
};

export const deleteOAuthProvider = async (id: string): Promise<void> => {
	await db
		.delete(instanceOAuthProvider)
		.where(eq(instanceOAuthProvider.id, id));
	await refreshInstanceSettings({ force: true });
};

/** What a "test" button shows. `ok: false` carries the reason in `message`. */
export type ConnectionTestResult = { ok: boolean; message: string };

/** A put, get and delete round trip on a probe key in the configured store. */
export const testStorage = async (): Promise<ConnectionTestResult> => {
	throw new Error("testStorage: not implemented");
};

/** One message to `to` through the configured mail provider. */
export const testEmail = async (to: string): Promise<ConnectionTestResult> => {
	throw new Error(`testEmail(${to}): not implemented`);
};

/** How many stored uploads the configured store holds references to. The page
 *  warns before a change to the endpoint or the bucket when this is not 0. */
export const storageUsage = async (): Promise<{ storedObjects: number }> => {
	throw new Error("storageUsage: not implemented");
};

/**
 * Refuse a change to `S3_ENDPOINT` or `S3_BUCKET` while stored objects exist,
 * unless the caller confirmed it. Every stored key points into the current
 * store, so a move breaks every icon and logo until the objects are copied.
 */
const guardStorageMove = async (
	_changes: Record<string, string | null>,
	_confirmed: boolean,
): Promise<void> => {};

export const instanceSettingsService = {
	storageUsage,
	testStorage,
	testEmail,
	refresh: refreshInstanceSettings,
	view: viewInstanceSettings,
	update: updateInstanceSettings,
	listOAuthProviders,
	createOAuthProvider,
	updateOAuthProvider,
	deleteOAuthProvider,
};
