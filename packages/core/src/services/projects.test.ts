// What the projects list is allowed to tell you.
//
// `projects.service` had no test, and the gap hid a real hole: `list` carried
// the docstring "Every project in the org. Admin-facing", resolved `Access`
// only to redact the two money fields, and asserted nothing. `orgMiddleware`
// was the entire gate, so any member — and `GET /api/v1/projects` — could
// enumerate every project in the organization along with its client and its
// month's hours. §4 says a Member sees nothing at project level, "not even the
// project's total hours", and nothing checked the sentence.
//
// So the three things asserted here are the three the payload can leak, each
// on a different axis:
//
//   * WHICH projects come back (the scope),
//   * the money fields (PM and Admin only),
//   * the project-level statistics (Team Lead and up).
//
// Money and statistics are separate cases on purpose: they have different
// thresholds, and a Team Lead is precisely the role that must have one and not
// the other.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import {
	client,
	project,
	projectMember,
	task,
	timeEntry,
} from "../db/schema/domain";
import { createTestDb, type TestDb } from "../test/harness";
import { NotAMemberError } from "./access.service";
import { projectsService } from "./projects.service";
import type { Ctx } from "./types";

const ORG = "org-projects";

const ADMIN = "u-projects-admin";
const PM = "u-projects-pm";
const LEAD = "u-projects-lead";
const PLAIN = "u-projects-plain";
const OUTSIDER = "u-projects-outsider";

const HOUR = 3600;

let harness: TestDb;
let assignedId: string;
let unassignedId: string;

/** A fresh Ctx per call: `Access` is memoized onto the object, and these tests
 *  deliberately resolve the same person under different fixtures. */
const ctx = (userId: string): Ctx => ({ organizationId: ORG, userId });

const listFor = (userId: string) => projectsService.list(ctx(userId));

const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG,
		name: "Projects Org",
		slug: ORG,
		createdAt: new Date(),
	});

	await db.insert(user).values(
		[ADMIN, PM, LEAD, PLAIN, OUTSIDER].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);

	// OUTSIDER deliberately gets no membership row — they are a signed-in user
	// whose session still names this org.
	await db.insert(member).values(
		[
			{ userId: ADMIN, role: "admin" },
			{ userId: PM, role: "member" },
			{ userId: LEAD, role: "member" },
			{ userId: PLAIN, role: "member" },
		].map((m) => ({
			id: `m-${m.userId}`,
			organizationId: ORG,
			userId: m.userId,
			role: m.role,
			createdAt: new Date(),
		})),
	);

	const [c] = await db
		.insert(client)
		.values({ organizationId: ORG, name: "Acme" })
		.returning();
	if (!c) throw new Error("client");

	const [assigned, unassigned] = await db
		.insert(project)
		.values([
			{
				organizationId: ORG,
				clientId: c.id,
				name: "Assigned",
				budgetSeconds: 100 * HOUR,
				budgetAmount: "12000.00",
				hourlyPrice: "85.00",
			},
			{
				organizationId: ORG,
				clientId: c.id,
				name: "Unassigned",
				budgetAmount: "9000.00",
				hourlyPrice: "70.00",
			},
		])
		.returning();
	if (!assigned || !unassigned) throw new Error("projects");
	assignedId = assigned.id;
	unassignedId = unassigned.id;

	// Everyone but the admin is assigned to exactly one of the two projects, at
	// three different roles — so "what may I see" varies while "what exists"
	// does not.
	await db.insert(projectMember).values(
		[
			{ userId: PM, role: "pm" as const },
			{ userId: LEAD, role: "team_lead" as const },
			{ userId: PLAIN, role: "member" as const },
		].map((m) => ({
			organizationId: ORG,
			projectId: assignedId,
			userId: m.userId,
			role: m.role,
		})),
	);

	// Time on the assigned project, dated today so it lands in the current
	// month's stats window that `loadProjectStats` asks for.
	const [work] = await db
		.insert(task)
		.values({
			organizationId: ORG,
			scope: "organization",
			name: "Development",
			systemKey: "development",
		})
		.returning();
	if (!work) throw new Error("task");

	const today = new Date().toISOString().slice(0, 10);
	await db.insert(timeEntry).values({
		organizationId: ORG,
		userId: PLAIN,
		projectId: assignedId,
		taskId: work.id,
		date: today,
		durationSeconds: 4 * HOUR,
		description: "work",
	});
});

afterAll(async () => {
	await harness.close();
});

describe("which projects come back", () => {
	// The regression this file exists for.
	test("a plain member sees only their assignments, not the org", async () => {
		expect(names(await listFor(PLAIN))).toEqual(["Assigned"]);
	});

	test("a team lead sees only their assignments", async () => {
		expect(names(await listFor(LEAD))).toEqual(["Assigned"]);
	});

	// A PM is unscoped on close and money for the projects they run, and still
	// has no window onto a project they are not on.
	test("a PM sees only their assignments", async () => {
		expect(names(await listFor(PM))).toEqual(["Assigned"]);
	});

	test("an admin sees every project, assigned or not", async () => {
		expect(names(await listFor(ADMIN))).toEqual(["Assigned", "Unassigned"]);
	});

	// The membership precondition, through a service rather than through
	// `resolve` directly — this is the shape `GET /api/v1/projects` had.
	test("a non-member is refused rather than served an empty list", async () => {
		expect(listFor(OUTSIDER)).rejects.toBeInstanceOf(NotAMemberError);
	});
});

describe("the money fields", () => {
	const moneyOf = (row: {
		budgetAmount: string | null;
		hourlyPrice: string | null;
	}) => [row.budgetAmount, row.hourlyPrice];

	test("a PM receives them for the project they run", async () => {
		const [row] = await listFor(PM);
		expect(row && moneyOf(row)).toEqual(["12000.00", "85.00"]);
	});

	test("an admin receives them everywhere", async () => {
		const rows = await listFor(ADMIN);
		expect(rows.every((r) => r.hourlyPrice !== null)).toBe(true);
	});

	// Stripped from the payload rather than hidden in the UI: a Team Lead never
	// receives them over the wire, which is the point of redacting server-side.
	test("a team lead does not receive them", async () => {
		const [row] = await listFor(LEAD);
		expect(row && moneyOf(row)).toEqual([null, null]);
		expect(row?.budgetSeconds).toBeNull();
	});

	test("a plain member does not receive them", async () => {
		const [row] = await listFor(PLAIN);
		expect(row && moneyOf(row)).toEqual([null, null]);
	});
});

describe("the project-level statistics", () => {
	// The §4 line in full: "not even the project's total hours". A Member is on
	// this project and still learns nothing about it beyond its existence.
	test("a plain member gets no hours and no contributors", async () => {
		const [row] = await listFor(PLAIN);
		expect(row?.monthlyTotalSeconds).toBe(0);
		expect(row?.contributors).toEqual([]);
		expect(row?.contributorCount).toBe(0);
	});

	// Visibility is where Team Lead begins, so the same row carries real numbers
	// one role up — the two assertions together are what make this a threshold
	// rather than a blanket.
	test("a team lead gets the real hours and contributors", async () => {
		const [row] = await listFor(LEAD);
		expect(row?.monthlyTotalSeconds).toBe(4 * HOUR);
		expect(row?.contributorCount).toBe(3);
	});

	test("an admin gets them on a project they are not assigned to", async () => {
		const rows = await listFor(ADMIN);
		const assigned = rows.find((r) => r.id === assignedId);
		expect(assigned?.monthlyTotalSeconds).toBe(4 * HOUR);
	});

	// `myRole` is the caller's real assignment, never synthesised — an admin
	// reads null here, which is what the close sheet's "your projects" filter
	// depends on.
	test("an admin's own role stays null on a project they are not on", async () => {
		const rows = await listFor(ADMIN);
		expect(rows.find((r) => r.id === unassignedId)?.myRole).toBeNull();
		expect(rows.find((r) => r.id === assignedId)?.myRole).toBeNull();
	});
});

describe("listMine", () => {
	// `list` and `listMine` agree for everyone except an admin, where they
	// answer different questions: everything worth looking at, versus everything
	// they may log time against (which for an admin is also everything).
	test("returns the caller's assignments", async () => {
		const rows = await projectsService.listMine(ctx(PLAIN));
		expect(names(rows)).toEqual(["Assigned"]);
	});

	test("an admin may track on every project", async () => {
		const rows = await projectsService.listMine(ctx(ADMIN));
		expect(names(rows)).toEqual(["Assigned", "Unassigned"]);
	});
});
