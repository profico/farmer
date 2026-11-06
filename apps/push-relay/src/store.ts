import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Platform = "ios" | "android";
export type ApnsEnvironment = "production" | "sandbox";

/** One registered installation of the mobile app. */
export type Device = {
	relayId: string;
	platform: Platform;
	pushToken: string;
	/** Only for iOS. Null on Android. */
	apnsEnvironment: ApnsEnvironment | null;
	/** The iOS push-to-start token for the timer's Live Activity, or null. */
	liveActivityStartToken: string | null;
	secretHash: string;
	createdAt: number;
	updatedAt: number;
	/** The last registration, token update or accepted push. A device unseen
	 *  for `STALE_DEVICE_MS` is pruned. */
	lastSeenAt: number;
};

type DeviceRow = {
	relay_id: string;
	platform: Platform;
	push_token: string;
	apns_environment: ApnsEnvironment | null;
	live_activity_start_token: string | null;
	secret_hash: string;
	created_at: number;
	updated_at: number;
	last_seen_at: number;
};

/** The columns that a token update can change. A field that is absent stays
 *  as it is; a null `liveActivityStartToken` clears it. */
export type DeviceUpdate = {
	pushToken?: string;
	apnsEnvironment?: ApnsEnvironment;
	liveActivityStartToken?: string | null;
};

/** One server key. The relay keeps the hash of the secret part only. */
export type ServerKey = {
	id: string;
	secretHash: string;
	label: string;
	contact: string;
	monthlyLimit: number;
	createdAt: number;
	revokedAt: number | null;
};

type ServerKeyRow = {
	id: string;
	secret_hash: string;
	label: string;
	contact: string;
	monthly_limit: number;
	created_at: number;
	revoked_at: number | null;
};

const toServerKey = (row: ServerKeyRow): ServerKey => ({
	id: row.id,
	secretHash: row.secret_hash,
	label: row.label,
	contact: row.contact,
	monthlyLimit: row.monthly_limit,
	createdAt: row.created_at,
	revokedAt: row.revoked_at,
});

/** The usage bucket of a push that comes without a key. */
export const ANONYMOUS_KEY_ID = "anonymous";

/** The calendar month of a time, in UTC: `2026-11`. */
export const monthOf = (at: number): string =>
	new Date(at).toISOString().slice(0, 7);

const toDevice = (row: DeviceRow): Device => ({
	relayId: row.relay_id,
	platform: row.platform,
	pushToken: row.push_token,
	apnsEnvironment: row.apns_environment,
	liveActivityStartToken: row.live_activity_start_token,
	secretHash: row.secret_hash,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
	lastSeenAt: row.last_seen_at,
});

/** The most Live Activity tokens that one device keeps. The app has one
 *  activity at a time, so a few cover a start that overlaps an end. */
export const MAX_ACTIVITY_TOKENS = 4;

/**
 * There are no migrations: the schema is `CREATE TABLE IF NOT EXISTS`, so a
 * new table appears on the next start. A later column in an old table needs
 * an `ALTER TABLE` that checks `PRAGMA table_info` first (see `ADDED_COLUMNS`).
 *
 * `proven_at` is the time of the last push that the platform delivered. It
 * is NULL for a row with no such push. Only a delivered push proves a row,
 * because the caller of a registration holds the device secret and can make
 * any other call (a verify call, a token update) for its own junk rows. A
 * row with no proof is the first to go when the relay is full. A real phone
 * that never got a push can go too, and it registers again on its next
 * launch. A row from before this column gets `last_seen_at` as the proof
 * only if the row was seen after its registration, so old junk is not proven.
 *
 * `token_bound_at` is the time when the row got its current push token: the
 * registration, or the last update that changed the token. The oldest
 * binding of a token owns the token (see `holdsOldestRegistration`).
 *
 * `live_activity_token` binds a per-activity token to one device. The token
 * is unique, so no second device can claim it. The foreign key removes the
 * tokens with their device.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS device (
	relay_id TEXT PRIMARY KEY,
	platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
	push_token TEXT NOT NULL,
	apns_environment TEXT CHECK (apns_environment IN ('production', 'sandbox')),
	live_activity_start_token TEXT,
	secret_hash TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	last_seen_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS device_last_seen_at ON device (last_seen_at);
CREATE TABLE IF NOT EXISTS live_activity_token (
	token TEXT PRIMARY KEY,
	relay_id TEXT NOT NULL REFERENCES device (relay_id) ON DELETE CASCADE,
	created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS live_activity_token_relay_id
	ON live_activity_token (relay_id, created_at);
CREATE TABLE IF NOT EXISTS server_key (
	id TEXT PRIMARY KEY,
	secret_hash TEXT NOT NULL,
	label TEXT NOT NULL,
	contact TEXT NOT NULL,
	monthly_limit INTEGER NOT NULL CHECK (monthly_limit >= 0),
	created_at INTEGER NOT NULL,
	revoked_at INTEGER
) STRICT;
CREATE TABLE IF NOT EXISTS server_key_usage (
	key_id TEXT NOT NULL,
	month TEXT NOT NULL,
	pushes INTEGER NOT NULL,
	PRIMARY KEY (key_id, month)
) STRICT;
`;

export class DeviceStore {
	readonly #db: Database;

	constructor(db: Database) {
		this.#db = db;
		this.#db.run("PRAGMA journal_mode = WAL;");
		this.#db.run("PRAGMA busy_timeout = 5000;");
		this.#db.run("PRAGMA foreign_keys = ON;");
		this.#db.run(SCHEMA);
		this.#migrate();
	}

	/** Bring a database from an older schema up to date. Each step checks
	 *  `PRAGMA table_info` first, so a second start changes nothing. */
	#migrate(): void {
		const present = new Set(
			this.#db
				.query<{ name: string }, []>("PRAGMA table_info(device)")
				.all()
				.map((column) => column.name),
		);
		this.#db.transaction(() => {
			if (!present.has("proven_at")) {
				// `last_push_ok_at` was the first name of this column.
				if (present.has("last_push_ok_at")) {
					this.#db.run(
						"ALTER TABLE device RENAME COLUMN last_push_ok_at TO proven_at",
					);
				} else {
					this.#db.run("ALTER TABLE device ADD COLUMN proven_at INTEGER");
				}
				this.#db.run(
					"UPDATE device SET proven_at = last_seen_at WHERE proven_at IS NULL AND last_seen_at > created_at",
				);
			}
			if (!present.has("token_bound_at")) {
				this.#db.run("ALTER TABLE device ADD COLUMN token_bound_at INTEGER");
				this.#db.run("UPDATE device SET token_bound_at = created_at");
			}
			this.#db.run("DROP INDEX IF EXISTS device_push_token");
			this.#db.run(
				"CREATE INDEX IF NOT EXISTS device_push_token_bound ON device (push_token, token_bound_at)",
			);
		})();
	}

	/** Open the file at `path`, and make its directory first. `:memory:`
	 *  gives a database that a test throws away. */
	static open(path: string): DeviceStore {
		if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
		return new DeviceStore(new Database(path, { create: true, strict: true }));
	}

	insert(device: Device): void {
		this.#db
			.query(
				`INSERT INTO device (relay_id, platform, push_token, apns_environment,
					live_activity_start_token, secret_hash, created_at, updated_at, last_seen_at,
					token_bound_at)
				 VALUES ($relayId, $platform, $pushToken, $apnsEnvironment,
					$liveActivityStartToken, $secretHash, $createdAt, $updatedAt, $lastSeenAt,
					$createdAt)`,
			)
			.run({
				relayId: device.relayId,
				platform: device.platform,
				pushToken: device.pushToken,
				apnsEnvironment: device.apnsEnvironment,
				liveActivityStartToken: device.liveActivityStartToken,
				secretHash: device.secretHash,
				createdAt: device.createdAt,
				updatedAt: device.updatedAt,
				lastSeenAt: device.lastSeenAt,
			});
	}

	count(): number {
		return (
			this.#db
				.query<{ total: number }, []>("SELECT COUNT(*) AS total FROM device")
				.get()?.total ?? 0
		);
	}

	find(relayId: string): Device | null {
		const row = this.#db
			.query<DeviceRow, { relayId: string }>(
				"SELECT * FROM device WHERE relay_id = $relayId",
			)
			.get({ relayId });
		return row ? toDevice(row) : null;
	}

	update(relayId: string, change: DeviceUpdate, now: number): void {
		const current = this.find(relayId);
		if (!current) return;
		this.#db
			.query(
				`UPDATE device SET
					token_bound_at = CASE WHEN push_token = $pushToken
						THEN token_bound_at ELSE $updatedAt END,
					push_token = $pushToken,
					apns_environment = $apnsEnvironment,
					live_activity_start_token = $liveActivityStartToken,
					updated_at = $updatedAt,
					last_seen_at = $updatedAt
				 WHERE relay_id = $relayId`,
			)
			.run({
				relayId,
				pushToken: change.pushToken ?? current.pushToken,
				apnsEnvironment: change.apnsEnvironment ?? current.apnsEnvironment,
				liveActivityStartToken:
					change.liveActivityStartToken === undefined
						? current.liveActivityStartToken
						: change.liveActivityStartToken,
				updatedAt: now,
			});
	}

	/** Clear the push-to-start token after APNs refused it. A refusal is not
	 *  a sign of life, so `last_seen_at` stays. */
	clearStartToken(relayId: string, now: number): void {
		this.#db
			.query(
				`UPDATE device SET live_activity_start_token = NULL, updated_at = $now
				 WHERE relay_id = $relayId`,
			)
			.run({ relayId, now });
	}

	/** Record that the device was seen: an accepted push. `delivered` is true
	 *  when the platform really delivered it, not a dry run, and then it is
	 *  also a proof of the device. */
	touch(relayId: string, now: number, delivered = false): void {
		this.#db
			.query(
				`UPDATE device SET last_seen_at = $now,
					proven_at = CASE WHEN $delivered THEN $now ELSE proven_at END
				 WHERE relay_id = $relayId`,
			)
			.run({ relayId, now, delivered });
	}

	/** Delete at most `limit` devices that have no proof, the oldest first.
	 *  A device with a proof is never deleted. Returns the count. */
	pruneUnprovenOldest(limit: number): number {
		if (limit < 1) return 0;
		return this.#db
			.query(
				`DELETE FROM device WHERE relay_id IN (
					SELECT relay_id FROM device
					WHERE proven_at IS NULL
					ORDER BY created_at, rowid LIMIT $limit)`,
			)
			.run({ limit }).changes;
	}

	/**
	 * Whether the device holds the oldest binding of its push token. The age
	 * is the time when the row got the token (`token_bound_at`), not the age
	 * of the row: an update can move a row onto another token, and a row
	 * that keeps its old age would then win the token of a victim.
	 *
	 * One gap stays. If the victim's row is deleted and the victim registers
	 * the token again, an older binding of the same token wins. To make that
	 * binding, a caller needs the victim's push token, and that token reaches
	 * the caller only after the phone registered it. The relay accepts this.
	 */
	holdsOldestRegistration(relayId: string, pushToken: string): boolean {
		const oldest = this.#db
			.query<{ relay_id: string }, { pushToken: string }>(
				`SELECT relay_id FROM device WHERE push_token = $pushToken
				 ORDER BY token_bound_at, rowid LIMIT 1`,
			)
			.get({ pushToken });
		return oldest?.relay_id === relayId;
	}

	/** Delete every device last seen before `cutoff`. Returns the count. */
	pruneUnseenSince(cutoff: number): number {
		return this.#db
			.query("DELETE FROM device WHERE last_seen_at < $cutoff")
			.run({ cutoff }).changes;
	}

	delete(relayId: string): void {
		this.#db
			.query("DELETE FROM device WHERE relay_id = $relayId")
			.run({ relayId });
	}

	/** Delete a device only while it still holds `pushToken`. A device that
	 *  changed its token during a push keeps its row. */
	deleteWithToken(relayId: string, pushToken: string): void {
		this.#db
			.query(
				"DELETE FROM device WHERE relay_id = $relayId AND push_token = $pushToken",
			)
			.run({ relayId, pushToken });
	}

	/** The relay id that a per-activity token is bound to, or null. */
	activityTokenOwner(token: string): string | null {
		return (
			this.#db
				.query<{ relay_id: string }, { token: string }>(
					"SELECT relay_id FROM live_activity_token WHERE token = $token",
				)
				.get({ token })?.relay_id ?? null
		);
	}

	/** The per-activity tokens of one device, the newest first. */
	activityTokens(relayId: string): string[] {
		return this.#db
			.query<{ token: string }, { relayId: string }>(
				`SELECT token FROM live_activity_token WHERE relay_id = $relayId
				 ORDER BY created_at DESC, rowid DESC`,
			)
			.all({ relayId })
			.map((row) => row.token);
	}

	/**
	 * Bind a per-activity token to a device. Returns `conflict` when another
	 * device holds the token. A device keeps at most `MAX_ACTIVITY_TOKENS`: the
	 * oldest go first.
	 */
	bindActivityToken(
		relayId: string,
		token: string,
		now: number,
	): "bound" | "conflict" {
		return this.#db.transaction((): "bound" | "conflict" => {
			const owner = this.activityTokenOwner(token);
			if (owner !== null && owner !== relayId) return "conflict";
			this.#db
				.query(
					`INSERT INTO live_activity_token (token, relay_id, created_at)
					 VALUES ($token, $relayId, $now)
					 ON CONFLICT (token) DO UPDATE SET created_at = $now`,
				)
				.run({ token, relayId, now });
			this.#db
				.query(
					`DELETE FROM live_activity_token WHERE relay_id = $relayId
					 AND token NOT IN (
						SELECT token FROM live_activity_token WHERE relay_id = $relayId
						ORDER BY created_at DESC, rowid DESC LIMIT $limit)`,
				)
				.run({ relayId, limit: MAX_ACTIVITY_TOKENS });
			return "bound";
		})();
	}

	/** Unbind one per-activity token of one device. */
	removeActivityToken(relayId: string, token: string): void {
		this.#db
			.query(
				"DELETE FROM live_activity_token WHERE relay_id = $relayId AND token = $token",
			)
			.run({ relayId, token });
	}

	/** Unbind every per-activity token of one device. */
	clearActivityTokens(relayId: string): void {
		this.#db
			.query("DELETE FROM live_activity_token WHERE relay_id = $relayId")
			.run({ relayId });
	}

	insertServerKey(key: ServerKey): void {
		this.#db
			.query(
				`INSERT INTO server_key (id, secret_hash, label, contact, monthly_limit,
					created_at, revoked_at)
				 VALUES ($id, $secretHash, $label, $contact, $monthlyLimit,
					$createdAt, $revokedAt)`,
			)
			.run({ ...key });
	}

	findServerKey(id: string): ServerKey | null {
		const row = this.#db
			.query<ServerKeyRow, { id: string }>(
				"SELECT * FROM server_key WHERE id = $id",
			)
			.get({ id });
		return row ? toServerKey(row) : null;
	}

	listServerKeys(): ServerKey[] {
		return this.#db
			.query<ServerKeyRow, []>(
				"SELECT * FROM server_key ORDER BY created_at, rowid",
			)
			.all()
			.map(toServerKey);
	}

	/** Revoke a key. Returns false when the id is unknown. A second revoke
	 *  keeps the first time. */
	revokeServerKey(id: string, now: number): boolean {
		return (
			this.#db
				.query(
					"UPDATE server_key SET revoked_at = COALESCE(revoked_at, $now) WHERE id = $id",
				)
				.run({ id, now }).changes > 0
		);
	}

	setServerKeyLimit(id: string, monthlyLimit: number): boolean {
		return (
			this.#db
				.query(
					"UPDATE server_key SET monthly_limit = $monthlyLimit WHERE id = $id",
				)
				.run({ id, monthlyLimit }).changes > 0
		);
	}

	/**
	 * Count one push for a key in the month of `now`, unless the key is at its
	 * limit. A null `limit` counts with no cap (the anonymous bucket). The read
	 * and the write are one transaction, so two pushes cannot pass the same
	 * last slot.
	 */
	consumeQuota(keyId: string, limit: number | null, now: number): boolean {
		const month = monthOf(now);
		return this.#db.transaction((): boolean => {
			if (limit !== null && this.usage(keyId, now) >= limit) return false;
			this.#db
				.query(
					`INSERT INTO server_key_usage (key_id, month, pushes)
					 VALUES ($keyId, $month, 1)
					 ON CONFLICT (key_id, month) DO UPDATE SET pushes = pushes + 1`,
				)
				.run({ keyId, month });
			return true;
		})();
	}

	/** The pushes that a key sent in the month of `now`. */
	usage(keyId: string, now: number): number {
		return (
			this.#db
				.query<{ pushes: number }, { keyId: string; month: string }>(
					"SELECT pushes FROM server_key_usage WHERE key_id = $keyId AND month = $month",
				)
				.get({ keyId, month: monthOf(now) })?.pushes ?? 0
		);
	}

	/** Answer one trivial query, for the health check. */
	ping(): boolean {
		return this.#db.query<{ ok: number }, []>("SELECT 1 AS ok").get()?.ok === 1;
	}

	close(): void {
		this.#db.close();
	}
}
