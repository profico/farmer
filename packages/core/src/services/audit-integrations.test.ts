// The audit rows the integrations and the PM absence writes leave (issue #112).
//
// What is pinned: a webhook's secret never reaches the log, a webhook update
// that changed nothing writes nothing, and time off is recorded only when a PM
// writes it for ANOTHER person, never for the caller's own day.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, asc, eq } from "drizzle-orm";

import { db } from "../db";
import { auditEvent } from "../db/schema/audit";
import { member, organization, user } from "../db/schema/auth";
import { task, timeEntry } from "../db/schema/domain";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";
import { webhooksService } from "./webhooks.service";

const ORG_ID = "org-audit-int";
const ADMIN = "user-audit-int-admin";
const PERSON = "user-audit-int-person";
const DAY = "2026-08-10"; // a Monday

const adminCtx = (): Ctx => ({ organizationId: ORG_ID, userId: ADMIN });

let harness: TestDb;
let leaveTaskId = "";

const rowsOfKind = (kind: string) =>
	db
		.select()
		.from(auditEvent)
		.where(
			and(eq(auditEvent.organizationId, ORG_ID), eq(auditEvent.kind, kind)),
		)
		.orderBy(asc(auditEvent.occurredAt));

const allRows = () =>
	db.select().from(auditEvent).where(eq(auditEvent.organizationId, ORG_ID));

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(organization).values({
		id: ORG_ID,
		name: "Audit Integrations",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	for (const [id, name] of [
		[ADMIN, "Ana Admin"],
		[PERSON, "Pero Person"],
	] as const) {
		await db.insert(user).values({
			id,
			name,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	}
	await db.insert(member).values([
		{
			id: "m-audit-int-admin",
			organizationId: ORG_ID,
			userId: ADMIN,
			role: "owner",
			createdAt: new Date(),
		},
		{
			id: "m-audit-int-person",
			organizationId: ORG_ID,
			userId: PERSON,
			role: "member",
			createdAt: new Date(),
		},
	]);
	// Migration 0038 seeds Paid Leave, so it is looked up rather than inserted.
	const leave = await db.query.task.findFirst({
		where: and(eq(task.scope, "site"), eq(task.systemKey, "paid_leave")),
		columns: { id: true },
	});
	leaveTaskId = present(leave, "paid leave task").id;
});

afterAll(async () => {
	await harness.close();
});

describe("webhooks", () => {
	test("create, update, roll and delete are recorded and the secret never is", async () => {
		const { endpoint, secret } = await webhooksService.create(adminCtx(), {
			url: "https://8.8.8.8/farmer?token=abc123",
			enabledEvents: ["client.created"],
		});
		await webhooksService.update(adminCtx(), {
			endpointId: endpoint.id,
			description: "Billing sync",
			enabledEvents: ["client.created", "project.created"],
		});
		const rolled = await webhooksService.rollSecret(adminCtx(), endpoint.id);
		await webhooksService.remove(adminCtx(), endpoint.id);

		const created = at(await rowsOfKind("webhook.created"), 0);
		expect(created.targetType).toBe("webhook");
		expect(created.targetId).toBe(endpoint.id);
		expect(created.targetLabel).toBe("8.8.8.8/farmer");

		const updated = at(await rowsOfKind("webhook.updated"), 0);
		expect(updated.targetLabel).toBe("Billing sync");
		expect(updated.changes).toEqual({
			description: { from: null, to: "Billing sync" },
			enabledEvents: {
				from: ["client.created"],
				to: ["client.created", "project.created"],
			},
		});

		expect(await rowsOfKind("webhook.secret_rolled")).toHaveLength(1);
		expect(await rowsOfKind("webhook.deleted")).toHaveLength(1);

		const serialized = JSON.stringify(await allRows());
		expect(serialized).not.toContain(secret);
		expect(serialized).not.toContain(rolled.secret);
		expect(serialized).not.toContain("abc123");
	});

	test("an update that changes nothing writes nothing", async () => {
		const { endpoint } = await webhooksService.create(adminCtx(), {
			url: "https://8.8.4.4/same",
			enabledEvents: ["client.created"],
		});
		const before = (await rowsOfKind("webhook.updated")).length;
		await webhooksService.update(adminCtx(), {
			endpointId: endpoint.id,
			enabledEvents: ["client.created"],
		});
		expect(await rowsOfKind("webhook.updated")).toHaveLength(before);
	});
});

describe("absence for another person", () => {
	test("a PM logging, changing and removing time off is recorded", async () => {
		await db.delete(timeEntry);
		const created = await timeEntriesService.createAbsenceForUser(adminCtx(), {
			userId: PERSON,
			taskId: leaveTaskId,
			date: DAY,
			durationSeconds: 8 * 3600,
		});
		await timeEntriesService.overrideAbsence(adminCtx(), {
			timeEntryId: created.id,
			durationSeconds: 4 * 3600,
		});
		await timeEntriesService.removeAbsence(adminCtx(), created.id);

		const logged = at(await rowsOfKind("absence.logged_for_person"), 0);
		expect(logged.subjectUserId).toBe(PERSON);
		expect(logged.actorUserId).toBe(ADMIN);
		expect(logged.targetType).toBe("member");
		expect(logged.targetId).toBe(PERSON);
		expect(logged.targetLabel).toBe("Pero Person");
		expect(logged.details).toMatchObject({
			date: DAY,
			durationSeconds: 8 * 3600,
		});

		const changed = at(await rowsOfKind("absence.changed_for_person"), 0);
		expect(changed.subjectUserId).toBe(PERSON);
		expect(changed.changes).toEqual({
			durationSeconds: { from: 8 * 3600, to: 4 * 3600 },
		});

		const removed = at(await rowsOfKind("absence.removed_for_person"), 0);
		expect(removed.subjectUserId).toBe(PERSON);
	});

	test("removing your own absence writes nothing", async () => {
		await db.delete(timeEntry);
		await db.delete(auditEvent);
		const [own] = await db
			.insert(timeEntry)
			.values({
				organizationId: ORG_ID,
				userId: ADMIN,
				taskId: leaveTaskId,
				projectId: null,
				date: DAY,
				description: "",
				durationSeconds: 8 * 3600,
			})
			.returning({ id: timeEntry.id });
		await timeEntriesService.removeAbsence(
			adminCtx(),
			present(own, "own absence").id,
		);
		expect(await allRows()).toHaveLength(0);
	});
});
