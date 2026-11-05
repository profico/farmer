// `slackService.pingBehind`: a Slack DM to a person who is behind their target,
// at most once in 24 hours, only by somebody who sees them on Tracking.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	spyOn,
	test,
} from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { auditEvent } from "../db/schema/audit";
import { member, organization, user } from "../db/schema/auth";
import { memberProfile, memberTypeHistory } from "../db/schema/people";
import { monthlyHourFund } from "../db/schema/settings";
import {
	memberSlackIdentity,
	slackInstallation,
	slackPing,
} from "../db/schema/slack";
import { createTestDb, type TestDb } from "../test/harness";
import * as notifyModule from "./notify";
import { setNotifyAdaptersForTests } from "./notify";
import { PingTooSoonError, slackService } from "./slack.service";
import type { Ctx } from "./types";

const ORG = "org-ping";
const OTHER_ORG = "org-ping-other";
const ADMIN = "u-ping-admin";
/** A member with Slack and no hours logged: behind. */
const BEHIND = "u-ping-behind";
/** A member with Slack and no target: never behind. */
const NO_TARGET = "u-ping-no-target";
/** A plain member, who sees only themselves on Tracking. */
const PLAIN = "u-ping-plain";
/** Behind, in the other organization. */
const STRANGER = "u-ping-stranger";
/** Behind, matched to Slack, and a Harvest import member who has not accepted. */
const CLAIMING = "u-ping-claiming";

const NOW = new Date("2026-04-16T12:00:00Z");
const HOUR = 60 * 60 * 1000;

const ctxOf = (userId: string, organizationId = ORG): Ctx => ({
	organizationId,
	userId,
});

let harness: TestDb;
const sent: string[] = [];

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(organization).values(
		[ORG, OTHER_ORG].map((id) => ({
			id,
			name: id,
			slug: id,
			timezone: "UTC",
			country: "US",
			createdAt: new Date(),
		})),
	);
	const everyone = [ADMIN, BEHIND, NO_TARGET, PLAIN, STRANGER, CLAIMING];
	await db.insert(user).values(
		everyone.map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	await db.insert(member).values(
		everyone.map((id) => ({
			id: `m-${id}`,
			organizationId: id === STRANGER ? OTHER_ORG : ORG,
			userId: id,
			role: id === ADMIN ? "admin" : "member",
			createdAt: new Date(),
		})),
	);
	await db.insert(monthlyHourFund).values(
		[ORG, OTHER_ORG].map((organizationId) => ({
			organizationId,
			year: 2026,
			month: 4,
			fundSeconds: 176 * 3600,
		})),
	);
	await db.insert(memberTypeHistory).values({
		organizationId: ORG,
		userId: NO_TARGET,
		type: "contractor_hourly" as const,
		effectiveFrom: "2020-01-01",
	});
	await db.insert(slackInstallation).values(
		[ORG, OTHER_ORG].map((organizationId) => ({
			organizationId,
			teamId: `T-${organizationId}`,
			botToken: "xoxb-test",
		})),
	);
	await db.insert(memberSlackIdentity).values(
		[BEHIND, NO_TARGET, PLAIN, ADMIN, STRANGER, CLAIMING].map((userId) => ({
			organizationId: userId === STRANGER ? OTHER_ORG : ORG,
			userId,
			slackUserId: `S-${userId}`,
		})),
	);
	await db.insert(memberProfile).values({
		organizationId: ORG,
		userId: CLAIMING,
		claimPendingSince: new Date("2026-01-01T00:00:00Z"),
	});
});

const deliveringAdapter = {
	slack: async (to: { userId: string }) => {
		sent.push(to.userId);
		return true;
	},
};

beforeEach(async () => {
	sent.length = 0;
	await db.delete(slackPing);
	setNotifyAdaptersForTests(deliveringAdapter);
});

afterAll(async () => {
	setNotifyAdaptersForTests();
	await harness.close();
});

describe("pingBehind", () => {
	test("sends a DM, records an audit entry, and refuses a second ping within 24 hours", async () => {
		await slackService.pingBehind(ctxOf(ADMIN), BEHIND, { now: NOW });
		expect(sent).toEqual([BEHIND]);

		const audit = await db.query.auditEvent.findFirst({
			where: and(
				eq(auditEvent.organizationId, ORG),
				eq(auditEvent.kind, "slack.pinged"),
			),
		});
		expect(audit?.targetId).toBe(BEHIND);

		const again = slackService.pingBehind(ctxOf(ADMIN), BEHIND, {
			now: new Date(NOW.getTime() + 23 * HOUR),
		});
		await expect(again).rejects.toBeInstanceOf(PingTooSoonError);
		expect(sent).toEqual([BEHIND]);

		const states = await slackService.pingStates(ctxOf(ADMIN), { now: NOW });
		expect(states.people.find((s) => s.userId === BEHIND)?.pingedAt).toEqual(
			NOW,
		);
		expect([states.year, states.month]).toEqual([2026, 4]);
		// The org is in UTC, so the month changes at midnight UTC.
		const edge = new Date("2026-05-01T00:30:00Z");
		const next = await slackService.pingStates(ctxOf(ADMIN), { now: edge });
		expect([next.year, next.month]).toEqual([2026, 5]);
	});

	test("allows a new ping after 24 hours", async () => {
		await slackService.pingBehind(ctxOf(ADMIN), BEHIND, { now: NOW });
		await slackService.pingBehind(ctxOf(ADMIN), BEHIND, {
			now: new Date(NOW.getTime() + 25 * HOUR),
		});
		expect(sent).toEqual([BEHIND, BEHIND]);
	});

	test("refuses a person who is not behind, and yourself", async () => {
		await expect(
			slackService.pingBehind(ctxOf(ADMIN), NO_TARGET, { now: NOW }),
		).rejects.toThrow("not behind");
		await expect(
			slackService.pingBehind(ctxOf(ADMIN), ADMIN, { now: NOW }),
		).rejects.toThrow("yourself");
	});

	test("refuses a caller who does not see the person on Tracking", async () => {
		await expect(
			slackService.pingBehind(ctxOf(PLAIN), BEHIND, { now: NOW }),
		).rejects.toThrow("cannot see");
		expect((await slackService.pingStates(ctxOf(PLAIN))).people).toEqual([]);
	});

	test("does not cross organizations", async () => {
		await expect(
			slackService.pingBehind(ctxOf(ADMIN), STRANGER, { now: NOW }),
		).rejects.toThrow("cannot see");
		const states = await slackService.pingStates(ctxOf(ADMIN));
		expect(states.people.some((s) => s.userId === STRANGER)).toBe(false);
	});

	test("gives the ping back when Slack does not deliver", async () => {
		setNotifyAdaptersForTests({ slack: async () => false });
		const later = new Date(NOW.getTime() + 100 * HOUR);
		await expect(
			slackService.pingBehind(ctxOf(ADMIN), BEHIND, { now: later }),
		).rejects.toThrow("could not be sent");
		setNotifyAdaptersForTests(deliveringAdapter);
		await slackService.pingBehind(ctxOf(ADMIN), BEHIND, { now: later });
		expect(sent).toEqual([BEHIND]);
	});

	test("says the person cannot be reached when Slack calls them unreachable", async () => {
		setNotifyAdaptersForTests({ slack: async () => "unreachable" });
		await expect(
			slackService.pingBehind(ctxOf(ADMIN), BEHIND, { now: NOW }),
		).rejects.toThrow("cannot be reached");
		expect(await db.query.slackPing.findFirst()).toBeUndefined();
	});

	test("refuses a person that notify holds back, and does not list them", async () => {
		await expect(
			slackService.pingBehind(ctxOf(ADMIN), CLAIMING, { now: NOW }),
		).rejects.toThrow("cannot be reached");
		expect(sent).toEqual([]);
		expect(await db.query.slackPing.findFirst()).toBeUndefined();
		const states = await slackService.pingStates(ctxOf(ADMIN), { now: NOW });
		expect(states.people.some((s) => s.userId === CLAIMING)).toBe(false);
		expect(states.people.some((s) => s.userId === BEHIND)).toBe(true);
	});

	test("gives the ping back when the send throws", async () => {
		const spy = spyOn(notifyModule, "notify").mockRejectedValueOnce(
			new Error("boom"),
		);
		try {
			await expect(
				slackService.pingBehind(ctxOf(ADMIN), BEHIND, { now: NOW }),
			).rejects.toThrow("boom");
		} finally {
			spy.mockRestore();
		}
		expect(await db.query.slackPing.findFirst()).toBeUndefined();
		await slackService.pingBehind(ctxOf(ADMIN), BEHIND, { now: NOW });
		expect(sent).toEqual([BEHIND]);
	});
});
