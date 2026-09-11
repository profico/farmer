// Effective-dated person type — the field every past-month report resolves
// through, and the one place this codebase stores history rather than state.
//
// The property pinned here is that the segments for one person PARTITION time:
// no day is covered twice, no day the person was known on is uncovered. It was
// documented on `typesAsOf` as a guarantee ("at most one match per user, so a
// plain Map build is safe") and nothing held it up. `setType` could break it
// alone: backdating a type shared a branch with the no-op edit, so moving
// "billable since June" back to March rewrote the June row's start and left the
// contractor segment it came from still ending in June. March, April and May
// were then covered twice, and `typesAsOf` chose between them by whichever row
// the query plan emitted last — so Expected, utilization and the pace check
// disagreed about a closed month on data nobody had touched.
//
// The months a person converts in are exactly the months somebody checks, which
// is what makes this worth a file of its own.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { invitation, member, organization, user } from "../db/schema/auth";
import { memberTypeHistory } from "../db/schema/people";
import { createTestDb, type TestDb } from "../test/harness";
import { AccessError } from "./access.service";
import { INVITATION_EMAIL_STALE_MS, membersService } from "./members.service";
import type { Ctx } from "./types";

const ORG = "mt-org";
const ADMIN = "u-mt-admin";
const PERSON = "u-mt-person";
const OTHER = "u-mt-other";
const PLAIN = "u-mt-plain";

let harness: TestDb;

/** A fresh Ctx per call: `requireAdmin` memoizes Access on the object. */
const adminCtx = (): Ctx => ({ organizationId: ORG, userId: ADMIN });

const setType = (
	userId: string,
	type: "billable" | "overhead" | "contractor",
	effectiveFrom: string,
	expectedSecondsOverride: number | null = null,
) =>
	membersService.setType(adminCtx(), {
		userId,
		type,
		effectiveFrom,
		expectedSecondsOverride,
	});

/** Every segment for one person, oldest first, as `[from, until, type]`. */
const segments = async (userId: string) => {
	const rows = await db
		.select({
			from: memberTypeHistory.effectiveFrom,
			until: memberTypeHistory.effectiveUntil,
			type: memberTypeHistory.type,
		})
		.from(memberTypeHistory)
		.where(
			and(
				eq(memberTypeHistory.organizationId, ORG),
				eq(memberTypeHistory.userId, userId),
			),
		);
	return rows
		.sort((a, b) => a.from.localeCompare(b.from))
		.map((r) => [r.from, r.until, r.type]);
};

const typeOn = async (userId: string, day: string) =>
	(await membersService.typesAsOf(adminCtx(), day)).get(userId)?.type ?? null;

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG,
		name: "Member Type Org",
		slug: "mt-org",
		country: "HR",
		createdAt: new Date(),
	});

	await db.insert(user).values(
		[ADMIN, PERSON, OTHER, PLAIN].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);

	await db.insert(member).values(
		[ADMIN, PERSON, OTHER, PLAIN].map((id) => ({
			id: `m-${id}`,
			organizationId: ORG,
			userId: id,
			role: id === ADMIN ? "admin" : "member",
			createdAt: new Date(),
		})),
	);
});

afterAll(async () => {
	await harness.close();
});

beforeEach(async () => {
	await db
		.delete(memberTypeHistory)
		.where(eq(memberTypeHistory.organizationId, ORG));
});

// The invitation email is sent after `createInvitation` has returned, so this
// row is the only place its outcome is kept. Two properties matter: sending an
// invitation again replaces the old outcome, and a send that never reported
// back cannot keep the members page polling for ever.
describe("invitation email status", () => {
	const INVITE = "inv-mt-1";

	beforeAll(async () => {
		await db.insert(invitation).values({
			id: INVITE,
			organizationId: ORG,
			email: "new@example.com",
			role: "member",
			status: "pending",
			expiresAt: new Date(Date.now() + 86_400_000),
			createdAt: new Date(),
			inviterId: ADMIN,
		});
	});

	test("a second send replaces the earlier outcome", async () => {
		await membersService.recordInvitationEmail(ORG, INVITE, "failed", "boom");
		await membersService.recordInvitationEmail(ORG, INVITE, "sending");

		const emails = await membersService.invitationEmails(adminCtx());
		expect(emails.get(INVITE)).toEqual({ status: "sending", error: null });
	});

	test("a send that never reported back reads as failed", async () => {
		await membersService.recordInvitationEmail(ORG, INVITE, "sending");
		const later = new Date(Date.now() + INVITATION_EMAIL_STALE_MS + 1_000);

		const emails = await membersService.invitationEmails(adminCtx(), {
			now: later,
		});
		expect(emails.get(INVITE)?.status).toBe("failed");
	});

	test("a status that cannot be written does not throw", async () => {
		// No such invitation, so the foreign key refuses the row. The hook
		// calling this runs after the invitation exists, and must not undo it.
		await expect(
			membersService.recordInvitationEmail(ORG, "inv-missing", "sent"),
		).resolves.toBeUndefined();
	});

	test("only an admin may read it", async () => {
		await expect(
			membersService.invitationEmails({ organizationId: ORG, userId: PLAIN }),
		).rejects.toThrow(AccessError);
	});
});

describe("setType", () => {
	test("the first change opens one open-ended segment", async () => {
		await setType(PERSON, "contractor", "2025-01-01");
		expect(await segments(PERSON)).toEqual([
			["2025-01-01", null, "contractor"],
		]);
	});

	test("a later change closes the previous segment at the new start", async () => {
		await setType(PERSON, "contractor", "2025-01-01");
		await setType(PERSON, "billable", "2025-06-01");

		expect(await segments(PERSON)).toEqual([
			["2025-01-01", "2025-06-01", "contractor"],
			["2025-06-01", null, "billable"],
		]);
	});

	test("re-stating from the SAME date edits in place, adding no segment", async () => {
		await setType(PERSON, "contractor", "2025-01-01", 100 * 3600);
		const [before] = await db
			.select({ id: memberTypeHistory.id })
			.from(memberTypeHistory)
			.where(eq(memberTypeHistory.userId, PERSON));

		await setType(PERSON, "contractor", "2025-01-01", 120 * 3600);

		const rows = await db
			.select({
				id: memberTypeHistory.id,
				override: memberTypeHistory.expectedSecondsOverride,
			})
			.from(memberTypeHistory)
			.where(eq(memberTypeHistory.userId, PERSON));

		// Same row, corrected — not a second segment and not a replacement, so the
		// audit trail `typeHistory` draws does not gain an entry for a typo fix.
		expect(rows).toHaveLength(1);
		expect(rows[0]?.id).toBe(before?.id);
		expect(rows[0]?.override).toBe(120 * 3600);
	});

	// The regression. Every assertion below failed before `setType` stopped
	// folding a backdate into the no-op branch.
	test("backdating truncates the segment it reaches into", async () => {
		await setType(PERSON, "contractor", "2025-01-01");
		await setType(PERSON, "billable", "2025-06-01");

		// "They have actually been billable since March."
		await setType(PERSON, "billable", "2025-03-01");

		expect(await segments(PERSON)).toEqual([
			["2025-01-01", "2025-03-01", "contractor"],
			["2025-03-01", null, "billable"],
		]);
	});

	test("backdating past a whole segment withdraws it", async () => {
		await setType(PERSON, "contractor", "2025-01-01");
		await setType(PERSON, "overhead", "2025-04-01");
		await setType(PERSON, "billable", "2025-06-01");

		await setType(PERSON, "billable", "2025-02-01");

		// The overhead segment described a period that is now billable. It is not
		// history any more, it is a withdrawn statement.
		expect(await segments(PERSON)).toEqual([
			["2025-01-01", "2025-02-01", "contractor"],
			["2025-02-01", null, "billable"],
		]);
	});

	test("backdating before every segment replaces the whole history", async () => {
		await setType(PERSON, "contractor", "2025-01-01");
		await setType(PERSON, "billable", "2025-06-01");

		await setType(PERSON, "overhead", "2024-01-01");

		expect(await segments(PERSON)).toEqual([["2024-01-01", null, "overhead"]]);
	});

	test("one person's history does not touch another's", async () => {
		await setType(PERSON, "contractor", "2025-01-01");
		await setType(OTHER, "overhead", "2025-01-01");
		await setType(PERSON, "billable", "2025-03-01");

		expect(await segments(OTHER)).toEqual([["2025-01-01", null, "overhead"]]);
	});

	test("a non-admin cannot change a type", async () => {
		await expect(
			membersService.setType(
				{ organizationId: ORG, userId: PLAIN },
				{
					userId: PERSON,
					type: "overhead",
					effectiveFrom: "2025-01-01",
					expectedSecondsOverride: null,
				},
			),
		).rejects.toBeInstanceOf(AccessError);
	});
});

describe("the mth_no_overlap trigger", () => {
	// `setType` is the only writer, so this asserts on the database directly:
	// the guarantee `typesAsOf` reads has to hold whatever writes the row.
	test("rejects a segment that covers a day another already covers", async () => {
		await setType(PERSON, "contractor", "2025-01-01");
		await setType(PERSON, "billable", "2025-06-01");

		// Exactly the shape the old backdating branch produced. Wrapped in a
		// real promise: a drizzle builder is only a thenable, and `.rejects`
		// resolves it to the builder object rather than running the statement.
		const backdateInPlace = async () => {
			await db
				.update(memberTypeHistory)
				.set({ effectiveFrom: "2025-03-01" })
				.where(
					and(
						eq(memberTypeHistory.userId, PERSON),
						eq(memberTypeHistory.effectiveFrom, "2025-06-01"),
					),
				);
		};

		// Drizzle wraps a driver error in a `Failed query: ...` of its own, so the
		// text the trigger raised is further down the `cause` chain. Walk the whole
		// chain rather than one link: which level it lands on is drizzle's business.
		const raised = await backdateInPlace().then(
			() => null,
			(error: unknown) => error,
		);
		expect(raised).toBeInstanceOf(Error);

		const messages: string[] = [];
		let cursor: unknown = raised;
		while (cursor instanceof Error) {
			messages.push(cursor.message);
			cursor = cursor.cause;
		}
		expect(messages.join(" ")).toMatch(/overlaps an existing one/);
	});

	test("allows two segments that meet without overlapping", async () => {
		await setType(PERSON, "contractor", "2025-01-01");
		await setType(PERSON, "billable", "2025-06-01");

		// `effective_until` is exclusive, so ending and starting on the same day is
		// the ordinary adjacent case and must stay legal.
		expect(await segments(PERSON)).toHaveLength(2);
	});
});

describe("typesAsOf", () => {
	test("answers with the type held on the day asked about", async () => {
		await setType(PERSON, "contractor", "2025-01-01");
		await setType(PERSON, "billable", "2025-06-01");

		expect(await typeOn(PERSON, "2025-03-15")).toBe("contractor");
		// `effective_until` is exclusive: the change lands ON its own date.
		expect(await typeOn(PERSON, "2025-05-31")).toBe("contractor");
		expect(await typeOn(PERSON, "2025-06-01")).toBe("billable");
		expect(await typeOn(PERSON, "2026-01-01")).toBe("billable");
	});

	test("a day before any segment has no entry, and typeFor defaults it", async () => {
		await setType(PERSON, "contractor", "2025-01-01");

		expect(await typeOn(PERSON, "2024-12-31")).toBeNull();
		// Billable is the default and the right one — delivery is the common case.
		const resolved = await membersService.typeFor(
			adminCtx(),
			PERSON,
			"2024-12-31",
		);
		expect(resolved.type).toBe("billable");
	});

	test("stays single-valued after a backdate", async () => {
		await setType(PERSON, "contractor", "2025-01-01");
		await setType(PERSON, "billable", "2025-06-01");
		await setType(PERSON, "billable", "2025-03-01");

		// The point of the whole fix: March resolves, and resolves to one thing.
		expect(await typeOn(PERSON, "2025-03-15")).toBe("billable");
		expect(await typeOn(PERSON, "2025-02-15")).toBe("contractor");
	});

	test("typesForMonth resolves as of the last day of the month", async () => {
		await setType(PERSON, "contractor", "2025-01-01");
		await setType(PERSON, "billable", "2025-06-15");

		// Mid-month conversion: the person is reported under the type they
		// finished June under, which is how the close sheet is read.
		const june = await membersService.typesForMonth(adminCtx(), 2025, 6);
		expect(june.get(PERSON)?.type).toBe("billable");
		const may = await membersService.typesForMonth(adminCtx(), 2025, 5);
		expect(may.get(PERSON)?.type).toBe("contractor");
	});
});

describe("list", () => {
	test("reports the type covering today, not a future-dated one", async () => {
		await setType(PERSON, "contractor", "2020-01-01");
		// Dated ahead. This is the open-ended row, so joining on
		// `effective_until is null` announced the change as already in force.
		await setType(PERSON, "billable", "2999-01-01");

		const rows = await membersService.list(adminCtx());
		expect(rows.find((r) => r.userId === PERSON)?.type).toBe("contractor");
	});

	test("a person with no history at all is billable", async () => {
		const rows = await membersService.list(adminCtx());
		expect(rows.find((r) => r.userId === PERSON)?.type).toBe("billable");
	});
});
