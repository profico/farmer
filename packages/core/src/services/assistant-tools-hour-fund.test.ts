// The assistant's hour fund tools.
//
// The fund is one figure per organization and month, and the Settings page for
// it is for Admins. The service functions that read it have no role check, so
// the read tool holds the line itself. The writes are admin only in the
// service, and they record the audit log; both are checked here through the
// tool.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { auditEvent } from "../db/schema/audit";
import { member, organization, user } from "../db/schema/auth";
import { monthlyHourFund } from "../db/schema/settings";
import { createTestDb, present, type TestDb } from "../test/harness";
import { Access, AccessError } from "./access.service";
import { findTool, toolsFor } from "./assistant-tools";
import type { Ctx } from "./types";

const ORG = "org-ast-fund";
const OTHER_ORG = "org-ast-fund-other";
const ADMIN = "user-ast-fund-admin";
const MEMBER = "user-ast-fund-member";
const STRANGER = "user-ast-fund-stranger";

const ctxOf = (userId: string, organizationId = ORG): Ctx => ({
	organizationId,
	userId,
});
const tool = (name: string) => present(findTool(name), `tool ${name}`);

const yearResult = z.object({
	year: z.number(),
	months: z.array(z.object({ month: z.number(), fundHours: z.number() })),
});
const monthResult = z.object({
	year: z.number(),
	month: z.number(),
	fundHours: z.number().nullable(),
	suggestion: z.object({ workingDays: z.number(), fundHours: z.number() }),
});

let harness: TestDb;

const fundRows = (organizationId: string) =>
	db
		.select()
		.from(monthlyHourFund)
		.where(eq(monthlyHourFund.organizationId, organizationId));

const auditKinds = async (organizationId: string) =>
	(
		await db
			.select()
			.from(auditEvent)
			.where(eq(auditEvent.organizationId, organizationId))
	).map((event) => event.kind);

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(organization).values([
		{ id: ORG, name: "Fund tools", slug: ORG, createdAt: new Date() },
		{ id: OTHER_ORG, name: "Away", slug: OTHER_ORG, createdAt: new Date() },
	]);
	for (const [id, orgId, role] of [
		[ADMIN, ORG, "owner"],
		[MEMBER, ORG, "member"],
		[STRANGER, OTHER_ORG, "owner"],
	] as const) {
		await db.insert(user).values({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await db.insert(member).values({
			id: `member-${id}`,
			organizationId: orgId,
			userId: id,
			role,
			createdAt: new Date(),
		});
	}
	await db.insert(monthlyHourFund).values([
		{ organizationId: ORG, year: 2026, month: 9, fundSeconds: 160 * 3600 },
		{ organizationId: ORG, year: 2026, month: 10, fundSeconds: 176 * 3600 },
		{
			organizationId: OTHER_ORG,
			year: 2026,
			month: 9,
			fundSeconds: 100 * 3600,
		},
	]);
});

afterAll(async () => {
	await harness.close();
});

describe("the tiers and the role", () => {
	test("the read is a read, set asks, clear is destructive, all for Admins", () => {
		expect(tool("get_hour_fund").kind).toBe("read");
		expect(tool("set_hour_fund").kind).toBe("write");
		expect(tool("set_hour_fund").confirm).toBe(true);
		expect(tool("set_hour_fund").summarize).toBeDefined();
		expect(tool("clear_hour_fund").kind).toBe("destructive");
		const offered = (isAdmin: boolean) =>
			toolsFor(new Access("u-1", "org-1", isAdmin, new Map())).map(
				(row) => row.name,
			);
		for (const name of ["get_hour_fund", "set_hour_fund", "clear_hour_fund"]) {
			expect(offered(true)).toContain(name);
			expect(offered(false)).not.toContain(name);
		}
	});

	test("a member who calls anyway is refused", async () => {
		await expect(
			tool("get_hour_fund").run(ctxOf(MEMBER), { year: 2026 }),
		).rejects.toBeInstanceOf(AccessError);
		await expect(
			tool("set_hour_fund").run(ctxOf(MEMBER), {
				year: 2026,
				month: 9,
				fundSeconds: 3600,
			}),
		).rejects.toBeInstanceOf(AccessError);
		await expect(
			tool("clear_hour_fund").run(ctxOf(MEMBER), { year: 2026, month: 9 }),
		).rejects.toBeInstanceOf(AccessError);
		expect((await fundRows(ORG)).map((row) => row.fundSeconds)).toEqual(
			expect.arrayContaining([160 * 3600, 176 * 3600]),
		);
	});
});

describe("get_hour_fund", () => {
	test("lists the months of a year that have a fund, in hours", async () => {
		const answer = yearResult.parse(
			await tool("get_hour_fund").run(ctxOf(ADMIN), { year: 2026 }),
		);
		expect(answer.months).toEqual([
			{ month: 9, fundHours: 160 },
			{ month: 10, fundHours: 176 },
		]);
	});

	test("reads one month with the suggestion beside it", async () => {
		const answer = monthResult.parse(
			await tool("get_hour_fund").run(ctxOf(ADMIN), { year: 2026, month: 9 }),
		);
		expect(answer.fundHours).toBe(160);
		expect(answer.suggestion.fundHours).toBe(answer.suggestion.workingDays * 8);
		expect(answer.suggestion.workingDays).toBeGreaterThan(15);
	});

	test("a month with no fund is null, not zero", async () => {
		const answer = monthResult.parse(
			await tool("get_hour_fund").run(ctxOf(ADMIN), { year: 2026, month: 3 }),
		);
		expect(answer.fundHours).toBeNull();
	});

	test("never shows another organization's fund", async () => {
		const away = monthResult.parse(
			await tool("get_hour_fund").run(ctxOf(STRANGER, OTHER_ORG), {
				year: 2026,
				month: 9,
			}),
		);
		expect(away.fundHours).toBe(100);
		const none = yearResult.parse(
			await tool("get_hour_fund").run(ctxOf(STRANGER, OTHER_ORG), {
				year: 2025,
			}),
		);
		expect(none.months).toEqual([]);
	});
});

describe("set_hour_fund", () => {
	test("the card names the month, the new figure and the old one", async () => {
		expect(
			await tool("set_hour_fund").summarize?.(ctxOf(ADMIN), {
				year: 2026,
				month: 9,
				fundSeconds: 168 * 3600,
			}),
		).toBe("Set the hour fund for September 2026 to 168.00h (now 160.00h)");
		expect(
			await tool("set_hour_fund").summarize?.(ctxOf(ADMIN), {
				year: 2026,
				month: 12,
				fundSeconds: 152 * 3600,
			}),
		).toBe("Set the hour fund for December 2026 to 152.00h (now not set)");
	});

	test("an Admin sets a month, and the audit log records it", async () => {
		const answer = await tool("set_hour_fund").run(ctxOf(ADMIN), {
			year: 2026,
			month: 12,
			fundSeconds: 152 * 3600,
		});
		expect(answer).toEqual({
			set: true,
			year: 2026,
			month: 12,
			fundHours: 152,
		});
		expect(await auditKinds(ORG)).toContain("hour_fund.set");
		// Another organization's months are untouched.
		expect(await fundRows(OTHER_ORG)).toHaveLength(1);
	});

	test("refuses a figure over the ceiling", () => {
		expect(
			tool("set_hour_fund").schema.safeParse({
				year: 2026,
				month: 1,
				fundSeconds: 401 * 3600,
			}).success,
		).toBe(false);
	});
});

describe("clear_hour_fund", () => {
	test("an Admin clears a month, and the audit log records it", async () => {
		const answer = await tool("clear_hour_fund").run(ctxOf(ADMIN), {
			year: 2026,
			month: 12,
		});
		expect(answer).toEqual({
			cleared: true,
			year: 2026,
			month: 12,
			wasHours: 152,
		});
		expect(await auditKinds(ORG)).toContain("hour_fund.cleared");
	});

	test("a month with no fund is refused, not reported as cleared", async () => {
		await expect(
			tool("clear_hour_fund").run(ctxOf(ADMIN), { year: 2026, month: 12 }),
		).rejects.toThrow("nothing was cleared");
	});

	test("cannot reach another organization's month", async () => {
		await expect(
			tool("clear_hour_fund").run(ctxOf(ADMIN), { year: 2026, month: 9 }),
		).resolves.toMatchObject({ wasHours: 160 });
		// The other organization still has its September.
		expect((await fundRows(OTHER_ORG)).map((row) => row.fundSeconds)).toEqual([
			100 * 3600,
		]);
	});
});
