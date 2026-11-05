// The reminder pass for a workspace with no Slack installation. The app
// takes the three Slack kinds, so a person with a phone must still get them
// there. Slack is never tried, and a person with no phone is not claimed.

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	spyOn,
	test,
} from "bun:test";

import { generateDeviceKeyPair, toBase64Url } from "@farmer/push-crypto";
import { eq } from "drizzle-orm";

import { db } from "../db";
import {
	account,
	member,
	organization,
	session,
	user,
} from "../db/schema/auth";
import { mobileDevice } from "../db/schema/mobile";
import { notificationSettings } from "../db/schema/notifications";
import { slackReminderLog } from "../db/schema/slack";
import * as nativePush from "../services/native-push";
import { settleNativePushForTests } from "../services/native-push";
import {
	type NotifyAdapter,
	setNotifyAdaptersForTests,
} from "../services/notify";
import { type FakeRelay, startFakeRelay } from "../test/fake-relay";
import { createTestDb, type TestDb } from "../test/harness";
import {
	forgetSlackReminderRunsForTests,
	runSlackRemindersOnce,
} from "./slack-reminders";

const ORG = "org-app-reminders";
const EMPTY_ORG = "org-app-reminders-empty";
const WITH_PHONE = "u-ar-phone";
const NO_PHONE = "u-ar-nophone";
const CHOSE_SLACK = "u-ar-slack";
const LONELY = "u-ar-lonely";
const RELAY_ID = "relay-app-reminders-aaaa";

/** A Tuesday, the digest day, after the 09:00 send time. */
const TUESDAY = new Date("2026-10-13T10:00:00Z");

let harness: TestDb;
let relay: FakeRelay;

const slackCalls: string[] = [];
const slackAdapter: NotifyAdapter = async (to) => {
	slackCalls.push(to.userId);
	return true;
};

const addAdmin = async (id: string, organizationId: string) => {
	const now = new Date();
	await db.insert(user).values({
		id,
		name: id,
		email: `${id}@example.com`,
		emailVerified: true,
		createdAt: now,
		updatedAt: now,
	});
	await db.insert(member).values({
		id: `m-${id}`,
		organizationId,
		userId: id,
		role: "admin",
		createdAt: now,
	});
	// Somebody who has signed in, so the reminder kinds reach them.
	await db.insert(account).values({
		id: `acc-${id}`,
		accountId: id,
		providerId: "credential",
		userId: id,
		createdAt: now,
		updatedAt: now,
	});
};

const addPhone = async (userId: string, relayId: string) => {
	const now = new Date();
	await db.insert(session).values({
		id: `s-${userId}`,
		token: `token-${userId}`,
		userId,
		expiresAt: new Date(now.getTime() + 24 * 3600 * 1000),
		createdAt: now,
		updatedAt: now,
	});
	const keys = await generateDeviceKeyPair();
	await db.insert(mobileDevice).values({
		userId,
		installationId: `install-${userId}`,
		platform: "ios",
		relayId,
		publicKey: toBase64Url(keys.publicKeyRaw),
		appVersion: "1.0.0",
		sessionId: `s-${userId}`,
		notificationsAllowed: true,
	});
};

beforeAll(async () => {
	harness = await createTestDb();
	relay = startFakeRelay();
	const now = new Date();
	await db.insert(organization).values([
		{ id: ORG, name: "App Reminders", slug: ORG, createdAt: now },
		{ id: EMPTY_ORG, name: "No Phones", slug: EMPTY_ORG, createdAt: now },
	]);
	for (const id of [WITH_PHONE, NO_PHONE, CHOSE_SLACK]) await addAdmin(id, ORG);
	await addAdmin(LONELY, EMPTY_ORG);
	await addPhone(WITH_PHONE, RELAY_ID);
	await addPhone(CHOSE_SLACK, "relay-app-reminders-bbbb");
	await db.insert(notificationSettings).values({
		organizationId: ORG,
		userId: CHOSE_SLACK,
		remindersChannel: "slack",
	});
});

beforeEach(() => {
	relay.reset();
	slackCalls.length = 0;
	forgetSlackReminderRunsForTests();
	setNotifyAdaptersForTests({ slack: slackAdapter });
});

afterEach(async () => {
	await settleNativePushForTests();
	await db.delete(slackReminderLog);
});

afterAll(async () => {
	setNotifyAdaptersForTests();
	await relay.stop();
	await harness.close();
});

describe("a workspace with no Slack installation", () => {
	test("sends the admin digest to a person with a phone, through the app", async () => {
		const summary = await runSlackRemindersOnce({ now: TUESDAY });

		expect(summary.digests).toBe(1);
		expect(summary.failed).toBe(0);
		expect(relay.requests.map((r) => r.relayId)).toEqual([RELAY_ID]);
		expect(slackCalls).toEqual([]);
	});

	test("does not claim a person with no phone, or one who chose Slack", async () => {
		await runSlackRemindersOnce({ now: TUESDAY });

		const claimed = await db
			.select({ userId: slackReminderLog.recipientUserId })
			.from(slackReminderLog)
			.where(eq(slackReminderLog.organizationId, ORG));
		expect(claimed.map((c) => c.userId)).toEqual([WITH_PHONE]);
		expect(slackCalls).toEqual([]);
	});

	test("skips a workspace where nobody has a phone", async () => {
		const summary = await runSlackRemindersOnce({ now: TUESDAY });

		expect(summary.organizations).toBe(1);
		const claimed = await db
			.select({ userId: slackReminderLog.recipientUserId })
			.from(slackReminderLog)
			.where(eq(slackReminderLog.organizationId, EMPTY_ORG));
		expect(claimed).toEqual([]);
	});

	test("a second pass the same day sends nothing more", async () => {
		await runSlackRemindersOnce({ now: TUESDAY });
		forgetSlackReminderRunsForTests();
		relay.requests.length = 0;

		await runSlackRemindersOnce({ now: TUESDAY });

		expect(relay.requests).toEqual([]);
	});

	test("a failed push is retried and never falls back to Slack", async () => {
		relay.answer(RELAY_ID, { status: 503, error: "unavailable" });

		const summary = await runSlackRemindersOnce({ now: TUESDAY });

		expect(summary.digests).toBe(0);
		expect(summary.failed).toBe(1);
		expect(slackCalls).toEqual([]);
		const [claim] = await db
			.select({ retry: slackReminderLog.retry })
			.from(slackReminderLog)
			.where(eq(slackReminderLog.recipientUserId, WITH_PHONE));
		expect(claim?.retry).toBe(true);
	});

	test("does not run the phone query when no reminder is due", async () => {
		const phoneQuery = spyOn(nativePush, "orgHasNotifiablePhone");
		try {
			// A Wednesday: not a nudge day, not the digest day, not month end.
			const summary = await runSlackRemindersOnce({
				now: new Date("2026-10-14T10:00:00Z"),
			});
			expect(summary.organizations).toBe(0);
			expect(phoneQuery).not.toHaveBeenCalled();
		} finally {
			phoneQuery.mockRestore();
		}
	});

	test("runs the phone query when a reminder is due", async () => {
		const phoneQuery = spyOn(nativePush, "orgHasNotifiablePhone");
		try {
			await runSlackRemindersOnce({ now: TUESDAY });
			expect(phoneQuery).toHaveBeenCalled();
		} finally {
			phoneQuery.mockRestore();
		}
	});

	test("sends nothing while the relay is off", async () => {
		relay.setEnabled(false);

		const summary = await runSlackRemindersOnce({ now: TUESDAY });

		expect(summary.organizations).toBe(0);
		expect(relay.requests).toEqual([]);
	});
});
