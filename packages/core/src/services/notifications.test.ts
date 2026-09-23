// Push subscriptions and per-org notification preferences.
//
// A push subscription belongs to a device and therefore to a person: saving
// one binds it to the caller, saving the same endpoint again re-binds it rather
// than duplicating it, and removing one only ever removes the caller's own.
// Preferences are per (org, person) and default ON, and the reminder job's
// "last reminded" stamp shares the row without clobbering the toggle.
//
// `sendPush` is covered only for what it keeps and drops: VAPID keys are
// generated per run and `web-push`'s send is replaced, so no call leaves the
// process.

import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	spyOn,
	test,
} from "bun:test";

import { eq } from "drizzle-orm";
import webpush from "web-push";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { pushSubscription } from "../db/schema/notifications";
import { at, createTestDb, type TestDb } from "../test/harness";
import { notificationsService } from "./notifications.service";
import type { Ctx } from "./types";

const ORG_A = "nt-a";
const ORG_B = "nt-b";
const ME = "u-nt-me";
const OTHER = "u-nt-other";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-1";

let harness: TestDb;

const ctx = (userId: string, organizationId: string = ORG_A): Ctx => ({
	organizationId,
	userId,
});

const subscriptionsAt = (endpoint: string) =>
	db.query.pushSubscription.findMany({
		where: eq(pushSubscription.endpoint, endpoint),
	});

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values([
		{ id: ORG_A, name: "Notify A", slug: ORG_A, createdAt: new Date() },
		{ id: ORG_B, name: "Notify B", slug: ORG_B, createdAt: new Date() },
	]);
	await db.insert(user).values(
		[ME, OTHER].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	await db.insert(member).values(
		[ME, OTHER].map((id) => ({
			id: `m-${id}`,
			organizationId: ORG_A,
			userId: id,
			role: "member",
			createdAt: new Date(),
		})),
	);
});

afterAll(async () => {
	await harness.close();
});

describe("push subscriptions", () => {
	test("saving binds the endpoint to the caller", async () => {
		await notificationsService.saveSubscription(ctx(ME), {
			endpoint: ENDPOINT,
			keys: { p256dh: "p1", auth: "a1" },
			userAgent: "Firefox",
		});
		const rows = await subscriptionsAt(ENDPOINT);
		expect(rows).toHaveLength(1);
		expect(at(rows, 0)).toMatchObject({
			userId: ME,
			p256dh: "p1",
			auth: "a1",
			userAgent: "Firefox",
		});
	});

	// `sendPush` POSTs to whatever is stored, so a URL that is not a browser
	// push service is refused before it is stored — the schema refuses it
	// too, and this holds for a caller that skipped the schema.
	test("an endpoint that is not a push service is refused and not stored", async () => {
		const internal = "https://10.0.0.1:6379/";
		await expect(
			notificationsService.saveSubscription(ctx(ME), {
				endpoint: internal,
				keys: { p256dh: "p1", auth: "a1" },
			}),
		).rejects.toThrow("Push endpoint must be a browser push service");
		expect(await subscriptionsAt(internal)).toHaveLength(0);
	});

	test("another person cannot remove a subscription that is not theirs", async () => {
		await notificationsService.removeSubscription(ctx(OTHER), ENDPOINT);
		expect(await subscriptionsAt(ENDPOINT)).toHaveLength(1);
	});

	test("re-saving the same endpoint re-binds it rather than duplicating it", async () => {
		// A shared device changing hands: the new person's save takes it over.
		await notificationsService.saveSubscription(ctx(OTHER), {
			endpoint: ENDPOINT,
			keys: { p256dh: "p2", auth: "a2" },
		});
		const rows = await subscriptionsAt(ENDPOINT);
		expect(rows).toHaveLength(1);
		expect(at(rows, 0)).toMatchObject({
			userId: OTHER,
			p256dh: "p2",
			auth: "a2",
			userAgent: null,
		});
	});

	test("the former owner can no longer remove it; the current owner can", async () => {
		await notificationsService.removeSubscription(ctx(ME), ENDPOINT);
		expect(await subscriptionsAt(ENDPOINT)).toHaveLength(1);

		await notificationsService.removeSubscription(ctx(OTHER), ENDPOINT);
		expect(await subscriptionsAt(ENDPOINT)).toHaveLength(0);
	});
});

describe("sending a push", () => {
	const DEAD = "https://fcm.googleapis.com/fcm/send/device-dead";
	const STRAY = "https://10.0.0.1:6379/";
	const gone = () =>
		Object.assign(new Error("Received unexpected response code"), {
			statusCode: 410,
		});
	/** Every endpoint `web-push` was asked to send to. */
	let sentTo: string[] = [];

	beforeAll(() => {
		const keys = webpush.generateVAPIDKeys();
		process.env.VAPID_PUBLIC_KEY = keys.publicKey;
		process.env.VAPID_PRIVATE_KEY = keys.privateKey;
	});

	afterEach(async () => {
		sentTo = [];
		await db.delete(pushSubscription);
	});

	afterAll(() => {
		delete process.env.VAPID_PUBLIC_KEY;
		delete process.env.VAPID_PRIVATE_KEY;
	});

	test("an endpoint the push service reports gone is dropped", async () => {
		await notificationsService.saveSubscription(ctx(ME), {
			endpoint: DEAD,
			keys: { p256dh: "p1", auth: "a1" },
		});
		const send = spyOn(webpush, "sendNotification").mockImplementation(
			async (subscription) => {
				sentTo.push(subscription.endpoint);
				throw gone();
			},
		);
		try {
			await notificationsService.sendPush(ME, { title: "t", body: "b" });
		} finally {
			send.mockRestore();
		}
		expect(sentTo).toEqual([DEAD]);
		expect(await subscriptionsAt(DEAD)).toHaveLength(0);
	});

	// The endpoint changed hands between the read and the 410: the delete is
	// the first person's, and the row is now somebody else's live device.
	test("dropping it never takes a row that now belongs to someone else", async () => {
		await notificationsService.saveSubscription(ctx(ME), {
			endpoint: DEAD,
			keys: { p256dh: "p1", auth: "a1" },
		});
		const send = spyOn(webpush, "sendNotification").mockImplementation(
			async (subscription) => {
				sentTo.push(subscription.endpoint);
				await notificationsService.saveSubscription(ctx(OTHER), {
					endpoint: DEAD,
					keys: { p256dh: "p2", auth: "a2" },
				});
				throw gone();
			},
		);
		try {
			await notificationsService.sendPush(ME, { title: "t", body: "b" });
		} finally {
			send.mockRestore();
		}
		const rows = await subscriptionsAt(DEAD);
		expect(rows).toHaveLength(1);
		expect(at(rows, 0).userId).toBe(OTHER);
	});

	// A row stored before the endpoint allowlist existed.
	test("a stored endpoint that is not a push service is never sent to", async () => {
		await db.insert(pushSubscription).values({
			userId: ME,
			endpoint: STRAY,
			p256dh: "p1",
			auth: "a1",
		});
		const send = spyOn(webpush, "sendNotification").mockImplementation(
			async (subscription) => {
				sentTo.push(subscription.endpoint);
				throw gone();
			},
		);
		try {
			await notificationsService.sendPush(ME, { title: "t", body: "b" });
		} finally {
			send.mockRestore();
		}
		expect(sentTo).toEqual([]);
	});
});

describe("notification settings", () => {
	test("a missing row means log reminders are on", async () => {
		expect(await notificationsService.getSettings(ctx(ME))).toEqual({
			logReminders: true,
		});
		expect(await notificationsService.settingsFor(ORG_A, ME)).toEqual({
			logReminders: true,
		});
	});

	test("turning reminders off is per person and per org", async () => {
		const saved = await notificationsService.update(ctx(ME), {
			logReminders: false,
		});
		expect(saved.logReminders).toBe(false);
		expect((await notificationsService.getSettings(ctx(ME))).logReminders).toBe(
			false,
		);
		expect(
			(await notificationsService.getSettings(ctx(OTHER))).logReminders,
		).toBe(true);
		expect(
			(await notificationsService.getSettings(ctx(ME, ORG_B))).logReminders,
		).toBe(true);
	});

	test("an empty patch keeps the stored value", async () => {
		const saved = await notificationsService.update(ctx(ME), {});
		expect(saved.logReminders).toBe(false);
	});

	test("the reminder stamp creates a row with reminders on, and never flips the toggle", async () => {
		expect(await notificationsService.lastLogReminderDay(ORG_A, OTHER)).toBe(
			null,
		);
		await notificationsService.markLogReminded(ORG_A, OTHER, "2026-09-10");
		expect(await notificationsService.lastLogReminderDay(ORG_A, OTHER)).toBe(
			"2026-09-10",
		);
		expect(
			(await notificationsService.settingsFor(ORG_A, OTHER)).logReminders,
		).toBe(true);

		// ME turned reminders off above; stamping must not turn them back on.
		await notificationsService.markLogReminded(ORG_A, ME, "2026-09-10");
		expect(
			(await notificationsService.settingsFor(ORG_A, ME)).logReminders,
		).toBe(false);
		expect(await notificationsService.lastLogReminderDay(ORG_B, ME)).toBe(null);
	});
});
