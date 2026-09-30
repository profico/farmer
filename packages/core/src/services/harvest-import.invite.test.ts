// The Harvest import with several organizations on the instance: a person
// whose address already has a user here is INVITED, never added. The people
// list comes from the importing org's admin, so it is not the person's
// consent. Their hours are written at once; accepting adds only the `member`
// row. In single-org mode a listed address still attaches the user directly
// (harvest-import.test.ts).
//
//   1. NO MEMBERSHIP WITHOUT CONSENT. `start` writes an invitation and no
//      `member` row, and says who it invited.
//   2. THE HOURS ARE WRITTEN NOW, under the user, and a second run matches
//      the invited person rather than calling them gone.
//   3. ONE INVITATION. A second run, or an invitation the org sent before,
//      does not send another.
//   4. UNDO CANCELS WHAT THE RUN SENT, and keeps a membership the person
//      accepted.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import {
	account,
	invitation,
	member,
	organization,
	user,
} from "../db/schema/auth";
import { timeEntry } from "../db/schema/domain";
import { invitationEmail, memberProfile } from "../db/schema/people";
import { setInstanceSettingsForTests } from "../lib/instance-settings";
import type { HarvestStartInput } from "../schema/harvest-import";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { harvestImportService } from "./harvest-import.service";
import type { Ctx } from "./types";

const ORG = "hv-org";
const OTHER_ORG = "hv-other";
const ADMIN = "u-hv-admin";
/** A user of another org who has signed in, whose address the people list
 *  holds. */
const OUTSIDER = "u-hv-outsider";
const OUTSIDER_EMAIL = "outsider@example.com";
/** A user nobody holds and who never signed in. Invited all the same. */
const LONER = "u-hv-loner";
const LONER_EMAIL = "loner@example.com";
const LATER = "u-hv-later";
const LATER_EMAIL = "later@example.com";
const RETRY = "u-hv-retry";
const RETRY_EMAIL = "retry@example.com";
/** People the org invited before the run, so the run reuses the invitation. */
const REUSED = "u-hv-reused";
const REUSED_EMAIL = "reused@example.com";
const JOINER = "u-hv-joiner";
const JOINER_EMAIL = "joiner@example.com";

const admin: Ctx = { organizationId: ORG, userId: ADMIN };

let harness: TestDb;
let taskId: string;

/** The mail settings a developer's `.env` may hold. Removed for this file,
 *  so the invitation email fails fast instead of going out. CI has none of
 *  them, `BETTER_AUTH_URL` included, so removing them makes a local run the
 *  same run as CI. */
const MAIL_NAMES = [
	"BETTER_AUTH_URL",
	"EMAIL_PROVIDER",
	"RESEND_API_KEY",
	"SMTP_HOST",
	"SMTP_PORT",
	"SMTP_USER",
	"SMTP_PASS",
	"SINGLE_ORG_SLUG",
] as const;
const savedEnv = new Map(MAIL_NAMES.map((name) => [name, process.env[name]]));

const person = (
	sourceKey: string,
	email: string,
	extra: Partial<{ emailListed: boolean; emailConfirmed: boolean }> = {},
) => ({
	action: "create" as const,
	sourceKey,
	name: sourceKey,
	email,
	emailListed: true,
	emailConfirmed: true,
	role: "member" as const,
	type: "employee_billable" as const,
	startDate: "2024-01-01",
	archivedOn: null,
	...extra,
});

const plan = (
	people: HarvestStartInput["people"],
	tasks: HarvestStartInput["tasks"] = [
		{ action: "match", sourceKey: "Paid Leave", localId: taskId },
	],
): HarvestStartInput => ({
	runId: crypto.randomUUID(),
	source: "harvest",
	cutoffDate: "2025-04-01",
	clients: [],
	tasks,
	projects: [],
	people,
	projectMembers: [],
});

const membershipOf = (userId: string) =>
	db.query.member.findFirst({
		where: and(eq(member.organizationId, ORG), eq(member.userId, userId)),
	});

/** A pending invitation, as the People page writes one. */
const invite = (id: string, email: string) =>
	db.insert(invitation).values({
		id,
		organizationId: ORG,
		email,
		role: "member",
		status: "pending",
		expiresAt: new Date(Date.now() + 60_000),
		inviterId: ADMIN,
	});

const invitationsTo = (email: string) =>
	db
		.select({ id: invitation.id, status: invitation.status })
		.from(invitation)
		.where(
			and(eq(invitation.organizationId, ORG), eq(invitation.email, email)),
		);

beforeAll(async () => {
	for (const name of MAIL_NAMES) delete process.env[name];
	setInstanceSettingsForTests({});
	harness = await createTestDb();

	await db.insert(organization).values(
		[ORG, OTHER_ORG].map((id) => ({
			id,
			name: id,
			slug: id,
			timezone: "UTC",
			createdAt: new Date(),
		})),
	);
	await db.insert(user).values([
		{
			id: ADMIN,
			name: "Admin",
			email: "admin@example.com",
			emailVerified: true,
		},
		{
			id: OUTSIDER,
			name: "Outsider",
			email: OUTSIDER_EMAIL,
			emailVerified: true,
		},
		{ id: LONER, name: "Loner", email: LONER_EMAIL, emailVerified: true },
		{ id: LATER, name: "Later", email: LATER_EMAIL, emailVerified: true },
		{ id: RETRY, name: "Retry", email: RETRY_EMAIL, emailVerified: true },
		{ id: REUSED, name: "Reused", email: REUSED_EMAIL, emailVerified: true },
		{ id: JOINER, name: "Joiner", email: JOINER_EMAIL, emailVerified: true },
	]);
	await db.insert(member).values([
		{
			id: "m-hv-admin",
			organizationId: ORG,
			userId: ADMIN,
			role: "admin",
			createdAt: new Date(),
		},
		{
			id: "m-hv-outsider",
			organizationId: OTHER_ORG,
			userId: OUTSIDER,
			role: "member",
			createdAt: new Date(),
		},
	]);
	await db.insert(account).values({
		id: "acc-hv-outsider",
		accountId: "google-outsider",
		providerId: "google",
		userId: OUTSIDER,
		updatedAt: new Date(),
	});
	taskId = present(
		await db.query.task.findFirst({
			where: (t, { eq: is }) => is(t.systemKey, "paid_leave"),
		}),
		"Paid Leave (migration 0038)",
	).id;
});

afterAll(async () => {
	setInstanceSettingsForTests(undefined);
	for (const [name, value] of savedEnv) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	await harness.close();
});

describe("harvest import with several organizations", () => {
	let runId: string;

	test("an existing user is invited, not added", async () => {
		const result = await harvestImportService.start(
			admin,
			plan([person("out", OUTSIDER_EMAIL), person("lone", LONER_EMAIL)]),
		);
		runId = result.runId;
		expect(result.created.people).toBe(0);
		expect(result.created.invited).toBe(2);
		expect([...result.invited].sort()).toEqual([LONER_EMAIL, OUTSIDER_EMAIL]);

		expect(await membershipOf(OUTSIDER)).toBeUndefined();
		expect(await membershipOf(LONER)).toBeUndefined();
		expect(await invitationsTo(OUTSIDER_EMAIL)).toEqual([
			{ id: expect.any(String), status: "pending" },
		]);
		// The profile is written now, so accepting adds only the membership.
		const profile = await db.query.memberProfile.findFirst({
			where: and(
				eq(memberProfile.organizationId, ORG),
				eq(memberProfile.userId, OUTSIDER),
			),
		});
		expect(profile?.startDate).toBe("2024-01-01");

		// The email was tried after the commit. No origin here to build the
		// link from, so it failed, and the People page shows why.
		const invitationId = at(await invitationsTo(OUTSIDER_EMAIL), 0).id;
		const delivery = await db.query.invitationEmail.findFirst({
			where: eq(invitationEmail.invitationId, invitationId),
		});
		expect(delivery?.status).toBe("failed");
		expect(delivery?.error).toContain("BETTER_AUTH_URL");
	});

	test("the invited person's hours are written at once", async () => {
		const result = await harvestImportService.importDays(admin, {
			runId,
			days: [
				{
					personSourceKey: "out",
					date: "2025-03-03",
					rows: [
						{
							key: "o1",
							projectSourceKey: null,
							taskSourceKey: "Paid Leave",
							description: "row o1",
							durationSeconds: 3600,
							overtime: false,
						},
					],
				},
			],
		});
		expect(result.inserted).toBe(1);
		const rows = await db
			.select({ userId: timeEntry.userId })
			.from(timeEntry)
			.where(eq(timeEntry.organizationId, ORG));
		expect(rows).toEqual([{ userId: OUTSIDER }]);
	});

	test("the snapshot lists the invited people, so a second run matches them", async () => {
		const snap = await harvestImportService.snapshot(admin, {
			from: "2025-01-01",
			to: "2025-12-31",
			emails: [],
		});
		const invited = snap.members.filter((m) => m.invited);
		expect(invited.map((m) => m.userId).sort()).toEqual([LONER, OUTSIDER]);

		const again = await harvestImportService.start(
			admin,
			plan(
				[
					{
						action: "match",
						sourceKey: "out",
						localId: OUTSIDER,
						startDate: null,
					},
				],
				[],
			),
		);
		expect(again.created.invited).toBe(0);
		// Still the one invitation.
		expect(await invitationsTo(OUTSIDER_EMAIL)).toHaveLength(1);
		await harvestImportService.undo(admin, { runId: again.runId });
	});

	test("a user the import makes must accept the workspace first", async () => {
		const result = await harvestImportService.start(
			admin,
			plan([person("fresh", "fresh@example.com")]),
		);
		expect(result.created.people).toBe(1);
		const made = present(
			await db.query.user.findFirst({
				where: eq(user.email, "fresh@example.com"),
			}),
			"the made user",
		);
		expect(await membershipOf(made.id)).toBeDefined();
		const profile = await db.query.memberProfile.findFirst({
			where: and(
				eq(memberProfile.organizationId, ORG),
				eq(memberProfile.userId, made.id),
			),
		});
		expect(profile?.claimPendingSince).toBeInstanceOf(Date);
		await harvestImportService.undo(admin, { runId: result.runId });
	});

	test("a guessed address of an existing user is refused, not invited", async () => {
		await expect(
			harvestImportService.start(
				admin,
				plan([
					person("guess", LONER_EMAIL, {
						emailListed: false,
						emailConfirmed: false,
					}),
				]),
			),
		).rejects.toThrow("belongs to another user");
		expect(await invitationsTo(LONER_EMAIL)).toHaveLength(1);
	});

	test("undo cancels the invitations the run sent", async () => {
		await harvestImportService.undo(admin, { runId });
		expect(await invitationsTo(OUTSIDER_EMAIL)).toEqual([
			{ id: expect.any(String), status: "canceled" },
		]);
		expect(await membershipOf(OUTSIDER)).toBeUndefined();
		const rows = await db
			.select({ id: timeEntry.id })
			.from(timeEntry)
			.where(eq(timeEntry.organizationId, ORG));
		expect(rows).toEqual([]);
		// The user is not the run's to delete.
		expect(
			await db.query.user.findFirst({ where: eq(user.id, OUTSIDER) }),
		).toBeDefined();
	});

	test("undo keeps a membership the person accepted", async () => {
		const result = await harvestImportService.start(
			admin,
			plan([person("lone", LONER_EMAIL)]),
		);
		const pending = (await invitationsTo(LONER_EMAIL)).find(
			(row) => row.status === "pending",
		);
		const sent = present(pending, "the run's invitation");
		// What better-auth's acceptInvitation writes.
		await db
			.update(invitation)
			.set({ status: "accepted" })
			.where(eq(invitation.id, sent.id));
		await db.insert(member).values({
			id: "m-hv-loner",
			organizationId: ORG,
			userId: LONER,
			role: "member",
			createdAt: new Date(),
		});

		await harvestImportService.undo(admin, { runId: result.runId });
		expect(await membershipOf(LONER)).toBeDefined();
		expect(
			await db.query.memberProfile.findFirst({
				where: and(
					eq(memberProfile.organizationId, ORG),
					eq(memberProfile.userId, LONER),
				),
			}),
		).toBeDefined();
	});

	test("undo leaves an invitation the People page sent after the run", async () => {
		const result = await harvestImportService.start(
			admin,
			plan([person("later", LATER_EMAIL)]),
		);
		const runsOwn = present(
			(await invitationsTo(LATER_EMAIL)).find((r) => r.status === "pending"),
			"the run's invitation",
		);
		// The run's invitation lapses, and the People page invites the
		// same address again afterwards.
		await db
			.update(invitation)
			.set({ status: "canceled" })
			.where(eq(invitation.id, runsOwn.id));
		const laterId = "inv-hv-later";
		await db.insert(invitation).values({
			id: laterId,
			organizationId: ORG,
			email: LATER_EMAIL,
			role: "member",
			status: "pending",
			expiresAt: new Date(Date.now() + 60_000),
			inviterId: ADMIN,
		});

		await harvestImportService.undo(admin, { runId: result.runId });
		const later = await db.query.invitation.findFirst({
			where: eq(invitation.id, laterId),
		});
		expect(later?.status).toBe("pending");
	});

	test("a retried start still reports a person who accepted as invited", async () => {
		const first = await harvestImportService.start(
			admin,
			plan([person("retry", RETRY_EMAIL)]),
		);
		expect(first.created.invited).toBe(1);
		const sent = present(
			(await invitationsTo(RETRY_EMAIL)).find((r) => r.status === "pending"),
			"the run's invitation",
		);
		await db
			.update(invitation)
			.set({ status: "accepted" })
			.where(eq(invitation.id, sent.id));
		await db.insert(member).values({
			id: "m-hv-retry",
			organizationId: ORG,
			userId: RETRY,
			role: "member",
			createdAt: new Date(),
		});

		const again = await harvestImportService.start(admin, {
			...plan([person("retry", RETRY_EMAIL)]),
			runId: first.runId,
		});
		expect(again.created.invited).toBe(1);
		expect(again.created.people).toBe(0);
		expect(again.invited).toEqual([RETRY_EMAIL]);
	});

	test("undo after a run that only reused an invitation leaves the People page's", async () => {
		await invite("inv-hv-reused-before", REUSED_EMAIL);
		const result = await harvestImportService.start(
			admin,
			plan([person("reused", REUSED_EMAIL)]),
		);
		expect(result.invited).toEqual([REUSED_EMAIL]);
		// The People page sends the same address a second invitation.
		await invite("inv-hv-reused-after", REUSED_EMAIL);

		await harvestImportService.undo(admin, { runId: result.runId });
		expect((await invitationsTo(REUSED_EMAIL)).map((r) => r.status)).toEqual([
			"pending",
			"pending",
		]);
	});

	test("undo keeps a person who accepted a reused invitation", async () => {
		await invite("inv-hv-joiner", JOINER_EMAIL);
		const result = await harvestImportService.start(
			admin,
			plan([person("joiner", JOINER_EMAIL)]),
		);
		// What better-auth's acceptInvitation writes.
		await db
			.update(invitation)
			.set({ status: "accepted" })
			.where(eq(invitation.id, "inv-hv-joiner"));
		await db.insert(member).values({
			id: "m-hv-joiner",
			organizationId: ORG,
			userId: JOINER,
			role: "member",
			createdAt: new Date(),
		});

		await harvestImportService.undo(admin, { runId: result.runId });
		expect(await membershipOf(JOINER)).toBeDefined();
		expect(
			await db.query.memberProfile.findFirst({
				where: and(
					eq(memberProfile.organizationId, ORG),
					eq(memberProfile.userId, JOINER),
				),
			}),
		).toBeDefined();
	});
});
