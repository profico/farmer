// Clients: who may create one, who may change one, and that neither reaches
// another org's rows.
//
// Creating a client is open to anyone who may create projects (Admin, or PM or
// Team Lead on at least one project), because a PM setting up a new engagement
// needs its client first. Renaming, archiving and restoring stay Admin-only.
// Every write names its client by id, so the org predicate on each is the whole
// tenancy story, and it is what these tests lean on.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { client, project, projectMember } from "../db/schema/domain";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { AccessError } from "./access.service";
import { clientsService } from "./clients.service";
import type { Ctx } from "./types";

const ORG_A = "cl-a";
const ORG_B = "cl-b";

const ADMIN = "u-cl-admin";
const PM = "u-cl-pm";
const TL = "u-cl-tl";
const MEM = "u-cl-member";
const NOBODY = "u-cl-unassigned";
const ADMIN_B = "u-cl-admin-b";

let harness: TestDb;

let clientA: string;
let clientB: string;
let archivedB: string;
let projectA: string;

/** A fresh Ctx per call: `ctxAccess` memoizes Access on the object. */
const ctx = (userId: string, organizationId: string = ORG_A): Ctx => ({
	organizationId,
	userId,
});

const clientRow = async (id: string) =>
	present(
		await db.query.client.findFirst({ where: eq(client.id, id) }),
		"client",
	);

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values([
		{ id: ORG_A, name: "Clients A", slug: ORG_A, createdAt: new Date() },
		{ id: ORG_B, name: "Clients B", slug: ORG_B, createdAt: new Date() },
	]);

	const people = [ADMIN, PM, TL, MEM, NOBODY, ADMIN_B];
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
	await db.insert(member).values(
		people.map((id) => ({
			id: `m-${id}`,
			organizationId: id === ADMIN_B ? ORG_B : ORG_A,
			userId: id,
			role: id === ADMIN || id === ADMIN_B ? "admin" : "member",
			createdAt: new Date(),
		})),
	);

	const clients = await db
		.insert(client)
		.values([
			{ organizationId: ORG_A, name: "Acme" },
			{ organizationId: ORG_B, name: "Beta" },
			{ organizationId: ORG_B, name: "Gone", archivedAt: new Date() },
		])
		.returning();
	clientA = at(clients, 0).id;
	clientB = at(clients, 1).id;
	archivedB = at(clients, 2).id;

	const [p] = await db
		.insert(project)
		.values({ organizationId: ORG_A, clientId: clientA, name: "Acme Web" })
		.returning();
	projectA = present(p, "project").id;

	await db.insert(projectMember).values([
		{ organizationId: ORG_A, projectId: projectA, userId: PM, role: "pm" },
		{
			organizationId: ORG_A,
			projectId: projectA,
			userId: TL,
			role: "team_lead",
		},
		{ organizationId: ORG_A, projectId: projectA, userId: MEM },
	]);
});

afterAll(async () => {
	await harness.close();
});

describe("create", () => {
	test("Admin, PM and Team Lead may create, always in the caller's org", async () => {
		for (const who of [ADMIN, PM, TL]) {
			const created = await clientsService.create(ctx(who), {
				name: `  By ${who}  `,
			});
			expect(created.organizationId).toBe(ORG_A);
			expect(created.name).toBe(`By ${who}`);
			expect(created.isInternal).toBe(false);
		}
	});

	test("a plain Member and a member with no assignment are refused", async () => {
		for (const who of [MEM, NOBODY]) {
			await expect(
				clientsService.create(ctx(who), { name: `By ${who}` }),
			).rejects.toThrow(AccessError);
		}
		const leaked = await db.query.client.findMany({
			where: eq(client.name, `By ${MEM}`),
		});
		expect(leaked).toHaveLength(0);
	});
});

describe("update", () => {
	test("an admin renames a client", async () => {
		const updated = await clientsService.update(ctx(ADMIN), {
			clientId: clientA,
			name: " Acme Corp ",
		});
		expect(updated.name).toBe("Acme Corp");
	});

	test("PM and Team Lead cannot rename, even though they may create", async () => {
		for (const who of [PM, TL]) {
			await expect(
				clientsService.update(ctx(who), { clientId: clientA, name: "Nope" }),
			).rejects.toThrow(AccessError);
		}
		expect((await clientRow(clientA)).name).toBe("Acme Corp");
	});

	test("another org's client reads as not found and keeps its name", async () => {
		await expect(
			clientsService.update(ctx(ADMIN), { clientId: clientB, name: "Mine" }),
		).rejects.toThrow("Client not found");
		expect((await clientRow(clientB)).name).toBe("Beta");
	});
});

describe("archive", () => {
	test("a PM cannot archive", async () => {
		await expect(clientsService.archive(ctx(PM), clientA)).rejects.toThrow(
			AccessError,
		);
	});

	test("the internal client cannot be archived", async () => {
		const internalId = await clientsService.ensureInternal(ctx(ADMIN));
		await expect(
			clientsService.archive(ctx(ADMIN), internalId),
		).rejects.toThrow("The internal client cannot be archived");
	});

	test("refused while an active project hangs off it, allowed once it is archived", async () => {
		await expect(clientsService.archive(ctx(ADMIN), clientA)).rejects.toThrow(
			"Archive this client's active projects first",
		);
		expect((await clientRow(clientA)).archivedAt).toBeNull();

		await db
			.update(project)
			.set({ status: "archived" })
			.where(eq(project.id, projectA));
		await clientsService.archive(ctx(ADMIN), clientA);

		const live = (await clientsService.list(ctx(MEM))).map((c) => c.id);
		const all = (await clientsService.listAll(ctx(ADMIN))).map((c) => c.id);
		expect(live).not.toContain(clientA);
		expect(all).toContain(clientA);
	});

	test("another org's client reads as not found and stays live", async () => {
		await expect(clientsService.archive(ctx(ADMIN), clientB)).rejects.toThrow(
			"Client not found",
		);
		expect((await clientRow(clientB)).archivedAt).toBeNull();
	});
});

describe("unarchive", () => {
	test("a Team Lead cannot restore", async () => {
		await expect(clientsService.unarchive(ctx(TL), clientA)).rejects.toThrow(
			AccessError,
		);
	});

	test("an admin restores their own org's client", async () => {
		await clientsService.unarchive(ctx(ADMIN), clientA);
		expect((await clientRow(clientA)).archivedAt).toBeNull();
	});

	test("another org's archived client stays archived", async () => {
		await clientsService.unarchive(ctx(ADMIN), archivedB);
		expect((await clientRow(archivedB)).archivedAt).not.toBeNull();
	});
});

describe("list", () => {
	test("only the caller's org, archived clients only in listAll", async () => {
		const live = (await clientsService.list(ctx(MEM))).map((c) => c.id);
		expect(live).toContain(clientA);
		expect(live).not.toContain(clientB);
		expect(live).not.toContain(archivedB);

		const all = (await clientsService.listAll(ctx(ADMIN_B, ORG_B))).map(
			(c) => c.id,
		);
		expect(all.sort()).toEqual([clientB, archivedB].sort());
	});

	test("the internal client sorts last", async () => {
		const rows = await clientsService.list(ctx(ADMIN));
		expect(rows.at(-1)?.isInternal).toBe(true);
	});
});

describe("ensureInternal", () => {
	test("exactly one internal client per org, even under concurrent callers", async () => {
		const ids = await Promise.all([
			clientsService.ensureInternal(ctx(ADMIN_B, ORG_B), " Beta Inc "),
			clientsService.ensureInternal(ctx(ADMIN_B, ORG_B), "Other Name"),
			clientsService.ensureInternal(ctx(ADMIN_B, ORG_B)),
		]);
		expect(new Set(ids).size).toBe(1);

		const rows = await db.query.client.findMany({
			where: and(eq(client.organizationId, ORG_B), eq(client.isInternal, true)),
		});
		expect(rows).toHaveLength(1);
		// A later call never renames the row the first one made.
		expect(await clientsService.ensureInternal(ctx(ADMIN_B, ORG_B), "X")).toBe(
			at(rows, 0).id,
		);
	});

	test("each org gets its own internal client", async () => {
		const a = await clientsService.ensureInternal(ctx(ADMIN));
		const b = await clientsService.ensureInternal(ctx(ADMIN_B, ORG_B));
		expect(a).not.toBe(b);
		expect((await clientRow(a)).organizationId).toBe(ORG_A);
	});
});
