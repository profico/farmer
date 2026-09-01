// The §4 capability matrix, pinned.
//
// `access.service` is the one place that decides who may see a project's money,
// who may close a month, and who may correct somebody else's absence — and it
// had no test at all. Everything downstream (close, reports, projects, members)
// opens by asking it, so a wrong answer here is a wrong answer everywhere, and
// the failure mode is silent: a Team Lead quietly gaining the money columns
// looks exactly like a Team Lead who was supposed to have them.
//
// Two halves, deliberately tested differently:
//
//   * `Access` itself is pure — a role map and an admin flag — so the matrix is
//     exercised by constructing one directly. No database, no fixtures, and one
//     assertion per cell of the table in §4.1.
//   * `accessService.resolve` is the part that can only be got wrong against a
//     real database: the org predicate, the `active` filter, and the
//     owner-counts-as-admin mapping. That half runs on PGLite (src/test/harness)
//     for the same reason guards.tenancy.test.ts does — the interesting bugs
//     live in the WHERE clause.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { client, project, projectMember } from "../db/schema/domain";
import { createTestDb, type TestDb } from "../test/harness";
import {
	Access,
	AccessError,
	accessService,
	NotAMemberError,
} from "./access.service";

// ── The pure half: the capability matrix ────────────────────────────────────

/** An `Access` with the given assignments, admin flag off unless stated. */
const accessWith = (
	roles: Record<string, "member" | "team_lead" | "pm">,
	isAdmin = false,
) =>
	new Access(
		"u1",
		"org1",
		isAdmin,
		// SAFETY: `Object.entries` widens the value type to `string`; `roles` is the
		// test's own literal, declared one line up with exactly this union.
		new Map(Object.entries(roles)) as ReadonlyMap<
			string,
			"member" | "team_lead" | "pm"
		>,
	);

const P = "project-1";
const OTHER = "project-2";

describe("Access — the §4.1 capability matrix", () => {
	// One row of the matrix per case. Written as a table so a future capability
	// is a column added here rather than a new test that only covers one role.
	const CASES = [
		{
			label: "unassigned",
			access: accessWith({}),
			canTrackOn: false,
			canViewProjectEntries: false,
			canManageProjectMembers: false,
			canViewProjectMoney: false,
			canCloseProject: false,
		},
		{
			label: "member",
			access: accessWith({ [P]: "member" }),
			canTrackOn: true,
			canViewProjectEntries: false,
			canManageProjectMembers: false,
			canViewProjectMoney: false,
			canCloseProject: false,
		},
		{
			label: "team_lead",
			access: accessWith({ [P]: "team_lead" }),
			canTrackOn: true,
			canViewProjectEntries: true,
			canManageProjectMembers: true,
			// The line the whole class exists to hold: visibility and team
			// management, but never money and never close.
			canViewProjectMoney: false,
			canCloseProject: false,
		},
		{
			label: "pm",
			access: accessWith({ [P]: "pm" }),
			canTrackOn: true,
			canViewProjectEntries: true,
			canManageProjectMembers: true,
			canViewProjectMoney: true,
			canCloseProject: true,
		},
		{
			label: "admin with no assignment",
			access: accessWith({}, true),
			canTrackOn: true,
			canViewProjectEntries: true,
			canManageProjectMembers: true,
			canViewProjectMoney: true,
			canCloseProject: true,
		},
	] as const;

	for (const c of CASES) {
		test(`${c.label}`, () => {
			expect(c.access.canTrackOn(P)).toBe(c.canTrackOn);
			expect(c.access.canViewProjectEntries(P)).toBe(c.canViewProjectEntries);
			expect(c.access.canManageProjectMembers(P)).toBe(
				c.canManageProjectMembers,
			);
			expect(c.access.canViewProjectMoney(P)).toBe(c.canViewProjectMoney);
			expect(c.access.canCloseProject(P)).toBe(c.canCloseProject);
		});
	}

	test("a role on one project grants nothing on another", () => {
		const access = accessWith({ [P]: "pm" });
		expect(access.canCloseProject(P)).toBe(true);
		expect(access.canCloseProject(OTHER)).toBe(false);
		expect(access.canTrackOn(OTHER)).toBe(false);
	});
});

describe("Access.roleOn", () => {
	test("returns the assigned role", () => {
		expect(accessWith({ [P]: "team_lead" }).roleOn(P)).toBe("team_lead");
	});

	test("returns null when unassigned", () => {
		expect(accessWith({}).roleOn(P)).toBeNull();
	});

	// Documented and load-bearing: the close sheet's "your projects" filter reads
	// this to show an admin their REAL assignments. Synthesising a PM role here
	// would make every project look like theirs.
	test("does not synthesise a role for an admin", () => {
		const admin = accessWith({}, true);
		expect(admin.roleOn(P)).toBeNull();
		expect(admin.canCloseProject(P)).toBe(true);
	});

	test("assignments() excludes the admin override", () => {
		expect(accessWith({ [P]: "member" }, true).assignments()).toEqual([
			[P, "member"],
		]);
		expect(accessWith({}, true).assignments()).toEqual([]);
	});
});

describe("Access.scopeFor", () => {
	// null means "unscoped", which callers turn into no project filter at all.
	// Returning every id instead would put a 200-element IN list in every admin
	// query, and — worse — silently scope an admin to the projects that existed
	// when the picture was resolved.
	test("admins are unscoped (null), not enumerated", () => {
		expect(accessWith({ [P]: "member" }, true).scopeFor("pm")).toBeNull();
	});

	test("filters by rank for a non-admin", () => {
		const access = accessWith({
			a: "member",
			b: "team_lead",
			c: "pm",
		});
		// Sorted copy, and null treated as a failure rather than an empty list:
		// null here would mean the admin override leaked into a non-admin.
		const scope = (role: "member" | "team_lead" | "pm") => {
			const ids = access.scopeFor(role);
			if (ids === null) throw new Error("expected a scoped, non-admin answer");
			return [...ids].sort();
		};
		expect(scope("member")).toEqual(["a", "b", "c"]);
		expect(scope("team_lead")).toEqual(["b", "c"]);
		expect(scope("pm")).toEqual(["c"]);
	});

	// An empty array is a real answer ("nothing"), distinct from null
	// ("everything"). Conflating them would hand a member the whole org.
	test("returns an empty array, not null, when nothing qualifies", () => {
		expect(accessWith({ a: "member" }).scopeFor("pm")).toEqual([]);
	});
});

describe("Access.canCreateProjects", () => {
	test("requires team_lead or above somewhere", () => {
		expect(accessWith({}).canCreateProjects()).toBe(false);
		expect(accessWith({ a: "member" }).canCreateProjects()).toBe(false);
		expect(accessWith({ a: "team_lead" }).canCreateProjects()).toBe(true);
		expect(accessWith({ a: "pm" }).canCreateProjects()).toBe(true);
	});

	test("admins may regardless of assignment", () => {
		expect(accessWith({}, true).canCreateProjects()).toBe(true);
	});
});

describe("Access.canOverrideAbsenceFor", () => {
	// PM of ANY project the person is on is enough — the person's absence is org
	// -wide, so there is no per-project absence to be PM of.
	test("true when PM of at least one of the person's projects", () => {
		const access = accessWith({ a: "pm", b: "member" });
		expect(access.canOverrideAbsenceFor(["b", "a"])).toBe(true);
	});

	test("false for a team lead — this is a PM capability", () => {
		expect(accessWith({ a: "team_lead" }).canOverrideAbsenceFor(["a"])).toBe(
			false,
		);
	});

	test("false when the person shares no project with the caller", () => {
		expect(accessWith({ a: "pm" }).canOverrideAbsenceFor(["b"])).toBe(false);
	});

	test("false for an empty project list unless admin", () => {
		expect(accessWith({ a: "pm" }).canOverrideAbsenceFor([])).toBe(false);
		expect(accessWith({}, true).canOverrideAbsenceFor([])).toBe(true);
	});
});

describe("Access assertions", () => {
	test("throw AccessError, not a bare Error", () => {
		try {
			accessWith({}).assertAdmin();
			throw new Error("should have thrown");
		} catch (error) {
			if (!(error instanceof AccessError)) throw error;
			expect(error.name).toBe("AccessError");
		}
	});

	test("each assertion mirrors its capability", () => {
		const nobody = accessWith({});
		expect(() => nobody.assertAdmin()).toThrow("Admin access required");
		expect(() => nobody.assertCanTrackOn(P)).toThrow("not assigned");
		expect(() => nobody.assertCanViewProjectEntries(P)).toThrow("cannot view");
		expect(() => nobody.assertCanManageProjectMembers(P)).toThrow(
			"cannot manage",
		);
		expect(() => nobody.assertCanCloseProject(P)).toThrow("cannot close");
		expect(() => nobody.assertCanCreateProjects()).toThrow("cannot create");
	});

	test("a PM passes every project-level assertion it should", () => {
		const pm = accessWith({ [P]: "pm" });
		expect(() => pm.assertCanTrackOn(P)).not.toThrow();
		expect(() => pm.assertCanViewProjectEntries(P)).not.toThrow();
		expect(() => pm.assertCanManageProjectMembers(P)).not.toThrow();
		expect(() => pm.assertCanCloseProject(P)).not.toThrow();
		expect(() => pm.assertCanCreateProjects()).not.toThrow();
		// ...but is still not an admin.
		expect(() => pm.assertAdmin()).toThrow(AccessError);
	});
});

// ── The database half: resolve() ────────────────────────────────────────────

let harness: TestDb;

const ORG = "acc-org";
const OTHER_ORG = "acc-org-other";
let projectAId: string;
let projectBId: string;
let projectOtherOrgId: string;

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values([
		{ id: ORG, name: "Access Org", slug: "acc-org", createdAt: new Date() },
		{
			id: OTHER_ORG,
			name: "Other Org",
			slug: "acc-org-other",
			createdAt: new Date(),
		},
	]);

	await db.insert(user).values(
		["owner", "admin", "plain", "lead", "outsider"].map((id) => ({
			id: `u-${id}`,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);

	await db.insert(member).values([
		{
			id: "m-owner",
			organizationId: ORG,
			userId: "u-owner",
			role: "owner",
			createdAt: new Date(),
		},
		{
			id: "m-admin",
			organizationId: ORG,
			userId: "u-admin",
			role: "admin",
			createdAt: new Date(),
		},
		{
			id: "m-plain",
			organizationId: ORG,
			userId: "u-plain",
			role: "member",
			createdAt: new Date(),
		},
		{
			id: "m-lead",
			organizationId: ORG,
			userId: "u-lead",
			role: "member",
			createdAt: new Date(),
		},
		// Same person, admin in the OTHER org only — the cross-org check below.
		{
			id: "m-out",
			organizationId: OTHER_ORG,
			userId: "u-outsider",
			role: "admin",
			createdAt: new Date(),
		},
	]);

	const [clientA, clientOther] = await db
		.insert(client)
		.values([
			{ organizationId: ORG, name: "Client A" },
			{ organizationId: OTHER_ORG, name: "Client Other" },
		])
		.returning();
	if (!clientA || !clientOther) throw new Error("Failed to seed clients");

	const [projectA, projectB, projectOther] = await db
		.insert(project)
		.values([
			{ organizationId: ORG, clientId: clientA.id, name: "A" },
			{ organizationId: ORG, clientId: clientA.id, name: "B" },
			{ organizationId: OTHER_ORG, clientId: clientOther.id, name: "Other" },
		])
		.returning();
	if (!projectA || !projectB || !projectOther) {
		throw new Error("Failed to seed projects");
	}
	projectAId = projectA.id;
	projectBId = projectB.id;
	projectOtherOrgId = projectOther.id;

	await db.insert(projectMember).values([
		// The lead: active PM on A, and an INACTIVE PM row on B.
		{
			organizationId: ORG,
			projectId: projectAId,
			userId: "u-lead",
			role: "pm",
			active: true,
		},
		{
			organizationId: ORG,
			projectId: projectBId,
			userId: "u-lead",
			role: "pm",
			active: false,
		},
		// A plain member assignment.
		{
			organizationId: ORG,
			projectId: projectAId,
			userId: "u-plain",
			role: "member",
			active: true,
		},
		// An assignment in the other org for the same person, to prove the org
		// predicate does the work rather than the project id happening to differ.
		{
			organizationId: OTHER_ORG,
			projectId: projectOtherOrgId,
			userId: "u-plain",
			role: "pm",
			active: true,
		},
	]);
});

afterAll(async () => {
	await harness.close();
});

describe("accessService.resolve", () => {
	test("maps better-auth 'owner' to admin", async () => {
		const access = await accessService.resolve({
			organizationId: ORG,
			userId: "u-owner",
		});
		expect(access.isAdmin).toBe(true);
	});

	test("maps better-auth 'admin' to admin", async () => {
		const access = await accessService.resolve({
			organizationId: ORG,
			userId: "u-admin",
		});
		expect(access.isAdmin).toBe(true);
	});

	test("a plain member is not an admin", async () => {
		const access = await accessService.resolve({
			organizationId: ORG,
			userId: "u-plain",
		});
		expect(access.isAdmin).toBe(false);
	});

	// The membership row is what makes someone an admin, and it is org-scoped.
	// An admin of another organization must not arrive here as an admin.
	//
	// It used to resolve to "nobody" — isAdmin false, no assignments — which
	// answers the project-level questions correctly and the prior question not
	// at all. "Nobody" is still a caller: every org-wide read that only filters
	// on organizationId (clients, tasks, org settings) served it happily. So a
	// resolve for a non-member now refuses instead of describing them.
	test("an admin of another org is refused, not described as nobody", async () => {
		expect(
			accessService.resolve({ organizationId: ORG, userId: "u-outsider" }),
		).rejects.toBeInstanceOf(NotAMemberError);
	});

	test("a user with no membership at all is refused", async () => {
		expect(
			accessService.resolve({
				organizationId: ORG,
				userId: "u-does-not-exist",
			}),
		).rejects.toBeInstanceOf(NotAMemberError);
	});

	// The case the refusal is actually for: someone who WAS a member. Their
	// session still names this organization — better-auth does not invalidate
	// sessions when a membership is deleted — so their Ctx is indistinguishable
	// from a current member's until this query runs.
	test("a removed member is refused even though their Ctx still names the org", async () => {
		await db.insert(member).values({
			id: "m-transient",
			organizationId: ORG,
			userId: "u-outsider",
			role: "member",
			createdAt: new Date(),
		});
		const ctx = { organizationId: ORG, userId: "u-outsider" };
		expect((await accessService.resolve(ctx)).isAdmin).toBe(false);

		await db.delete(member).where(eq(member.id, "m-transient"));

		expect(accessService.resolve(ctx)).rejects.toBeInstanceOf(NotAMemberError);
	});

	// An inactive assignment keeps the person on historical close sheets but
	// grants nothing going forward — so it must not appear in the picture.
	test("inactive assignments grant nothing", async () => {
		const access = await accessService.resolve({
			organizationId: ORG,
			userId: "u-lead",
		});
		expect(access.roleOn(projectAId)).toBe("pm");
		expect(access.roleOn(projectBId)).toBeNull();
		expect(access.canCloseProject(projectBId)).toBe(false);
	});

	// The cross-tenant case: u-plain is a PM in OTHER_ORG. Resolving them under
	// ORG must not leak that role, or a member would silently hold PM
	// capabilities keyed by a project id from a different tenant.
	test("assignments from another org do not leak into this org's picture", async () => {
		const access = await accessService.resolve({
			organizationId: ORG,
			userId: "u-plain",
		});
		expect(access.roleOn(projectAId)).toBe("member");
		expect(access.roleOn(projectOtherOrgId)).toBeNull();
		expect(access.canViewProjectMoney(projectOtherOrgId)).toBe(false);
	});

	test("scopeFor reflects only active, in-org assignments", async () => {
		const access = await accessService.resolve({
			organizationId: ORG,
			userId: "u-lead",
		});
		expect(access.scopeFor("pm")).toEqual([projectAId]);
	});
});

describe("accessService.requireAdmin", () => {
	test("returns the picture for an admin", async () => {
		const access = await accessService.requireAdmin({
			organizationId: ORG,
			userId: "u-admin",
		});
		expect(access.isAdmin).toBe(true);
	});

	test("throws AccessError for a non-admin", async () => {
		await expect(
			accessService.requireAdmin({ organizationId: ORG, userId: "u-plain" }),
		).rejects.toThrow(AccessError);
	});
});
