// The assistant's timer tools.
//
// `timersService` has its own tests for the clock. What is under test here is
// the adapter: one timer per PERSON across workspaces (the one exception to
// tenancy), so a tool call from a second workspace must not drive a timer that
// runs in the first, and a colleague must never see it.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import {
	client,
	project,
	projectMember,
	task,
	timeEntry,
} from "../db/schema/domain";
import { runningTimer } from "../db/schema/timer";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { findTool } from "./assistant-tools";
import type { Ctx } from "./types";

const ORG = "org-ast-timer";
const OTHER_ORG = "org-ast-timer-other";
const ME = "user-ast-timer-me";
const COLLEAGUE = "user-ast-timer-colleague";

const mine = (): Ctx => ({ organizationId: ORG, userId: ME });
const mineElsewhere = (): Ctx => ({ organizationId: OTHER_ORG, userId: ME });
const colleague = (): Ctx => ({ organizationId: ORG, userId: COLLEAGUE });

const tool = (name: string) => present(findTool(name), `tool ${name}`);

const timerResult = z.object({
	timer: z
		.object({
			state: z.enum(["running", "paused", "dropped"]),
			thisOrganization: z.boolean(),
			organization: z.string(),
			task: z.string().nullable(),
			project: z.string().nullable(),
			description: z.string().nullable(),
			taskId: z.string().nullable(),
			projectId: z.string().nullable(),
			needsNote: z.boolean().nullable(),
			continuesEntryId: z.string().nullable(),
			elapsedHours: z.number(),
			willLogHours: z.number(),
		})
		.nullable(),
});

const loggedResult = z.object({
	logged: z.object({
		id: z.string(),
		date: z.string(),
		hours: z.number(),
		description: z.string(),
	}),
});

let harness: TestDb;
let projectId = "";
let devTaskId = "";
let strangerProjectId = "";

const timers = () => db.select().from(runningTimer);

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values([
		{ id: ORG, name: "Timer tools", slug: ORG, createdAt: new Date() },
		{
			id: OTHER_ORG,
			name: "Second org",
			slug: OTHER_ORG,
			createdAt: new Date(),
		},
	]);
	for (const id of [ME, COLLEAGUE]) {
		await db.insert(user).values({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	}
	await db.insert(member).values([
		{
			id: "member-ast-timer-me",
			organizationId: ORG,
			userId: ME,
			role: "member",
			createdAt: new Date(),
		},
		{
			id: "member-ast-timer-me-other",
			organizationId: OTHER_ORG,
			userId: ME,
			role: "member",
			createdAt: new Date(),
		},
		{
			id: "member-ast-timer-colleague",
			organizationId: ORG,
			userId: COLLEAGUE,
			role: "member",
			createdAt: new Date(),
		},
	]);

	const acme = at(
		await db
			.insert(client)
			.values({ organizationId: ORG, name: "Acme" })
			.returning(),
		0,
	);
	const projects = await db
		.insert(project)
		.values([
			{ organizationId: ORG, clientId: acme.id, name: "Farmer" },
			{ organizationId: ORG, clientId: acme.id, name: "Not mine" },
		])
		.returning();
	projectId = at(projects, 0).id;
	strangerProjectId = at(projects, 1).id;
	await db
		.insert(projectMember)
		.values({ organizationId: ORG, projectId, userId: ME });

	devTaskId = at(
		await db
			.insert(task)
			.values({
				scope: "organization" as const,
				organizationId: ORG,
				name: "Development",
				isAbsence: false,
			})
			.returning(),
		0,
	).id;
});

beforeEach(async () => {
	await db.delete(runningTimer);
	await db.delete(timeEntry);
});

afterAll(async () => {
	await harness.close();
});

describe("the tiers", () => {
	test("get is a read, the clock controls are plain writes, discard asks", () => {
		expect(tool("get_timer").kind).toBe("read");
		for (const name of [
			"start_timer",
			"pause_timer",
			"resume_timer",
			"stop_timer",
		]) {
			const row = tool(name);
			expect(row.kind).toBe("write");
			// As create_time_entry: nothing is logged until the stop, and the stop
			// logs one entry of the caller's own on one day.
			expect(row.confirm).toBeUndefined();
		}
		expect(tool("discard_timer").kind).toBe("destructive");
	});
});

describe("get_timer", () => {
	test("says null when nothing runs", async () => {
		expect(timerResult.parse(await tool("get_timer").run(mine(), {}))).toEqual({
			timer: null,
		});
	});

	test("shows the caller's own timer and nobody else's", async () => {
		await tool("start_timer").run(mine(), {
			projectId,
			taskId: devTaskId,
			description: "Timed work",
		});
		const own = timerResult.parse(await tool("get_timer").run(mine(), {}));
		expect(own.timer).toMatchObject({
			state: "running",
			task: "Development",
			project: "Farmer",
			thisOrganization: true,
		});
		const theirs = timerResult.parse(
			await tool("get_timer").run(colleague(), {}),
		);
		expect(theirs.timer).toBeNull();
	});

	test("says that the timer runs in another workspace", async () => {
		await tool("start_timer").run(mine(), {
			projectId,
			taskId: devTaskId,
			description: "Timed work",
		});
		const elsewhere = timerResult.parse(
			await tool("get_timer").run(mineElsewhere(), {}),
		);
		expect(elsewhere.timer).toMatchObject({
			state: "running",
			thisOrganization: false,
			organization: "Timer tools",
			// What the timer is about belongs to the other workspace.
			task: null,
			taskId: null,
			project: null,
			projectId: null,
			description: null,
			needsNote: null,
			continuesEntryId: null,
		});
	});
});

describe("start, pause and resume", () => {
	test("start refuses a second timer and says which one runs", async () => {
		await tool("start_timer").run(mine(), {
			taskId: devTaskId,
			description: "First",
		});
		await expect(
			tool("start_timer").run(mine(), { taskId: devTaskId }),
		).rejects.toThrow("A timer is already running on Development");
		expect(await timers()).toHaveLength(1);
	});

	test("start refuses a project the person is not on", async () => {
		await expect(
			tool("start_timer").run(mine(), {
				projectId: strangerProjectId,
				taskId: devTaskId,
			}),
		).rejects.toThrow("You are not assigned to this project");
		expect(await timers()).toHaveLength(0);
	});

	test("start needs a task or an entry to continue", () => {
		expect(tool("start_timer").schema.safeParse({}).success).toBe(false);
	});

	test("pause holds the clock and resume starts it again", async () => {
		await tool("start_timer").run(mine(), {
			taskId: devTaskId,
			description: "Held",
		});
		const paused = timerResult.parse(await tool("pause_timer").run(mine(), {}));
		expect(paused.timer?.state).toBe("paused");
		const resumed = timerResult.parse(
			await tool("resume_timer").run(mine(), {}),
		);
		expect(resumed.timer?.state).toBe("running");
	});

	test("pause and resume refuse when nothing runs", async () => {
		await expect(tool("pause_timer").run(mine(), {})).rejects.toThrow(
			"No timer is running",
		);
		await expect(tool("resume_timer").run(mine(), {})).rejects.toThrow(
			"No timer is running",
		);
	});

	test("a timer in another workspace is not driven from this one", async () => {
		await tool("start_timer").run(mine(), {
			taskId: devTaskId,
			description: "Held",
		});
		await expect(tool("pause_timer").run(mineElsewhere(), {})).rejects.toThrow(
			"belongs to Timer tools",
		);
		await expect(
			tool("stop_timer").run(mineElsewhere(), { description: "x" }),
		).rejects.toThrow("belongs to Timer tools");
		const [row] = await timers();
		expect(present(row, "timer").runningSince).not.toBeNull();
	});
});

describe("stop_timer", () => {
	test("a refused entry leaves the timer and its time", async () => {
		await tool("start_timer").run(mine(), { taskId: devTaskId });
		// The task needs a note and the timer has none.
		await expect(tool("stop_timer").run(mine(), {})).rejects.toThrow(
			"Describe what you worked on",
		);
		expect(await timers()).toHaveLength(1);
		expect(await db.select().from(timeEntry)).toHaveLength(0);
	});

	test("logs one entry, snapped to a quarter hour, and clears the timer", async () => {
		await tool("start_timer").run(mine(), {
			projectId,
			taskId: devTaskId,
			headStartSeconds: 40 * 60,
		});
		const result = loggedResult.parse(
			await tool("stop_timer").run(mine(), { description: "Did the work" }),
		);
		// 40 minutes of head start, snapped to the nearest 15: 45 minutes.
		expect(result.logged.hours).toBe(0.75);
		expect(result.logged.description).toBe("Did the work");
		expect(await timers()).toHaveLength(0);
		const entries = await db.select().from(timeEntry);
		expect(entries).toHaveLength(1);
		expect(at(entries, 0).userId).toBe(ME);
		expect(at(entries, 0).organizationId).toBe(ORG);
	});

	test("a colleague has no timer to stop", async () => {
		await tool("start_timer").run(mine(), {
			taskId: devTaskId,
			description: "Mine",
		});
		await expect(
			tool("stop_timer").run(colleague(), { description: "Not theirs" }),
		).rejects.toThrow("No timer is running");
		expect(await timers()).toHaveLength(1);
	});
});

describe("discard_timer", () => {
	test("names the timer on the approval card", async () => {
		await tool("start_timer").run(mine(), {
			taskId: devTaskId,
			description: "Card",
			headStartSeconds: 3600,
		});
		expect(await tool("discard_timer").summarize?.(mine(), {})).toBe(
			"Discard the timer on Development (1.00h measured)",
		);
	});

	test("throws the timer away and logs nothing", async () => {
		await tool("start_timer").run(mine(), {
			taskId: devTaskId,
			description: "Gone",
		});
		const result = await tool("discard_timer").run(mine(), {});
		expect(result).toMatchObject({ discarded: true });
		expect(await timers()).toHaveLength(0);
		expect(await db.select().from(timeEntry)).toHaveLength(0);
	});

	test("says so when nothing runs", async () => {
		await expect(tool("discard_timer").run(mine(), {})).rejects.toThrow(
			"No timer is running",
		);
	});

	test("does not delete a timer that runs in another workspace", async () => {
		await tool("start_timer").run(mine(), {
			taskId: devTaskId,
			description: "Stays",
		});
		await expect(
			tool("discard_timer").run(mineElsewhere(), {}),
		).rejects.toThrow("belongs to Timer tools");
		expect(await timers()).toHaveLength(1);
	});

	test("a colleague's discard touches nothing", async () => {
		await tool("start_timer").run(mine(), {
			taskId: devTaskId,
			description: "Stays",
		});
		await expect(tool("discard_timer").run(colleague(), {})).rejects.toThrow(
			"No timer is running",
		);
		expect(await timers()).toHaveLength(1);
	});

	test("clears the notice of a dropped timer from any workspace", async () => {
		await tool("start_timer").run(mine(), {
			taskId: devTaskId,
			description: "Dropped",
		});
		await db.update(runningTimer).set({ droppedAt: new Date() });
		await tool("discard_timer").run(mineElsewhere(), {});
		expect(
			await db.select().from(runningTimer).where(eq(runningTimer.userId, ME)),
		).toHaveLength(0);
	});
});
