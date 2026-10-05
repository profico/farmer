// Organization settings: name, country, timezone, week start and logo.
//
// The timezone is the field with teeth. Every day key in the product is
// computed in it, so an invalid zone must never reach the row, and a write to
// one org must never touch another.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { createTestDb, present, type TestDb } from "../test/harness";
import { AccessError, NotAMemberError } from "./access.service";
import { ctxTimezone, ctxWeekStartsOn } from "./context";
import { organizationService } from "./organization.service";
import type { Ctx } from "./types";

const ORG_A = "og-a";
const ORG_B = "og-b";
const ADMIN = "u-og-admin";
const MEM = "u-og-member";

let harness: TestDb;

const ctx = (userId: string, organizationId: string = ORG_A): Ctx => ({
	organizationId,
	userId,
});

const orgRow = async (id: string) =>
	present(
		await db.query.organization.findFirst({ where: eq(organization.id, id) }),
		"organization",
	);

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values([
		{ id: ORG_A, name: "Org A", slug: ORG_A, createdAt: new Date() },
		{
			id: ORG_B,
			name: "Org B",
			slug: ORG_B,
			country: "HR",
			timezone: "Europe/Zagreb",
			createdAt: new Date(),
		},
	]);
	await db.insert(user).values(
		[ADMIN, MEM].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	await db.insert(member).values(
		[ADMIN, MEM].map((id) => ({
			id: `m-${id}`,
			organizationId: ORG_A,
			userId: id,
			role: id === ADMIN ? "owner" : "member",
			createdAt: new Date(),
		})),
	);
});

afterAll(async () => {
	await harness.close();
});

describe("getSettings", () => {
	test("returns the org's own settings, with the column defaults", async () => {
		expect(await organizationService.getSettings(ctx(ADMIN))).toEqual({
			name: "Org A",
			country: "US",
			timezone: "UTC",
			weekStartsOn: 1,
			logo: null,
		});
	});

	// The admin check runs first, so an org the caller is not in is refused
	// before the read, and never answers empty.
	test("an org id that does not exist is an error, not an empty answer", async () => {
		await expect(
			organizationService.getSettings(ctx(ADMIN, "og-missing")),
		).rejects.toBeInstanceOf(NotAMemberError);
	});

	test("a member who is not an admin is refused", async () => {
		await expect(
			organizationService.getSettings(ctx(MEM)),
		).rejects.toBeInstanceOf(AccessError);
	});
});

describe("updateSettings", () => {
	test("a partial patch changes only the fields it names", async () => {
		const updated = await organizationService.updateSettings(ctx(ADMIN), {
			name: "Org A Renamed",
		});
		expect(updated).toMatchObject({
			name: "Org A Renamed",
			country: "US",
			timezone: "UTC",
		});
	});

	test("an invalid IANA zone is refused and the stored zone is kept", async () => {
		await expect(
			organizationService.updateSettings(ctx(ADMIN), {
				timezone: "Mars/Olympus_Mons",
			}),
		).rejects.toThrow("Invalid timezone");
		expect((await orgRow(ORG_A)).timezone).toBe("UTC");
	});

	test("a valid zone is stored", async () => {
		await organizationService.updateSettings(ctx(ADMIN), {
			timezone: "Europe/Sarajevo",
		});
		expect((await orgRow(ORG_A)).timezone).toBe("Europe/Sarajevo");
	});

	test("the week start is stored and answered as the org's", async () => {
		const updated = await organizationService.updateSettings(ctx(ADMIN), {
			weekStartsOn: 0,
		});
		expect(updated.weekStartsOn).toBe(0);
		expect((await orgRow(ORG_A)).weekStartsOn).toBe(0);
		expect((await orgRow(ORG_B)).weekStartsOn).toBe(1);

		await organizationService.updateSettings(ctx(ADMIN), { weekStartsOn: 1 });
		expect((await orgRow(ORG_A)).weekStartsOn).toBe(1);
	});

	test("a URL sets the logo and an empty string clears it", async () => {
		await organizationService.updateSettings(ctx(ADMIN), {
			logo: "https://example.com/logo.png",
		});
		expect((await orgRow(ORG_A)).logo).toBe("https://example.com/logo.png");

		await organizationService.updateSettings(ctx(ADMIN), { logo: "" });
		expect((await orgRow(ORG_A)).logo).toBeNull();
	});

	test("a write to one org never touches another", async () => {
		await organizationService.updateSettings(ctx(ADMIN), {
			name: "Org A Again",
			country: "BA",
			timezone: "Europe/Sarajevo",
		});
		const b = await orgRow(ORG_B);
		expect(b).toMatchObject({
			name: "Org B",
			country: "HR",
			timezone: "Europe/Zagreb",
		});
	});

	// The service asserts admin itself rather than trusting orgAdminMiddleware:
	// every service re-resolves Access and asserts.
	test("a plain member cannot change the organization's settings", async () => {
		await expect(
			organizationService.updateSettings(ctx(MEM), { name: "Taken over" }),
		).rejects.toThrow(AccessError);
		expect((await orgRow(ORG_A)).name).not.toBe("Taken over");
	});

	// The Ctx memoizes the timezone, so a write must invalidate it.
	test("a timezone write is visible to the same Ctx straight away", async () => {
		const c = ctx(ADMIN);
		await organizationService.updateSettings(c, { timezone: "UTC" });
		expect(await ctxTimezone(c)).toBe("UTC");
		await organizationService.updateSettings(c, { timezone: "Asia/Tokyo" });
		expect(await ctxTimezone(c)).toBe("Asia/Tokyo");
	});

	// The week start is memoized beside it; the week target reads it.
	test("a week start write is visible to the same Ctx straight away", async () => {
		const c = ctx(ADMIN);
		await organizationService.updateSettings(c, { weekStartsOn: 1 });
		expect(await ctxWeekStartsOn(c)).toBe(1);
		await organizationService.updateSettings(c, { weekStartsOn: 0 });
		expect(await ctxWeekStartsOn(c)).toBe(0);
		await organizationService.updateSettings(c, { weekStartsOn: 1 });
	});
});
