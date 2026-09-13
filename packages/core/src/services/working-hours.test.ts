// Working hours: a person's own seven-day schedule and weekly target.
//
// There is deliberately no path here that writes somebody else's schedule —
// every write takes its user from the Ctx, never from the input — so the
// property worth pinning is that a write lands on exactly one (org, person)
// pair and nothing else reads it. The defaults matter just as much: a missing
// row is Monday to Friday, and reports read everyone through
// `listForOrg`, which must synthesize the same defaults for people with none.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { memberWorkingHoursDay } from "../db/schema/schedule";
import { defaultDayRow } from "../lib/working-day";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import type { Ctx } from "./types";
import { workingHoursService } from "./working-hours.service";

const ORG_A = "wh-a";
const ORG_B = "wh-b";
const ME = "u-wh-me";
const COLLEAGUE = "u-wh-colleague";
const FRESH = "u-wh-fresh";

const MONDAY = 1;
const TUESDAY = 2;
const SATURDAY = 6;

let harness: TestDb;

const ctx = (userId: string, organizationId: string = ORG_A): Ctx => ({
	organizationId,
	userId,
});

const dayOf = async (c: Ctx, dayOfWeek: number) =>
	at(await workingHoursService.list(c), dayOfWeek);

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values([
		{ id: ORG_A, name: "Hours A", slug: ORG_A, createdAt: new Date() },
		{ id: ORG_B, name: "Hours B", slug: ORG_B, createdAt: new Date() },
	]);
	await db.insert(user).values(
		[ME, COLLEAGUE, FRESH].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	// ME works in both orgs, which is what makes the per-org split testable.
	await db.insert(member).values([
		...[ME, COLLEAGUE, FRESH].map((id) => ({
			id: `m-a-${id}`,
			organizationId: ORG_A,
			userId: id,
			role: "member",
			createdAt: new Date(),
		})),
		{
			id: `m-b-${ME}`,
			organizationId: ORG_B,
			userId: ME,
			role: "member",
			createdAt: new Date(),
		},
	]);
});

afterAll(async () => {
	await harness.close();
});

describe("list", () => {
	test("a person with no rows gets all seven days, Monday to Friday on", async () => {
		const days = await workingHoursService.list(ctx(FRESH));
		expect(days).toHaveLength(7);
		expect(days.map((d) => d.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
		expect(days.map((d) => d.enabled)).toEqual([
			false,
			true,
			true,
			true,
			true,
			true,
			false,
		]);
		expect(days).toEqual(days.map((d) => defaultDayRow(d.dayOfWeek)));
	});
});

describe("upsertDay", () => {
	test("writes the caller's own day, in the caller's org, and nobody else's", async () => {
		await workingHoursService.upsertDay(ctx(ME), {
			dayOfWeek: MONDAY,
			enabled: false,
		});

		expect(await dayOf(ctx(ME), MONDAY)).toEqual({
			dayOfWeek: MONDAY,
			enabled: false,
			startTime: null,
			endTime: null,
		});
		// A colleague in the same org, and the same person in another org, both
		// still read the default.
		expect(await dayOf(ctx(COLLEAGUE), MONDAY)).toEqual(defaultDayRow(MONDAY));
		expect(await dayOf(ctx(ME, ORG_B), MONDAY)).toEqual(defaultDayRow(MONDAY));
	});

	test("a second write updates the one row rather than adding another", async () => {
		await workingHoursService.upsertDay(ctx(ME), {
			dayOfWeek: SATURDAY,
			enabled: true,
			startTime: "10:00",
			endTime: "14:00",
		});
		await workingHoursService.upsertDay(ctx(ME), {
			dayOfWeek: SATURDAY,
			enabled: true,
			startTime: "11:00",
			endTime: "13:00",
		});

		const rows = await db.query.memberWorkingHoursDay.findMany({
			where: and(
				eq(memberWorkingHoursDay.organizationId, ORG_A),
				eq(memberWorkingHoursDay.userId, ME),
				eq(memberWorkingHoursDay.dayOfWeek, SATURDAY),
			),
		});
		expect(rows).toHaveLength(1);
		expect(await dayOf(ctx(ME), SATURDAY)).toMatchObject({
			enabled: true,
			startTime: "11:00",
			endTime: "13:00",
		});
	});

	test("omitting the times clears them rather than keeping the old ones", async () => {
		await workingHoursService.upsertDay(ctx(ME), {
			dayOfWeek: SATURDAY,
			enabled: false,
		});
		expect(await dayOf(ctx(ME), SATURDAY)).toMatchObject({
			enabled: false,
			startTime: null,
			endTime: null,
		});
	});
});

describe("listForOrg", () => {
	test("every requested person, defaults filled in, from this org's rows only", async () => {
		// ME turns Tuesday off in org B only; org A's report must not see it.
		await workingHoursService.upsertDay(ctx(ME, ORG_B), {
			dayOfWeek: TUESDAY,
			enabled: false,
		});

		const byUser = await workingHoursService.listForOrg(ctx(COLLEAGUE), [
			ME,
			FRESH,
		]);
		expect([...byUser.keys()].sort()).toEqual([FRESH, ME].sort());

		const mine = present(byUser.get(ME), "ME's schedule");
		expect(mine).toHaveLength(7);
		expect(at(mine, MONDAY).enabled).toBe(false);
		expect(at(mine, TUESDAY).enabled).toBe(true);

		expect(present(byUser.get(FRESH), "FRESH's schedule")).toEqual(
			Array.from({ length: 7 }, (_, d) => defaultDayRow(d)),
		);
	});
});
