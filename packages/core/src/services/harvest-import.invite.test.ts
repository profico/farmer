// The Harvest import with several organizations on the instance: a person
// whose address already has a user here is attached with a PENDING CLAIM, in
// the same way as an address with no account. The people list comes from the
// importing org's admin, so it is not the person's consent: the person uses
// the org only after they accept it (import-claims.service.ts). In single-org
// mode a listed address still attaches the user directly
// (harvest-import.test.ts).
//
//   1. NO ANSWER SAYS WHETHER AN ADDRESS HAS AN ACCOUNT. The result of
//      `start`, the invitations and the snapshot are the same for an address
//      with an account and for one without (issue #158).
//   2. NO MEMBERSHIP WITHOUT CONSENT. The `member` row carries a pending claim.
//   3. THE HOURS ARE WRITTEN NOW, under the user, and a second run matches
//      the person.
//   4. UNDO REMOVES ONLY THIS ORG'S ROWS from an attached user.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { auditEvent } from "../db/schema/audit";
import {
	account,
	invitation,
	member,
	organization,
	user,
} from "../db/schema/auth";
import { timeEntry } from "../db/schema/domain";
import { importPendingPerson } from "../db/schema/import";
import { memberProfile } from "../db/schema/people";
import { placeholderEmail } from "../lib/import-placeholder";
import { setInstanceSettingsForTests } from "../lib/instance-settings";
import type { HarvestStartInput } from "../schema/harvest-import";
import { createTestDb, present, type TestDb } from "../test/harness";
import { shownNameOf } from "./claim-name";
import { harvestImportService } from "./harvest-import.service";
import { importClaimsService } from "./import-claims.service";
import { membersService } from "./members.service";
import type { Ctx } from "./types";

const ORG = "hv-org";
const OTHER_ORG = "hv-other";
const ADMIN = "u-hv-admin";
/** A user of another org who has signed in, whose address the people list
 *  holds. */
const OUTSIDER = "u-hv-outsider";
const OUTSIDER_EMAIL = "outsider@example.com";
/** A user nobody holds and who never signed in. */
const LONER = "u-hv-loner";
const LONER_EMAIL = "loner@example.com";
/** A user whose address a guess happens to hit. */
const GUESSED = "u-hv-guessed";
const GUESSED_EMAIL = "guessed@example.com";

const admin: Ctx = { organizationId: ORG, userId: ADMIN };

let harness: TestDb;
let taskId: string;

/** The settings a developer's `.env` may hold. Removed for this file, so a
 *  local run is the same run as CI. */
const ENV_NAMES = [
	"BETTER_AUTH_URL",
	"EMAIL_PROVIDER",
	"RESEND_API_KEY",
	"SMTP_HOST",
	"SMTP_PORT",
	"SMTP_USER",
	"SMTP_PASS",
	"SINGLE_ORG_SLUG",
] as const;
const savedEnv = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));

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

const membershipOf = (userId: string, org = ORG) =>
	db.query.member.findFirst({
		where: and(eq(member.organizationId, org), eq(member.userId, userId)),
	});

const profileOf = (userId: string) =>
	db.query.memberProfile.findFirst({
		where: and(
			eq(memberProfile.organizationId, ORG),
			eq(memberProfile.userId, userId),
		),
	});

beforeAll(async () => {
	for (const name of ENV_NAMES) delete process.env[name];
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
		{
			id: GUESSED,
			name: "Guessed",
			email: GUESSED_EMAIL,
			emailVerified: true,
		},
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

	test("an existing user gets a pending claim, like an address with no account", async () => {
		const result = await harvestImportService.start(
			admin,
			plan([
				person("out", OUTSIDER_EMAIL),
				person("lone", LONER_EMAIL),
				person("fresh", "fresh@example.com"),
			]),
		);
		runId = result.runId;
		// One answer for all three: nothing tells the user that exists.
		expect(result.created.people).toBe(3);
		expect(result.created.invited).toBe(0);
		expect(result.invited).toEqual([]);

		for (const id of [OUTSIDER, LONER]) {
			expect(await membershipOf(id)).toBeDefined();
			expect((await profileOf(id))?.claimPendingSince).toBeInstanceOf(Date);
		}
		// The address has no account, so the user is a placeholder (issue #162).
		const [pending] = await db
			.select({ userId: importPendingPerson.userId })
			.from(importPendingPerson)
			.where(eq(importPendingPerson.email, "fresh@example.com"));
		const made = present(
			await db.query.user.findFirst({
				where: eq(user.id, present(pending, "the pending row").userId),
			}),
			"the made user",
		);
		expect(made.email).toBe(placeholderEmail(made.id));
		expect(made.emailVerified).toBe(false);
		expect(
			await db.query.user.findFirst({
				where: eq(user.email, "fresh@example.com"),
			}),
		).toBeUndefined();
		expect((await profileOf(made.id))?.claimPendingSince).toBeInstanceOf(Date);

		// No invitation, no email, no `member.invited` row for any of them.
		expect(
			await db
				.select({ id: invitation.id })
				.from(invitation)
				.where(eq(invitation.organizationId, ORG)),
		).toEqual([]);
		expect(
			await db
				.select({ id: auditEvent.id })
				.from(auditEvent)
				.where(
					and(
						eq(auditEvent.organizationId, ORG),
						eq(auditEvent.kind, "member.invited"),
					),
				),
		).toEqual([]);
	});

	test("a guessed address of an existing user gets the same answer", async () => {
		// Refusing it would tell the admin that the address has an account.
		const guess = (email: string) =>
			harvestImportService.start(
				admin,
				plan(
					[
						person(`guess ${email}`, email, {
							emailListed: false,
							emailConfirmed: false,
						}),
					],
					[],
				),
			);
		const withAccount = await guess(GUESSED_EMAIL);
		const without = await guess("nobody.guessed@example.com");
		expect(withAccount.created).toEqual(without.created);
		expect(withAccount.invited).toEqual(without.invited);
		await harvestImportService.undo(admin, { runId: without.runId });
		await harvestImportService.undo(admin, { runId: withAccount.runId });
	});

	test("the snapshot does not say that an attached user has an account", async () => {
		const snap = await harvestImportService.snapshot(admin, {
			from: "2025-01-01",
			to: "2025-12-31",
			emails: [],
		});
		const outsider = present(
			snap.members.find((m) => m.userId === OUTSIDER),
			"the attached member",
		);
		expect(outsider.hasAccount).toBe(false);
		expect(snap.members.some((m) => m.invited)).toBe(false);
	});

	test("the attached person's hours are written at once", async () => {
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

	test("a second run matches the attached person", async () => {
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
		expect(again.created.people).toBe(0);
		await harvestImportService.undo(admin, { runId: again.runId });
	});

	test("undo removes this org's rows and keeps the user and other orgs", async () => {
		await harvestImportService.undo(admin, { runId });
		expect(await membershipOf(OUTSIDER)).toBeUndefined();
		expect(await profileOf(OUTSIDER)).toBeUndefined();
		expect(await membershipOf(OUTSIDER, OTHER_ORG)).toBeDefined();
		expect(
			await db
				.select({ id: timeEntry.id })
				.from(timeEntry)
				.where(eq(timeEntry.organizationId, ORG)),
		).toEqual([]);
		// The user is not the run's to delete.
		for (const id of [OUTSIDER, LONER]) {
			expect(
				await db.query.user.findFirst({ where: eq(user.id, id) }),
			).toBeDefined();
		}
		// A user the run made is deleted.
		expect(
			await db.query.user.findFirst({
				where: eq(user.email, "fresh@example.com"),
			}),
		).toBeUndefined();
	});
});

describe("what the org sees of a pending claim", () => {
	const GUESS_NAME = "Imported Name";
	const guess = (email: string) =>
		harvestImportService.start(admin, {
			...plan(
				[
					{
						...person(`key ${email}`, email, {
							emailListed: false,
							emailConfirmed: false,
						}),
						name: GUESS_NAME,
					},
				],
				[],
			),
			runId: crypto.randomUUID(),
		});

	/** Everything the org reads about the person, without the ids and the
	 *  address that differ by construction. */
	const seenOf = async (email: string) => {
		const roster = await membersService.roster(admin);
		const row = present(
			roster.members.find((m) => m.user.email === email),
			"the roster row",
		);
		const directory = (await membersService.directory(admin)).find(
			(d) => d.userId === row.userId,
		);
		const listed = present(
			(await membersService.list(admin)).find((p) => p.userId === row.userId),
			"the list row",
		);
		return {
			rosterName: row.user.name,
			rosterImage: row.user.image,
			directory: { name: directory?.name, image: directory?.image },
			listName: listed.name,
			emailUnconfirmed: listed.emailUnconfirmed,
			claimPending: listed.claimPending,
		};
	};

	test("a found user and a made user look the same, then the real name shows", async () => {
		await db
			.update(user)
			.set({ image: "https://example.com/real.png" })
			.where(eq(user.id, GUESSED));
		const found = await guess(GUESSED_EMAIL);
		const made = await guess("made.same@example.com");
		const seenFound = await seenOf(GUESSED_EMAIL);
		const seenMade = await seenOf("made.same@example.com");
		expect(seenFound).toEqual(seenMade);
		expect(seenFound.rosterName).toBe(GUESS_NAME);
		expect(seenFound.rosterImage).toBeNull();

		// An audit label written for a pending person carries the claim name.
		await membersService.setStartDate(admin, GUESSED, "2024-02-02");
		const audit = await db
			.select({ label: auditEvent.targetLabel })
			.from(auditEvent)
			.where(
				and(
					eq(auditEvent.organizationId, ORG),
					eq(auditEvent.subjectUserId, GUESSED),
				),
			);
		expect(audit.length).toBeGreaterThan(0);
		expect(audit.every((a) => a.label === GUESS_NAME)).toBe(true);

		// After the person accepts, the org sees the account as it is.
		await importClaimsService.accept({ organizationId: ORG, userId: GUESSED });
		const accepted = await seenOf(GUESSED_EMAIL);
		expect(accepted.rosterName).toBe("Guessed");
		expect(accepted.claimPending).toBe(false);

		// Undo keeps the person who accepted, and removes the pending made user.
		await harvestImportService.undo(admin, { runId: made.runId });
		await harvestImportService.undo(admin, { runId: found.runId });
		expect(await membershipOf(GUESSED)).toBeDefined();
		expect((await profileOf(GUESSED))?.claimPendingSince).toBeNull();
	});
});

describe("a person who declined a claim", () => {
	test("keeps the claim name, gets a new claim on re-import, and undo cleans up", async () => {
		const first = await harvestImportService.start(
			admin,
			plan([person("dec one", LONER_EMAIL)], []),
		);
		const loner = { organizationId: ORG, userId: LONER };
		await importClaimsService.decline(loner);

		// The org's history shows the import's name, not the account's.
		expect(await shownNameOf(db, ORG, LONER)).toBe("dec one");
		const declined = await db
			.select({ label: auditEvent.targetLabel })
			.from(auditEvent)
			.where(
				and(
					eq(auditEvent.organizationId, ORG),
					eq(auditEvent.kind, "member.claim_declined"),
					eq(auditEvent.subjectUserId, LONER),
				),
			);
		expect(declined.map((a) => a.label)).toEqual(["dec one"]);

		// A re-import makes a pending claim again, not a full member.
		const second = await harvestImportService.start(
			admin,
			plan([person("dec two", LONER_EMAIL)], []),
		);
		expect(await membershipOf(LONER)).toBeDefined();
		const profile = await profileOf(LONER);
		expect(profile?.claimPendingSince).toBeInstanceOf(Date);
		expect(profile?.claimName).toBe("dec two");

		// Declined again, then undo removes the profile.
		await importClaimsService.decline(loner);
		await harvestImportService.undo(admin, { runId: second.runId });
		expect(await profileOf(LONER)).toBeUndefined();
		expect(first.runId).not.toBe(second.runId);
	});
});
