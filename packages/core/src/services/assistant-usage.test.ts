import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { assistantConversation, assistantUsage } from "../db/schema/assistant";
import { member, organization, user } from "../db/schema/auth";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { AccessError } from "./access.service";
import { assistantUsageService } from "./assistant-usage.service";
import type { Ctx } from "./types";

const ORG = "au-org";
const OTHER = "au-other";
const ADMIN = "u-au-admin";
const WORKER = "u-au-worker";
const FOREIGN = "u-au-foreign";

let harness: TestDb;
let chatId = "";

const ctx = (userId: string, organizationId = ORG): Ctx => ({
	organizationId,
	userId,
});
const range = { from: "2026-01-01", to: "2026-12-31" };
const at12 = new Date("2026-06-15T12:00:00Z");

const row = (
	over: Partial<typeof assistantUsage.$inferInsert> & { userId: string },
): typeof assistantUsage.$inferInsert => ({
	organizationId: ORG,
	model: "m/one",
	kind: "turn",
	attempt: 1,
	promptTokens: 100,
	completionTokens: 10,
	costUsd: 0.5,
	createdAt: at12,
	...over,
});

beforeAll(async () => {
	harness = await createTestDb();
	const now = new Date();
	await db.insert(organization).values([
		{ id: ORG, name: "Usage", slug: ORG, createdAt: now },
		{ id: OTHER, name: "Elsewhere", slug: OTHER, createdAt: now },
	]);
	await db.insert(user).values(
		[ADMIN, WORKER, FOREIGN].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		})),
	);
	await db.insert(member).values([
		{
			id: "m-au-admin",
			organizationId: ORG,
			userId: ADMIN,
			role: "admin",
			createdAt: now,
		},
		{
			id: "m-au-worker",
			organizationId: ORG,
			userId: WORKER,
			role: "member",
			createdAt: now,
		},
		{
			id: "m-au-foreign",
			organizationId: OTHER,
			userId: FOREIGN,
			role: "admin",
			createdAt: now,
		},
	]);
	const [chat] = await db
		.insert(assistantConversation)
		.values({ organizationId: ORG, userId: WORKER, model: "m/one" })
		.returning();
	chatId = present(chat, "conversation").id;
	await db.insert(assistantUsage).values([
		row({ userId: WORKER, conversationId: chatId, costUsd: 0.25 }),
		row({
			userId: WORKER,
			conversationId: chatId,
			costUsd: null,
			attempt: 2,
		}),
		row({ userId: ADMIN, model: "m/two", kind: "title", costUsd: 1 }),
		row({ userId: WORKER, createdAt: new Date("2025-01-01T00:00:00Z") }),
		row({ userId: FOREIGN, organizationId: OTHER, costUsd: 99 }),
	]);
});

afterAll(async () => {
	await harness.close();
});

describe("assistantUsageService.summary", () => {
	test("sums the cost, counts the calls, and keeps unknown cost apart", async () => {
		const result = await assistantUsageService.summary(ctx(ADMIN), range);
		expect(result.totals.calls).toBe(3);
		expect(result.totals.costUsd).toBeCloseTo(1.25);
		expect(result.totals.unknownCostCalls).toBe(1);
		const worker = present(
			result.people.find((p) => p.userId === WORKER),
			"worker row",
		);
		expect(worker.calls).toBe(2);
		expect(worker.unknownCostCalls).toBe(1);
		expect(worker.costUsd).toBeCloseTo(0.25);
		expect(at(result.people, 0).userId).toBe(ADMIN);
		expect(result.models.map((m) => m.model).sort()).toEqual([
			"m/one",
			"m/two",
		]);
	});

	test("a deleted conversation keeps its rows", async () => {
		await db
			.delete(assistantConversation)
			.where(eq(assistantConversation.id, chatId));
		const result = await assistantUsageService.summary(ctx(ADMIN), range);
		expect(result.totals.calls).toBe(3);
	});

	test("another organization's rows never show", async () => {
		const result = await assistantUsageService.summary(
			ctx(FOREIGN, OTHER),
			range,
		);
		expect(result.totals.calls).toBe(1);
		expect(result.totals.costUsd).toBe(99);
		expect(result.people.map((p) => p.userId)).toEqual([FOREIGN]);
	});

	test("a Member is refused", async () => {
		await expect(
			assistantUsageService.summary(ctx(WORKER), range),
		).rejects.toBeInstanceOf(AccessError);
	});
});
