// A GET with a read-only API token writes nothing. `listRange` recomputes the
// fill blocks of the days it reads; the org-scoped route must pass
// `persist: false` for that token, through the real route handler.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { db } from "@farmer/core/db";
import { member, organization, user } from "@farmer/core/schema/auth";
import { task, timeEntry } from "@farmer/core/schema/domain";
import { memberWorkingHoursDay } from "@farmer/core/schema/schedule";
import { addDaysToKey, dayKeyInTz } from "@farmer/core/lib/time";
import { apiTokensService } from "@farmer/core/services";
import { createTestDb, present, type TestDb } from "@farmer/core/test/harness";

import { Route } from "#/routes/api/v1/orgs/$orgSlug/time-entries/index.ts";

const ORG_ID = "org-ro-reads";
const USER_ID = "user-ro-reads";
const TZ = "Europe/Zagreb";

type Handler = (args: {
	request: Request;
	params: { orgSlug: string };
}) => Promise<Response>;

let harness: TestDb;
let date = "";
let readToken = "";
let writeToken = "";

/** The newest weekday in the automation window. */
const recentWeekday = () => {
	let key = dayKeyInTz(new Date(), TZ);
	while ([0, 6].includes(new Date(`${key}T00:00:00Z`).getUTCDay())) {
		key = addDaysToKey(key, -1);
	}
	return key;
};

const getEntries = (token: string) => {
	// SAFETY: the GET handler of an `api/v1` route is made by `apiRoute`, a
	// function of `{ request, params }` that answers a Response.
	const handlers = Route.options.server?.handlers as
		| Record<string, Handler | undefined>
		| undefined;
	const handler = present(handlers?.GET, "the GET handler");
	return handler({
		request: new Request(
			`http://localhost/api/v1/orgs/${ORG_ID}/time-entries?from=${date}&to=${date}`,
			{ headers: { authorization: `Bearer ${token}` } },
		),
		params: { orgSlug: ORG_ID },
	});
};

const storedFillSeconds = async () => {
	const rows = await db.query.timeEntry.findMany();
	return rows.find((row) => row.fillsDay)?.durationSeconds;
};

beforeAll(async () => {
	harness = await createTestDb();
	const now = new Date();
	await db.insert(organization).values({
		id: ORG_ID,
		name: "Read Only Org",
		slug: ORG_ID,
		createdAt: now,
		timezone: TZ,
		country: "HR",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Reader",
		email: "ro-reads@example.com",
		emailVerified: true,
		createdAt: now,
		updatedAt: now,
	});
	await db.insert(member).values({
		id: "member-ro-reads",
		organizationId: ORG_ID,
		userId: USER_ID,
		role: "owner",
		createdAt: now,
	});
	for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
		const weekday = dayOfWeek >= 1 && dayOfWeek <= 5;
		await db.insert(memberWorkingHoursDay).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			dayOfWeek,
			enabled: weekday,
			startTime: weekday ? "09:00" : null,
			endTime: weekday ? "17:00" : null,
		});
	}
	const [dev] = await db
		.insert(task)
		.values({
			scope: "organization" as const,
			organizationId: ORG_ID,
			name: "Development",
			systemKey: "development" as const,
			isAbsence: false,
		})
		.returning({ id: task.id });
	const taskId = present(dev, "the task").id;
	date = recentWeekday();
	// A fill block of 8 h beside 2 h of real work is stale: a write read
	// resizes it to 6 h.
	await db.insert(timeEntry).values([
		{
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId,
			projectId: null,
			date,
			durationSeconds: 8 * 3600,
			description: "Rest of day",
			fillsDay: true,
		},
		{
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId,
			projectId: null,
			date,
			durationSeconds: 2 * 3600,
			description: "real work",
		},
	]);
	const ctx = { organizationId: "", userId: USER_ID };
	const input = { workspace: "all", expiresInDays: null } as const;
	readToken = (
		await apiTokensService.create(ctx, { ...input, name: "ro", scope: "read" })
	).token;
	writeToken = (
		await apiTokensService.create(ctx, { ...input, name: "rw", scope: "write" })
	).token;
}, 60_000);

afterAll(async () => {
	await harness.close();
});

describe("GET /api/v1/orgs/$orgSlug/time-entries", () => {
	test("a read-only token sees the resized block and writes nothing", async () => {
		const response = await getEntries(readToken);
		expect(response.status).toBe(200);
		expect(await storedFillSeconds()).toBe(8 * 3600);
	});

	test("a write token still keeps the fill block in sync", async () => {
		const response = await getEntries(writeToken);
		expect(response.status).toBe(200);
		expect(await storedFillSeconds()).toBe(6 * 3600);
	});
});
