// An organization's slug is the first path segment of its URLs, so it must
// never be one of the app's own pages (`RESERVED_SLUGS` in lib/slug.ts). Run
// through better-auth's endpoints, so the organization hooks run exactly as the
// org switcher's request runs them.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization } from "../db/schema/auth";
import { setInstanceSettingsForTests } from "../lib/instance-settings";
import { createTestDb, present, type TestDb } from "../test/harness";
import { auth } from "./index";

const PASSWORD = "correct horse battery";

let harness: TestDb;
let headers: Headers;

beforeAll(async () => {
	harness = await createTestDb();
	setInstanceSettingsForTests({ REGISTRATION_OPEN: "true" });
	const signedUp = await auth.api.signUpEmail({
		body: { name: "Owner", email: "owner@example.com", password: PASSWORD },
		returnHeaders: true,
	});
	headers = new Headers({
		cookie: present(signedUp.headers.get("set-cookie"), "the session cookie"),
	});
});

afterAll(async () => {
	setInstanceSettingsForTests(undefined);
	await harness.close();
});

const create = (slug: string) =>
	auth.api.createOrganization({
		body: { name: slug, slug, timezone: "UTC", country: "US", weekStartsOn: 1 },
		headers,
	});

describe("an organization's slug", () => {
	test("moves a reserved slug on create to the next free one", async () => {
		const created = await create("about");
		expect(created?.slug).toBe("about-1");
	});

	test("refuses a slug that slugify would not make", async () => {
		await expect(create("_")).rejects.toThrow(/lowercase letters/);
		await expect(create("../api")).rejects.toThrow(/lowercase letters/);
	});

	test("keeps an ordinary slug as it is", async () => {
		const created = await create("acme");
		expect(created?.slug).toBe("acme");
	});

	test("refuses a reserved slug on rename", async () => {
		const acme = present(
			await db.query.organization.findFirst({
				where: eq(organization.slug, "acme"),
			}),
			"the acme organization",
		);
		await expect(
			auth.api.updateOrganization({
				body: { organizationId: acme.id, data: { slug: "login" } },
				headers,
			}),
		).rejects.toThrow(/page of this app/);
	});

	test("gives a sign-up's workspace a free slug when the name is a page", async () => {
		const signedUp = await auth.api.signUpEmail({
			body: { name: "Api", email: "api@example.com", password: PASSWORD },
		});
		const membership = present(
			await db.query.member.findFirst({
				where: eq(member.userId, signedUp.user.id),
			}),
			"the new account's membership",
		);
		const workspace = present(
			await db.query.organization.findFirst({
				where: eq(organization.id, membership.organizationId),
			}),
			"the new account's workspace",
		);
		expect(workspace.slug).toBe("api-1");
	});
});
