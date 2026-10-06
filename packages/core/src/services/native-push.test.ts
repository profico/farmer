// The native push channel and the timer's Live Activity, against a relay on
// localhost (ADR 0006). What a phone gets, what the relay's answers do to the
// row, which channel a Slack kind takes, and that nothing at all goes out
// while `PUSH_RELAY_ENABLED` is off.

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import {
	generateDeviceKeyPair,
	openOnDevice,
	toBase64Url,
} from "@farmer/push-crypto";
import { eq } from "drizzle-orm";

import { db } from "../db";
import {
	account,
	member,
	organization,
	session,
	user,
} from "../db/schema/auth";
import { task } from "../db/schema/domain";
import { mobileDevice } from "../db/schema/mobile";
import { notificationSettings } from "../db/schema/notifications";
import { runningTimer } from "../db/schema/timer";
import { runTimerSweepOnce } from "../jobs/timer-sweep";
import { type FakeRelay, startFakeRelay } from "../test/fake-relay";
import { createTestDb, present, type TestDb } from "../test/harness";
import { appReach, settleNativePushForTests } from "./native-push";
import {
	type NotifyAdapter,
	notify,
	setNotifyAdaptersForTests,
	wasUnreachable,
} from "./notify";
import { timersService } from "./timers.service";
import type { Ctx } from "./types";

const ORG = "org-native";
const ME = "user-native";
const IOS = "relay-ios-aaaaaaaaaaaa";
const ANDROID = "relay-android-aaaaaaaa";
const ctx = (): Ctx => ({ organizationId: ORG, userId: ME });

let harness: TestDb;
let relay: FakeRelay;
let iosKey: CryptoKey;
let androidKey: CryptoKey;
let meetingTaskId = "";

const decoder = new TextDecoder();

/** Open a sealed payload with the phone's private key, and parse it. */
const opened = async (key: CryptoKey, ciphertext: string) =>
	// SAFETY: the server seals `JSON.stringify` of an object; the tests read
	// the fields they name and compare the rest with `toMatchObject`.
	JSON.parse(decoder.decode(await openOnDevice(key, ciphertext))) as Record<
		string,
		string | number | null | Record<string, string | number | null>
	>;

const addDevice = async (
	relayId: string,
	publicKey: Uint8Array,
	fields: Partial<typeof mobileDevice.$inferInsert> = {},
) => {
	await db.insert(mobileDevice).values({
		userId: ME,
		installationId: `install-${relayId}`,
		platform: "ios",
		relayId,
		publicKey: toBase64Url(publicKey),
		appVersion: "1.0.0",
		sessionId: "s-native",
		notificationsAllowed: true,
		...fields,
	});
};

const deviceRow = async (relayId: string) =>
	db.query.mobileDevice.findFirst({ where: eq(mobileDevice.relayId, relayId) });

const slackRecorder = () => {
	const sent: string[] = [];
	const adapter: NotifyAdapter = async (_to, event) => {
		sent.push(event.body);
		return true;
	};
	return { sent, adapter };
};

beforeAll(async () => {
	harness = await createTestDb();
	relay = startFakeRelay();
	await db.insert(organization).values({
		id: ORG,
		name: "Native Org",
		slug: ORG,
		createdAt: new Date(),
	});
	await db.insert(user).values({
		id: ME,
		name: "Me",
		email: "native@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "m-native",
		organizationId: ORG,
		userId: ME,
		role: "member",
		createdAt: new Date(),
	});
	// Somebody who has signed in, so the reminder kinds reach them.
	await db.insert(account).values({
		id: "acc-native",
		accountId: ME,
		providerId: "credential",
		userId: ME,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(session).values({
		id: "s-native",
		token: "token-native",
		userId: ME,
		expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	const meeting = await db.query.task.findFirst({
		where: eq(task.systemKey, "meeting"),
	});
	meetingTaskId = present(meeting, "the Meeting task").id;
});

let iosPublic: Uint8Array;
let androidPublic: Uint8Array;

beforeEach(async () => {
	relay.reset();
	const ios = await generateDeviceKeyPair();
	const android = await generateDeviceKeyPair();
	iosKey = ios.privateKey;
	androidKey = android.privateKey;
	iosPublic = ios.publicKeyRaw;
	androidPublic = android.publicKeyRaw;
});

afterEach(async () => {
	await settleNativePushForTests();
	setNotifyAdaptersForTests();
	await db.delete(mobileDevice);
	await db.delete(runningTimer);
	await db.delete(notificationSettings);
});

afterAll(async () => {
	await relay.stop();
	await harness.close();
});

describe("alerts", () => {
	test("the log reminder reaches each phone that allows notifications, sealed for it", async () => {
		await addDevice(IOS, iosPublic);
		await addDevice(ANDROID, androidPublic, {
			platform: "android",
			notificationsAllowed: false,
		});

		const outcome = await notify(
			{ organizationId: ORG, userId: ME },
			{
				kind: "log-reminder",
				title: "Log your hours",
				body: "Today is empty",
				url: `/${ORG}/time`,
			},
		);

		expect(outcome.native).toBe(true);
		expect(relay.requests).toHaveLength(1);
		const [push] = relay.requests;
		expect(push).toMatchObject({ relayId: IOS, kind: "alert" });
		const { pushKind, sentAt, id, ...alert } = await opened(
			iosKey,
			present(push, "push").ciphertext,
		);
		expect(alert).toEqual({
			kind: "log-reminder",
			title: "Log your hours",
			body: "Today is empty",
			url: `/${ORG}/time`,
		});
		// The freshness fields: the relay kind of this push, the send time and
		// a random id.
		expect(pushKind).toBe("alert");
		expect(Math.abs(Date.now() - Number(sentAt))).toBeLessThan(60_000);
		expect(String(id)).toMatch(/^[A-Za-z0-9_-]{12}$/);
	});

	// The limit is on the sealed JSON, where a line break or a quote costs
	// two bytes and a non-ASCII letter more than one.
	test("a body too long for the relay is cut to fit, not refused", async () => {
		await addDevice(IOS, iosPublic);
		for (const body of ["ä".repeat(5_000), '"\n'.repeat(3_000)]) {
			relay.reset();
			const outcome = await notify(
				{ organizationId: ORG, userId: ME },
				{ kind: "log-reminder", title: "Digest", body },
			);
			expect(outcome.native).toBe(true);
			const push = present(relay.requests[0], "push");
			const payload = await opened(iosKey, push.ciphertext);
			expect(String(payload.body).endsWith("…")).toBe(true);
		}
	});

	test("404 and 410 delete the row; 502 keeps it", async () => {
		await addDevice(IOS, iosPublic);
		await addDevice(ANDROID, androidPublic, { platform: "android" });
		await addDevice("relay-broken-aaaaaaa", iosPublic);
		relay.answer(IOS, { status: 404, error: "unknown_relay_id" });
		relay.answer(ANDROID, { status: 410, error: "device_gone" });
		relay.answer("relay-broken-aaaaaaa", {
			status: 502,
			error: "upstream_failed",
		});

		const outcome = await notify(
			{ organizationId: ORG, userId: ME },
			{ kind: "log-reminder", title: "Log", body: "now" },
		);

		expect(outcome.native).toBe(false);
		expect(await deviceRow(IOS)).toBeUndefined();
		expect(await deviceRow(ANDROID)).toBeUndefined();
		expect(await deviceRow("relay-broken-aaaaaaa")).toBeDefined();
	});

	test("a 404 or 410 without the relay's code keeps the row", async () => {
		// A proxy in front of the relay (a redeploy) or a wrong relay path
		// gives a 404 that is not from the relay. It must not delete a row.
		await addDevice(IOS, iosPublic);
		await addDevice(ANDROID, androidPublic, { platform: "android" });
		relay.answer(IOS, { status: 404, error: "not_found" });
		relay.answer(ANDROID, { status: 410 });

		const outcome = await notify(
			{ organizationId: ORG, userId: ME },
			{ kind: "log-reminder", title: "Log", body: "now" },
		);

		expect(outcome.native).toBe(false);
		expect(await deviceRow(IOS)).toBeDefined();
		expect(await deviceRow(ANDROID)).toBeDefined();
	});

	test("a phone of an expired session gets nothing", async () => {
		await db.insert(session).values({
			id: "s-expired",
			token: "token-expired",
			userId: ME,
			expiresAt: new Date(Date.now() - 1000),
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await addDevice(IOS, iosPublic, { sessionId: "s-expired" });
		await notify(
			{ organizationId: ORG, userId: ME },
			{ kind: "log-reminder", title: "Log", body: "now" },
		);
		expect(relay.requests).toHaveLength(0);
		await db.delete(session).where(eq(session.id, "s-expired"));
	});
});

describe("what the phones can do for a reminder", () => {
	test("a person with no phone has none to reach", async () => {
		expect(await appReach(ME)).toEqual({
			relay: true,
			phones: 0,
			allowing: 0,
		});
	});

	test("a phone that blocks notifications counts, and does not allow", async () => {
		await addDevice(IOS, iosPublic, { notificationsAllowed: false });
		expect(await appReach(ME)).toEqual({ relay: true, phones: 1, allowing: 0 });
	});

	test("only a phone that allows notifications counts as allowing", async () => {
		await addDevice(IOS, iosPublic);
		await addDevice(ANDROID, androidPublic, { notificationsAllowed: false });
		expect(await appReach(ME)).toEqual({ relay: true, phones: 2, allowing: 1 });
	});

	test("a phone of an expired session is not live", async () => {
		await db.insert(session).values({
			id: "s-expired-reach",
			token: "token-expired-reach",
			userId: ME,
			expiresAt: new Date(Date.now() - 1000),
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await addDevice(IOS, iosPublic, { sessionId: "s-expired-reach" });
		expect((await appReach(ME)).phones).toBe(0);
		await db.delete(mobileDevice);
		await db.delete(session).where(eq(session.id, "s-expired-reach"));
	});
});

describe("the Slack kinds", () => {
	const nudge = {
		kind: "compliance-nudge" as const,
		title: "Behind",
		body: "nudge",
	};

	test("go to the app instead of Slack for a person with a phone", async () => {
		await addDevice(IOS, iosPublic);
		const slack = slackRecorder();
		setNotifyAdaptersForTests({ slack: slack.adapter });

		const outcome = await notify({ organizationId: ORG, userId: ME }, nudge);

		expect(outcome).toEqual({ push: false, native: true, slack: false });
		expect(slack.sent).toEqual([]);
		expect(relay.requests).toHaveLength(1);
	});

	test("stay on Slack when the person chose Slack", async () => {
		await addDevice(IOS, iosPublic);
		await db.insert(notificationSettings).values({
			organizationId: ORG,
			userId: ME,
			remindersChannel: "slack",
		});
		const slack = slackRecorder();
		setNotifyAdaptersForTests({ slack: slack.adapter });

		const outcome = await notify({ organizationId: ORG, userId: ME }, nudge);

		expect(outcome).toEqual({ push: false, native: false, slack: true });
		expect(relay.requests).toHaveLength(0);
	});

	test("stay on Slack without a phone that allows notifications", async () => {
		await addDevice(IOS, iosPublic, { notificationsAllowed: false });
		const slack = slackRecorder();
		setNotifyAdaptersForTests({ slack: slack.adapter });

		const outcome = await notify({ organizationId: ORG, userId: ME }, nudge);

		expect(outcome.slack).toBe(true);
		expect(relay.requests).toHaveLength(0);
	});

	test("fall back to Slack when every push fails", async () => {
		await addDevice(IOS, iosPublic);
		relay.answer(IOS, { status: 429, error: "rate_limited" });
		const slack = slackRecorder();
		setNotifyAdaptersForTests({ slack: slack.adapter });

		const outcome = await notify({ organizationId: ORG, userId: ME }, nudge);

		expect(outcome).toEqual({ push: false, native: false, slack: true });
		expect(slack.sent).toEqual(["nudge"]);
	});

	test("a failed push with no Slack match stays open to a retry", async () => {
		await addDevice(IOS, iosPublic);
		relay.answer(IOS, { status: 503, error: "unavailable" });
		setNotifyAdaptersForTests({ slack: async () => "unreachable" });

		const outcome = await notify({ organizationId: ORG, userId: ME }, nudge);

		expect(outcome).toEqual({ push: false, native: false, slack: false });
		expect(wasUnreachable(outcome)).toBe(false);
	});
});

describe("the timer's Live Activity", () => {
	const start = () =>
		timersService.start(ctx(), { taskId: meetingTaskId, description: "" });

	test("a start without an activity token is a push-to-start, with the labels sealed", async () => {
		await addDevice(IOS, iosPublic);
		const timer = await start();
		await settleNativePushForTests();

		const push = present(relay.requests[0], "push");
		expect(push.kind).toBe("liveactivity");
		expect(push.liveActivity).toEqual({
			event: "start",
			contentState: {
				state: "running",
				runningSinceMs: timer.serverNow.getTime(),
				accumulatedSeconds: timer.elapsedSeconds,
				workspace: ORG,
			},
			attributesType: "TimerAttributes",
			attributes: { version: 1 },
		});
		expect(await opened(iosKey, push.ciphertext)).toMatchObject({
			kind: "timer",
			event: "start",
			workspace: "Native Org",
			task: timer.taskName,
			pushKind: "liveactivity",
		});
	});

	test("a pause updates the activity; without a token it waits for the app", async () => {
		await addDevice(IOS, iosPublic, { liveActivityToken: "activity-token-1" });
		await addDevice("relay-ios-no-token-aa", iosPublic);
		await start();
		await settleNativePushForTests();
		relay.reset();

		await timersService.pause(ctx());
		await settleNativePushForTests();

		expect(relay.requests).toHaveLength(1);
		expect(relay.requests[0]).toMatchObject({
			relayId: IOS,
			liveActivity: {
				token: "activity-token-1",
				event: "update",
				contentState: { state: "held", runningSinceMs: null },
			},
		});
	});

	test("409 activity_gone clears the token, and a start then opens a new activity", async () => {
		await addDevice(IOS, iosPublic, { liveActivityToken: "dead-token-1" });
		relay.answer(IOS, { status: 409, error: "activity_gone" });

		await start();
		await settleNativePushForTests();

		expect(
			relay.requests.map((r) => r.liveActivity?.token ?? "push-to-start"),
		).toEqual(["dead-token-1", "push-to-start"]);
		expect((await deviceRow(IOS))?.liveActivityToken).toBeNull();
	});

	test("confirm, discard and the sweep end the activity and forget the token", async () => {
		const today = new Date().toISOString().slice(0, 10);
		const ending: [string, () => Promise<void>][] = [
			[
				"confirm",
				async () => {
					await timersService.confirm(ctx(), {
						date: today,
						taskId: meetingTaskId,
						durationSeconds: 900,
						description: "Planning",
						overtime: false,
					});
				},
			],
			["discard", () => timersService.discard(ctx())],
			[
				"sweep",
				async () => {
					await runTimerSweepOnce({
						now: new Date(Date.now() + 13 * 3600 * 1000),
					});
				},
			],
		];
		for (const [name, end] of ending) {
			await db.delete(mobileDevice);
			await db.delete(runningTimer);
			await addDevice(IOS, iosPublic, {
				liveActivityToken: "activity-token-2",
			});
			await start();
			await settleNativePushForTests();
			relay.reset();

			await end();
			await settleNativePushForTests();

			expect({
				name,
				events: relay.requests.map((r) => r.liveActivity?.event),
			}).toEqual({
				name,
				events: ["end"],
			});
			expect((await deviceRow(IOS))?.liveActivityToken).toBeNull();
		}
	});

	test("Android gets the whole state sealed in a data push", async () => {
		await addDevice(ANDROID, androidPublic, { platform: "android" });
		await start();
		await timersService.pause(ctx());
		await settleNativePushForTests();

		expect(relay.requests.map((r) => [r.kind, r.liveActivity])).toEqual([
			["data", undefined],
			["data", undefined],
		]);
		const paused = await opened(
			androidKey,
			present(relay.requests[1], "pause").ciphertext,
		);
		expect(paused).toMatchObject({
			kind: "timer",
			event: "update",
			state: { state: "held", runningSinceMs: null },
			pushKind: "data",
		});
		// Each push has its own id, so the phone can refuse a replay.
		const started = await opened(
			androidKey,
			present(relay.requests[0], "start").ciphertext,
		);
		expect(started.id).not.toBe(paused.id);
	});
});

describe("with PUSH_RELAY_ENABLED off", () => {
	test("nothing goes to the relay, for an alert, a Slack kind or the timer", async () => {
		await addDevice(IOS, iosPublic);
		relay.setEnabled(false);
		const slack = slackRecorder();
		setNotifyAdaptersForTests({ slack: slack.adapter });

		const reminder = await notify(
			{ organizationId: ORG, userId: ME },
			{ kind: "log-reminder", title: "Log", body: "now" },
		);
		const nudge = await notify(
			{ organizationId: ORG, userId: ME },
			{ kind: "compliance-nudge", body: "nudge" },
		);
		await start();
		await settleNativePushForTests();

		expect(reminder.native).toBe(false);
		expect(nudge.slack).toBe(true);
		expect(relay.requests).toHaveLength(0);
	});

	const start = () =>
		timersService.start(ctx(), { taskId: meetingTaskId, description: "" });
});
