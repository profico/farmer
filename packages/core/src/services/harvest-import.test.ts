// The Harvest import's write side (docs/plans/harvest-import.md). The browser
// builds the plan; this file pins what the server does with one, and the
// properties that matter are the ones a bad plan must not break:
//
//   1. ADMIN ONLY, AND ONLY THIS ORG. A `match` naming a row of another org
//      fails, and a chunk naming a source key `start` never mapped fails.
//   2. A MATCHED PERSON IS NOT CHANGED, except an empty start date.
//   3. A GUESSED ADDRESS STAYS UNVERIFIED, and never attaches to a user that
//      exists already (plan section 3.3).
//   4. A SECOND IMPORT OF THE SAME DATA ADDS NOTHING; a changed day is
//      replaced, and a day somebody edited here is kept.
//   5. THE HISTORY CLOSE is finalized with Harvest's billable hours as Final
//      and the snapshots `finalize` would write.
//   6. UNDO TAKES BACK ONLY WHAT THE RUN MADE, and refuses while something
//      made here depends on it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { db } from "../db";
import { account, member, organization, user } from "../db/schema/auth";
import { monthlyClose, monthlyCloseRow } from "../db/schema/close";
import {
	client,
	project,
	projectMember,
	projectTask,
	task,
	timeEntry,
} from "../db/schema/domain";
import { importRun } from "../db/schema/import";
import { memberProfile } from "../db/schema/people";
import type { HarvestStartInput } from "../schema/harvest-import";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { AccessError } from "./access.service";
import { harvestImportService } from "./harvest-import.service";
import { hourFundService } from "./hour-fund.service";
import { membersService } from "./members.service";
import { orgSettingsService } from "./org-settings.service";
import type { Ctx } from "./types";

const H = 3600;
const ORG = "hi-org";
const OTHER_ORG = "hi-other";
const ADMIN = "u-hi-admin";
const WORKER = "u-hi-worker";
/** A user of another org, whose address the people list happens to hold. */
const OUTSIDER = "u-hi-outsider";
const OUTSIDER_EMAIL = "outsider@example.com";

const admin: Ctx = { organizationId: ORG, userId: ADMIN };
const worker: Ctx = { organizationId: ORG, userId: WORKER };

let harness: TestDb;
let acmeId: string;
let alphaId: string;
let devTaskId: string;
let paidLeaveId: string;
let foreignClientId: string;

const K = {
	acme: "acme",
	globex: "globex",
	internal: "profico",
	alpha: '["acme","alpha",""]',
	gamma: '["globex","gamma","GAM"]',
	ops: '["profico","ops",""]',
	dev: "Development",
	design: "Design",
	paid: "Paid Leave",
	worker: "worker one",
	ana: "ana listed",
	bo: "bo guess",
	out: "out sider",
};

const plan = (): HarvestStartInput => ({
	source: "harvest",
	cutoffDate: "2025-04-01",
	clients: [
		{ action: "match", sourceKey: K.acme, localId: acmeId },
		{ action: "create", sourceKey: K.globex, name: "Globex", archived: false },
		{ action: "internal", sourceKey: K.internal },
	],
	tasks: [
		{ action: "match", sourceKey: K.dev, localId: devTaskId },
		{ action: "create", sourceKey: K.design, name: "Design", archived: false },
		{ action: "match", sourceKey: K.paid, localId: paidLeaveId },
	],
	projects: [
		{ action: "match", sourceKey: K.alpha, localId: alphaId },
		{
			action: "create",
			sourceKey: K.gamma,
			clientSourceKey: K.globex,
			name: "Gamma",
			code: "GAM",
			type: "product_team",
			archived: false,
			budgetSeconds: null,
		},
		{
			action: "create",
			sourceKey: K.ops,
			clientSourceKey: K.internal,
			name: "Ops",
			code: null,
			type: "internal",
			archived: true,
			budgetSeconds: null,
		},
	],
	people: [
		{
			action: "match",
			sourceKey: K.worker,
			localId: WORKER,
			startDate: "2020-01-01",
		},
		{
			action: "create",
			sourceKey: K.ana,
			name: "Ana Listed",
			email: "Ana@Example.com",
			emailListed: true,
			role: "member",
			type: "billable",
			startDate: "2024-01-01",
			archivedOn: null,
			weeklyTargetSeconds: 40 * H,
		},
		{
			action: "create",
			sourceKey: K.bo,
			name: "Bo Guess",
			email: "bo.guess@example.com",
			emailListed: false,
			role: "member",
			type: "billable",
			startDate: "2024-01-01",
			archivedOn: "2025-06-30",
			weeklyTargetSeconds: 40 * H,
		},
		{
			action: "create",
			sourceKey: K.out,
			name: "Out Sider",
			email: OUTSIDER_EMAIL,
			emailListed: true,
			role: "member",
			type: "billable",
			startDate: "2024-01-01",
			archivedOn: null,
			weeklyTargetSeconds: 40 * H,
		},
	],
	projectMembers: [
		{ projectSourceKey: K.gamma, personSourceKey: K.ana, active: true },
		{ projectSourceKey: K.alpha, personSourceKey: K.out, active: true },
	],
	projectTasks: [
		{ projectSourceKey: K.gamma, taskSourceKey: K.dev },
		{ projectSourceKey: K.gamma, taskSourceKey: K.design },
	],
});

/** A plan that only matches what an earlier run mapped. */
const emptyPlan = (): HarvestStartInput => ({
	source: "harvest",
	cutoffDate: "2025-04-01",
	clients: [],
	tasks: [],
	projects: [],
	people: [],
	projectMembers: [],
	projectTasks: [],
});

const row = (
	key: string,
	projectSourceKey: string | null,
	taskSourceKey: string,
	hours: number,
) => ({
	key,
	projectSourceKey,
	taskSourceKey,
	description: `row ${key}`,
	durationSeconds: hours * H,
	overtime: false,
});

const firstDays = () => [
	{
		personSourceKey: K.ana,
		date: "2025-03-03",
		rows: [row("a1", K.gamma, K.dev, 4), row("a2", K.gamma, K.design, 4)],
	},
	{
		personSourceKey: K.worker,
		date: "2025-03-03",
		rows: [row("w1", K.alpha, K.dev, 8)],
	},
	{
		personSourceKey: K.bo,
		date: "2025-03-04",
		rows: [row("b1", null, K.paid, 8)],
	},
	{
		personSourceKey: K.ana,
		date: "2025-03-05",
		rows: [row("o1", K.ops, K.dev, 2)],
	},
];

const userByEmail = async (email: string) =>
	db.query.user.findFirst({ where: eq(user.email, email) });

const importedCount = async () =>
	(
		await db
			.select({ id: timeEntry.id })
			.from(timeEntry)
			.where(
				and(eq(timeEntry.organizationId, ORG), isNotNull(timeEntry.importKey)),
			)
	).length;

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values([
		{
			id: ORG,
			name: "Harvest Org",
			slug: ORG,
			timezone: "UTC",
			createdAt: new Date(),
		},
		{
			id: OTHER_ORG,
			name: "Other Org",
			slug: OTHER_ORG,
			timezone: "UTC",
			createdAt: new Date(),
		},
	]);
	await db.insert(user).values(
		[ADMIN, WORKER, OUTSIDER].map((id) => ({
			id,
			name: id,
			email: id === OUTSIDER ? OUTSIDER_EMAIL : `${id}@example.com`,
			emailVerified: true,
		})),
	);
	await db.insert(member).values([
		{
			id: "m-hi-admin",
			organizationId: ORG,
			userId: ADMIN,
			role: "admin",
			createdAt: new Date(),
		},
		{
			id: "m-hi-worker",
			organizationId: ORG,
			userId: WORKER,
			role: "member",
			createdAt: new Date(),
		},
		{
			id: "m-hi-outsider",
			organizationId: OTHER_ORG,
			userId: OUTSIDER,
			role: "member",
			createdAt: new Date(),
		},
	]);

	const [acme, foreign] = await db
		.insert(client)
		.values([
			{ organizationId: ORG, name: "Acme" },
			{ organizationId: OTHER_ORG, name: "Foreign" },
		])
		.returning();
	acmeId = present(acme, "acme").id;
	foreignClientId = present(foreign, "foreign client").id;

	const [alpha] = await db
		.insert(project)
		.values({
			organizationId: ORG,
			clientId: acmeId,
			name: "Alpha",
			type: "product_team",
		})
		.returning();
	alphaId = present(alpha, "alpha").id;

	const [dev] = await db
		.insert(task)
		.values({
			scope: "organization",
			organizationId: ORG,
			name: "Development",
		})
		.returning();
	devTaskId = present(dev, "development").id;
	await db
		.insert(projectTask)
		.values({ organizationId: ORG, projectId: alphaId, taskId: devTaskId });

	const paid = await db.query.task.findFirst({
		where: eq(task.systemKey, "paid_leave"),
	});
	paidLeaveId = present(paid, "Paid Leave (migration 0038)").id;
});

afterAll(async () => {
	await harness.close();
});

describe("harvest import", () => {
	let runId: string;

	test("only an admin may import", async () => {
		await expect(
			harvestImportService.snapshot(worker, {
				from: "2025-01-01",
				to: "2025-12-31",
				emails: [],
			}),
		).rejects.toThrow(AccessError);
		await expect(harvestImportService.start(worker, plan())).rejects.toThrow(
			AccessError,
		);
	});

	test("a match on a row of another org fails, and leaves no run", async () => {
		const bad = plan();
		bad.clients[0] = {
			action: "match",
			sourceKey: K.acme,
			localId: foreignClientId,
		};
		await expect(harvestImportService.start(admin, bad)).rejects.toThrow(
			"matches no client",
		);
		const runs = await db
			.select()
			.from(importRun)
			.where(eq(importRun.organizationId, ORG));
		expect(runs).toHaveLength(0);
	});

	test("a guessed address never attaches to an existing user", async () => {
		const bad = plan();
		bad.people[2] = {
			action: "create",
			sourceKey: K.bo,
			name: "Bo Guess",
			email: OUTSIDER_EMAIL,
			emailListed: false,
			role: "member",
			type: "billable",
			startDate: "2024-01-01",
			archivedOn: null,
			weeklyTargetSeconds: 40 * H,
		};
		// The listed copy of the same address is dropped, so only the guess
		// can reach the user.
		bad.people.splice(3, 1);
		bad.projectMembers = [];
		await expect(harvestImportService.start(admin, bad)).rejects.toThrow(
			"belongs to another user",
		);
	});

	test("the snapshot names an address outside the org as taken", async () => {
		const snap = await harvestImportService.snapshot(admin, {
			from: "2025-01-01",
			to: "2025-12-31",
			emails: [OUTSIDER_EMAIL.toUpperCase(), `${WORKER}@example.com`],
		});
		expect(snap.takenEmails).toEqual([OUTSIDER_EMAIL]);
		expect(snap.tasks.some((t) => t.id === paidLeaveId)).toBe(true);
	});

	test("start writes the reference rows", async () => {
		const workerBefore = present(
			await db.query.user.findFirst({ where: eq(user.id, WORKER) }),
			"worker",
		);
		const result = await harvestImportService.start(admin, plan());
		runId = result.runId;
		expect(result.created).toEqual({
			clients: 1,
			tasks: 1,
			people: 3,
			projects: 2,
		});

		const ana = present(await userByEmail("ana@example.com"), "ana");
		const bo = present(await userByEmail("bo.guess@example.com"), "bo");
		expect(ana.emailVerified).toBe(true);
		expect(bo.emailVerified).toBe(false);

		const boProfile = present(
			await db.query.memberProfile.findFirst({
				where: and(
					eq(memberProfile.organizationId, ORG),
					eq(memberProfile.userId, bo.id),
				),
			}),
			"bo profile",
		);
		expect(boProfile.archivedAt?.toISOString()).toBe(
			"2025-06-30T12:00:00.000Z",
		);

		// The matched person: same user row, and only the empty start date
		// was filled.
		const workerAfter = present(
			await db.query.user.findFirst({ where: eq(user.id, WORKER) }),
			"worker",
		);
		expect(workerAfter.name).toBe(workerBefore.name);
		expect(workerAfter.email).toBe(workerBefore.email);
		const workerProfile = await db.query.memberProfile.findFirst({
			where: and(
				eq(memberProfile.organizationId, ORG),
				eq(memberProfile.userId, WORKER),
			),
		});
		expect(workerProfile?.startDate).toBe("2020-01-01");

		// The listed address of a user in another org attaches that user.
		const outsiderMember = await db.query.member.findFirst({
			where: and(eq(member.organizationId, ORG), eq(member.userId, OUTSIDER)),
		});
		expect(outsiderMember).toBeDefined();

		const gamma = present(
			await db.query.project.findFirst({ where: eq(project.name, "Gamma") }),
			"gamma",
		);
		const ops = present(
			await db.query.project.findFirst({ where: eq(project.name, "Ops") }),
			"ops",
		);
		expect(ops.status).toBe("archived");
		const internal = present(
			await db.query.client.findFirst({ where: eq(client.id, ops.clientId) }),
			"internal client",
		);
		expect(internal.isInternal).toBe(true);
		const assigned = await db
			.select()
			.from(projectMember)
			.where(eq(projectMember.projectId, gamma.id));
		expect(assigned.map((a) => a.userId)).toEqual([ana.id]);
	});

	test("a create for a key an earlier run mapped asks for a reload", async () => {
		await expect(harvestImportService.start(admin, plan())).rejects.toThrow(
			"was imported before",
		);
	});

	test("importDays writes whole days, and a second import adds nothing", async () => {
		const first = await harvestImportService.importDays(admin, {
			runId,
			days: firstDays(),
		});
		expect(first).toEqual({
			inserted: 5,
			deleted: 0,
			unchangedDays: 0,
			keptDays: [],
		});

		const again = await harvestImportService.importDays(admin, {
			runId,
			days: firstDays(),
		});
		expect(again).toEqual({
			inserted: 0,
			deleted: 0,
			unchangedDays: 4,
			keptDays: [],
		});
		expect(await importedCount()).toBe(5);

		const leave = present(
			await db.query.timeEntry.findFirst({
				where: eq(timeEntry.importKey, "b1"),
			}),
			"paid leave row",
		);
		expect(leave.projectId).toBeNull();
		expect(leave.syncLocked).toBe(true);
	});

	test("the snapshot digests each imported day like the browser", async () => {
		const { dayDigest } = await import("../lib/harvest/keys");
		const snap = await harvestImportService.snapshot(admin, {
			from: "2025-03-01",
			to: "2025-03-31",
			emails: [],
		});
		const ana = present(await userByEmail("ana@example.com"), "ana");
		const days = present(
			snap.importedDays.find((d) => d.userId === ana.id),
			"ana's days",
		);
		const march3 = present(
			days.days.find((d) => d[0] === "2025-03-03"),
			"2025-03-03",
		);
		expect(march3[1]).toBe(await dayDigest(["a2", "a1"]));
		expect(march3[2]).toBe(0);
	});

	test("an unknown source key or an absence on a project fails", async () => {
		await expect(
			harvestImportService.importDays(admin, {
				runId,
				days: [
					{
						personSourceKey: "nobody",
						date: "2025-03-06",
						rows: [row("n1", K.alpha, K.dev, 1)],
					},
				],
			}),
		).rejects.toThrow('does not know the person "nobody"');
		await expect(
			harvestImportService.importDays(admin, {
				runId,
				days: [
					{
						personSourceKey: K.bo,
						date: "2025-03-06",
						rows: [row("b2", K.alpha, K.paid, 8)],
					},
				],
			}),
		).rejects.toThrow("names a project");
	});

	test("a changed day is replaced; an edited day is kept; own rows stay", async () => {
		// A row the worker typed here on the same day: never touched.
		await db.insert(timeEntry).values({
			organizationId: ORG,
			userId: WORKER,
			date: "2025-03-03",
			projectId: alphaId,
			taskId: devTaskId,
			description: "typed here",
			durationSeconds: H,
		});
		// The worker edits their imported row.
		await db
			.update(timeEntry)
			.set({
				description: "fixed",
				updatedAt: new Date(Date.now() + 60_000),
			})
			.where(eq(timeEntry.importKey, "w1"));

		const days = firstDays();
		const anaDay = at(days, 0);
		anaDay.rows = [row("a3", K.gamma, K.dev, 8)];
		const workerDay = at(days, 1);
		workerDay.rows = [row("w2", K.alpha, K.dev, 6)];

		const result = await harvestImportService.importDays(admin, {
			runId,
			days,
		});
		expect(result.inserted).toBe(1);
		expect(result.deleted).toBe(2);
		expect(result.unchangedDays).toBe(2);
		expect(result.keptDays).toEqual([
			{ personSourceKey: K.worker, date: "2025-03-03" },
		]);

		const workerRows = await db
			.select({
				importKey: timeEntry.importKey,
				description: timeEntry.description,
			})
			.from(timeEntry)
			.where(
				and(eq(timeEntry.userId, WORKER), eq(timeEntry.date, "2025-03-03")),
			);
		expect(workerRows.map((r) => r.importKey ?? "own").sort()).toEqual([
			"own",
			"w1",
		]);
	});

	test("removeDays deletes an unedited day and keeps an edited one", async () => {
		const result = await harvestImportService.removeDays(admin, {
			runId,
			days: [
				{ personSourceKey: K.ana, date: "2025-03-05" },
				{ personSourceKey: K.worker, date: "2025-03-03" },
			],
		});
		expect(result).toEqual({
			deleted: 1,
			keptDays: [{ personSourceKey: K.worker, date: "2025-03-03" }],
		});
	});

	test("finish locks automation and writes finalized history closes", async () => {
		const result = await harvestImportService.finish(admin, {
			runId,
			historyThrough: "2025-03",
			billable: [
				{
					projectSourceKey: K.gamma,
					personSourceKey: K.ana,
					month: "2025-03",
					seconds: 7 * H,
				},
			],
		});
		// Gamma and Alpha; Ops is internal, and Paid Leave has no project.
		expect(result.closesCreated).toBe(2);
		expect(result.automationLockedThrough).toBe("2025-03-31");
		const settings = await orgSettingsService.get(admin);
		expect(settings.automationLockedThrough).toBe("2025-03-31");

		const gamma = present(
			await db.query.project.findFirst({ where: eq(project.name, "Gamma") }),
			"gamma",
		);
		const close = present(
			await db.query.monthlyClose.findFirst({
				where: eq(monthlyClose.projectId, gamma.id),
			}),
			"gamma close",
		);
		expect(close.status).toBe("finalized");
		expect([close.year, close.month]).toEqual([2025, 3]);

		const ana = present(await userByEmail("ana@example.com"), "ana");
		const rows = await db
			.select()
			.from(monthlyCloseRow)
			.where(eq(monthlyCloseRow.closeId, close.id));
		const anaRow = at(rows, 0);
		expect(rows).toHaveLength(1);
		expect(anaRow.userId).toBe(ana.id);
		expect(anaRow.finalSeconds).toBe(7 * H);
		expect(anaRow.reportedAtFinalizeSeconds).toBe(8 * H);
		expect(anaRow.overtimeAtFinalizeSeconds).toBe(0);
		const funds = await hourFundService.getMany(admin, [
			{ year: 2025, month: 3 },
		]);
		expect(anaRow.expectedAtFinalizeSeconds).toBe(
			present(funds.get("2025-03"), "March fund"),
		);

		// A billable figure Harvest does not have is zero, not Reported.
		const alphaClose = present(
			await db.query.monthlyClose.findFirst({
				where: eq(monthlyClose.projectId, alphaId),
			}),
			"alpha close",
		);
		const alphaRows = await db
			.select()
			.from(monthlyCloseRow)
			.where(eq(monthlyCloseRow.closeId, alphaClose.id));
		expect(at(alphaRows, 0).finalSeconds).toBe(0);

		const run = present(
			await db.query.importRun.findFirst({ where: eq(importRun.id, runId) }),
			"run",
		);
		expect(run.status).toBe("finished");
		expect(run.closesCreated).toBe(2);
	});

	test("a finished run takes no more data", async () => {
		await expect(
			harvestImportService.importDays(admin, { runId, days: firstDays() }),
		).rejects.toThrow("takes no more data");
	});

	test("restoring a never-signed-in person confirms a guessed address", async () => {
		const bo = present(await userByEmail("bo.guess@example.com"), "bo");
		const ana = present(await userByEmail("ana@example.com"), "ana");
		const people = await membersService.list(admin);
		expect(people.find((p) => p.userId === bo.id)?.emailUnconfirmed).toBe(true);
		expect(people.find((p) => p.userId === ana.id)?.emailUnconfirmed).toBe(
			false,
		);

		expect(await membersService.setArchived(admin, bo.id, false)).toEqual({
			emailConfirmed: true,
		});
		const after = present(await userByEmail("bo.guess@example.com"), "bo");
		expect(after.emailVerified).toBe(true);

		// Archiving never confirms anything.
		expect(await membersService.setArchived(admin, bo.id, true)).toEqual({
			emailConfirmed: false,
		});
	});

	describe("a second run", () => {
		let secondRunId: string;

		test("rewrites an untouched import close and skips an edited one", async () => {
			const alphaClose = present(
				await db.query.monthlyClose.findFirst({
					where: eq(monthlyClose.projectId, alphaId),
				}),
				"alpha close",
			);
			await db
				.update(monthlyCloseRow)
				.set({
					finalSeconds: 5 * H,
					updatedAt: new Date(Date.now() + 60_000),
				})
				.where(eq(monthlyCloseRow.closeId, alphaClose.id));

			const { runId: id } = await harvestImportService.start(
				admin,
				emptyPlan(),
			);
			secondRunId = id;
			const result = await harvestImportService.finish(admin, {
				runId: id,
				historyThrough: "2025-03",
				billable: [
					{
						projectSourceKey: K.gamma,
						personSourceKey: K.ana,
						month: "2025-03",
						seconds: 6 * H,
					},
					{
						projectSourceKey: K.alpha,
						personSourceKey: K.worker,
						month: "2025-03",
						seconds: 8 * H,
					},
				],
			});
			expect(result).toMatchObject({
				closesCreated: 0,
				closesUpdated: 1,
				closesSkipped: 1,
			});

			const alphaRows = await db
				.select()
				.from(monthlyCloseRow)
				.where(eq(monthlyCloseRow.closeId, alphaClose.id));
			expect(at(alphaRows, 0).finalSeconds).toBe(5 * H);
		});

		test("only the latest run can be undone", async () => {
			await expect(harvestImportService.undo(admin, { runId })).rejects.toThrow(
				"Only the latest import",
			);
			const result = await harvestImportService.undo(admin, {
				runId: secondRunId,
			});
			expect(result.entriesDeleted).toBe(0);
		});
	});

	describe("undo", () => {
		test("refuses while an entry made here uses a created row", async () => {
			const ana = present(await userByEmail("ana@example.com"), "ana");
			const gamma = present(
				await db.query.project.findFirst({ where: eq(project.name, "Gamma") }),
				"gamma",
			);
			const [own] = await db
				.insert(timeEntry)
				.values({
					organizationId: ORG,
					userId: ana.id,
					date: "2025-04-02",
					projectId: gamma.id,
					taskId: devTaskId,
					description: "after the cutoff",
					durationSeconds: H,
				})
				.returning();
			await expect(harvestImportService.undo(admin, { runId })).rejects.toThrow(
				"uses a row this import created",
			);
			await db
				.delete(timeEntry)
				.where(eq(timeEntry.id, present(own, "own entry").id));
		});

		test("refuses once a created person has signed in", async () => {
			const bo = present(await userByEmail("bo.guess@example.com"), "bo");
			await db.insert(account).values({
				id: "acc-hi-bo",
				accountId: "google-bo",
				providerId: "google",
				userId: bo.id,
				updatedAt: new Date(),
			});
			await expect(harvestImportService.undo(admin, { runId })).rejects.toThrow(
				"has signed in",
			);
			await db.delete(account).where(eq(account.id, "acc-hi-bo"));
		});

		test("takes back only what the run made", async () => {
			const result = await harvestImportService.undo(admin, { runId });
			expect(result).toMatchObject({
				closesDeleted: 2,
				projectsDeleted: 2,
				clientsDeleted: 1,
				tasksDeleted: 1,
				peopleRemoved: 3,
			});

			expect(await importedCount()).toBe(0);
			expect(await userByEmail("ana@example.com")).toBeUndefined();
			expect(await userByEmail("bo.guess@example.com")).toBeUndefined();
			expect(
				await db.query.project.findFirst({ where: eq(project.name, "Gamma") }),
			).toBeUndefined();
			expect(
				await db.query.client.findFirst({ where: eq(client.name, "Globex") }),
			).toBeUndefined();

			// Matched rows stay: the worker, their own entry, Alpha, Acme.
			expect(
				await db.query.member.findFirst({
					where: and(eq(member.organizationId, ORG), eq(member.userId, WORKER)),
				}),
			).toBeDefined();
			const own = await db
				.select()
				.from(timeEntry)
				.where(and(eq(timeEntry.userId, WORKER), isNull(timeEntry.importKey)));
			expect(own).toHaveLength(1);
			expect(
				await db.query.project.findFirst({ where: eq(project.id, alphaId) }),
			).toBeDefined();

			// The attached user keeps their account and their other org.
			expect(
				await db.query.user.findFirst({ where: eq(user.id, OUTSIDER) }),
			).toBeDefined();
			const outsiderOrgs = await db
				.select({ org: member.organizationId })
				.from(member)
				.where(eq(member.userId, OUTSIDER));
			expect(outsiderOrgs).toEqual([{ org: OTHER_ORG }]);

			const run = present(
				await db.query.importRun.findFirst({ where: eq(importRun.id, runId) }),
				"run",
			);
			expect(run.status).toBe("undone");
		});

		test("an undone run cannot be undone again", async () => {
			await expect(harvestImportService.undo(admin, { runId })).rejects.toThrow(
				"This import is undone",
			);
		});
	});

	describe("a second spelling of a person", () => {
		const ALIAS = "worker 1";
		const aliasPlan = (of: string): HarvestStartInput => ({
			...emptyPlan(),
			tasks: [{ action: "match", sourceKey: K.dev, localId: devTaskId }],
			projects: [{ action: "match", sourceKey: K.alpha, localId: alphaId }],
			people: [
				{ action: "alias", sourceKey: ALIAS, of },
				{
					action: "match",
					sourceKey: K.worker,
					localId: WORKER,
					startDate: null,
				},
			],
		});

		test("an alias of a person the plan does not have fails", async () => {
			await expect(
				harvestImportService.start(admin, aliasPlan("nobody")),
			).rejects.toThrow("which the plan does not have");
		});

		test("maps to its person's user, and shares their day", async () => {
			const { runId: id } = await harvestImportService.start(
				admin,
				aliasPlan(K.worker),
			);
			const result = await harvestImportService.importDays(admin, {
				runId: id,
				days: [
					{
						personSourceKey: K.worker,
						date: "2025-03-10",
						rows: [row("s1", K.alpha, K.dev, 2)],
					},
					{
						personSourceKey: ALIAS,
						date: "2025-03-10",
						rows: [row("s2", K.alpha, K.dev, 3)],
					},
				],
			});
			expect(result).toMatchObject({ inserted: 2, deleted: 0 });
			const rows = await db
				.select({ userId: timeEntry.userId, key: timeEntry.importKey })
				.from(timeEntry)
				.where(
					and(
						eq(timeEntry.organizationId, ORG),
						isNotNull(timeEntry.importKey),
					),
				);
			expect(rows.map((r) => r.userId)).toEqual([WORKER, WORKER]);

			// Undo removes the mapping and the rows, and never the person.
			const undone = await harvestImportService.undo(admin, { runId: id });
			expect(undone).toMatchObject({ entriesDeleted: 2, peopleRemoved: 0 });
			expect(
				await db.query.member.findFirst({
					where: and(eq(member.organizationId, ORG), eq(member.userId, WORKER)),
				}),
			).toBeDefined();
		});
	});
});
