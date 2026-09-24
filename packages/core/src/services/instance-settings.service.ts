import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { z } from "zod";

import { db } from "../db";
import { account } from "../db/schema/auth";
import { instanceOAuthProvider, instanceSetting } from "../db/schema/instance";
import { referencedUploadKeys } from "../jobs/upload-sweep";
import { sendMail } from "../lib/email";
import {
	INSTANCE_SETTINGS,
	isSecretKind,
	isSettingName,
	replaceSettingsSnapshot,
	resolveSetting,
	type SettingDefinition,
	type SettingSource,
	settingDefinition,
} from "../lib/instance-settings";
import {
	isSealedWithCurrentKey,
	openSecret,
	sealSecret,
} from "../lib/secret-box";
import { objectStore } from "../lib/storage";
import { UserFacingError } from "../lib/user-facing-error";
import {
	type CreateOAuthProviderInput,
	createOAuthProviderInput,
	type UpdateOAuthProviderInput,
	updateOAuthProviderInput,
} from "../schema/instance-settings";

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
 * characters) and nothing else. The loader reseals a stored secret that is
 * not under the current key, so a BETTER_AUTH_SECRETS rotation reaches these
 * rows on the next refresh. A disabled OIDC source is resealed too: it is off
 * today, and it must still open when somebody switches it on after the old
 * key is retired.
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
	trustsEmail: boolean;
};

/** When the last load finished, whether it worked or not. A failed load waits
 *  out the TTL too: during a database outage every request would otherwise
 *  pay for one more failing query and log one more line. */
let attemptedAt = 0;
let inFlight: Promise<void> | null = null;
let fingerprint = "";
let providers: readonly OAuthProviderConfig[] = [];
/** The settings whose stored secret does not decrypt. The page says so,
 *  rather than show them as not set. */
let unreadable: ReadonlySet<string> = new Set();
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

/** Stored values already logged as unreadable. The loader reads them again
 *  every few seconds, and one line each says the same as one line a load. */
const reportedUnreadable = new Set<string>();

const openOrSkip = (name: string, stored: string): string | undefined => {
	try {
		return openSecret(stored);
	} catch (error) {
		if (!reportedUnreadable.has(stored)) {
			reportedUnreadable.add(stored);
			console.error(
				`[instance-settings] ${name} does not decrypt; treating it as not set`,
				error,
			);
		}
		return undefined;
	}
};

/**
 * Rewrite a stored secret under the current key when it is plaintext or was
 * sealed before a rotation (`lib/secret-box.ts`). `write` must update the row
 * only where it still holds the old value, so a concurrent save wins.
 *
 * Not awaited: the loader runs on the request path, and a rotation must not
 * add a write to it. A failed reseal is logged and ignored; the next load
 * tries again.
 */
const healLater = (
	what: string,
	stored: string,
	plaintext: string,
	write: (sealed: string) => Promise<void>,
) => {
	Promise.resolve()
		.then(() =>
			isSealedWithCurrentKey(stored) ? undefined : write(sealSecret(plaintext)),
		)
		.catch((error: unknown) => {
			console.error(`[instance-settings] resealing ${what} failed`, error);
		});
};

const load = async () => {
	const [rows, providerRows] = await Promise.all([
		db.select().from(instanceSetting),
		db
			.select()
			.from(instanceOAuthProvider)
			.orderBy(asc(instanceOAuthProvider.createdAt)),
	]);
	const values = new Map<string, string>();
	const nextUnreadable = new Set<string>();
	for (const row of rows) {
		const definition = settingDefinition(row.name);
		// A row for a setting this build no longer knows is left alone, not
		// deleted: an older build may still be running against this database.
		if (!definition) continue;
		if (!isSecretKind(definition)) {
			values.set(row.name, row.value);
			continue;
		}
		const value = openOrSkip(row.name, row.value);
		if (value === undefined) {
			nextUnreadable.add(row.name);
			continue;
		}
		values.set(row.name, value);
		healLater(row.name, row.value, value, async (sealed) => {
			await db
				.update(instanceSetting)
				.set({ value: sealed })
				.where(
					and(
						eq(instanceSetting.name, row.name),
						eq(instanceSetting.value, row.value),
					),
				);
		});
	}
	const nextProviders: OAuthProviderConfig[] = [];
	for (const row of providerRows) {
		const clientSecret = openOrSkip(
			`OAuth provider ${row.providerId}`,
			row.clientSecret,
		);
		if (clientSecret === undefined) continue;
		healLater(
			`OAuth provider ${row.providerId}`,
			row.clientSecret,
			clientSecret,
			async (sealed) => {
				await db
					.update(instanceOAuthProvider)
					.set({ clientSecret: sealed })
					.where(
						and(
							eq(instanceOAuthProvider.id, row.id),
							eq(instanceOAuthProvider.clientSecret, row.clientSecret),
						),
					);
			},
		);
		if (!row.enabled) continue;
		nextProviders.push({
			providerId: row.providerId,
			name: row.name,
			baseUrl: row.baseUrl,
			clientId: row.clientId,
			clientSecret,
			scopes: parseScopes(row.scopes),
			trustsEmail: row.trustsEmail,
		});
	}
	const next = JSON.stringify([
		[...values].sort(([a], [b]) => a.localeCompare(b)),
		nextProviders,
	]);
	replaceSettingsSnapshot(values);
	providers = nextProviders;
	unreadable = nextUnreadable;
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
 *
 * `force` is what a writer passes after its commit, and it must not share a
 * load that started before the commit: that load's SELECT may not see the
 * write, and its fresh timestamp would then hold the old values for a TTL.
 * So a forced refresh waits for such a load and runs its own. A load that
 * started after the wait is after the commit, and is shared.
 */
export const refreshInstanceSettings = async (
	options: { force?: boolean } = {},
): Promise<void> => {
	if (!options.force && Date.now() - attemptedAt < REFRESH_TTL_MS) return;
	if (inFlight) {
		if (!options.force) return inFlight;
		await inFlight;
		if (inFlight) return inFlight;
	}
	inFlight = load()
		.catch((error: unknown) => {
			console.error("[instance-settings] refresh failed", error);
		})
		.finally(() => {
			attemptedAt = Date.now();
			inFlight = null;
		});
	return inFlight;
};

const isPort = (value: string) =>
	/^\d{1,5}$/.test(value) && Number(value) >= 1 && Number(value) <= 65_535;

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
	/** For a field locked through its lock group: the variable that locks it. */
	lockedBy: string | null;
	/** The value, for every kind except a secret. */
	value: string | null;
	/** For a secret: whether one is set, and its first characters. */
	secretHint: string | null;
	/** A stored secret that does not decrypt (a retired key). It is not in
	 *  use, and entering it again fixes it. */
	unreadable: boolean;
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
			lockedBy: resolved.lockedBy,
			value: secret ? null : (resolved.value ?? null),
			secretHint:
				secret && resolved.value !== undefined && resolved.source !== "default"
					? maskSecret(resolved.value)
					: null,
			unreadable:
				secret &&
				resolved.source === "default" &&
				unreadable.has(definition.name),
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
	const entries = Object.entries(changes);
	for (const [name, value] of entries) {
		if (!isSettingName(name)) {
			throw new UserFacingError(`There is no setting called ${name}.`);
		}
		const { locked, lockedBy } = resolveSetting(name);
		if (locked) {
			throw new UserFacingError(
				lockedBy
					? `${name} is locked because ${lockedBy} is set by the environment. Set it there too.`
					: `${name} is set by the environment. Change it there.`,
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
		if (
			value !== null &&
			value.trim() !== "" &&
			definition?.kind === "port" &&
			!isPort(value.trim())
		) {
			throw new UserFacingError(`${name} must be a port from 1 to 65535.`);
		}
	}
	// After the checks above, so a write that is refused anyway does not first
	// ask the person to confirm a storage move.
	await guardStorageMove(changes, options.confirmStorageMove === true);
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

const parseScopes = (scopes: string) => scopes.split(/\s+/).filter(Boolean);

/** The schema's first complaint, as the refusal. */
const parseOrRefuse = <T extends z.ZodType>(
	schema: T,
	input: z.input<T>,
): z.output<T> => {
	const parsed = schema.safeParse(input);
	if (parsed.success) return parsed.data;
	throw new UserFacingError(
		parsed.error.issues[0]?.message ?? "The provider is not valid.",
	);
};

/** The base URL as the auth instance uses it, so "/" at the end is no change. */
const issuerOf = (baseUrl: string) => baseUrl.trim().replace(/\/+$/, "");

export type OAuthProviderView = {
	id: string;
	providerId: string;
	name: string;
	baseUrl: string;
	clientId: string;
	/** The secret's first characters, or null when it does not decrypt. */
	secretHint: string | null;
	scopes: string;
	enabled: boolean;
	trustsEmail: boolean;
};

export const listOAuthProviders = async (): Promise<OAuthProviderView[]> => {
	const rows = await db
		.select()
		.from(instanceOAuthProvider)
		.orderBy(asc(instanceOAuthProvider.createdAt));
	return rows.map((row) => {
		let secretHint: string | null = null;
		try {
			secretHint = maskSecret(openSecret(row.clientSecret));
		} catch {
			// The loader logs it. The view says it, rather than a mask that reads
			// like a working secret.
		}
		return {
			id: row.id,
			providerId: row.providerId,
			name: row.name,
			baseUrl: row.baseUrl,
			clientId: row.clientId,
			secretHint,
			scopes: row.scopes,
			enabled: row.enabled,
			trustsEmail: row.trustsEmail,
		};
	});
};

export const createOAuthProvider = async (
	input: CreateOAuthProviderInput,
): Promise<void> => {
	const data = parseOrRefuse(createOAuthProviderInput, input);
	const existing = await db.query.instanceOAuthProvider.findFirst({
		where: eq(instanceOAuthProvider.providerId, data.providerId),
	});
	if (existing) {
		throw new UserFacingError(`A provider "${data.providerId}" exists.`);
	}
	await db.insert(instanceOAuthProvider).values({
		providerId: data.providerId,
		name: data.name,
		baseUrl: data.baseUrl,
		clientId: data.clientId,
		clientSecret: sealSecret(data.clientSecret),
		scopes: data.scopes,
		enabled: data.enabled,
		trustsEmail: data.trustsEmail,
	});
	await refreshInstanceSettings({ force: true });
};

/** How many accounts are linked through the source `providerId`. */
const linkedAccounts = async (providerId: string) =>
	(
		await db
			.select({ n: count() })
			.from(account)
			.where(eq(account.providerId, providerId))
	)[0]?.n ?? 0;

/**
 * `providerId` is not changed here: it is in the callback URL registered
 * with the provider, and accounts linked through it carry it.
 *
 * Nor is the issuer, while accounts are linked through the source. An account
 * is found by (the provider's subject, `providerId`), and a subject is only
 * unique inside one issuer: GitLab's is a number, so person 42 at a new issuer
 * would sign in as whoever was 42 at the old one. Deleting the source removes
 * those links, and adding it again starts clean.
 */
export const updateOAuthProvider = async (
	input: UpdateOAuthProviderInput,
): Promise<void> => {
	const data = parseOrRefuse(updateOAuthProviderInput, input);
	const row = await db.query.instanceOAuthProvider.findFirst({
		where: eq(instanceOAuthProvider.id, data.id),
	});
	if (!row) throw new UserFacingError("That provider no longer exists.");
	if (issuerOf(data.baseUrl) !== issuerOf(row.baseUrl)) {
		const linked = await linkedAccounts(row.providerId);
		if (linked > 0) {
			throw new UserFacingError(
				`${linked} ${linked === 1 ? "account is" : "accounts are"} linked through this provider, and a new base URL can be another identity provider. Delete the provider and add it again to change it.`,
			);
		}
	}
	const changes: Partial<typeof instanceOAuthProvider.$inferInsert> = {
		name: data.name,
		baseUrl: data.baseUrl,
		clientId: data.clientId,
		scopes: data.scopes,
		enabled: data.enabled,
		trustsEmail: data.trustsEmail,
		updatedAt: new Date(),
	};
	if (data.clientSecret) changes.clientSecret = sealSecret(data.clientSecret);
	await db
		.update(instanceOAuthProvider)
		.set(changes)
		.where(eq(instanceOAuthProvider.id, data.id));
	await refreshInstanceSettings({ force: true });
};

/** Removes the accounts linked through the source too, so a source added
 *  again under the same ID, perhaps at another issuer, inherits no links. A
 *  person then links again by a verified address, as at a first sign-in. */
export const deleteOAuthProvider = async (id: string): Promise<void> => {
	await db.transaction(async (tx) => {
		const [row] = await tx
			.delete(instanceOAuthProvider)
			.where(eq(instanceOAuthProvider.id, id))
			.returning({ providerId: instanceOAuthProvider.providerId });
		if (row) {
			await tx.delete(account).where(eq(account.providerId, row.providerId));
		}
	});
	await refreshInstanceSettings({ force: true });
};

/** What a "test" button shows. `ok: false` carries the reason in `message`. */
export type ConnectionTestResult = { ok: boolean; message: string };

/**
 * An error's message with every stored secret blanked out. A test result goes
 * to a browser, and a driver may echo what it was given (a URL with a key in
 * it, a refused password) into its error.
 */
const withoutSecrets = (message: string): string => {
	let clean = message;
	for (const definition of INSTANCE_SETTINGS) {
		if (!isSecretKind(definition) && definition.name !== "S3_ACCESS_KEY_ID") {
			continue;
		}
		const value = resolveSetting(definition.name).value;
		if (value && value.length >= 4) clean = clean.replaceAll(value, "••••••••");
	}
	return clean;
};

/** Where the storage test writes. Outside `orgs/`, the only prefix the upload
 *  sweep lists, so a probe whose delete failed is never taken for an upload
 *  (and never served: `/api/files` only answers upload-shaped keys). */
const STORAGE_PROBE_PREFIX = "instance/connection-test/";

/** A put, get and delete round trip on a probe key in the configured store.
 *  Never throws for a store that refuses: the refusal is the answer. */
export const testStorage = async (): Promise<ConnectionTestResult> => {
	const store = objectStore();
	if (!store) {
		return {
			ok: false,
			message:
				"No store is configured. Set the endpoint, the bucket and both keys.",
		};
	}
	const key = `${STORAGE_PROBE_PREFIX}${crypto.randomUUID()}.txt`;
	const body = `Farmer storage test, ${new Date().toISOString()}`;
	let step = "write";
	let written = false;
	try {
		await store.put(key, new TextEncoder().encode(body), "text/plain");
		written = true;
		step = "read";
		const read = await store.get(key);
		if (!read) {
			return {
				ok: false,
				message: "The store took the test file and then did not find it.",
			};
		}
		if ((await new Response(read.body).text()) !== body) {
			return {
				ok: false,
				message: "The store gave back different bytes from the ones written.",
			};
		}
		step = "delete";
		await store.delete(key);
		written = false;
		return { ok: true, message: "Wrote, read and deleted a test file." };
	} catch (error) {
		return {
			ok: false,
			message: `The ${step} failed: ${withoutSecrets(error instanceof Error ? error.message : String(error))}`,
		};
	} finally {
		// A failed read leaves the probe behind. One more try, and its failure
		// is not the answer: the probe sits outside what the sweep reads.
		if (written) await store.delete(key).catch(() => undefined);
	}
};

/** One message to `to` through the configured mail provider. */
export const testEmail = async (to: string): Promise<ConnectionTestResult> => {
	try {
		await sendMail({
			to,
			subject: "Farmer test email",
			text: "This is a test message from the Infrastructure page. Email works.",
			html: "<p>This is a test message from the Infrastructure page. Email works.</p>",
		});
		return { ok: true, message: `Sent a test message to ${to}.` };
	} catch (error) {
		return {
			ok: false,
			message: withoutSecrets(
				error instanceof Error ? error.message : String(error),
			),
		};
	}
};

/** How many stored uploads the configured store holds references to. The page
 *  warns before a change to the endpoint or the bucket when this is not 0.
 *
 *  Counted from the rows, not by listing the bucket: a reference is what
 *  breaks when the store moves, and an unreferenced object is the sweep's to
 *  delete anyway. Instance-wide, so every organization counts. */
export const storageUsage = async (): Promise<{ storedObjects: number }> => ({
	storedObjects: (await referencedUploadKeys()).size,
});

/** A storage move that needs the person to confirm it first. Its own class so
 *  the page can tell it from any other refusal and ask. */
export class StorageMoveNeedsConfirmationError extends UserFacingError {
	readonly storedObjects: number;
	constructor(storedObjects: number) {
		super(
			`${storedObjects} stored ${storedObjects === 1 ? "file points" : "files point"} into the current store. ` +
				"A new endpoint or bucket breaks them until they are copied there. " +
				"Confirm the change to save it.",
		);
		this.name = "StorageMoveNeedsConfirmationError";
		this.storedObjects = storedObjects;
	}
}

const STORE_LOCATION = ["S3_ENDPOINT", "S3_BUCKET"] as const;

/**
 * Refuse a change to `S3_ENDPOINT` or `S3_BUCKET` while stored objects exist,
 * unless the caller confirmed it. Every stored key points into the current
 * store, so a move breaks every icon and logo until the objects are copied.
 *
 * Clearing either one counts as a move: it switches uploads off, and every
 * stored icon then answers 404.
 */
export const guardStorageMove = async (
	changes: Record<string, string | null>,
	confirmed: boolean,
): Promise<void> => {
	if (confirmed) return;
	const moves = STORE_LOCATION.some((name) => {
		if (!(name in changes)) return false;
		const next = changes[name]?.trim() ?? "";
		const current = resolveSetting(name).value?.trim() ?? "";
		return next !== current;
	});
	if (!moves) return;
	const { storedObjects } = await storageUsage();
	if (storedObjects > 0) {
		throw new StorageMoveNeedsConfirmationError(storedObjects);
	}
};

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
