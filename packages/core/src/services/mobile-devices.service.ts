import { and, eq, gt } from "drizzle-orm";

import { db } from "../db";
import { session } from "../db/schema/auth";
import { mobileDevice } from "../db/schema/mobile";
import { pushRelayUrl, verifyWithRelay } from "../lib/push-relay";
import { UserFacingError } from "../lib/user-facing-error";
import type {
	RegisterMobileDeviceInput,
	RemoveMobileDeviceInput,
	UpdateMobileDeviceInput,
} from "../schema/mobile-devices";
import { AccessError } from "./access.service";
import { normalizePublicKey, otherRowsWithRelayId } from "./native-push";
import type { Ctx } from "./types";

/**
 * The person's phones, for native push (ADR 0006, `docs/domains/mobile.md`).
 *
 * A phone belongs to a person and not to a workspace, so these functions read
 * only `ctx.userId` and take a `PersonCtx`. Any Ctx is one. The routes are
 * under `/api/v1/me`, where no workspace is named.
 *
 * Not in the audit log: a phone is a person's own device, as a web push
 * subscription is, and it changes no workspace. The sign-in that made the
 * session is recorded (`auth.signed_in`), and the row ends with that session.
 */

/** The part of a Ctx that a per-person function reads. */
type PersonCtx = Pick<Ctx, "userId" | "actor">;

type MobileDeviceView = {
	installationId: string;
	platform: "ios" | "android";
	appVersion: string;
	notificationsAllowed: boolean;
	/** Whether the server holds a Live Activity token for the phone. The token
	 *  itself is not sent back. */
	liveActivity: boolean;
	createdAt: Date;
	updatedAt: Date;
};

const viewOf = (row: typeof mobileDevice.$inferSelect): MobileDeviceView => ({
	installationId: row.installationId,
	platform: row.platform,
	appVersion: row.appVersion,
	notificationsAllowed: row.notificationsAllowed,
	liveActivity: row.liveActivityToken !== null,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
});

const NOT_A_SESSION =
	"Register a phone from the app's own sign-in, not with an API token.";

/** The id of the person's live session that `token` names, or null. */
const sessionIdFor = async (
	userId: string,
	token: string,
): Promise<string | null> => {
	const row = await db.query.session.findFirst({
		where: and(
			eq(session.token, token),
			eq(session.userId, userId),
			gt(session.expiresAt, new Date()),
		),
		columns: { id: true },
	});
	return row?.id ?? null;
};

/**
 * Ask the relay whether the phone holds the relay registration. The relay id
 * is the only authority to push to a phone, and the client names it. Without
 * this check, a person who learns a relay id could register it with their own
 * key. The server would then seal the pushes of that phone for the wrong key.
 */
const requireRelayProof = async (
	input: RegisterMobileDeviceInput,
): Promise<void> => {
	const relayUrl = pushRelayUrl();
	if (!relayUrl) {
		throw new UserFacingError("Native push is off on this server.");
	}
	const verdict = await verifyWithRelay(relayUrl, input.relayId, {
		publicKey: input.publicKey,
		proof: input.relayProof,
	});
	if (verdict === "invalid") {
		throw new UserFacingError(
			"The relay does not confirm this phone. Register the phone with the relay again.",
		);
	}
	if (verdict === "failed") {
		throw new UserFacingError(
			"The push relay could not check this phone. Try again later.",
		);
	}
};

export const mobileDevicesService = {
	/**
	 * Register the phone, or register it again.
	 *
	 * `sessionToken` is the bearer token of the request: the row belongs to
	 * that session, so the row goes when the session goes. Null, for an API
	 * token, is refused. An installation that registers again (a new relay id
	 * after the relay forgot the phone, a new key, a new sign-in) replaces its
	 * row in full, the session included.
	 *
	 * One phone has one relay id. A row of any other person or installation
	 * with the same relay id is deleted, so a phone that changed hands does not
	 * get the last person's pushes.
	 *
	 * The phone must prove that it holds the relay registration whenever the
	 * relay id or the key is new for this installation (`requireRelayProof`).
	 * An unchanged re-registration, as on each foreground, makes no relay
	 * call. Only a phone with the proof can take a relay id from a row.
	 */
	register: async (
		ctx: PersonCtx,
		input: RegisterMobileDeviceInput,
		opts: { sessionToken: string | null },
	): Promise<MobileDeviceView> => {
		if (!opts.sessionToken) throw new AccessError(NOT_A_SESSION);
		const sessionId = await sessionIdFor(ctx.userId, opts.sessionToken);
		if (!sessionId) throw new AccessError(NOT_A_SESSION);

		let publicKey: string;
		try {
			publicKey = await normalizePublicKey(input.publicKey);
		} catch {
			throw new UserFacingError("The public key is not a P-256 point.");
		}

		const existing = await db.query.mobileDevice.findFirst({
			where: and(
				eq(mobileDevice.userId, ctx.userId),
				eq(mobileDevice.installationId, input.installationId),
			),
			columns: { relayId: true, publicKey: true },
		});
		const unchanged =
			existing?.relayId === input.relayId && existing.publicKey === publicKey;
		if (!unchanged) await requireRelayProof(input);

		const now = new Date();
		const fields = {
			platform: input.platform,
			relayId: input.relayId,
			publicKey,
			appVersion: input.appVersion,
			sessionId,
			notificationsAllowed: input.notificationsAllowed,
			// Drizzle leaves an undefined value out of the write, so an absent
			// token keeps the stored one, and null clears it.
			liveActivityToken: input.liveActivityToken,
		};

		const row = await db.transaction(async (tx) => {
			await tx
				.delete(mobileDevice)
				.where(
					otherRowsWithRelayId(ctx.userId, input.installationId, input.relayId),
				);
			const [saved] = await tx
				.insert(mobileDevice)
				.values({
					userId: ctx.userId,
					installationId: input.installationId,
					...fields,
				})
				.onConflictDoUpdate({
					target: [mobileDevice.userId, mobileDevice.installationId],
					set: { ...fields, updatedAt: now },
				})
				.returning();
			return saved;
		});
		if (!row) throw new Error("Failed to register the phone");

		return viewOf(row);
	},

	/** Change what the app reports: the Live Activity token, the
	 *  notification permission or the app version. */
	update: async (
		ctx: PersonCtx,
		input: UpdateMobileDeviceInput,
	): Promise<MobileDeviceView> => {
		const [row] = await db
			.update(mobileDevice)
			// Drizzle leaves an undefined value out of the SET, so only the
			// fields the app sent change. Null clears the token.
			.set({
				liveActivityToken: input.liveActivityToken,
				notificationsAllowed: input.notificationsAllowed,
				appVersion: input.appVersion,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(mobileDevice.userId, ctx.userId),
					eq(mobileDevice.installationId, input.installationId),
				),
			)
			.returning();
		if (!row) throw new UserFacingError("Device not found");

		return viewOf(row);
	},

	/** Forget the phone. Removing one that is not there is not an error: the
	 *  app asks after a sign-out too, and the cascade can be first. */
	remove: async (
		ctx: PersonCtx,
		input: RemoveMobileDeviceInput,
	): Promise<{ removed: boolean }> => {
		const rows = await db
			.delete(mobileDevice)
			.where(
				and(
					eq(mobileDevice.userId, ctx.userId),
					eq(mobileDevice.installationId, input.installationId),
				),
			)
			.returning({ id: mobileDevice.id });

		return { removed: rows.length > 0 };
	},
};
