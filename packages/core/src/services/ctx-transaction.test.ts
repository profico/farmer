// Every service function that opens a transaction, driven with a COLD Ctx.
//
// This is the shape of the bug it exists to catch: `ctxTimezone` resolved
// through the ambient `db` handle, and `remove`, `copyDay` and `setWeekCell`
// all call it from INSIDE their own `withCtxTx`. `db.transaction` reserves a
// connection for its whole duration, so an ambient read at that point needs a
// second connection while still holding the first. The pool is 10 wide with no
// `connect_timeout`, so ten concurrent such requests hold all ten connections
// and every one of them waits forever for an eleventh.
//
// Two things hid it. In production the memo is usually warm by the time a
// transaction opens, so the ambient read never happens — but
// `requireOrgContext` returns a bare `{ organizationId, userId }` literal per
// request, so "usually" is doing a lot of work. And in tests, every file shares
// one module-level `ctx` object that an earlier call already populated, which
// is why 228 passing tests never touched it.
//
// So the rule this file enforces is: a Ctx that has never been used before must
// survive every transactional entry point. `freshCtx()` below is deliberately
// not shared and deliberately not warmed.
//
// PGLite makes the failure deterministic rather than load-dependent: it has ONE
// connection, so an ambient read inside a transaction deadlocks on the first
// try instead of at concurrency 10. Each test therefore carries an explicit
// timeout — a regression here hangs, it does not throw, and a hang with no
// deadline would take the whole suite down with it.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import {
	client,
	project,
	projectMember,
	task,
	timeEntry,
} from "../db/schema/domain";
import { memberWorkingHoursDay } from "../db/schema/schedule";
import { createTestDb, type TestDb } from "../test/harness";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-ctxtx";

const USER_ID = "user-ctxtx";

/** A Ctx exactly as `requireOrgContext` builds one: a plain literal, no memo.
 *  Never reuse one of these across two calls, or the second call is testing the
 *  memo rather than the code path. */
const freshCtx = (): Ctx => ({ organizationId: ORG_ID, userId: USER_ID });

/** Generous enough for a slow machine, far below a deadlock. */
const NO_DEADLOCK_MS = 15_000;

const MONDAY = "2026-08-17";

const TUESDAY = "2026-08-18";

let harness: TestDb;

let devTaskId = "";

let projectId = "";

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Ctx Tx Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "ctxtx@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "member-ctxtx",
		organizationId: ORG_ID,
		userId: USER_ID,
		// Deliberately not an admin: an admin short-circuits `canTrackOn`, so the
		// access lookup this exercises would not run.
		role: "member",
		createdAt: new Date(),
	});

	const [c] = await db
		.insert(client)
		.values({ organizationId: ORG_ID, name: "Acme" })
		.returning();

	const [p] = await db
		.insert(project)
		.values({ organizationId: ORG_ID, clientId: c?.id ?? "", name: "Farmer" })
		.returning();

	projectId = p?.id ?? "";
	await db.insert(projectMember).values({
		organizationId: ORG_ID,
		projectId,
		userId: USER_ID,
		role: "member",
		active: true,
	});

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

	devTaskId = dev?.id ?? "";

	for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
		const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
		await db.insert(memberWorkingHoursDay).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			dayOfWeek,
			enabled: isWeekday,
			startTime: isWeekday ? "09:00" : null,
			endTime: isWeekday ? "17:00" : null,
		});
	}
});

afterAll(async () => {
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
});

const seedEntry = (date: string, durationSeconds = 2 * 3600) =>
	timeEntriesService.create(freshCtx(), {
		taskId: devTaskId,
		projectId,
		description: "seed",
		date,
		durationSeconds,
		overtime: false,
		fillsDay: false,
	});

const entriesOn = (date: string) =>
	db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ORG_ID),
			eq(timeEntry.userId, USER_ID),
			eq(timeEntry.date, date),
		),
	});

describe("transactional entry points survive a cold Ctx", () => {
	test(
		"create",
		async () => {
			const row = await seedEntry(MONDAY);
			expect(row.durationSeconds).toBe(2 * 3600);
		},
		NO_DEADLOCK_MS,
	);

	test(
		"remove",
		async () => {
			const row = await seedEntry(MONDAY);
			const removed = await timeEntriesService.remove(freshCtx(), row.id);
			expect(removed?.id).toBe(row.id);
			expect(await entriesOn(MONDAY)).toHaveLength(0);
		},
		NO_DEADLOCK_MS,
	);

	test(
		"copyDay",
		async () => {
			await seedEntry(MONDAY);

			const result = await timeEntriesService.copyDay(freshCtx(), {
				fromDate: MONDAY,
				toDate: TUESDAY,
			});

			expect(result.copied).toBe(1);
			expect(await entriesOn(TUESDAY)).toHaveLength(1);
		},
		NO_DEADLOCK_MS,
	);

	test(
		"copyWeek",
		async () => {
			await seedEntry(MONDAY);

			const result = await timeEntriesService.copyWeek(freshCtx(), {
				fromWeekStart: MONDAY,
				toWeekStart: "2026-08-24",
			});

			expect(result.copied).toBe(1);
		},
		NO_DEADLOCK_MS,
	);

	test(
		"setWeekCell — writes a new cell",
		async () => {
			// The densest case: setWeekCell opens the transaction, then reaches
			// `create(txCtx, …)`, which runs the taxonomy guard, the access lookup
			// and the timezone resolve — three separate helpers that each used to
			// read the ambient handle from inside it.
			const result = await timeEntriesService.setWeekCell(freshCtx(), {
				date: MONDAY,
				projectId,
				taskId: devTaskId,
				durationSeconds: 3 * 3600,
			});

			expect(result.entryId).toBeString();
			expect(await entriesOn(MONDAY)).toHaveLength(1);
		},
		NO_DEADLOCK_MS,
	);

	test(
		"setWeekCell — clears a cell, collapsing duplicates through remove()",
		async () => {
			await seedEntry(MONDAY);
			await seedEntry(MONDAY);

			const result = await timeEntriesService.setWeekCell(freshCtx(), {
				date: MONDAY,
				projectId,
				taskId: devTaskId,
				durationSeconds: 0,
			});

			expect(result.cleared).toBe(2);
			expect(await entriesOn(MONDAY)).toHaveLength(0);
		},
		NO_DEADLOCK_MS,
	);

	test(
		"update",
		async () => {
			const row = await seedEntry(MONDAY);

			const updated = await timeEntriesService.update(freshCtx(), {
				timeEntryId: row.id,
				taskId: devTaskId,
				projectId,
				description: "edited",
				date: MONDAY,
				durationSeconds: 4 * 3600,
				overtime: false,
				fillsDay: false,
			});

			expect(updated?.durationSeconds).toBe(4 * 3600);
		},
		NO_DEADLOCK_MS,
	);
});
