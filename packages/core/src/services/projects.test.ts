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

import { eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import {
	client,
	project,
	projectMember,
	task,
	timeEntry,
} from "../db/schema/domain";
import { memberProfile } from "../db/schema/people";
import { createTestDb, type TestDb } from "../test/harness";
import { AccessError, NotAMemberError } from "./access.service";
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
let clientId: string;

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
	clientId = c.id;

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
	// this project and learns nothing about it beyond its existence and their
	// own time on it — the end of the file pins that the figure stays their own
	// once somebody else logs there too.
	test("a plain member gets their own hours and no contributors", async () => {
		const [row] = await listFor(PLAIN);
		expect(row?.statsScope).toBe("own");
		expect(row?.monthlyTotalSeconds).toBe(4 * HOUR);
		expect(row?.allTimeSeconds).toBe(4 * HOUR);
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

// Last on purpose: the positive case writes an assignment, and every block
// above reads the fixture's assignments as they were seeded.
describe("assignMember", () => {
	/** A member of the org with no assignment, archived or not. */
	const seedMember = async (id: string, archived: boolean) => {
		await db.insert(user).values({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await db.insert(member).values({
			id: `m-${id}`,
			organizationId: ORG,
			userId: id,
			role: "member",
			createdAt: new Date(),
		});
		if (archived) {
			await db.insert(memberProfile).values({
				organizationId: ORG,
				userId: id,
				archivedAt: new Date(),
			});
		}
	};

	const assign = (userId: string) =>
		projectsService.assignMember(ctx(ADMIN), {
			projectId: unassignedId,
			userId,
			role: "member",
		});

	// The capability check asks whether the ADMIN may staff the project; it
	// never asked whether the person named is in the org at all.
	test("refuses somebody who is not a member of the org", async () => {
		await expect(assign(OUTSIDER)).rejects.toThrow(/not a member/);
	});

	// `listAssignable` hides archived people; the service used to take them
	// anyway from any caller that was not the picker.
	test("refuses an archived member", async () => {
		await seedMember("u-projects-archived", true);
		await expect(assign("u-projects-archived")).rejects.toThrow(/archived/);
	});

	test("assigns an active member", async () => {
		await seedMember("u-projects-fresh", false);
		await assign("u-projects-fresh");
		const team = await projectsService.listMembers(ctx(ADMIN), unassignedId);
		expect(team.map((m) => m.userId)).toContain("u-projects-fresh");
	});
});

// The role-escalation guard on assignMember/removeMember: `canManageProjectMembers`
// only asks whether the caller may touch the roster at all (Team Lead and up),
// never how high they may set it or whether the person they are touching
// already outranks them. A dedicated project and dedicated PM/Team Lead here,
// so promoting or removing someone cannot leak into the fixtures every other
// block in this file depends on.
describe("project role escalation", () => {
	const ESC_PM = "u-projects-esc-pm";
	const ESC_LEAD = "u-projects-esc-lead";
	let escProjectId: string;

	const seedMember = async (id: string) => {
		await db.insert(user).values({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await db.insert(member).values({
			id: `m-${id}`,
			organizationId: ORG,
			userId: id,
			role: "member",
			createdAt: new Date(),
		});
	};

	beforeAll(async () => {
		await seedMember(ESC_PM);
		await seedMember(ESC_LEAD);
		const [p] = await db
			.insert(project)
			.values({
				organizationId: ORG,
				clientId,
				name: "Escalation",
			})
			.returning();
		if (!p) throw new Error("project");
		escProjectId = p.id;
		await db.insert(projectMember).values([
			{
				organizationId: ORG,
				projectId: escProjectId,
				userId: ESC_PM,
				role: "pm",
			},
			{
				organizationId: ORG,
				projectId: escProjectId,
				userId: ESC_LEAD,
				role: "team_lead",
			},
		]);
	});

	test("a team lead cannot promote themselves to pm", async () => {
		await expect(
			projectsService.assignMember(ctx(ESC_LEAD), {
				projectId: escProjectId,
				userId: ESC_LEAD,
				role: "pm",
			}),
		).rejects.toThrow(AccessError);
	});

	test("a team lead cannot promote someone else to pm", async () => {
		await expect(
			projectsService.assignMember(ctx(ESC_LEAD), {
				projectId: escProjectId,
				userId: ESC_PM,
				role: "pm",
			}),
		).rejects.toThrow(AccessError);
	});

	test("a team lead cannot remove the pm", async () => {
		await expect(
			projectsService.removeMember(ctx(ESC_LEAD), {
				projectId: escProjectId,
				userId: ESC_PM,
			}),
		).rejects.toThrow(AccessError);
	});

	test("a team lead can add a plain member", async () => {
		const newbie = "u-projects-esc-newbie";
		await seedMember(newbie);
		await projectsService.assignMember(ctx(ESC_LEAD), {
			projectId: escProjectId,
			userId: newbie,
			role: "member",
		});
		const team = await projectsService.listMembers(ctx(ESC_PM), escProjectId);
		const row = team.find((m) => m.userId === newbie);
		expect(row?.role).toBe("member");
	});

	test("an admin can promote, demote and remove without restriction", async () => {
		await projectsService.assignMember(ctx(ADMIN), {
			projectId: escProjectId,
			userId: ESC_LEAD,
			role: "pm",
		});
		let team = await projectsService.listMembers(ctx(ADMIN), escProjectId);
		expect(team.find((m) => m.userId === ESC_LEAD)?.role).toBe("pm");

		await projectsService.assignMember(ctx(ADMIN), {
			projectId: escProjectId,
			userId: ESC_LEAD,
			role: "member",
		});
		team = await projectsService.listMembers(ctx(ADMIN), escProjectId);
		expect(team.find((m) => m.userId === ESC_LEAD)?.role).toBe("member");

		await projectsService.removeMember(ctx(ADMIN), {
			projectId: escProjectId,
			userId: ESC_PM,
		});
		team = await projectsService.listMembers(ctx(ADMIN), escProjectId);
		expect(team.find((m) => m.userId === ESC_PM)?.active).toBe(false);
	});
});

// ── The project page ───────────────────────────────────────────────────────

describe("the project overview", () => {
	const today = new Date().toISOString().slice(0, 10);

	test("an admin gets the whole history in five numbers", async () => {
		const overview = await projectsService.overview(ctx(ADMIN), assignedId);
		expect(overview).toMatchObject({
			allTimeSeconds: 4 * HOUR,
			entryCount: 1,
			peopleCount: 1,
			firstEntry: today,
			lastEntry: today,
			overtimeSeconds: 0,
			monthSeconds: 4 * HOUR,
			monthPeople: 1,
		});
	});

	test("a team lead gets it for their project", async () => {
		const overview = await projectsService.overview(ctx(LEAD), assignedId);
		expect(overview.allTimeSeconds).toBe(4 * HOUR);
	});

	test("a plain member is refused — nothing at project level, not even totals", async () => {
		await expect(
			projectsService.overview(ctx(PLAIN), assignedId),
		).rejects.toThrow(AccessError);
	});

	test("a project nobody logged on reads as empty, not as an error", async () => {
		const overview = await projectsService.overview(ctx(ADMIN), unassignedId);
		expect(overview).toMatchObject({
			allTimeSeconds: 0,
			entryCount: 0,
			peopleCount: 0,
			firstEntry: null,
			lastEntry: null,
		});
	});
});

describe("the team roster", () => {
	test("carries what each person ever logged here, and when they last did", async () => {
		const today = new Date().toISOString().slice(0, 10);
		const rows = await projectsService.listMembers(ctx(LEAD), assignedId);
		const plain = rows.find((r) => r.userId === PLAIN);
		expect(plain?.allTimeSeconds).toBe(4 * HOUR);
		expect(plain?.lastEntry).toBe(today);
		const lead = rows.find((r) => r.userId === LEAD);
		expect(lead?.allTimeSeconds).toBe(0);
		expect(lead?.lastEntry).toBeNull();
	});
});

describe("the icon", () => {
	test("a PM sets it, everyone reads it, null clears it", async () => {
		const updated = await projectsService.update(ctx(PM), {
			projectId: assignedId,
			icon: "🍷",
		});
		expect(updated.icon).toBe("🍷");
		const seen = await projectsService.get(ctx(LEAD), assignedId);
		expect(seen.icon).toBe("🍷");

		const cleared = await projectsService.update(ctx(PM), {
			projectId: assignedId,
			icon: null,
		});
		expect(cleared.icon).toBeNull();
	});

	test("the list carries each project's all-time hours beside the month's", async () => {
		const rows = await listFor(ADMIN);
		const assigned = rows.find((r) => r.id === assignedId);
		expect(assigned?.allTimeSeconds).toBe(4 * HOUR);
		expect(assigned?.monthlyTotalSeconds).toBe(4 * HOUR);
	});
});

// Last in the file: the entry below changes the project's totals, which every
// case above reads as 4 hours.
describe("a plain member's figures with somebody else on the project", () => {
	beforeAll(async () => {
		const [row] = await db
			.select({ taskId: timeEntry.taskId })
			.from(timeEntry)
			.where(eq(timeEntry.projectId, assignedId))
			.limit(1);
		if (!row) throw new Error("fixture entry");
		await db.insert(timeEntry).values({
			organizationId: ORG,
			userId: LEAD,
			projectId: assignedId,
			taskId: row.taskId,
			date: new Date().toISOString().slice(0, 10),
			durationSeconds: 2 * HOUR,
			description: "lead work",
		});
	});

	test("they stay their own, never the project's total", async () => {
		const [row] = await listFor(PLAIN);
		expect(row?.monthlyTotalSeconds).toBe(4 * HOUR);
		expect(row?.allTimeSeconds).toBe(4 * HOUR);
	});

	test("a team lead reads the whole project", async () => {
		const [row] = await listFor(LEAD);
		expect(row?.statsScope).toBe("project");
		expect(row?.monthlyTotalSeconds).toBe(6 * HOUR);
	});
});

// After the block above, which reads the plain member's first row: this block
// opens the unassigned project, and closes it again at the end.
describe("a project open to the organization", () => {
	test("a PM of another project cannot open it", async () => {
		await expect(
			projectsService.update(ctx(PM), {
				projectId: unassignedId,
				openToOrg: true,
			}),
		).rejects.toBeInstanceOf(AccessError);
	});

	test("once open, a plain member may track on it and gains nothing more", async () => {
		const updated = await projectsService.update(ctx(ADMIN), {
			projectId: unassignedId,
			openToOrg: true,
		});
		expect(updated.openToOrg).toBe(true);

		expect(names(await projectsService.listMine(ctx(PLAIN)))).toEqual([
			"Assigned",
			"Unassigned",
		]);
		await projectsService.assertProjectMembership(ctx(PLAIN), unassignedId);

		const seen = await projectsService.get(ctx(PLAIN), unassignedId);
		expect(seen.myRole).toBeNull();
		expect(seen.statsScope).toBe("own");
		expect(seen.hourlyPrice).toBeNull();
		await expect(
			projectsService.listMembers(ctx(PLAIN), unassignedId),
		).rejects.toBeInstanceOf(AccessError);
		await expect(
			projectsService.update(ctx(PLAIN), {
				projectId: unassignedId,
				openToOrg: false,
			}),
		).rejects.toBeInstanceOf(AccessError);
	});

	test("closing it takes the access away again", async () => {
		await projectsService.update(ctx(ADMIN), {
			projectId: unassignedId,
			openToOrg: false,
		});
		expect(names(await projectsService.listMine(ctx(PLAIN)))).toEqual([
			"Assigned",
		]);
		await expect(
			projectsService.assertProjectMembership(ctx(PLAIN), unassignedId),
		).rejects.toBeInstanceOf(AccessError);
	});
});
