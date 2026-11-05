// The security events of the audit log (issue #112), where they are written:
// the services that own a credential (API tokens, sessions, sign-in methods)
// and better-auth's own endpoints (sign-in, sign-out, member roles), driven
// through `auth.api` so the hooks run exactly as a request runs them.
//
// What is pinned: each event names its person and its actor, a token bound to
// one workspace is news there only, the request's door and address reach the
// row, a failed sign-in is recorded for an address with an account and never
// for one without, and a role change names the admin who made it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, eq } from "drizzle-orm";

import { auth } from "../auth";
import { db } from "../db";
import { auditEvent } from "../db/schema/audit";
import {
	account,
	invitation,
	member,
	organization,
	session,
	user,
} from "../db/schema/auth";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { accountService } from "./account.service";
import { apiTokensService } from "./api-tokens.service";
import { sessionsService } from "./sessions.service";
import type { Ctx } from "./types";

const ORG_A = "as-org-a";
const ORG_B = "as-org-b";
const ALICE = "u-as-alice";
const BOB = "u-as-bob";

const OWNER_EMAIL = "owner@example.com";
const PASSWORD = "correct horse battery";
const CLIENT_IP = "198.51.100.23";
const USER_AGENT = "audit-test/1.0";

const ctx = (userId: string): Ctx => ({
	organizationId: ORG_A,
	userId,
	actor: { via: "web", ip: "203.0.113.9", userAgent: USER_AGENT },
});

let harness: TestDb;
let savedTrustedHeader: string | undefined;

/** The request headers of a browser at `CLIENT_IP`, with a cookie if given. */
const browser = (cookie?: string): Headers => {
	const headers = new Headers({
		"cf-connecting-ip": CLIENT_IP,
		"user-agent": USER_AGENT,
	});
	if (cookie) headers.set("cookie", cookie);
	return headers;
};

/** The `Cookie` header a browser sends back after these `Set-Cookie`s. */
const cookieFrom = (headers: Headers): string =>
	headers
		.getSetCookie()
		.map((line) => line.split(";")[0] ?? "")
		.join("; ");

const rowsOf = (kind: string, subjectUserId: string) =>
	db
		.select()
		.from(auditEvent)
		.where(
			and(
				eq(auditEvent.kind, kind),
				eq(auditEvent.subjectUserId, subjectUserId),
			),
		);

const userIdOf = async (email: string): Promise<string> =>
	present(
		await db.query.user.findFirst({ where: eq(user.email, email) }),
		`the user ${email}`,
	).id;

beforeAll(async () => {
	harness = await createTestDb();
	// The address rule reads this; the developer's `.env` must not change it.
	savedTrustedHeader = process.env.TRUSTED_IP_HEADER;
	process.env.TRUSTED_IP_HEADER = "cf-connecting-ip";

	await db.insert(organization).values(
		[ORG_A, ORG_B].map((id) => ({
			id,
			name: id,
			slug: id,
			createdAt: new Date(),
		})),
	);
	await db.insert(user).values(
		[
			[ALICE, "Alice"],
			[BOB, "Bob"],
		].map(([id, name]) => ({
			id: present(id, "id"),
			name: present(name, "name"),
			email: `${String(id)}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	// Alice works in both workspaces, Bob in the first only.
	await db.insert(member).values([
		{
			id: "m-as-alice-a",
			organizationId: ORG_A,
			userId: ALICE,
			role: "member",
			createdAt: new Date(),
		},
		{
			id: "m-as-alice-b",
			organizationId: ORG_B,
			userId: ALICE,
			role: "member",
			createdAt: new Date(),
		},
		{
			id: "m-as-bob-a",
			organizationId: ORG_A,
			userId: BOB,
			role: "member",
			createdAt: new Date(),
		},
	]);
});

afterAll(async () => {
	if (savedTrustedHeader === undefined) delete process.env.TRUSTED_IP_HEADER;
	else process.env.TRUSTED_IP_HEADER = savedTrustedHeader;
	await harness.close();
});

describe("API tokens", () => {
	test("a token for every workspace is news in each of them", async () => {
		const { apiToken } = await apiTokensService.create(ctx(ALICE), {
			name: "Nightly export",
			scope: "read",
			workspace: "all",
			expiresInDays: null,
		});

		const rows = (await rowsOf("api_token.created", ALICE)).filter(
			(row) => row.targetId === apiToken.id,
		);
		expect(rows.map((row) => row.organizationId).sort()).toEqual([
			ORG_A,
			ORG_B,
		]);
		const row = at(rows, 0);
		expect(row.category).toBe("security");
		expect(row.actorUserId).toBe(ALICE);
		expect(row.targetLabel).toBe("Nightly export");
		expect(row.via).toBe("web");
		expect(row.ip).toBe("203.0.113.9");
	});

	test("a token bound to one workspace is news there only, made and revoked", async () => {
		const { apiToken } = await apiTokensService.create(ctx(ALICE), {
			name: "CI step",
			scope: "write",
			workspace: "this",
			expiresInDays: 30,
		});
		const created = (await rowsOf("api_token.created", ALICE)).filter(
			(row) => row.targetId === apiToken.id,
		);
		expect(created.map((row) => row.organizationId)).toEqual([ORG_A]);

		expect(await apiTokensService.revoke(ctx(ALICE), apiToken.id)).toEqual({
			revoked: true,
		});
		const revoked = (await rowsOf("api_token.revoked", ALICE)).filter(
			(row) => row.targetId === apiToken.id,
		);
		expect(revoked.map((row) => row.organizationId)).toEqual([ORG_A]);
		expect(at(revoked, 0).targetLabel).toBe("CI step");
	});

	test("revoking somebody else's token records nothing", async () => {
		const { apiToken } = await apiTokensService.create(ctx(ALICE), {
			name: "Not Bob's",
			scope: "read",
			workspace: "this",
			expiresInDays: null,
		});
		expect(await apiTokensService.revoke(ctx(BOB), apiToken.id)).toEqual({
			revoked: false,
		});
		const revoked = (await rowsOf("api_token.revoked", ALICE)).filter(
			(row) => row.targetId === apiToken.id,
		);
		expect(revoked).toHaveLength(0);
	});

	test("a token that revokes itself is recorded as that token", async () => {
		const { token, apiToken } = await apiTokensService.create(ctx(BOB), {
			name: "Script",
			scope: "read",
			workspace: "all",
			expiresInDays: null,
		});
		const principal = present(
			await apiTokensService.authenticate(token),
			"the token's principal",
		);
		await apiTokensService.revokePresented(principal);

		const row = at(
			(await rowsOf("api_token.revoked", BOB)).filter(
				(r) => r.targetId === apiToken.id,
			),
			0,
		);
		expect(row.via).toBe("api_token");
		expect(row.apiTokenId).toBe(apiToken.id);
		expect(row.organizationId).toBe(ORG_A);
	});
});

describe("sessions", () => {
	test("revoking a device writes session.revoked in each workspace", async () => {
		await db.insert(session).values({
			id: "s-as-alice-cli",
			userId: ALICE,
			token: "token-s-as-alice-cli",
			userAgent: "farmer-cli/0.1.0 (linux; x64)",
			ipAddress: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			expiresAt: new Date(Date.now() + 86_400_000),
		});

		expect(
			await sessionsService.revoke(ctx(ALICE), "s-as-alice-cli", "s-current"),
		).toEqual({ revoked: true });

		const rows = await rowsOf("session.revoked", ALICE);
		expect(rows.map((row) => row.organizationId).sort()).toEqual([
			ORG_A,
			ORG_B,
		]);
		const row = at(rows, 0);
		expect(row.actorUserId).toBe(ALICE);
		expect(row.targetId).toBe("s-as-alice-cli");
		expect(row.targetLabel).toBe("Farmer CLI (linux x64)");
	});

	test("a session id that is not yours records nothing", async () => {
		await sessionsService.revoke(ctx(BOB), "s-as-nobody", "s-current");
		expect(await rowsOf("session.revoked", BOB)).toHaveLength(0);
	});
});

describe("sign-in methods", () => {
	test("disconnecting Google writes account.unlinked", async () => {
		await db.insert(account).values(
			["credential", "google"].map((providerId) => ({
				id: `a-as-bob-${providerId}`,
				accountId: `bob-${providerId}`,
				providerId,
				userId: BOB,
				createdAt: new Date(),
				updatedAt: new Date(),
			})),
		);

		await accountService.unlinkGoogle(ctx(BOB));

		const row = at(await rowsOf("account.unlinked", BOB), 0);
		expect(row.targetLabel).toBe("google");
		expect(row.organizationId).toBe(ORG_A);
	});
});

// Through better-auth's endpoints. The instance already has users, so the
// owner's password signup needs an invitation to pass the registration gate
// (`auth/registration.ts`); development auth (`NODE_ENV=test`) does the rest.
// Like any signup outside single-org mode, it makes the owner a workspace.
describe("better-auth", () => {
	let ownerId: string;
	let ownerOrgId: string;
	let cookie: string;

	beforeAll(async () => {
		// An invitation is what lets a second account in (`./registration.ts`).
		await db.insert(invitation).values({
			id: "i-as-owner",
			organizationId: ORG_A,
			email: OWNER_EMAIL,
			role: "member",
			status: "pending",
			expiresAt: new Date(Date.now() + 86_400_000),
			inviterId: BOB,
			createdAt: new Date(),
		});
		const { headers } = await auth.api.signUpEmail({
			body: { name: "Olive Owner", email: OWNER_EMAIL, password: PASSWORD },
			headers: browser(),
			returnHeaders: true,
		});
		cookie = cookieFrom(headers);
		ownerId = await userIdOf(OWNER_EMAIL);
		// The signup made the owner a workspace of their own.
		ownerOrgId = present(
			await db.query.member.findFirst({
				where: and(eq(member.userId, ownerId), eq(member.role, "owner")),
			}),
			"the owner's membership",
		).organizationId;
	});

	test("a sign-up signs in, with the request's address and browser", async () => {
		const row = at(await rowsOf("auth.signed_in", ownerId), 0);
		expect(row.organizationId).toBe(ownerOrgId);
		expect(row.actorUserId).toBe(ownerId);
		expect(row.via).toBe("web");
		expect(row.ip).toBe(CLIENT_IP);
		expect(row.userAgent).toBe(USER_AGENT);
		expect(row.details).toEqual({ method: "password" });
	});

	test("a wrong password is recorded for the account it names", async () => {
		await expect(
			auth.api.signInEmail({
				body: { email: OWNER_EMAIL.toUpperCase(), password: "wrong password" },
				headers: browser(),
			}),
		).rejects.toThrow("Invalid email or password");

		const row = at(await rowsOf("auth.sign_in_failed", ownerId), 0);
		expect(row.actorUserId).toBeNull();
		expect(row.ip).toBe(CLIENT_IP);
		expect(row.details).toMatchObject({ method: "password" });
	});

	test("an address with no account writes nothing", async () => {
		const before = await db
			.select()
			.from(auditEvent)
			.where(eq(auditEvent.kind, "auth.sign_in_failed"));
		await expect(
			auth.api.signInEmail({
				body: { email: "nobody@example.com", password: "whatever it is" },
				headers: browser(),
			}),
		).rejects.toThrow("Invalid email or password");
		const after = await db
			.select()
			.from(auditEvent)
			.where(eq(auditEvent.kind, "auth.sign_in_failed"));
		expect(after).toHaveLength(before.length);
	});

	test("a role change names the admin who made it", async () => {
		const bobInOwnerOrg = "m-as-bob-owner-org";
		await db.insert(member).values({
			id: bobInOwnerOrg,
			organizationId: ownerOrgId,
			userId: BOB,
			role: "member",
			createdAt: new Date(),
		});

		await auth.api.updateMemberRole({
			body: {
				memberId: bobInOwnerOrg,
				role: "admin",
				organizationId: ownerOrgId,
			},
			headers: browser(cookie),
		});

		const row = at(
			(await rowsOf("member.role_changed", BOB)).filter(
				(r) => r.organizationId === ownerOrgId,
			),
			0,
		);
		expect(row.actorUserId).toBe(ownerId);
		expect(row.actorName).toBe("Olive Owner");
		expect(row.targetLabel).toBe("Bob");
		expect(row.changes).toEqual({ role: { from: "member", to: "admin" } });
		expect(row.via).toBe("web");
		expect(row.ip).toBe(CLIENT_IP);
	});

	test("removing a member is recorded in that workspace", async () => {
		await auth.api.removeMember({
			body: {
				memberIdOrEmail: "m-as-bob-owner-org",
				organizationId: ownerOrgId,
			},
			headers: browser(cookie),
		});

		const row = at(await rowsOf("member.removed", BOB), 0);
		expect(row.organizationId).toBe(ownerOrgId);
		expect(row.actorUserId).toBe(ownerId);
		expect(row.targetLabel).toBe("Bob");
	});

	test("signing out is recorded before the session is gone", async () => {
		await auth.api.signOut({ headers: browser(cookie) });

		const row = at(await rowsOf("auth.signed_out", ownerId), 0);
		expect(row.actorUserId).toBe(ownerId);
		expect(row.ip).toBe(CLIENT_IP);
	});
});
