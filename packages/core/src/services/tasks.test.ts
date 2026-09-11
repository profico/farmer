// The task taxonomy: one global list per org plus the site built-ins every org
// shares, cherry-picked onto projects through `projectTask`.
//
// Pinned here are the boundaries rather than the CRUD. Writes to the list are
// Admin-only; writes to a project's subset are Team Lead and up on THAT
// project; and every id a caller hands in is checked against its own org in
// the query, so another org's task or project cannot be smuggled through. The
// built-ins are the other half: they cannot be edited or archived, the engines
// find them by `systemKey` rather than by name, and absence tasks never land on
// a project.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import {
	client,
	project,
	projectMember,
	projectTask,
	type TaskSystemKey,
	task,
} from "../db/schema/domain";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { AccessError, NotAMemberError } from "./access.service";
import { tasksService } from "./tasks.service";
import type { Ctx } from "./types";

const ORG_A = "tk-a";
const ORG_B = "tk-b";

const ADMIN = "u-tk-admin";
const PM = "u-tk-pm";
const TL = "u-tk-tl";
const MEM = "u-tk-member";
const TL_INACTIVE = "u-tk-tl-inactive";
const OUTSIDER = "u-tk-outsider";
const ADMIN_B = "u-tk-admin-b";

let harness: TestDb;

let projectA1: string;
let projectA2: string;
let projectB: string;
let devA: string;
let designA: string;
let taskB: string;
let meetingId: string;
let breakId: string;
let vacationId: string;
let paidLeaveId: string;

/** A fresh Ctx per call: `ctxAccess` memoizes Access on the object. */
const ctx = (userId: string, organizationId: string = ORG_A): Ctx => ({
	organizationId,
	userId,
});

const siteTaskId = async (key: TaskSystemKey) => {
	const row = await db.query.task.findFirst({
		where: and(eq(task.scope, "site"), eq(task.systemKey, key)),
		columns: { id: true },
	});
	return present(row, `site task ${key}`).id;
};

const linkedTaskIds = async (projectId: string) =>
	(
		await db
			.select({ taskId: projectTask.taskId })
			.from(projectTask)
			.where(eq(projectTask.projectId, projectId))
	)
		.map((r) => r.taskId)
		.sort();

const taskRow = async (id: string) =>
	present(await db.query.task.findFirst({ where: eq(task.id, id) }), "task");

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values([
		{ id: ORG_A, name: "Tasks A", slug: ORG_A, createdAt: new Date() },
		{ id: ORG_B, name: "Tasks B", slug: ORG_B, createdAt: new Date() },
	]);

	const people = [ADMIN, PM, TL, MEM, TL_INACTIVE, OUTSIDER, ADMIN_B];
	await db.insert(user).values(
		people.map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);

	await db.insert(member).values([
		...[ADMIN, PM, TL, MEM, TL_INACTIVE].map((id) => ({
			id: `m-${id}`,
			organizationId: ORG_A,
			userId: id,
			role: id === ADMIN ? "admin" : "member",
			createdAt: new Date(),
		})),
		{
			id: `m-${ADMIN_B}`,
			organizationId: ORG_B,
			userId: ADMIN_B,
			role: "owner",
			createdAt: new Date(),
		},
	]);

	const clients = await db
		.insert(client)
		.values([
			{ organizationId: ORG_A, name: "Client A" },
			{ organizationId: ORG_B, name: "Client B" },
		])
		.returning();
	const clientA = at(clients, 0);
	const clientB = at(clients, 1);

	const projects = await db
		.insert(project)
		.values([
			{ organizationId: ORG_A, clientId: clientA.id, name: "A1" },
			{ organizationId: ORG_A, clientId: clientA.id, name: "A2" },
			{ organizationId: ORG_B, clientId: clientB.id, name: "B" },
		])
		.returning();
	projectA1 = at(projects, 0).id;
	projectA2 = at(projects, 1).id;
	projectB = at(projects, 2).id;

	await db.insert(projectMember).values([
		{ organizationId: ORG_A, projectId: projectA1, userId: PM, role: "pm" },
		{
			organizationId: ORG_A,
			projectId: projectA1,
			userId: TL,
			role: "team_lead",
		},
		{ organizationId: ORG_A, projectId: projectA1, userId: MEM },
		// An inactive assignment keeps a person on old close sheets and grants
		// nothing going forward.
		{
			organizationId: ORG_A,
			projectId: projectA1,
			userId: TL_INACTIVE,
			role: "team_lead",
			active: false,
		},
	]);

	const tasks = await db
		.insert(task)
		.values([
			{
				scope: "organization" as const,
				organizationId: ORG_A,
				name: "Development",
				systemKey: "development" as const,
			},
			{ scope: "organization" as const, organizationId: ORG_A, name: "Design" },
			{
				scope: "organization" as const,
				organizationId: ORG_B,
				name: "B Only",
			},
		])
		.returning();
	devA = at(tasks, 0).id;
	designA = at(tasks, 1).id;
	taskB = at(tasks, 2).id;

	// Org B genuinely picked its own task for its own project — the pair is
	// internally consistent, so only the org predicate keeps org A out of it.
	await db
		.insert(projectTask)
		.values({ organizationId: ORG_B, projectId: projectB, taskId: taskB });

	// Meeting, Break (0024) and Paid Leave (0038) come from the migrations;
	// Vacation comes from `db:seed-tasks`, which the harness does not run.
	const [vacation] = await db
		.insert(task)
		.values({
			scope: "site" as const,
			name: "Vacation",
			isAbsence: true,
			systemKey: "vacation" as const,
		})
		.returning();
	vacationId = present(vacation, "vacation task").id;
	meetingId = await siteTaskId("meeting");
	breakId = await siteTaskId("break");
	paidLeaveId = await siteTaskId("paid_leave");
});

afterAll(async () => {
	await harness.close();
});

describe("create", () => {
	test("an admin creates an org-scoped task in the caller's own org", async () => {
		const created = await tasksService.create(ctx(ADMIN), {
			name: "  Research  ",
		});
		expect(created.scope).toBe("organization");
		expect(created.organizationId).toBe(ORG_A);
		expect(created.name).toBe("Research");
	});

	test("PM, Team Lead and Member are refused, and nothing is written", async () => {
		for (const who of [PM, TL, MEM]) {
			await expect(
				tasksService.create(ctx(who), { name: "Sneaky" }),
			).rejects.toThrow(AccessError);
		}
		const rows = await db.query.task.findMany({
			where: eq(task.name, "Sneaky"),
		});
		expect(rows).toHaveLength(0);
	});

	test("a caller with no membership in the org is refused as a non-member", async () => {
		await expect(
			tasksService.create(ctx(OUTSIDER), { name: "Outside" }),
		).rejects.toThrow(NotAMemberError);
	});

	test("a live name clash is refused with a message", async () => {
		await tasksService.create(ctx(ADMIN), { name: "Dup" });
		await expect(
			tasksService.create(ctx(ADMIN), { name: "Dup" }),
		).rejects.toThrow('A task called "Dup" already exists.');
	});

	test("an archived clash asks for a restore rather than stacking a second row", async () => {
		const old = await tasksService.create(ctx(ADMIN), { name: "Old" });
		await tasksService.archive(ctx(ADMIN), old.id);
		await expect(
			tasksService.create(ctx(ADMIN), { name: "Old" }),
		).rejects.toThrow("Restore it instead");
		const rows = await db.query.task.findMany({
			where: and(eq(task.organizationId, ORG_A), eq(task.name, "Old")),
		});
		expect(rows).toHaveLength(1);
	});

	test("the same name in another org is not a clash", async () => {
		const created = await tasksService.create(ctx(ADMIN_B, ORG_B), {
			name: "Research",
		});
		expect(created.organizationId).toBe(ORG_B);
	});
});

describe("update", () => {
	test("renaming keeps the systemKey, so the engine still finds the task", async () => {
		const renamed = await tasksService.update(ctx(ADMIN), {
			taskId: devA,
			name: "Engineering",
		});
		expect(present(renamed, "updated task").systemKey).toBe("development");

		const found = await tasksService.findBySystemKey(ctx(MEM), "development");
		expect(present(found, "development task")).toMatchObject({
			id: devA,
			name: "Engineering",
		});
	});

	test("a site built-in cannot be edited", async () => {
		await expect(
			tasksService.update(ctx(ADMIN), { taskId: meetingId, name: "Meetings" }),
		).rejects.toThrow("Built-in tasks cannot be edited");
		expect((await taskRow(meetingId)).name).toBe("Meeting");
	});

	test("another org's task reads as not found and is left alone", async () => {
		await expect(
			tasksService.update(ctx(ADMIN), { taskId: taskB, name: "Hijacked" }),
		).rejects.toThrow("Task not found");
		expect((await taskRow(taskB)).name).toBe("B Only");
	});

	test("a PM cannot edit the org's list", async () => {
		await expect(
			tasksService.update(ctx(PM), { taskId: designA, name: "PM Design" }),
		).rejects.toThrow(AccessError);
		expect((await taskRow(designA)).name).toBe("Design");
	});
});

describe("archive and unarchive", () => {
	test("site built-ins, including absence, cannot be archived", async () => {
		for (const id of [meetingId, breakId, vacationId, paidLeaveId]) {
			await expect(tasksService.archive(ctx(ADMIN), id)).rejects.toThrow(
				"Built-in tasks cannot be archived",
			);
			expect((await taskRow(id)).archivedAt).toBeNull();
		}
	});

	test("another org's task reads as not found on both paths", async () => {
		await expect(tasksService.archive(ctx(ADMIN), taskB)).rejects.toThrow(
			"Task not found",
		);
		expect((await taskRow(taskB)).archivedAt).toBeNull();

		const [archivedB] = await db
			.insert(task)
			.values({
				scope: "organization" as const,
				organizationId: ORG_B,
				name: "B Archived",
				archivedAt: new Date(),
			})
			.returning();
		const archivedBId = present(archivedB, "archived org B task").id;
		await expect(
			tasksService.unarchive(ctx(ADMIN), archivedBId),
		).rejects.toThrow("Task not found");
		expect((await taskRow(archivedBId)).archivedAt).not.toBeNull();
	});

	test("a Team Lead cannot archive or restore", async () => {
		await expect(tasksService.archive(ctx(TL), designA)).rejects.toThrow(
			AccessError,
		);
		await expect(tasksService.unarchive(ctx(TL), designA)).rejects.toThrow(
			AccessError,
		);
	});

	test("archive hides a task from the picker and restore brings back the same id", async () => {
		const ops = await tasksService.create(ctx(ADMIN), { name: "Ops" });
		await tasksService.archive(ctx(ADMIN), ops.id);
		let selectable = await tasksService.listSelectable(ctx(MEM));
		expect(selectable.map((t) => t.id)).not.toContain(ops.id);

		await tasksService.unarchive(ctx(ADMIN), ops.id);
		selectable = await tasksService.listSelectable(ctx(MEM));
		expect(selectable.map((t) => t.id)).toContain(ops.id);
		expect((await taskRow(ops.id)).archivedAt).toBeNull();
	});

	test("restore is refused while a live task has taken the name", async () => {
		const first = await tasksService.create(ctx(ADMIN), { name: "Support" });
		await tasksService.archive(ctx(ADMIN), first.id);
		// `create` would refuse this clash, so the live twin is inserted directly —
		// the state a rename of another task can reach.
		await db.insert(task).values({
			scope: "organization" as const,
			organizationId: ORG_A,
			name: "Support",
		});
		await expect(tasksService.unarchive(ctx(ADMIN), first.id)).rejects.toThrow(
			'Another live task already uses the name "Support"',
		);
		expect((await taskRow(first.id)).archivedAt).not.toBeNull();
	});

	test("archiving a keyed task switches its engine lookup off in that org only", async () => {
		const [devB] = await db
			.insert(task)
			.values({
				scope: "organization" as const,
				organizationId: ORG_B,
				name: "Development",
				systemKey: "development" as const,
			})
			.returning();
		const devBId = present(devB, "org B development").id;

		// Each org resolves the key to its own row, never the other's.
		expect(
			(await tasksService.findBySystemKey(ctx(ADMIN), "development"))?.id,
		).toBe(devA);
		expect(
			(await tasksService.findBySystemKey(ctx(ADMIN_B, ORG_B), "development"))
				?.id,
		).toBe(devBId);

		await tasksService.archive(ctx(ADMIN_B, ORG_B), devBId);
		expect(
			await tasksService.findBySystemKey(ctx(ADMIN_B, ORG_B), "development"),
		).toBeNull();
		expect(
			(await tasksService.findBySystemKey(ctx(ADMIN), "development"))?.id,
		).toBe(devA);
	});
});

describe("listSelectable", () => {
	test("the universal built-ins and the org's own tasks, never absence or another org's", async () => {
		const ids = (await tasksService.listSelectable(ctx(MEM))).map((t) => t.id);
		expect(ids).toEqual(expect.arrayContaining([meetingId, breakId, devA]));
		expect(ids).not.toContain(vacationId);
		expect(ids).not.toContain(paidLeaveId);
		expect(ids).not.toContain(taskB);
	});
});

describe("listForProject", () => {
	test("with no project it offers every site task, absence included, and no org task", async () => {
		const ids = (await tasksService.listForProject(ctx(MEM), undefined)).map(
			(t) => t.id,
		);
		expect(ids).toEqual(
			expect.arrayContaining([meetingId, breakId, vacationId, paidLeaveId]),
		);
		expect(ids).not.toContain(devA);
		expect(ids).not.toContain(taskB);
	});

	test("with a project it offers the picked subset plus the universal built-ins", async () => {
		await tasksService.setProjectTasks(ctx(TL), projectA1, [devA]);
		const ids = (await tasksService.listForProject(ctx(MEM), projectA1)).map(
			(t) => t.id,
		);
		expect(ids.sort()).toEqual([breakId, devA, meetingId].sort());
	});

	test("another org's project shows none of that org's picks", async () => {
		const ids = (await tasksService.listForProject(ctx(ADMIN), projectB)).map(
			(t) => t.id,
		);
		expect(ids).not.toContain(taskB);
	});
});

describe("setProjectTasks", () => {
	test("a Team Lead on the project replaces its subset wholesale", async () => {
		await tasksService.setProjectTasks(ctx(TL), projectA1, [devA, designA]);
		expect(await linkedTaskIds(projectA1)).toEqual([devA, designA].sort());

		await tasksService.setProjectTasks(ctx(TL), projectA1, [designA]);
		expect(await linkedTaskIds(projectA1)).toEqual([designA]);
	});

	test("a plain Member on the project is refused", async () => {
		const before = await linkedTaskIds(projectA1);
		await expect(
			tasksService.setProjectTasks(ctx(MEM), projectA1, [devA]),
		).rejects.toThrow(AccessError);
		expect(await linkedTaskIds(projectA1)).toEqual(before);
	});

	test("a Team Lead is refused on a project they do not lead", async () => {
		await expect(
			tasksService.setProjectTasks(ctx(TL), projectA2, [devA]),
		).rejects.toThrow(AccessError);
		expect(await linkedTaskIds(projectA2)).toEqual([]);
	});

	test("an inactive Team Lead assignment grants nothing", async () => {
		await expect(
			tasksService.setProjectTasks(ctx(TL_INACTIVE), projectA1, [devA]),
		).rejects.toThrow(AccessError);
	});

	test("another org's task, an absence task and an archived task are all refused", async () => {
		const [retired] = await db
			.insert(task)
			.values({
				scope: "organization" as const,
				organizationId: ORG_A,
				name: "Retired",
				archivedAt: new Date(),
			})
			.returning();
		const retiredId = present(retired, "archived task").id;

		const before = await linkedTaskIds(projectA1);
		for (const bad of [taskB, vacationId, retiredId]) {
			await expect(
				tasksService.setProjectTasks(ctx(ADMIN), projectA1, [devA, bad]),
			).rejects.toThrow("One or more tasks are not available to this project");
		}
		expect(await linkedTaskIds(projectA1)).toEqual(before);
	});

	test("a universal built-in in the list is dropped rather than stored", async () => {
		await tasksService.setProjectTasks(ctx(ADMIN), projectA1, [
			meetingId,
			devA,
		]);
		expect(await linkedTaskIds(projectA1)).toEqual([devA]);
		const offered = (
			await tasksService.listForProject(ctx(MEM), projectA1)
		).map((t) => t.id);
		expect(offered).toContain(meetingId);
	});

	test("an admin of one org cannot edit another org's project", async () => {
		await expect(
			tasksService.setProjectTasks(ctx(ADMIN), projectB, []),
		).rejects.toThrow("Project not found");
		expect(await linkedTaskIds(projectB)).toEqual([taskB]);
	});
});

describe("setTaskProjects and listProjectsForTask", () => {
	test("an admin sets which projects offer a task, and reads it back", async () => {
		const qa = await tasksService.create(ctx(ADMIN), { name: "QA" });
		await tasksService.setTaskProjects(ctx(ADMIN), qa.id, [
			projectA1,
			projectA2,
		]);
		const projects = await tasksService.listProjectsForTask(ctx(ADMIN), qa.id);
		expect(projects.sort()).toEqual([projectA1, projectA2].sort());

		await tasksService.setTaskProjects(ctx(ADMIN), qa.id, [projectA2]);
		expect(await tasksService.listProjectsForTask(ctx(ADMIN), qa.id)).toEqual([
			projectA2,
		]);
	});

	test("both directions are Admin-only, even for a PM", async () => {
		await expect(
			tasksService.setTaskProjects(ctx(PM), designA, [projectA1]),
		).rejects.toThrow(AccessError);
		await expect(
			tasksService.listProjectsForTask(ctx(PM), designA),
		).rejects.toThrow(AccessError);
	});

	test("a universal built-in cannot be limited to some projects", async () => {
		await expect(
			tasksService.setTaskProjects(ctx(ADMIN), meetingId, [projectA1]),
		).rejects.toThrow("Built-in tasks are available on every project");
	});

	test("an absence task and another org's task are not available to this org", async () => {
		for (const bad of [vacationId, taskB]) {
			await expect(
				tasksService.setTaskProjects(ctx(ADMIN), bad, [projectA1]),
			).rejects.toThrow("Task is not available to this organization");
		}
		expect(await linkedTaskIds(projectB)).toEqual([taskB]);
	});

	test("another org's project id is refused and the existing links survive", async () => {
		const ux = await tasksService.create(ctx(ADMIN), { name: "UX" });
		await tasksService.setTaskProjects(ctx(ADMIN), ux.id, [projectA1]);
		await expect(
			tasksService.setTaskProjects(ctx(ADMIN), ux.id, [projectA2, projectB]),
		).rejects.toThrow("One or more projects are not in this organization");
		expect(await tasksService.listProjectsForTask(ctx(ADMIN), ux.id)).toEqual([
			projectA1,
		]);
	});

	test("another org's links to its own task are invisible", async () => {
		expect(await tasksService.listProjectsForTask(ctx(ADMIN), taskB)).toEqual(
			[],
		);
	});
});

describe("listManaged", () => {
	test("Admin-only", async () => {
		await expect(tasksService.listManaged(ctx(TL))).rejects.toThrow(
			AccessError,
		);
	});

	test("the org's tasks and the site built-ins, flagged, and nothing from another org", async () => {
		const rows = await tasksService.listManaged(ctx(ADMIN));
		const byId = new Map(rows.map((r) => [r.id, r]));
		expect(byId.has(taskB)).toBe(false);
		expect(present(byId.get(meetingId), "Meeting").universal).toBe(true);
		expect(present(byId.get(vacationId), "Vacation").universal).toBe(false);
		expect(present(byId.get(devA), "Development").universal).toBe(false);
		// The archived "Old" from the create tests is listed: this is the screen
		// that offers the restore.
		expect(rows.some((r) => r.name === "Old" && r.archivedAt !== null)).toBe(
			true,
		);
	});
});
