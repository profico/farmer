// A Harvest import in multi-org mode holds no real address in `user` (issue
// #162): the person is a placeholder until the verified owner of the address
// claims the history. These tests pin what a claim moves, what it refuses and
// what it leaves.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, asc, count, eq, is, or } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";

import { assertMayRegister } from "../auth/registration";
import { db } from "../db";
import * as apiTokenSchema from "../db/schema/api-tokens";
import * as assistantSchema from "../db/schema/assistant";
import { auditEvent } from "../db/schema/audit";
import * as authSchema from "../db/schema/auth";
import { member, organization, user } from "../db/schema/auth";
import * as domainSchema from "../db/schema/domain";
import {
	client,
	project,
	projectMember,
	recurringBlockRule,
	task,
	timeEntry,
} from "../db/schema/domain";
import * as githubSchema from "../db/schema/github";
import * as importSchema from "../db/schema/import";
import { importMapping, importPendingPerson } from "../db/schema/import";
import * as instanceSchema from "../db/schema/instance";
import * as notificationSchema from "../db/schema/notifications";
import * as peopleSchema from "../db/schema/people";
import {
	memberProfile,
	memberTypeHistory,
	teamLeadPerson,
} from "../db/schema/people";
import * as scheduleSchema from "../db/schema/schedule";
import { memberWorkingHoursDay } from "../db/schema/schedule";
import * as settingsSchema from "../db/schema/settings";
import * as slackSchema from "../db/schema/slack";
import * as timerSchema from "../db/schema/timer";
import * as webhookSchema from "../db/schema/webhooks";
import { placeholderEmail } from "../lib/import-placeholder";
import { setInstanceSettingsForTests } from "../lib/instance-settings";
import type { HarvestStartInput } from "../schema/harvest-import";
import { createTestDb, present, type TestDb } from "../test/harness";
import { harvestImportService } from "./harvest-import.service";
import {
	NoPendingClaimError,
	importClaimsService,
} from "./import-claims.service";
import { membersService } from "./members.service";
import type { Ctx } from "./types";

const ORG = "ip-org";
const ADMIN = "u-ip-admin";
const admin: Ctx = { organizationId: ORG, userId: ADMIN };

let harness: TestDb;
let taskId: string;
let projectId: string;
let seq = 0;

const savedSlug = process.env.SINGLE_ORG_SLUG;

beforeAll(async () => {
	delete process.env.SINGLE_ORG_SLUG;
	setInstanceSettingsForTests({});
	harness = await createTestDb();
	await db.insert(organization).values({
		id: ORG,
		name: ORG,
		slug: ORG,
		timezone: "UTC",
		createdAt: new Date(),
	});
	await db.insert(user).values({
		id: ADMIN,
		name: "Admin",
		email: "admin@example.com",
		emailVerified: true,
	});
	await db.insert(member).values({
		id: "m-ip-admin",
		organizationId: ORG,
		userId: ADMIN,
		role: "admin",
		createdAt: new Date(),
	});
	const [c] = await db
		.insert(client)
		.values({ organizationId: ORG, name: "Client" })
		.returning();
	const [p] = await db
		.insert(project)
		.values({
			organizationId: ORG,
			clientId: present(c, "client").id,
			name: "Project",
		})
		.returning();
	projectId = present(p, "project").id;
	const [t] = await db
		.insert(task)
		.values({ scope: "organization", organizationId: ORG, name: "Dev" })
		.returning();
	taskId = present(t, "task").id;
});

afterAll(async () => {
	setInstanceSettingsForTests(undefined);
	if (savedSlug !== undefined) process.env.SINGLE_ORG_SLUG = savedSlug;
	await harness.close();
});

const plan = (email: string, confirmed: boolean): HarvestStartInput => ({
	runId: crypto.randomUUID(),
	source: "harvest",
	cutoffDate: "2025-04-01",
	clients: [],
	tasks: [],
	projects: [],
	people: [
		{
			action: "create",
			sourceKey: email,
			name: "Imported Person",
			email,
			emailListed: confirmed,
			emailConfirmed: confirmed,
			role: "member",
			type: "employee_billable",
			startDate: "2024-01-01",
			archivedOn: null,
		},
	],
	projectMembers: [],
});

/** Imports one person and returns their placeholder id. */
const importPerson = async (email: string, confirmed = true) => {
	const result = await harvestImportService.start(
		admin,
		plan(email, confirmed),
	);
	const [pending] = await db
		.select()
		.from(importPendingPerson)
		.where(eq(importPendingPerson.email, email));
	return {
		runId: result.runId,
		placeholder: present(pending, "pending").userId,
	};
};

const signUp = async (email: string, verified: boolean) => {
	const id = `u-ip-${String(++seq)}`;
	await db
		.insert(user)
		.values({ id, name: "Real", email, emailVerified: verified });
	const ctx: Ctx = { organizationId: ORG, userId: id };
	return ctx;
};

const entry = (userId: string, date: string, durationSeconds: number) =>
	db.insert(timeEntry).values({
		organizationId: ORG,
		userId,
		date,
		taskId,
		projectId,
		description: "work",
		durationSeconds,
	});

/** Every column that holds a foreign key to `user`, from the schema itself, so
 *  a table added later is checked without a change here. */
const userForeignKeys = () => {
	const exports = {
		...apiTokenSchema,
		...assistantSchema,
		...authSchema,
		...domainSchema,
		...githubSchema,
		...importSchema,
		...instanceSchema,
		...notificationSchema,
		...peopleSchema,
		...scheduleSchema,
		...settingsSchema,
		...slackSchema,
		...timerSchema,
		...webhookSchema,
	};
	const tables: PgTable[] = [];
	for (const value of Object.values(exports)) {
		if (is(value, PgTable)) tables.push(value);
	}
	return tables.flatMap((table) =>
		getTableConfig(table).foreignKeys.flatMap((fk) => {
			const ref = fk.reference();
			const [col] = ref.columns;
			return getTableConfig(ref.foreignTable).name === "user" && col
				? [{ table, col }]
				: [];
		}),
	);
};

const holdersOf = async (userId: string) => {
	const held: string[] = [];
	for (const { table, col } of userForeignKeys()) {
		const [row] = await db
			.select({ n: count() })
			.from(table)
			.where(eq(col, userId));
		if ((row?.n ?? 0) > 0)
			held.push(`${getTableConfig(table).name}.${col.name}`);
	}
	return held;
};

describe("the import holds no real address", () => {
	test("makes a placeholder, never a user row for the address", async () => {
		const email = "ana.import@example.com";
		const { placeholder } = await importPerson(email, false);

		expect(
			await db.query.user.findFirst({ where: eq(user.email, email) }),
		).toBeUndefined();
		const row = present(
			await db.query.user.findFirst({ where: eq(user.id, placeholder) }),
			"placeholder",
		);
		expect(row.email).toBe(placeholderEmail(placeholder));
		expect(row.emailVerified).toBe(false);

		// The org still reads the real address.
		const roster = await membersService.roster(admin);
		expect(
			roster.members.find((m) => m.userId === placeholder)?.user.email,
		).toBe(email);
		const people = await membersService.list(admin);
		expect(people.find((p) => p.userId === placeholder)?.email).toBe(email);
	});

	test("a lying client flag changes nothing", async () => {
		const confirmed = await importPerson("lie.true@example.com", true);
		const guessed = await importPerson("lie.false@example.com", false);
		for (const id of [confirmed.placeholder, guessed.placeholder]) {
			const row = present(
				await db.query.user.findFirst({ where: eq(user.id, id) }),
				"placeholder",
			);
			expect(row.emailVerified).toBe(false);
		}
	});

	test("a second import of the address finds the placeholder", async () => {
		await importPerson("again@example.com");
		// A new spelling of the same address, so the key is not mapped yet.
		await expect(
			harvestImportService.start(admin, {
				...plan("again@example.com", true),
				people: [
					{
						...present(plan("again@example.com", true).people[0], "person"),
						sourceKey: "Again, Second Spelling",
					},
				],
			}),
		).rejects.toThrow("is a member already");
		expect(
			await db
				.select()
				.from(importPendingPerson)
				.where(eq(importPendingPerson.email, "again@example.com")),
		).toHaveLength(1);
	});
});

describe("a claim", () => {
	test("an address the provider did not vouch for claims nothing", async () => {
		const email = "unverified@example.com";
		await importPerson(email);
		const caller = await signUp(email, false);
		// Development accepts an unverified address (`mayClaimInvitation`).
		const previous = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";
		try {
			expect(await importClaimsService.pendingFor(caller.userId)).toEqual([]);
			await expect(importClaimsService.accept(caller)).rejects.toThrow(
				NoPendingClaimError,
			);
			await expect(importClaimsService.decline(caller)).rejects.toThrow(
				NoPendingClaimError,
			);
		} finally {
			process.env.NODE_ENV = previous;
		}
	});

	test("another address claims nothing", async () => {
		await importPerson("somebody@example.com");
		const caller = await signUp("somebody.else@example.com", true);
		expect(await importClaimsService.pendingFor(caller.userId)).toEqual([]);
	});

	test("accept moves the rows and leaves no key on the placeholder", async () => {
		const email = "move@example.com";
		const { placeholder } = await importPerson(email);
		const caller = await signUp(email, true);

		await entry(placeholder, "2025-03-03", 3600);
		await db.insert(projectMember).values({
			organizationId: ORG,
			projectId,
			userId: placeholder,
		});
		await db.insert(teamLeadPerson).values([
			{ organizationId: ORG, leadUserId: ADMIN, personUserId: placeholder },
			{ organizationId: ORG, leadUserId: placeholder, personUserId: ADMIN },
		]);
		await db.insert(memberWorkingHoursDay).values({
			organizationId: ORG,
			userId: placeholder,
			dayOfWeek: 1,
		});
		await db.insert(recurringBlockRule).values({
			organizationId: ORG,
			userId: placeholder,
			taskId,
			description: "weekly",
			daysOfWeek: [1],
			durationSeconds: 1800,
		});
		expect(await holdersOf(placeholder)).toContain("time_entry.user_id");

		const claims = await importClaimsService.pendingFor(caller.userId);
		expect(claims.map((c) => c.organizationId)).toEqual([ORG]);
		const { slug } = await importClaimsService.accept(caller);
		expect(slug).toBe(ORG);

		// Nothing anywhere points at the placeholder, and it is gone.
		expect(await holdersOf(placeholder)).toEqual([]);
		expect(
			await db.query.user.findFirst({ where: eq(user.id, placeholder) }),
		).toBeUndefined();

		// The data is the person's now.
		const mine = {
			projectMembers: await db
				.select()
				.from(projectMember)
				.where(eq(projectMember.userId, caller.userId)),
			entries: await db
				.select()
				.from(timeEntry)
				.where(eq(timeEntry.userId, caller.userId)),
			ledByAdmin: await db
				.select()
				.from(teamLeadPerson)
				.where(
					and(
						eq(teamLeadPerson.leadUserId, ADMIN),
						eq(teamLeadPerson.personUserId, caller.userId),
					),
				),
			leads: await db
				.select()
				.from(teamLeadPerson)
				.where(
					and(
						eq(teamLeadPerson.leadUserId, caller.userId),
						eq(teamLeadPerson.personUserId, ADMIN),
					),
				),
			hours: await db
				.select()
				.from(memberWorkingHoursDay)
				.where(eq(memberWorkingHoursDay.userId, caller.userId)),
			rules: await db
				.select()
				.from(recurringBlockRule)
				.where(eq(recurringBlockRule.userId, caller.userId)),
		};
		expect(mine.projectMembers).toHaveLength(1);
		expect(mine.entries).toHaveLength(1);
		expect(mine.ledByAdmin).toHaveLength(1);
		expect(mine.leads).toHaveLength(1);
		expect(mine.hours).toHaveLength(1);
		expect(mine.rules).toHaveLength(1);

		const profile = present(
			await db.query.memberProfile.findFirst({
				where: and(
					eq(memberProfile.organizationId, ORG),
					eq(memberProfile.userId, caller.userId),
				),
			}),
			"profile",
		);
		expect(profile.claimPendingSince).toBeNull();
		expect(
			await db.query.member.findFirst({
				where: and(
					eq(member.organizationId, ORG),
					eq(member.userId, caller.userId),
				),
			}),
		).toBeDefined();
		expect(await importClaimsService.pendingFor(caller.userId)).toEqual([]);

		// Undo still finds the person: the mapping follows the user.
		expect(
			await db
				.select()
				.from(importMapping)
				.where(
					and(
						eq(importMapping.kind, "person"),
						eq(importMapping.localId, caller.userId),
					),
				),
		).toHaveLength(1);

		// The join is recorded like any other.
		expect(
			await db
				.select()
				.from(auditEvent)
				.where(
					and(
						eq(auditEvent.organizationId, ORG),
						eq(auditEvent.kind, "member.joined"),
						eq(auditEvent.subjectUserId, caller.userId),
					),
				),
		).toHaveLength(1);
	});

	test("accept merges into a person who is a member already, past 24 hours", async () => {
		const email = "merge@example.com";
		const { placeholder } = await importPerson(email);
		const caller = await signUp(email, true);
		await db.insert(member).values({
			id: "m-ip-merge",
			organizationId: ORG,
			userId: caller.userId,
			role: "admin",
			createdAt: new Date(),
		});
		// A profile with a claim of its own still open, and a later start date
		// than the import's (2024-01-01).
		await db.insert(memberProfile).values({
			organizationId: ORG,
			userId: caller.userId,
			startDate: "2025-01-01",
			claimPendingSince: new Date(),
		});
		await db.insert(memberTypeHistory).values({
			organizationId: ORG,
			userId: caller.userId,
			type: "contractor_hourly",
			effectiveFrom: "2025-01-01",
		});
		await db.insert(projectMember).values({
			organizationId: ORG,
			projectId,
			userId: caller.userId,
		});
		await db.insert(projectMember).values({
			organizationId: ORG,
			projectId,
			userId: placeholder,
		});
		// 20h from the import and 8h of the person's own on one day.
		await entry(placeholder, "2025-03-10", 20 * 3600);
		await entry(caller.userId, "2025-03-10", 8 * 3600);

		await importClaimsService.accept(caller);

		expect(await holdersOf(placeholder)).toEqual([]);
		const entries = await db
			.select()
			.from(timeEntry)
			.where(
				and(
					eq(timeEntry.userId, caller.userId),
					eq(timeEntry.date, "2025-03-10"),
				),
			);
		// Both stay: the entries are what happened, so the cap that guards a
		// manual write does not refuse them.
		expect(entries.reduce((sum, e) => sum + e.durationSeconds, 0)).toBe(
			28 * 3600,
		);
		// The person keeps their own membership, role and single assignment.
		const mine = present(
			await db.query.member.findFirst({
				where: and(
					eq(member.organizationId, ORG),
					eq(member.userId, caller.userId),
				),
			}),
			"member",
		);
		expect(mine.role).toBe("admin");
		expect(
			await db
				.select()
				.from(projectMember)
				.where(eq(projectMember.userId, caller.userId)),
		).toHaveLength(1);
		// Nobody joined, and the merge is in the audit log with the number of
		// days that passed the cap.
		const [merged] = await db
			.select()
			.from(auditEvent)
			.where(
				and(
					eq(auditEvent.kind, "member.claim_merged"),
					eq(auditEvent.subjectUserId, caller.userId),
				),
			);
		expect(present(merged, "merge row").details).toEqual({
			role: "admin",
			daysOverCap: 1,
		});

		// The imported months keep the imported type; the person's own rows
		// stand from their first day.
		const types = await db
			.select()
			.from(memberTypeHistory)
			.where(eq(memberTypeHistory.userId, caller.userId))
			.orderBy(asc(memberTypeHistory.effectiveFrom));
		expect(
			types.map((t) => [t.type, t.effectiveFrom, t.effectiveUntil]),
		).toEqual([
			["employee_billable", "2024-01-01", "2025-01-01"],
			["contractor_hourly", "2025-01-01", null],
		]);

		// The earlier start date wins, and the open claim is closed at once.
		const profile = present(
			await db.query.memberProfile.findFirst({
				where: and(
					eq(memberProfile.organizationId, ORG),
					eq(memberProfile.userId, caller.userId),
				),
			}),
			"profile",
		);
		expect(profile.startDate).toBe("2024-01-01");
		expect(profile.claimPendingSince).toBeNull();
		expect(await importClaimsService.pendingFor(caller.userId)).toEqual([]);
	});

	test("accept drops a lead link between the caller and the placeholder", async () => {
		for (const [email, callerLeads] of [
			["lead.of@example.com", true],
			["lead.by@example.com", false],
		] as const) {
			const { placeholder } = await importPerson(email);
			const caller = await signUp(email, true);
			await db.insert(member).values({
				id: `m-${caller.userId}`,
				organizationId: ORG,
				userId: caller.userId,
				role: "member",
				createdAt: new Date(),
			});
			await db.insert(teamLeadPerson).values({
				organizationId: ORG,
				leadUserId: callerLeads ? caller.userId : placeholder,
				personUserId: callerLeads ? placeholder : caller.userId,
			});

			await importClaimsService.accept(caller);

			expect(
				await db
					.select()
					.from(teamLeadPerson)
					.where(
						or(
							eq(teamLeadPerson.leadUserId, caller.userId),
							eq(teamLeadPerson.personUserId, caller.userId),
						),
					),
			).toEqual([]);
		}
	});

	test("decline keeps the history, and the offer does not return", async () => {
		const email = "decline@example.com";
		const { placeholder } = await importPerson(email);
		await entry(placeholder, "2025-03-04", 3600);
		const caller = await signUp(email, true);

		await importClaimsService.decline(caller);

		expect(await importClaimsService.pendingFor(caller.userId)).toEqual([]);
		expect(
			await db.query.member.findFirst({
				where: and(
					eq(member.organizationId, ORG),
					eq(member.userId, placeholder),
				),
			}),
		).toBeUndefined();
		expect(
			await db
				.select()
				.from(timeEntry)
				.where(eq(timeEntry.userId, placeholder)),
		).toHaveLength(1);
		const [pending] = await db
			.select()
			.from(importPendingPerson)
			.where(eq(importPendingPerson.userId, placeholder));
		expect(pending?.declinedAt).toBeInstanceOf(Date);
		await expect(importClaimsService.accept(caller)).rejects.toThrow(
			NoPendingClaimError,
		);
	});
});

describe("a guessed address", () => {
	test("is not offered or accepted until an admin confirms it", async () => {
		const email = "guess.claim@example.com";
		const { placeholder } = await importPerson(email, false);
		const caller = await signUp(email, true);

		expect(await importClaimsService.pendingFor(caller.userId)).toEqual([]);
		await expect(importClaimsService.accept(caller)).rejects.toThrow(
			NoPendingClaimError,
		);

		expect(await membersService.confirmEmail(admin, placeholder)).toEqual({
			emailConfirmed: true,
		});
		expect(
			(await importClaimsService.pendingFor(caller.userId)).map(
				(c) => c.organizationId,
			),
		).toEqual([ORG]);
		await importClaimsService.accept(caller);
		expect(await holdersOf(placeholder)).toEqual([]);
	});

	test("restoring an archived guess confirms it", async () => {
		const email = "guess.restore@example.com";
		const { placeholder } = await importPerson(email, false);
		await membersService.setArchived(admin, placeholder, true);
		const caller = await signUp(email, true);
		expect(await importClaimsService.pendingFor(caller.userId)).toEqual([]);

		expect(await membersService.setArchived(admin, placeholder, false)).toEqual(
			{ emailConfirmed: true },
		);
		expect(await importClaimsService.pendingFor(caller.userId)).toHaveLength(1);
	});

	test("confirming gives the same answer for an existing account", async () => {
		const email = "has.account@example.com";
		const owner = await signUp(email, true);
		await harvestImportService.start(admin, plan(email, false));
		expect(await membersService.confirmEmail(admin, owner.userId)).toEqual({
			emailConfirmed: true,
		});
	});
});

const CLOSED = "does not accept new accounts";

describe("registration while it is closed", () => {
	const savedOpen = process.env.REGISTRATION_OPEN;

	beforeAll(() => {
		delete process.env.REGISTRATION_OPEN;
	});
	afterAll(() => {
		if (savedOpen !== undefined) process.env.REGISTRATION_OPEN = savedOpen;
	});

	const mayRegister = (email: string, emailVerified: boolean) =>
		assertMayRegister({ email, emailVerified }, undefined);

	test("a stranger is refused", async () => {
		await expect(mayRegister("stranger@example.com", true)).rejects.toThrow(
			CLOSED,
		);
	});

	test("the verified owner of a confirmed address may sign up", async () => {
		await importPerson("owner.signup@example.com", true);
		await mayRegister("owner.signup@example.com", true);
		await mayRegister("Owner.Signup@example.com", true);
	});

	test("an unverified owner is refused outside development", async () => {
		await importPerson("owner.unverified@example.com", true);
		const previous = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";
		try {
			await expect(
				mayRegister("owner.unverified@example.com", false),
			).rejects.toThrow(CLOSED);
		} finally {
			process.env.NODE_ENV = previous;
		}
	});

	test("a guessed address is refused until it is confirmed", async () => {
		const { placeholder } = await importPerson(
			"owner.guess@example.com",
			false,
		);
		await expect(mayRegister("owner.guess@example.com", true)).rejects.toThrow(
			CLOSED,
		);
		await membersService.confirmEmail(admin, placeholder);
		await mayRegister("owner.guess@example.com", true);
	});

	test("an address whose placeholder was removed is refused", async () => {
		const email = "owner.removed@example.com";
		const { placeholder } = await importPerson(email, true);
		await mayRegister(email, true);
		await db
			.delete(member)
			.where(and(eq(member.organizationId, ORG), eq(member.userId, placeholder)));
		await expect(mayRegister(email, true)).rejects.toThrow(CLOSED);
	});

	test("an address that declined is refused", async () => {
		const email = "owner.declined@example.com";
		await importPerson(email, true);
		await importClaimsService.decline(await signUp(email, true));
		await expect(mayRegister(email, true)).rejects.toThrow(CLOSED);
	});
});
