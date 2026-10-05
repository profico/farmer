// Member management for the REST API, through better-auth's own endpoints.
//
// A REST caller with a session token has no browser cookie, so the route
// signs one from the token (`sessionCookieHeader`). These tests prove that the
// signed cookie opens the session, that each write still runs better-auth's
// hooks (the audit rows), and that the checks the People page makes in the
// browser hold on the server.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { auditEvent } from "../db/schema/audit";
import { invitation, member, organization, user } from "../db/schema/auth";
import { teamLeadPerson } from "../db/schema/people";
import { UserFacingError } from "../lib/user-facing-error";
import { AccessError } from "../services/access.service";
import type { Ctx } from "../services/types";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { auth } from "./index";
import { memberAdmin } from "./member-admin";
import { sessionCookieHeader } from "./session-cookie";

const SEED_ORG = "ma-seed";
const BOB = "u-ma-bob";
const CAROL = "u-ma-carol";
const OWNER_EMAIL = "ma-owner@example.com";

let harness: TestDb;
let savedAuthUrl: string | undefined;
let ownerId: string;
let orgId: string;
let headers: Headers;

const ctx = (userId: string): Ctx => ({ organizationId: orgId, userId });

const roleOf = async (userId: string) =>
	(
		await db.query.member.findFirst({
			where: and(eq(member.organizationId, orgId), eq(member.userId, userId)),
			columns: { role: true },
		})
	)?.role ?? null;

beforeAll(async () => {
	harness = await createTestDb();
	// Without an address the invitation email is marked failed and never
	// sent, so no test reaches a real mail server from the developer's `.env`.
	savedAuthUrl = process.env.BETTER_AUTH_URL;
	delete process.env.BETTER_AUTH_URL;

	const now = new Date();
	await db
		.insert(organization)
		.values({ id: SEED_ORG, name: "Seed", slug: SEED_ORG, createdAt: now });
	await db.insert(user).values(
		[BOB, CAROL].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		})),
	);
	// The instance has users, so a signup needs an invitation to pass the
	// registration gate (`./registration.ts`).
	await db.insert(invitation).values({
		id: "i-ma-owner",
		organizationId: SEED_ORG,
		email: OWNER_EMAIL,
		role: "member",
		status: "pending",
		expiresAt: new Date(Date.now() + 86_400_000),
		inviterId: BOB,
		createdAt: now,
	});
	await auth.api.signUpEmail({
		body: {
			name: "Mia Owner",
			email: OWNER_EMAIL,
			password: "correct horse battery",
		},
	});
	const owner = present(
		await db.query.user.findFirst({ where: eq(user.email, OWNER_EMAIL) }),
		"the owner",
	);
	ownerId = owner.id;
	// A signup makes the person the owner of a workspace of their own.
	orgId = present(
		await db.query.member.findFirst({
			where: and(eq(member.userId, ownerId), eq(member.role, "owner")),
		}),
		"the owner's membership",
	).organizationId;
	await db.insert(member).values(
		[BOB, CAROL].map((id) => ({
			id: `m-${id}`,
			organizationId: orgId,
			userId: id,
			role: "member",
			createdAt: now,
		})),
	);

	// The token a device-flow or mobile client holds is the session's token.
	const session = present(
		await db.query.session.findFirst({
			where: (row, { eq: is }) => is(row.userId, ownerId),
		}),
		"the owner's session",
	);
	headers = new Headers({ cookie: await sessionCookieHeader(session.token) });
});

afterAll(async () => {
	if (savedAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
	else process.env.BETTER_AUTH_URL = savedAuthUrl;
	await harness.close();
});

describe("sessionCookieHeader", () => {
	test("opens the session the token names", async () => {
		const session = await auth.api.getSession({ headers });
		expect(session?.user.id).toBe(ownerId);
	});

	test("a forged signature opens nothing", async () => {
		const forged = new Headers({
			cookie: `${(await sessionCookieHeader("not-a-token")).split("=")[0]}=x.y`,
		});
		expect(await auth.api.getSession({ headers: forged })).toBeNull();
	});
});

describe("memberAdmin", () => {
	test("an invitation goes through better-auth, and its hook records it", async () => {
		const created = await memberAdmin.invite(ctx(ownerId), headers, {
			email: "new-hire@example.com",
			role: "member",
		});
		const row = present(
			await db.query.invitation.findFirst({
				where: eq(invitation.id, created.id),
			}),
			"the invitation",
		);
		expect(row.organizationId).toBe(orgId);
		const audit = at(
			await db
				.select()
				.from(auditEvent)
				.where(
					and(
						eq(auditEvent.kind, "member.invited"),
						eq(auditEvent.targetId, created.id),
					),
				),
			0,
		);
		expect(audit.actorUserId).toBe(ownerId);
	});

	test("a refusal from better-auth is a sentence the API may show", async () => {
		await expect(
			memberAdmin.invite(ctx(ownerId), headers, {
				email: `${BOB}@example.com`,
				role: "member",
			}),
		).rejects.toBeInstanceOf(UserFacingError);
	});

	test("a member who is not an admin is refused before better-auth", async () => {
		await expect(
			memberAdmin.invite(ctx(BOB), headers, {
				email: "someone@example.com",
				role: "member",
			}),
		).rejects.toBeInstanceOf(AccessError);
	});

	test("cancel takes only an invitation of this organization", async () => {
		await expect(
			memberAdmin.cancel(ctx(ownerId), headers, "i-ma-owner"),
		).rejects.toThrow("Invitation not found");

		const created = await memberAdmin.invite(ctx(ownerId), headers, {
			email: "changed-mind@example.com",
			role: "member",
		});
		await memberAdmin.cancel(ctx(ownerId), headers, created.id);
		const row = await db.query.invitation.findFirst({
			where: eq(invitation.id, created.id),
		});
		expect(row?.status).toBe("canceled");
	});

	test("a role change reaches the row, and nobody changes their own", async () => {
		await memberAdmin.setRole(ctx(ownerId), headers, {
			userId: BOB,
			role: "admin",
		});
		expect(await roleOf(BOB)).toBe("admin");

		await expect(
			memberAdmin.setRole(ctx(ownerId), headers, {
				userId: ownerId,
				role: "member",
			}),
		).rejects.toThrow("You cannot change your own role");
	});

	test("the owner's role is not changed here", async () => {
		await expect(
			memberAdmin.setRole(ctx(BOB), headers, {
				userId: ownerId,
				role: "member",
			}),
		).rejects.toThrow("You cannot change the owner's role");
		expect(await roleOf(ownerId)).toBe("owner");
	});

	test("a removal also clears the person from every team lead list", async () => {
		await db.insert(teamLeadPerson).values({
			organizationId: orgId,
			leadUserId: BOB,
			personUserId: CAROL,
		});
		await memberAdmin.remove(ctx(ownerId), headers, CAROL);

		expect(await roleOf(CAROL)).toBeNull();
		const lists = await db
			.select()
			.from(teamLeadPerson)
			.where(eq(teamLeadPerson.personUserId, CAROL));
		expect(lists).toHaveLength(0);
	});

	test("nobody removes themselves or the only owner", async () => {
		await expect(
			memberAdmin.remove(ctx(ownerId), headers, ownerId),
		).rejects.toThrow("You cannot remove yourself");
		await expect(
			memberAdmin.remove(ctx(BOB), headers, ownerId),
		).rejects.toThrow("You cannot remove the only owner");
	});
});
