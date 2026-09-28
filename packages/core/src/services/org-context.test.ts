// The tenancy decision for the two credentials that carry no organization — an
// MCP access token and a CLI token from the device flow.
//
// `orgContextService.resolveBySlug` decides whether a stored connection still
// answers. It is the only membership check in front of both surfaces, and its
// inputs are a slug and a user id — the two things a long-lived token cannot
// tell apart from a revoked one.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { createTestDb, type TestDb } from "../test/harness";
import { orgContextService } from "./org-context.service";

let harness: TestDb;

const ORG = "ctx-org";
const OTHER_ORG = "ctx-org-other";

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values([
		{ id: ORG, name: "Ctx Org", slug: "ctx-org", createdAt: new Date() },
		{
			id: OTHER_ORG,
			name: "Other Org",
			slug: "ctx-org-other",
			createdAt: new Date(),
		},
	]);

	await db.insert(user).values(
		["member", "former", "outsider", "both"].map((id) => ({
			id: `u-${id}`,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);

	await db.insert(member).values([
		{
			id: "m-member",
			organizationId: ORG,
			userId: "u-member",
			role: "member",
			createdAt: new Date(),
		},
		// A member of the OTHER org only — the cross-org case below.
		{
			id: "m-outsider",
			organizationId: OTHER_ORG,
			userId: "u-outsider",
			role: "admin",
			createdAt: new Date(),
		},
		// In both, joined OTHER_ORG first — the ordering case below.
		{
			id: "m-both-other",
			organizationId: OTHER_ORG,
			userId: "u-both",
			role: "member",
			createdAt: new Date("2026-01-01T00:00:00Z"),
		},
		{
			id: "m-both-org",
			organizationId: ORG,
			userId: "u-both",
			role: "member",
			createdAt: new Date("2026-02-01T00:00:00Z"),
		},
	]);
});

afterAll(async () => {
	await harness.close();
});

describe("orgContextService.resolveBySlug", () => {
	test("resolves the slug to a Ctx for a member", async () => {
		expect(
			await orgContextService.resolveBySlug("u-member", "ctx-org"),
		).toEqual({ organizationId: ORG, userId: "u-member" });
	});

	// The case this function exists for. An MCP access token or a CLI token is a
	// credential that sits in a config file or a keyring until somebody revokes
	// it, so it outlives a membership by far more than a session does — and
	// nothing in the request after this point re-asks.
	test("refuses a member who has since been removed", async () => {
		await db.insert(member).values({
			id: "m-former",
			organizationId: ORG,
			userId: "u-former",
			role: "member",
			createdAt: new Date(),
		});
		expect(
			await orgContextService.resolveBySlug("u-former", "ctx-org"),
		).not.toBe(null);

		await db.delete(member).where(eq(member.id, "m-former"));

		expect(await orgContextService.resolveBySlug("u-former", "ctx-org")).toBe(
			null,
		);
	});

	test("refuses a member of another organization", async () => {
		expect(await orgContextService.resolveBySlug("u-outsider", "ctx-org")).toBe(
			null,
		);
	});

	// Both null, deliberately: a valid token must not be usable to find out
	// which workspaces exist on the deployment.
	test("answers a slug nobody owns the same way as a non-membership", async () => {
		const missing = await orgContextService.resolveBySlug(
			"u-member",
			"no-such-org",
		);
		const forbidden = await orgContextService.resolveBySlug(
			"u-member",
			"ctx-org-other",
		);
		expect(missing).toBe(null);
		expect(forbidden).toBe(null);
	});
});

describe("orgContextService.organizationsFor", () => {
	// What `farmer login` offers. Only the person's own memberships, so the list
	// is not a second way to enumerate workspaces.
	test("lists only the caller's memberships", async () => {
		expect(await orgContextService.organizationsFor("u-member")).toEqual([
			{
				id: ORG,
				slug: "ctx-org",
				name: "Ctx Org",
				logo: null,
				role: "member",
				timezone: "UTC",
			},
		]);
		expect(await orgContextService.organizationsFor("u-nobody")).toEqual([]);
	});

	// Oldest first, so the CLI's default is the same organization every time.
	test("orders by membership age, oldest first", async () => {
		expect(
			(await orgContextService.organizationsFor("u-both")).map((o) => o.slug),
		).toEqual(["ctx-org-other", "ctx-org"]);
	});
});

describe("orgContextService.organizationOf", () => {
	test("names the Ctx's organization", async () => {
		expect(
			await orgContextService.organizationOf({
				organizationId: ORG,
				userId: "u-member",
			}),
		).toEqual({ slug: "ctx-org", name: "Ctx Org" });
	});
});
