// Partial updates to the org's knobs.
//
// `updateOrgSettingsInput` has both fields optional so each section of the
// settings screen can save its own without sending the other. That is exactly
// the shape where a careless upsert clobbers the field it wasn't given — and
// the field at risk here is the automation lock, whose whole job is to be
// trusted about a closed month.
//
// The other trap is `null`. For the lock it is a real value meaning "no lock",
// so it cannot be collapsed with `undefined` ("not in this patch") the way a
// `?? DEFAULT` would.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { orgSettings } from "../db/schema/settings";
import { createTestDb, type TestDb } from "../test/harness";
import { orgSettingsService } from "./org-settings.service";
import type { Ctx } from "./types";

const ORG_ID = "org-settings";
const USER_ID = "user-settings";
const ctx: Ctx = { organizationId: ORG_ID, userId: USER_ID };

let harness: TestDb;

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(organization).values({
		id: ORG_ID,
		name: "Settings Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Admin",
		email: "settings@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	// update() is admin-gated.
	await db.insert(member).values({
		id: "member-settings",
		organizationId: ORG_ID,
		userId: USER_ID,
		role: "owner",
		createdAt: new Date(),
	});
});

afterAll(async () => {
	await harness.close();
});

beforeEach(async () => {
	await db.delete(orgSettings).where(eq(orgSettings.organizationId, ORG_ID));
});

describe("org settings", () => {
	test("a missing row reads as defaults", async () => {
		expect(await orgSettingsService.get(ctx)).toEqual({
			complianceMissingDays: 3,
			automationLockedThrough: null,
		});
	});

	test("saving the compliance knob leaves the lock alone", async () => {
		await orgSettingsService.update(ctx, {
			automationLockedThrough: "2026-07-31",
		});
		await orgSettingsService.update(ctx, { complianceMissingDays: 7 });

		expect(await orgSettingsService.get(ctx)).toEqual({
			complianceMissingDays: 7,
			automationLockedThrough: "2026-07-31",
		});
	});

	test("saving the lock leaves the compliance knob alone", async () => {
		await orgSettingsService.update(ctx, { complianceMissingDays: 9 });
		await orgSettingsService.update(ctx, {
			automationLockedThrough: "2026-07-31",
		});

		expect(await orgSettingsService.get(ctx)).toEqual({
			complianceMissingDays: 9,
			automationLockedThrough: "2026-07-31",
		});
	});

	test("null clears the lock, undefined does not touch it", async () => {
		await orgSettingsService.update(ctx, {
			automationLockedThrough: "2026-07-31",
		});

		// `undefined` = not in this patch.
		await orgSettingsService.update(ctx, { complianceMissingDays: 4 });
		expect((await orgSettingsService.get(ctx)).automationLockedThrough).toBe(
			"2026-07-31",
		);

		// `null` = clear it. If these two were collapsed, the lock could never be
		// lifted through the settings screen.
		await orgSettingsService.update(ctx, { automationLockedThrough: null });
		expect((await orgSettingsService.get(ctx)).automationLockedThrough).toBeNull();
	});

	test("the first save creates the row without inventing values", async () => {
		await orgSettingsService.update(ctx, {
			automationLockedThrough: "2026-07-31",
		});

		// Insert path: the field that wasn't given lands on its default, which is
		// what `get` was already reporting for the missing row.
		expect(await orgSettingsService.get(ctx)).toEqual({
			complianceMissingDays: 3,
			automationLockedThrough: "2026-07-31",
		});
	});
});
