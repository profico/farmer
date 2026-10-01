// Which writes reach the audit log, through the real services.
//
// A sample rather than the whole list: one write of each shape. A create, an
// update that diffs, an update that changed nothing (which writes no row), an
// archive of a person, a keyed upsert, a replaced list, and a settings row.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, asc, eq } from "drizzle-orm";

import { db } from "../db";
import { auditEvent } from "../db/schema/audit";
import { member, organization, user } from "../db/schema/auth";
import { client, project } from "../db/schema/domain";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { clientsService } from "./clients.service";
import { hourFundService } from "./hour-fund.service";
import { membersService } from "./members.service";
import { orgSettingsService } from "./org-settings.service";
import { projectsService } from "./projects.service";
import { teamLeadsService } from "./team-leads.service";
import type { Ctx } from "./types";

const ORG = "ac-org";
const ADMIN = "u-ac-admin";
const ANA = "u-ac-ana";
const BOB = "u-ac-bob";
const LEAD = "u-ac-lead";

/** A fresh Ctx per call: Access is memoized on the object. */
const admin = (): Ctx => ({ organizationId: ORG, userId: ADMIN });

const events = (kind: string) =>
	db
		.select()
		.from(auditEvent)
		.where(and(eq(auditEvent.organizationId, ORG), eq(auditEvent.kind, kind)))
		.orderBy(asc(auditEvent.occurredAt));

let harness: TestDb;

beforeAll(async () => {
	harness = await createTestDb();
	await db
		.insert(organization)
		.values({ id: ORG, name: "Audit", slug: ORG, createdAt: new Date() });
	const people: [string, string][] = [
		[ADMIN, "Ada Admin"],
		[ANA, "Ana Person"],
		[BOB, "Bob Person"],
		[LEAD, "Lea Lead"],
	];
	await db.insert(user).values(
		people.map(([id, name]) => ({
			id,
			name,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	await db.insert(member).values(
		people.map(([userId], index) => ({
			id: `m-ac-${index}`,
			organizationId: ORG,
			userId,
			role: userId === ADMIN ? "owner" : "member",
			createdAt: new Date(),
		})),
	);
});

afterAll(async () => {
	await harness.close();
});

describe("audited writes", () => {
	test("a client create and rename are recorded, the rename as a diff", async () => {
		const created = await clientsService.create(admin(), { name: "Acme" });
		await clientsService.update(admin(), {
			clientId: created.id,
			name: "Acme Corp",
		});
		// The same name again changes nothing.
		await clientsService.update(admin(), {
			clientId: created.id,
			name: "Acme Corp",
		});

		const made = await events("client.created");
		expect(made).toHaveLength(1);
		expect(at(made, 0).targetLabel).toBe("Acme");
		expect(at(made, 0).actorUserId).toBe(ADMIN);

		const renamed = await events("client.updated");
		expect(renamed).toHaveLength(1);
		expect(at(renamed, 0).changes).toEqual({
			name: { from: "Acme", to: "Acme Corp" },
		});
	});

	test("a project update that changes nothing writes no row", async () => {
		const [owner] = await db
			.select({ id: client.id })
			.from(client)
			.where(eq(client.organizationId, ORG));
		const [row] = await db
			.insert(project)
			.values({
				organizationId: ORG,
				clientId: present(owner, "client").id,
				name: "Apollo",
			})
			.returning();
		const apollo = present(row, "project");

		await projectsService.update(admin(), {
			projectId: apollo.id,
			name: "Apollo",
		});
		expect(await events("project.updated")).toHaveLength(0);

		await projectsService.update(admin(), {
			projectId: apollo.id,
			name: "Apollo 2",
		});
		const updated = await events("project.updated");
		expect(updated).toHaveLength(1);
		expect(at(updated, 0).changes).toEqual({
			name: { from: "Apollo", to: "Apollo 2" },
		});
		expect(at(updated, 0).targetLabel).toBe("Apollo 2");
	});

	test("archiving and restoring a person name them as the subject", async () => {
		await membersService.setArchived(admin(), ANA, true);
		await membersService.setArchived(admin(), ANA, false);

		const archived = await events("member.archived");
		expect(archived).toHaveLength(1);
		expect(at(archived, 0).subjectUserId).toBe(ANA);
		expect(at(archived, 0).targetLabel).toBe("Ana Person");
		expect(await events("member.restored")).toHaveLength(1);
	});

	test("an hour fund records the hours before and after", async () => {
		await hourFundService.set(admin(), {
			year: 2026,
			month: 9,
			fundSeconds: 160 * 3600,
		});
		await hourFundService.set(admin(), {
			year: 2026,
			month: 9,
			fundSeconds: 168 * 3600,
		});
		// Setting the same figure again is not a change.
		await hourFundService.set(admin(), {
			year: 2026,
			month: 9,
			fundSeconds: 168 * 3600,
		});

		const rows = await events("hour_fund.set");
		expect(rows).toHaveLength(2);
		expect(at(rows, 0).changes).toEqual({ hours: { from: null, to: 160 } });
		expect(at(rows, 1).changes).toEqual({ hours: { from: 160, to: 168 } });
		expect(at(rows, 1).targetId).toBe("2026-09");
		expect(at(rows, 1).targetLabel).toBe("September 2026");
	});

	test("a team lead's list records the names before and after", async () => {
		await teamLeadsService.setPeople(admin(), {
			leadUserId: LEAD,
			personUserIds: [BOB],
		});
		await teamLeadsService.setPeople(admin(), {
			leadUserId: LEAD,
			personUserIds: [BOB, ANA],
		});

		const rows = await events("team_lead.people_changed");
		expect(rows).toHaveLength(2);
		expect(at(rows, 0).subjectUserId).toBe(LEAD);
		expect(at(rows, 1).changes).toEqual({
			people: { from: ["Bob Person"], to: ["Ana Person", "Bob Person"] },
		});
	});

	test("an org settings update records the changed field only", async () => {
		await orgSettingsService.update(admin(), { trackingTolerancePct: 10 });
		await orgSettingsService.update(admin(), { trackingTolerancePct: 10 });

		const rows = await events("org_settings.updated");
		expect(rows).toHaveLength(1);
		expect(at(rows, 0).changes).toEqual({
			trackingTolerancePct: { from: 5, to: 10 },
		});
	});
});
