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
 * an `ALTER TABLE` that checks `PRAGMA table_info` first.
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
`;

export class DeviceStore {
	readonly #db: Database;

	constructor(db: Database) {
		this.#db = db;
		this.#db.run("PRAGMA journal_mode = WAL;");
		this.#db.run("PRAGMA busy_timeout = 5000;");
		this.#db.run("PRAGMA foreign_keys = ON;");
		this.#db.run(SCHEMA);
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
					live_activity_start_token, secret_hash, created_at, updated_at, last_seen_at)
				 VALUES ($relayId, $platform, $pushToken, $apnsEnvironment,
					$liveActivityStartToken, $secretHash, $createdAt, $updatedAt, $lastSeenAt)`,
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
				`UPDATE device SET push_token = $pushToken,
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

	/** Record that the device was seen: an accepted push. */
	touch(relayId: string, now: number): void {
		this.#db
			.query("UPDATE device SET last_seen_at = $now WHERE relay_id = $relayId")
			.run({ relayId, now });
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

	/** Answer one trivial query, for the health check. */
	ping(): boolean {
		return this.#db.query<{ ok: number }, []>("SELECT 1 AS ok").get()?.ok === 1;
	}

	close(): void {
		this.#db.close();
	}
}
