import { eq, ilike, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import { db } from "../db";
import { apiToken } from "../db/schema/api-tokens";
import { assistantConversation } from "../db/schema/assistant";
import {
	account,
	deviceCode,
	invitation,
	member,
	oauthAccessToken,
	oauthConsent,
	session,
	user,
	verification,
} from "../db/schema/auth";
import { mobileDevice } from "../db/schema/mobile";
import {
	notificationSettings,
	pushSubscription,
} from "../db/schema/notifications";
import {
	commitDetachTombstone,
	commitFillTombstone,
	filingRule,
	hiddenTask,
	integrationSettings,
	pullRequestEventDetachTombstone,
	pullRequestReviewTombstone,
	syncedMeetingTombstone,
} from "../db/schema/settings";
import { memberSlackIdentity, slackReminderLog } from "../db/schema/slack";
import { runningTimer, timerSettings } from "../db/schema/timer";
import { PLATFORM_USER_ROLE } from "../lib/platform-admin";
import { UserFacingError } from "../lib/user-facing-error";
import { apiTokensService } from "./api-tokens.service";
import { recordAudit } from "./audit";
import { membersService } from "./members.service";
import { mobileDevicesService } from "./mobile-devices.service";
import { platformAdminsService } from "./platform-admins.service";
import type { Ctx, CtxActor } from "./types";

/**
 * Anonymise a person's account: the answer to "delete my account".
 *
 * **The `user` row is never deleted.** Nearly every table cascades from it,
 * `time_entry` among them, and a workspace keeps its time. So the row stays,
 * scrubbed, and the workspaces read the person as "Deleted user".
 *
 * Order, so that a failure never leaves a person who can still sign in:
 *
 * 1. Guards. They read only, so a refusal changes nothing.
 * 2. Revoke API tokens and remove phones through their services. They use the
 *    ambient connection and cannot join a transaction. A failure here leaves
 *    an account that is still whole, not a half-anonymised one.
 * 3. One transaction: scrub the `user` row, ban it, and delete every
 *    credential (sessions, sign-in methods, OAuth grants, device codes, the
 *    tokens that carry the old address).
 * 4. Archive each membership (audit row and `member.*` webhook).
 * 5. One transaction: delete the personal rows.
 *
 * Every step is safe to run again, so a failure after step 3 is finished by
 * the same call. The person is banned and has no credential from step 3 on.
 */

export type AnonymiseRefusal =
	| "not_found"
	| "self"
	| "last_platform_admin"
	| "sole_owner";

export class AnonymiseRefusedError extends UserFacingError {
	constructor(
		readonly reason: AnonymiseRefusal,
		message: string,
	) {
		super(message);
		this.name = "AnonymiseRefusedError";
	}
}

export const DELETED_USER_NAME = "Deleted user";
export const DELETED_EMAIL_DOMAIN = "deleted.invalid";
export const DELETED_BAN_REASON = "Account deleted";

/** The address a scrubbed account keeps: unique through the id, and a valid
 *  address for every parser (`.invalid` is reserved, so it never delivers). */
export const deletedEmailFor = (userId: string): string =>
	`deleted-${userId}@${DELETED_EMAIL_DOMAIN}`;

/** Rows that belong to one person alone and that no workspace needs as a
 *  record: preferences, saved filters, automation state, the timer, and the
 *  assistant history (its messages cascade). Time entries, absences,
 *  assignments, member rows and team-lead links are NOT here. */
const PERSONAL_ROWS: readonly (readonly [PgTable, PgColumn])[] = [
	[pushSubscription, pushSubscription.userId],
	[notificationSettings, notificationSettings.userId],
	[assistantConversation, assistantConversation.userId],
	[runningTimer, runningTimer.userId],
	[timerSettings, timerSettings.userId],
	[integrationSettings, integrationSettings.userId],
	[filingRule, filingRule.userId],
	[hiddenTask, hiddenTask.userId],
	[syncedMeetingTombstone, syncedMeetingTombstone.userId],
	[commitFillTombstone, commitFillTombstone.userId],
	[pullRequestReviewTombstone, pullRequestReviewTombstone.userId],
	[commitDetachTombstone, commitDetachTombstone.userId],
	[pullRequestEventDetachTombstone, pullRequestEventDetachTombstone.userId],
	[memberSlackIdentity, memberSlackIdentity.userId],
	[slackReminderLog, slackReminderLog.recipientUserId],
];

const refuse = (reason: AnonymiseRefusal, message: string): never => {
	throw new AnonymiseRefusedError(reason, message);
};

/** Every refusal, before any write. Answers the old address. */
const assertAllowed = async (
	byUserId: string,
	targetId: string,
): Promise<string> => {
	const person = await platformAdminsService.find(targetId);
	if (!person) return refuse("not_found", "That account no longer exists.");
	if (person.id === byUserId) {
		return refuse(
			"self",
			"You cannot anonymise your own account. Ask another platform admin.",
		);
	}
	if (person.isPlatformAdmin && (await platformAdminsService.count()) <= 1) {
		return refuse(
			"last_platform_admin",
			"This is the only platform admin. Give somebody else the role first.",
		);
	}
	const sole = await membersService.soleOwnerWorkspaces(targetId);
	if (sole.length > 0) {
		return refuse(
			"sole_owner",
			`This person is the only active owner of ${sole.map((w) => w.name).join(", ")}. Give the workspace another owner first.`,
		);
	}
	return person.email;
};

/** Step 2: the user row and every way back in, in one transaction. */
const scrubAccess = async (userId: string, oldEmail: string) => {
	await db.transaction(async (tx) => {
		await tx
			.update(user)
			.set({
				name: DELETED_USER_NAME,
				email: deletedEmailFor(userId),
				image: null,
				emailVerified: false,
				banned: true,
				banReason: DELETED_BAN_REASON,
				banExpires: null,
				role: PLATFORM_USER_ROLE,
				updatedAt: new Date(),
			})
			.where(eq(user.id, userId));
		await tx.delete(session).where(eq(session.userId, userId));
		await tx.delete(account).where(eq(account.userId, userId));
		await tx
			.delete(oauthAccessToken)
			.where(eq(oauthAccessToken.userId, userId));
		await tx.delete(oauthConsent).where(eq(oauthConsent.userId, userId));
		await tx.delete(deviceCode).where(eq(deviceCode.userId, userId));
		// A second run finds the placeholder address, and nothing is keyed by it.
		if (oldEmail === deletedEmailFor(userId)) return;
		// `%` and `_` are wildcards to `ilike`: escape them, as the search does.
		const pattern = `%${oldEmail.replace(/[\\%_]/g, "\\$&")}%`;
		await tx
			.delete(verification)
			.where(ilike(verification.identifier, pattern));
		await tx
			.delete(invitation)
			.where(sql`lower(${invitation.email}) = lower(${oldEmail})`);
	});
};

/** Step 3a: the tokens and phones, through the services that own them. */
const revokeDevicesAndTokens = async (userId: string) => {
	const actor: CtxActor = { via: "system" };
	const tokens = await db
		.select({ id: apiToken.id, organizationId: apiToken.organizationId })
		.from(apiToken)
		.where(eq(apiToken.userId, userId));
	for (const token of tokens) {
		await apiTokensService.revoke(
			{ organizationId: token.organizationId ?? "", userId, actor },
			token.id,
		);
	}
	const phones = await db
		.select({ installationId: mobileDevice.installationId })
		.from(mobileDevice)
		.where(eq(mobileDevice.userId, userId));
	for (const phone of phones) {
		await mobileDevicesService.remove(
			{ userId, actor },
			{ installationId: phone.installationId },
		);
	}
};

/** Step 3b: archive each workspace membership, then say so once per
 *  workspace. The platform admin is the actor of both rows. */
const archiveMemberships = async (
	byUserId: string,
	actor: CtxActor,
	targetId: string,
) => {
	const rows = await db
		.select({ organizationId: member.organizationId })
		.from(member)
		.where(eq(member.userId, targetId));
	for (const { organizationId } of rows) {
		const ctx: Ctx = { organizationId, userId: byUserId, actor };
		if (!(await membersService.archiveForAnonymise(ctx, targetId))) continue;
		await recordAudit(ctx, {
			kind: "member.anonymised",
			target: { type: "member", id: targetId, label: DELETED_USER_NAME },
			subjectUserId: targetId,
		});
	}
};

/** Step 4. */
const deletePersonalRows = async (userId: string) => {
	await db.transaction(async (tx) => {
		for (const [table, column] of PERSONAL_ROWS) {
			await tx.delete(table).where(eq(column, userId));
		}
	});
};

export const anonymiseService = {
	/**
	 * Anonymise one person. `by` is the platform admin who runs it, and the
	 * actor of the audit rows. Throws `AnonymiseRefusedError` for the four
	 * refusals; a second call on the same person finishes whatever is left.
	 */
	anonymise: async (
		by: { userId: string; actor?: CtxActor },
		targetId: string,
	): Promise<void> => {
		const oldEmail = await assertAllowed(by.userId, targetId);
		await revokeDevicesAndTokens(targetId);
		await scrubAccess(targetId, oldEmail);
		await archiveMemberships(by.userId, by.actor ?? { via: "web" }, targetId);
		await deletePersonalRows(targetId);
	},
};
