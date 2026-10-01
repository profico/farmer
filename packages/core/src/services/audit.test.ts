// The audit log's own rules (issue #112).
//
// What is pinned is what makes the log worth trusting: a row names the person
// who acted and the operator behind an impersonation, a secret never reaches
// a diff, a row cannot be rewritten, a security event reaches every workspace
// of the person and no other, only an admin reads the log, and the sweep
// deletes what the organization no longer keeps and nothing else.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { auditEvent } from "../db/schema/audit";
import { member, organization, user } from "../db/schema/auth";
import { memberProfile } from "../db/schema/people";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { AccessError } from "./access.service";
import {
	auditService,
	diffFields,
	recordAudit,
	recordSecurityEvent,
	sweepAuditLog,
} from "./audit";
import type { Ctx } from "./types";

const ORG = "au-org";
const OTHER_ORG = "au-other";
const THIRD_ORG = "au-third";
const ADMIN = "u-au-admin";
const MEMBER = "u-au-member";
const OPERATOR = "u-au-operator";
/** A person with a Harvest import's pending claim in ORG, and a workspace
 *  they did accept in OTHER_ORG. */
const CLAIMANT = "u-au-claimant";

const ctx = (userId: string, organizationId = ORG): Ctx => ({
	organizationId,
	userId,
});

let harness: TestDb;

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(organization).values(
		[ORG, OTHER_ORG, THIRD_ORG].map((id) => ({
			id,
			name: id,
			slug: id,
			createdAt: new Date(),
		})),
	);
	await db.insert(user).values(
		[
			[ADMIN, "Ana Admin"],
			[MEMBER, "Mo Member"],
			[OPERATOR, "Olga Operator"],
			[CLAIMANT, "Cleo Claimant"],
		].map(([id, name]) => ({
			id: present(id, "id"),
			name: present(name, "name"),
			email: `${String(id)}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	await db.insert(member).values([
		{
			id: "m1",
			organizationId: ORG,
			userId: ADMIN,
			role: "owner",
			createdAt: new Date(),
		},
		{
			id: "m2",
			organizationId: ORG,
			userId: MEMBER,
			role: "member",
			createdAt: new Date(),
		},
		{
			id: "m3",
			organizationId: OTHER_ORG,
			userId: MEMBER,
			role: "member",
			createdAt: new Date(),
		},
	]);
});

afterAll(async () => {
	await harness.close();
});

const rowsOf = (organizationId: string) =>
	db
		.select()
		.from(auditEvent)
		.where(eq(auditEvent.organizationId, organizationId));

describe("recordAudit", () => {
	test("names the actor, the door and the operator behind an impersonation", async () => {
		await recordAudit(
			{
				...ctx(MEMBER),
				actor: { via: "web", impersonatorId: OPERATOR, ip: "203.0.113.9" },
			},
			{
				kind: "project.updated",
				target: { type: "project", id: "p1", label: "Website" },
				changes: { name: { from: "Site", to: "Website" } },
			},
		);
		const [row] = await db
			.select()
			.from(auditEvent)
			.where(eq(auditEvent.kind, "project.updated"));
		const written = present(row, "the audit row");
		expect(written.actorName).toBe("Mo Member");
		expect(written.impersonatorName).toBe("Olga Operator");
		expect(written.via).toBe("web");
		expect(written.category).toBe("change");
		expect(written.targetLabel).toBe("Website");
		expect(written.ip).toBe("203.0.113.9");
	});

	test("a Ctx with no actor reads as system", async () => {
		await recordAudit(ctx(ADMIN), { kind: "holiday.disabled" });
		const [row] = await db
			.select()
			.from(auditEvent)
			.where(eq(auditEvent.kind, "holiday.disabled"));
		expect(present(row, "the audit row").via).toBe("system");
	});

	test("a row cannot be rewritten", async () => {
		const [row] = await rowsOf(ORG);
		const id = present(row, "a row").id;
		// drizzle wraps the database's refusal; the trigger's words are the cause.
		const refusal = await db
			.update(auditEvent)
			.set({ actorName: "Somebody else" })
			.where(eq(auditEvent.id, id))
			.then(
				() => null,
				(error: Error) => error,
			);
		expect(String(present(refusal, "a refusal").cause)).toContain(
			"append-only",
		);
	});
});

describe("diffFields", () => {
	test("keeps only the fields that changed", () => {
		expect(
			diffFields(
				{ name: "A", color: "red", archived: false },
				{ name: "B", color: "red", archived: false },
				["name", "color", "archived"],
			),
		).toEqual({ name: { from: "A", to: "B" } });
	});

	test("answers null when nothing changed", () => {
		expect(diffFields({ name: "A" }, { name: "A" }, ["name"])).toBeNull();
	});

	test("says a secret changed without saying what to", () => {
		expect(
			diffFields(
				{ secret: "old", apiKey: null },
				{ secret: "new", apiKey: "k" },
				["secret", "apiKey"],
			),
		).toEqual({
			secret: { from: "[redacted]", to: "[redacted]" },
			apiKey: { from: null, to: "[redacted]" },
		});
	});
});

describe("recordSecurityEvent", () => {
	test("reaches every workspace of the person and no other", async () => {
		await recordSecurityEvent({
			kind: "auth.signed_in",
			subjectUserId: MEMBER,
			actorUserId: MEMBER,
			actor: { via: "web" },
		});
		const signIns = await db
			.select()
			.from(auditEvent)
			.where(eq(auditEvent.kind, "auth.signed_in"));
		expect([...signIns.map((row) => row.organizationId)].sort()).toEqual(
			[ORG, OTHER_ORG].sort(),
		);
		expect(at(signIns, 0).category).toBe("security");
	});

	test("skips a workspace where the person has a pending claim", async () => {
		await db.insert(member).values([
			{
				id: "m-claim-pending",
				organizationId: ORG,
				userId: CLAIMANT,
				role: "member",
				createdAt: new Date(),
			},
			{
				id: "m-claim-own",
				organizationId: OTHER_ORG,
				userId: CLAIMANT,
				role: "member",
				createdAt: new Date(),
			},
		]);
		await db.insert(memberProfile).values([
			{
				organizationId: ORG,
				userId: CLAIMANT,
				claimPendingSince: new Date("2026-09-01T00:00:00Z"),
			},
			// A profile row with no claim is a workspace the person accepted.
			{ organizationId: OTHER_ORG, userId: CLAIMANT },
		]);
		await recordSecurityEvent({
			kind: "auth.signed_in",
			subjectUserId: CLAIMANT,
			actorUserId: CLAIMANT,
			actor: { via: "web" },
		});
		const rows = await db
			.select()
			.from(auditEvent)
			.where(eq(auditEvent.subjectUserId, CLAIMANT));
		expect(rows.map((row) => row.organizationId)).toEqual([OTHER_ORG]);

		// The same for a workspace named on purpose.
		await recordSecurityEvent({
			kind: "api_token.created",
			subjectUserId: CLAIMANT,
			actorUserId: CLAIMANT,
			organizationId: ORG,
			target: { type: "api_token", id: "t-claim", label: "Pending" },
		});
		const named = await db
			.select()
			.from(auditEvent)
			.where(eq(auditEvent.subjectUserId, CLAIMANT));
		expect(named).toHaveLength(1);
	});

	test("reaches only the named workspace when one is given", async () => {
		await recordSecurityEvent({
			kind: "api_token.created",
			subjectUserId: MEMBER,
			actorUserId: MEMBER,
			organizationId: OTHER_ORG,
			target: { type: "api_token", id: "t1", label: "Nightly" },
		});
		const rows = await db
			.select()
			.from(auditEvent)
			.where(eq(auditEvent.kind, "api_token.created"));
		expect(rows.map((row) => row.organizationId)).toEqual([OTHER_ORG]);
	});
});

describe("auditService", () => {
	test("only an admin reads the log", async () => {
		await expect(auditService.list(ctx(MEMBER), {})).rejects.toThrow(
			AccessError,
		);
		const page = await auditService.list(ctx(ADMIN), {});
		expect(page.events.length).toBeGreaterThan(0);
		expect(page.events.every((event) => event.id)).toBe(true);
	});

	test("filters on the person who acted or the person it was about", async () => {
		const page = await auditService.list(ctx(ADMIN), { userId: MEMBER });
		expect(
			page.events.every(
				(event) =>
					event.actorUserId === MEMBER || event.subjectUserId === MEMBER,
			),
		).toBe(true);
		expect(page.events.length).toBeGreaterThan(0);
	});

	test("the cursor walks the log without a gap or a repeat", async () => {
		for (let index = 0; index < 60; index++) {
			await recordAudit(ctx(ADMIN), {
				kind: "task.updated",
				target: { type: "task", id: `t${String(index)}`, label: "Task" },
			});
		}
		const first = await auditService.list(ctx(ADMIN), { kind: "task.updated" });
		expect(first.events).toHaveLength(50);
		const second = await auditService.list(ctx(ADMIN), {
			kind: "task.updated",
			cursor: present(first.nextCursor, "a cursor"),
		});
		expect(second.events).toHaveLength(10);
		expect(second.nextCursor).toBeNull();
		const ids = new Set(
			[...first.events, ...second.events].map((event) => event.targetId),
		);
		expect(ids.size).toBe(60);
	});

	test("the export escapes a formula and records itself", async () => {
		await recordAudit(ctx(ADMIN), {
			kind: "client.created",
			target: { type: "client", id: "c1", label: '=HYPERLINK("x")' },
		});
		const today = new Date().toISOString().slice(0, 10);
		const { csv } = await auditService.exportCsv(ctx(ADMIN), {
			from: today,
			to: today,
			kind: "client.created",
		});
		expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
		const exported = await db
			.select()
			.from(auditEvent)
			.where(eq(auditEvent.kind, "audit_log.exported"));
		expect(exported).toHaveLength(1);
	});

	test("changing the retention is itself recorded", async () => {
		expect(await auditService.retention(ctx(ADMIN))).toBe(365);
		await auditService.setRetention(ctx(ADMIN), 90);
		expect(await auditService.retention(ctx(ADMIN))).toBe(90);
		const [row] = await db
			.select()
			.from(auditEvent)
			.where(eq(auditEvent.kind, "audit_log.retention_changed"));
		expect(present(row, "the retention row").changes).toEqual({
			retentionDays: { from: 365, to: 90 },
		});
	});
});

describe("sweepAuditLog", () => {
	test("deletes what each organization no longer keeps, and nothing else", async () => {
		const now = new Date("2030-01-01T00:00:00Z");
		const daysAgo = (days: number) =>
			new Date(now.getTime() - days * 86_400_000);
		await db.insert(auditEvent).values([
			// ORG keeps 90 days (set above).
			{
				organizationId: ORG,
				kind: "task.created",
				category: "change",
				via: "system",
				occurredAt: daysAgo(100),
				targetLabel: "old-org",
			},
			{
				organizationId: ORG,
				kind: "task.created",
				category: "change",
				via: "system",
				occurredAt: daysAgo(80),
				targetLabel: "new-org",
			},
			// THIRD_ORG has no settings row, so the default year.
			{
				organizationId: THIRD_ORG,
				kind: "task.created",
				category: "change",
				via: "system",
				occurredAt: daysAgo(100),
				targetLabel: "kept-third",
			},
			{
				organizationId: THIRD_ORG,
				kind: "task.created",
				category: "change",
				via: "system",
				occurredAt: daysAgo(400),
				targetLabel: "old-third",
			},
		]);
		const before = (await db.select({ id: auditEvent.id }).from(auditEvent))
			.length;
		const swept = await sweepAuditLog({ now });
		const after = (await db.select({ id: auditEvent.id }).from(auditEvent))
			.length;
		expect(swept).toBeGreaterThanOrEqual(2);
		expect(before - after).toBe(swept);
		const labels = (
			await db.select({ label: auditEvent.targetLabel }).from(auditEvent)
		).map((row) => row.label);
		expect(labels).toContain("new-org");
		expect(labels).toContain("kept-third");
		expect(labels).not.toContain("old-org");
		expect(labels).not.toContain("old-third");
	});
});
