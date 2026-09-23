// `slackService.syncIdentities`, on who it asks Slack about.
//
// After a Harvest import most of an organization's roster is archived, and the
// re-match made one Slack call for each of those people too — in one request
// that has to answer before the host's idle timeout. Archived people never get
// a reminder, so they are skipped; a match they already have is kept.

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { memberProfile } from "../db/schema/people";
import { memberSlackIdentity, slackInstallation } from "../db/schema/slack";
import { isSealed } from "../lib/secret-box";
import { slackClient } from "../lib/slack-client";
import { createTestDb, type TestDb } from "../test/harness";
import { slackService } from "./slack.service";

const ORG = "org-slack-sync";
/** Active, with a profile row, and in the workspace. */
const ACTIVE = "u-ss-active";
/** Active with no profile row at all: still somebody to match. */
const NO_PROFILE = "u-ss-no-profile";
/** Active, but not in the workspace. */
const OUTSIDE = "u-ss-outside";
/** Archived, and matched before they were archived. */
const ARCHIVED = "u-ss-archived";

const email = (id: string) => `${id}@example.com`;
const IN_WORKSPACE = new Map([
	[email(ACTIVE), "U-ACTIVE"],
	[email(NO_PROFILE), "U-NO-PROFILE"],
	[email(ARCHIVED), "U-ARCHIVED"],
]);

let harness: TestDb;

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(organization).values({
		id: ORG,
		name: ORG,
		slug: ORG,
		createdAt: new Date(),
	});
	const everyone = [ACTIVE, NO_PROFILE, OUTSIDE, ARCHIVED];
	await db.insert(user).values(
		everyone.map((id) => ({
			id,
			name: id,
			email: email(id),
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	await db.insert(member).values(
		everyone.map((id) => ({
			id: `m-${id}`,
			organizationId: ORG,
			userId: id,
			role: id === ACTIVE ? "owner" : "member",
			createdAt: new Date(),
		})),
	);
	await db.insert(memberProfile).values([
		{ organizationId: ORG, userId: ACTIVE },
		{ organizationId: ORG, userId: OUTSIDE },
		{ organizationId: ORG, userId: ARCHIVED, archivedAt: new Date() },
	]);
	await db.insert(slackInstallation).values({
		organizationId: ORG,
		teamId: "T-TEST",
		botToken: "xoxb-test",
	});
	await db.insert(memberSlackIdentity).values({
		organizationId: ORG,
		userId: ARCHIVED,
		slackUserId: "U-ARCHIVED",
	});
});

afterAll(async () => {
	await harness.close();
});

describe("syncIdentities", () => {
	test("asks Slack about active people only, and keeps an archived match", async () => {
		const asked: string[] = [];
		const lookup = spyOn(slackClient, "lookupUserByEmail").mockImplementation(
			async (_token, address) => {
				asked.push(address);
				return IN_WORKSPACE.get(address) ?? null;
			},
		);
		try {
			const mapped = await slackService.syncIdentities({
				organizationId: ORG,
				userId: ACTIVE,
			});

			expect(mapped).toBe(2);
			expect(asked.sort()).toEqual(
				[email(ACTIVE), email(NO_PROFILE), email(OUTSIDE)].sort(),
			);
			const rows = await db
				.select({
					userId: memberSlackIdentity.userId,
					slackUserId: memberSlackIdentity.slackUserId,
				})
				.from(memberSlackIdentity)
				.where(eq(memberSlackIdentity.organizationId, ORG));
			expect(rows.sort((a, b) => a.userId.localeCompare(b.userId))).toEqual([
				{ userId: ACTIVE, slackUserId: "U-ACTIVE" },
				{ userId: ARCHIVED, slackUserId: "U-ARCHIVED" },
				{ userId: NO_PROFILE, slackUserId: "U-NO-PROFILE" },
			]);
			const outside = await db.query.memberSlackIdentity.findFirst({
				where: and(
					eq(memberSlackIdentity.organizationId, ORG),
					eq(memberSlackIdentity.userId, OUTSIDE),
				),
			});
			expect(outside).toBeUndefined();
		} finally {
			lookup.mockRestore();
		}
	});
});

describe("installationFor", () => {
	test("opens the bot token, and reseals one stored in plaintext", async () => {
		// `beforeAll` writes the token the way every row was written before
		// encryption at rest existed.
		const installation = await slackService.installationFor(ORG);
		expect(installation?.botToken).toBe("xoxb-test");

		const row = await db.query.slackInstallation.findFirst({
			where: eq(slackInstallation.organizationId, ORG),
			columns: { botToken: true },
		});
		expect(isSealed(row?.botToken ?? "")).toBe(true);
		expect(row?.botToken).not.toContain("xoxb-test");

		// The sealed row reads back the same.
		expect((await slackService.installationFor(ORG))?.botToken).toBe(
			"xoxb-test",
		);
	});
});

describe("sendDm", () => {
	test("tells a refusal no retry can change from one it may", async () => {
		let answer: "sent" | "refused" | "failed" = "refused";
		const post = spyOn(slackClient, "postMessage").mockImplementation(
			async () => answer,
		);
		try {
			// `beforeAll` maps ARCHIVED; OUTSIDE has no Slack match at all.
			expect(await slackService.sendDm(ORG, ARCHIVED, "hi")).toBe(
				"unreachable",
			);
			answer = "failed";
			expect(await slackService.sendDm(ORG, ARCHIVED, "hi")).toBe(false);
			answer = "sent";
			expect(await slackService.sendDm(ORG, ARCHIVED, "hi")).toBe(true);
			expect(await slackService.sendDm(ORG, OUTSIDE, "hi")).toBe("unreachable");
		} finally {
			post.mockRestore();
		}
	});
});
