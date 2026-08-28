// "Not on the invoice" (PRD 6.7) — the monthly bench list that goes to the CEO.
//
// It is a report about ABSENCE of billed hours, which makes every one of its
// filters a way to accuse somebody wrongly or to let a real gap through:
//
//   * STRICTLY ZERO. Someone with 16h Final is not on the bench, and rounding
//     that to "barely billed" would put a working person on a list the CEO reads
//     as idle.
//   * FINAL, NOT REPORTED. The number is what was invoiced after close, so an
//     open or submitted month contributes nothing — which is why the report
//     hands back `finalizedCloseCount`, so the screen can say "no months
//     finalized yet" instead of implying the whole company was benched.
//   * INTERNAL PROJECTS DON'T COUNT. Hours on an internal project are hours
//     nobody paid for; a month spent entirely on internal work IS bench.
//   * ONLY BILLABLE, ONLY ACTIVE. Contractors and overhead have no bench
//     concept, and a leaver's permanent zero would be noise every month forever.
//
// The status list is the other half: seeded lazily on first read, and an org
// that archives every option means it, so re-seeding would resurrect a list they
// deleted on purpose.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { monthlyClose, monthlyCloseRow } from "../db/schema/close";
import { client, project } from "../db/schema/domain";
import { memberProfile, memberTypeHistory } from "../db/schema/people";
import {
	notOnInvoiceEntry,
	notOnInvoiceStatusOption,
} from "../db/schema/settings";
import { createTestDb, type TestDb } from "../test/harness";
import { AccessError } from "./access.service";
import {
	DEFAULT_STATUS_OPTIONS,
	notOnInvoiceService,
} from "./not-on-invoice.service";
import type { Ctx } from "./types";

const H = 3600;
const ORG = "noi-org";
const YEAR = 2026;
const MONTH = 4;

const ADMIN = "u-noi-admin";
/** Billed real hours — never on the list. */
const BILLED = "u-noi-billed";
/** Billable, active, zero Final — the archetype the report is for. */
const BENCH = "u-noi-bench";
/** Billable but every hour on an internal project — still bench. */
const INTERNAL_ONLY = "u-noi-internal";
/** Zero hours, but a contractor. */
const CONTRACTOR = "u-noi-contractor";
/** Zero hours, but overhead. */
const OVERHEAD = "u-noi-overhead";
/** Zero hours, but they left. */
const ARCHIVED = "u-noi-archived";

const EVERYONE = [
	ADMIN,
	BILLED,
	BENCH,
	INTERNAL_ONLY,
	CONTRACTOR,
	OVERHEAD,
	ARCHIVED,
];

let harness: TestDb;
let clientProjectId: string;
let internalProjectId: string;

const adminCtx = (): Ctx => ({ organizationId: ORG, userId: ADMIN });

/** Finalize a project's month with these per-person Final figures. Writes the
 *  close records directly: this file is about how the REPORT reads them, and
 *  going through closeService would drag in its own lifecycle rules. */
const finalizeWith = async (
	projectId: string,
	finals: Record<string, number>,
) => {
	const [close] = await db
		.insert(monthlyClose)
		.values({
			organizationId: ORG,
			projectId,
			year: YEAR,
			month: MONTH,
			status: "finalized",
			finalizedAt: new Date(),
		})
		.returning();
	if (!close) throw new Error("Failed to seed close");

	const rows = Object.entries(finals);
	if (rows.length > 0) {
		await db.insert(monthlyCloseRow).values(
			rows.map(([userId, finalSeconds]) => ({
				organizationId: ORG,
				closeId: close.id,
				userId,
				finalSeconds,
			})),
		);
	}
	return close.id;
};

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG,
		name: "NOI Org",
		slug: "noi-org",
		createdAt: new Date(),
	});

	await db.insert(user).values(
		EVERYONE.map((id) => ({
			id,
			name: id.replace("u-noi-", ""),
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);

	await db.insert(member).values(
		EVERYONE.map((id) => ({
			id: `mn-${id}`,
			organizationId: ORG,
			userId: id,
			role: id === ADMIN ? "admin" : "member",
			createdAt: new Date(),
		})),
	);

	const [c] = await db
		.insert(client)
		.values({ organizationId: ORG, name: "Paying Client" })
		.returning();
	if (!c) throw new Error("Failed to seed client");

	const [paying, internal] = await db
		.insert(project)
		.values([
			{
				organizationId: ORG,
				clientId: c.id,
				name: "Paying",
				type: "product_team" as const,
			},
			{
				organizationId: ORG,
				clientId: c.id,
				name: "Internal",
				type: "internal" as const,
			},
		])
		.returning();
	if (!paying || !internal) throw new Error("Failed to seed projects");
	clientProjectId = paying.id;
	internalProjectId = internal.id;

	// Effective-dated types. Anyone without a row is billable by default, which
	// covers ADMIN, BILLED, BENCH, INTERNAL_ONLY and ARCHIVED.
	await db.insert(memberTypeHistory).values([
		{
			organizationId: ORG,
			userId: CONTRACTOR,
			type: "contractor" as const,
			effectiveFrom: "2020-01-01",
		},
		{
			organizationId: ORG,
			userId: OVERHEAD,
			type: "overhead" as const,
			effectiveFrom: "2020-01-01",
		},
	]);

	await db.insert(memberProfile).values({
		organizationId: ORG,
		userId: ARCHIVED,
		archivedAt: new Date(),
	});
});

afterAll(async () => {
	await harness.close();
});

beforeEach(async () => {
	await db.delete(monthlyClose).where(eq(monthlyClose.organizationId, ORG));
	await db
		.delete(notOnInvoiceEntry)
		.where(eq(notOnInvoiceEntry.organizationId, ORG));
	await db
		.delete(notOnInvoiceStatusOption)
		.where(eq(notOnInvoiceStatusOption.organizationId, ORG));
});

const namesOn = async () => {
	const report = await notOnInvoiceService.report(adminCtx(), {
		year: YEAR,
		month: MONTH,
	});
	return report.rows.map((r) => r.userId).sort();
};

describe("who lands on the list", () => {
	test("somebody with billed hours does not, somebody with none does", async () => {
		await finalizeWith(clientProjectId, { [BILLED]: 40 * H });

		const listed = await namesOn();
		expect(listed).not.toContain(BILLED);
		expect(listed).toContain(BENCH);
	});

	test("strictly zero — a small number of hours is still not bench", async () => {
		await finalizeWith(clientProjectId, {
			[BILLED]: 40 * H,
			// One hour all month. Under-sold, certainly; not on the invoice, no.
			[BENCH]: 1 * H,
		});
		expect(await namesOn()).not.toContain(BENCH);
	});

	test("a person whose every hour is on an internal project IS bench", async () => {
		await finalizeWith(clientProjectId, { [BILLED]: 40 * H });
		await finalizeWith(internalProjectId, { [INTERNAL_ONLY]: 120 * H });

		const listed = await namesOn();
		expect(listed).toContain(INTERNAL_ONLY);
	});

	test("contractors, overhead and archived people never appear", async () => {
		await finalizeWith(clientProjectId, { [BILLED]: 40 * H });

		const listed = await namesOn();
		expect(listed).not.toContain(CONTRACTOR);
		expect(listed).not.toContain(OVERHEAD);
		expect(listed).not.toContain(ARCHIVED);
	});

	test("a zero stored explicitly counts as zero, not as missing", async () => {
		await finalizeWith(clientProjectId, { [BENCH]: 0 });
		expect(await namesOn()).toContain(BENCH);
	});
});

describe("only finalized months count", () => {
	test("hours in a month that is merely submitted do not save you from the list", async () => {
		const [close] = await db
			.insert(monthlyClose)
			.values({
				organizationId: ORG,
				projectId: clientProjectId,
				year: YEAR,
				month: MONTH,
				status: "submitted",
				submittedAt: new Date(),
			})
			.returning();
		if (!close) throw new Error("Failed to seed close");
		await db.insert(monthlyCloseRow).values({
			organizationId: ORG,
			closeId: close.id,
			userId: BILLED,
			finalSeconds: 100 * H,
		});

		const report = await notOnInvoiceService.report(adminCtx(), {
			year: YEAR,
			month: MONTH,
		});
		expect(report.finalizedCloseCount).toBe(0);
		// Everybody billable and active is "on the bench" — which is exactly why
		// the count is surfaced: the screen must say the month isn't closed rather
		// than present this as a finding.
		expect(report.rows.map((r) => r.userId)).toContain(BILLED);
	});

	test("finalizedCloseCount reports how many projects actually closed", async () => {
		await finalizeWith(clientProjectId, { [BILLED]: 40 * H });
		await finalizeWith(internalProjectId, {});

		const report = await notOnInvoiceService.report(adminCtx(), {
			year: YEAR,
			month: MONTH,
		});
		expect(report.finalizedCloseCount).toBe(2);
	});

	test("another month's finalization does not answer this month", async () => {
		await db
			.insert(monthlyClose)
			.values({
				organizationId: ORG,
				projectId: clientProjectId,
				year: YEAR,
				month: MONTH - 1,
				status: "finalized",
				finalizedAt: new Date(),
			})
			.returning();

		const report = await notOnInvoiceService.report(adminCtx(), {
			year: YEAR,
			month: MONTH,
		});
		expect(report.finalizedCloseCount).toBe(0);
	});
});

describe("annotations", () => {
	test("a status and comment come back on the person's row", async () => {
		await finalizeWith(clientProjectId, { [BILLED]: 40 * H });
		const options = await notOnInvoiceService.listStatusOptions(adminCtx());
		const bench = options.find((o) => o.label === "Bench");
		if (!bench) throw new Error("Bench option missing");

		await notOnInvoiceService.setStatus(adminCtx(), {
			year: YEAR,
			month: MONTH,
			userId: BENCH,
			statusOptionId: bench.id,
			comment: "waiting on the Acme SOW",
		});

		const report = await notOnInvoiceService.report(adminCtx(), {
			year: YEAR,
			month: MONTH,
		});
		const row = report.rows.find((r) => r.userId === BENCH);
		expect(row?.statusLabel).toBe("Bench");
		expect(row?.comment).toBe("waiting on the Acme SOW");
	});

	test("setStatus is per month — it does not bleed into the next one", async () => {
		const options = await notOnInvoiceService.listStatusOptions(adminCtx());
		const bench = options[0];
		if (!bench) throw new Error("no options");

		await notOnInvoiceService.setStatus(adminCtx(), {
			year: YEAR,
			month: MONTH,
			userId: BENCH,
			statusOptionId: bench.id,
			comment: "this month only",
		});

		const next = await notOnInvoiceService.report(adminCtx(), {
			year: YEAR,
			month: MONTH + 1,
		});
		expect(next.rows.find((r) => r.userId === BENCH)?.comment).toBeNull();
	});

	test("re-setting a status replaces rather than duplicating", async () => {
		const options = await notOnInvoiceService.listStatusOptions(adminCtx());
		const [first, second] = options;
		if (!first || !second) throw new Error("need two options");

		const args = { year: YEAR, month: MONTH, userId: BENCH };
		await notOnInvoiceService.setStatus(adminCtx(), {
			...args,
			statusOptionId: first.id,
			comment: "one",
		});
		await notOnInvoiceService.setStatus(adminCtx(), {
			...args,
			statusOptionId: second.id,
			comment: "two",
		});

		const report = await notOnInvoiceService.report(adminCtx(), {
			year: YEAR,
			month: MONTH,
		});
		const row = report.rows.find((r) => r.userId === BENCH);
		expect(row?.statusLabel).toBe(second.label);
		expect(row?.comment).toBe("two");
	});

	test("a status option from another org is refused", async () => {
		await db.insert(organization).values({
			id: "noi-other",
			name: "Other",
			slug: "noi-other",
			createdAt: new Date(),
		});
		const [foreign] = await db
			.insert(notOnInvoiceStatusOption)
			.values({ organizationId: "noi-other", label: "Foreign", sortOrder: 0 })
			.returning();
		if (!foreign) throw new Error("Failed to seed foreign option");

		await expect(
			notOnInvoiceService.setStatus(adminCtx(), {
				year: YEAR,
				month: MONTH,
				userId: BENCH,
				statusOptionId: foreign.id,
				comment: null,
			}),
		).rejects.toThrow("Status not found");

		await db
			.delete(notOnInvoiceStatusOption)
			.where(eq(notOnInvoiceStatusOption.organizationId, "noi-other"));
		await db.delete(organization).where(eq(organization.id, "noi-other"));
	});
});

describe("the status list", () => {
	test("seeds the defaults on first read", async () => {
		const options = await notOnInvoiceService.listStatusOptions(adminCtx());
		expect(options.map((o) => o.label)).toEqual([...DEFAULT_STATUS_OPTIONS]);
	});

	test("does not re-seed once the org has edited the list", async () => {
		const seeded = await notOnInvoiceService.listStatusOptions(adminCtx());
		for (const option of seeded) {
			await notOnInvoiceService.archiveStatusOption(adminCtx(), option.id);
		}
		// Every option archived is a decision, not an empty slate: re-seeding here
		// would resurrect the list they deleted on purpose.
		expect(await notOnInvoiceService.listStatusOptions(adminCtx())).toEqual([]);
	});

	test("a custom option survives alongside the defaults", async () => {
		await notOnInvoiceService.listStatusOptions(adminCtx());
		await notOnInvoiceService.createStatusOption(adminCtx(), {
			label: "Parental leave",
			sortOrder: 99,
		});
		const options = await notOnInvoiceService.listStatusOptions(adminCtx());
		expect(options.map((o) => o.label)).toContain("Parental leave");
		expect(options).toHaveLength(DEFAULT_STATUS_OPTIONS.length + 1);
	});
});

describe("authorization", () => {
	test("a plain member cannot read the report or touch the statuses", async () => {
		const plain = (): Ctx => ({ organizationId: ORG, userId: BENCH });

		await expect(
			notOnInvoiceService.report(plain(), { year: YEAR, month: MONTH }),
		).rejects.toBeInstanceOf(AccessError);
		await expect(
			notOnInvoiceService.createStatusOption(plain(), {
				label: "nope",
				sortOrder: 0,
			}),
		).rejects.toBeInstanceOf(AccessError);
		await expect(
			notOnInvoiceService.setStatus(plain(), {
				year: YEAR,
				month: MONTH,
				userId: BENCH,
				statusOptionId: null,
				comment: null,
			}),
		).rejects.toBeInstanceOf(AccessError);
	});
});
