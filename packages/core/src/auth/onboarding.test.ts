// The steps of a person before a workspace (`/api/v1/me/...`): the
// invitations to them, an answer to one, and a workspace of their own. Each
// write goes through better-auth's endpoint with a signed session cookie, as
// the REST route sends it, so its hooks write the audit rows.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { auditEvent } from "../db/schema/audit";
import { invitation, member, organization, user } from "../db/schema/auth";
import { setInstanceSettingsForTests } from "../lib/instance-settings";
import { AccessError } from "../services/access.service";
import { createTestDb, present, type TestDb } from "../test/harness";
import { auth } from "./index";
import { onboarding } from "./onboarding";
import { sessionCookieHeader } from "./session-cookie";

const PASSWORD = "correct horse battery";
const BEN_EMAIL = "ben@example.com";

let harness: TestDb;
let savedAuthUrl: string | undefined;
let annId: string;
let annOrg: string;
let benId: string;
let benHeaders: Headers;

/** Sign a person up, and return their id and a cookie for their session. */
const signUp = async (name: string, email: string) => {
	await auth.api.signUpEmail({ body: { name, email, password: PASSWORD } });
	const person = present(
		await db.query.user.findFirst({ where: eq(user.email, email) }),
		`the user ${email}`,
	);
	const session = present(
		await db.query.session.findFirst({
			where: (row, { eq: is }) => is(row.userId, person.id),
		}),
		`the session of ${email}`,
	);
	return {
		id: person.id,
		headers: new Headers({ cookie: await sessionCookieHeader(session.token) }),
	};
};

let invitationCount = 0;
/** An invitation from Ann's workspace, live unless `expired`. */
const invite = async (email: string, options: { expired?: boolean } = {}) => {
	invitationCount += 1;
	const id = `i-onb-${invitationCount}`;
	await db.insert(invitation).values({
		id,
		organizationId: annOrg,
		email,
		role: "member",
		status: "pending",
		expiresAt: new Date(Date.now() + (options.expired ? -1 : 1) * 86_400_000),
		inviterId: annId,
		createdAt: new Date(),
	});
	return id;
};

const auditKinds = async (organizationId: string) =>
	(
		await db
			.select({ kind: auditEvent.kind })
			.from(auditEvent)
			.where(eq(auditEvent.organizationId, organizationId))
	).map((row) => row.kind);

beforeAll(async () => {
	harness = await createTestDb();
	// Without an address the invitation email is never sent.
	savedAuthUrl = process.env.BETTER_AUTH_URL;
	delete process.env.BETTER_AUTH_URL;
	setInstanceSettingsForTests({ REGISTRATION_OPEN: "true" });

	const ann = await signUp("Ann", "ann@example.com");
	annId = ann.id;
	annOrg = present(
		await db.query.member.findFirst({
			where: and(eq(member.userId, annId), eq(member.role, "owner")),
		}),
		"Ann's workspace",
	).organizationId;

	const ben = await signUp("Ben", BEN_EMAIL);
	benId = ben.id;
	benHeaders = ben.headers;
	await db.update(user).set({ emailVerified: true }).where(eq(user.id, benId));
});

afterAll(async () => {
	setInstanceSettingsForTests(undefined);
	if (savedAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
	else process.env.BETTER_AUTH_URL = savedAuthUrl;
	await harness.close();
});

describe("pendingInvitationsFor", () => {
	test("lists a live invitation in any case, and not an expired one", async () => {
		const live = await invite("Ben@Example.COM");
		await invite(BEN_EMAIL, { expired: true });
		await invite("somebody-else@example.com");

		const found = await onboarding.pendingInvitationsForUser(benId);
		expect(found.map((row) => row.id)).toStrictEqual([live]);
		expect(found[0]?.organizationId).toBe(annOrg);

		await db.delete(invitation).where(eq(invitation.id, live));
	});

	// `bun test` runs with NODE_ENV=test, which is development auth and lets
	// an unverified address through. The gate holds outside development.
	test("lists nothing for an unverified address outside development", async () => {
		await invite(BEN_EMAIL);
		const previous = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";
		try {
			const found = await onboarding.pendingInvitationsFor({
				email: BEN_EMAIL,
				emailVerified: false,
			});
			expect(found).toStrictEqual([]);
		} finally {
			process.env.NODE_ENV = previous;
		}
		await db
			.delete(invitation)
			.where(
				and(eq(invitation.email, BEN_EMAIL), eq(invitation.status, "pending")),
			);
	});

	test("lists nothing for a person who does not exist", async () => {
		expect(await onboarding.pendingInvitationsForUser("u-nobody")).toEqual([]);
	});
});

describe("answers to an invitation", () => {
	test("a decline closes it, and the workspace that sent it records it", async () => {
		const id = await invite(BEN_EMAIL);
		await onboarding.rejectInvitation(benHeaders, id);

		const row = await db.query.invitation.findFirst({
			where: eq(invitation.id, id),
		});
		expect(row?.status).toBe("rejected");
		expect(await auditKinds(annOrg)).toContain("member.invitation_declined");
	});

	test("an accept makes a member, and answers the slug to open", async () => {
		const id = await invite(BEN_EMAIL);
		const joined = await onboarding.acceptInvitation(benHeaders, id);

		const org = present(
			await db.query.organization.findFirst({
				where: eq(organization.id, annOrg),
			}),
			"Ann's workspace",
		);
		expect(joined).toStrictEqual({ organizationId: annOrg, slug: org.slug });
		const membership = await db.query.member.findFirst({
			where: and(eq(member.organizationId, annOrg), eq(member.userId, benId)),
		});
		expect(membership?.role).toBe("member");
		expect(await auditKinds(annOrg)).toContain("member.joined");
	});

	test("an invitation to a different address is refused", async () => {
		const id = await invite("carol@example.com");
		expect(onboarding.acceptInvitation(benHeaders, id)).rejects.toThrow(
			AccessError,
		);
	});
});

describe("createOrganization", () => {
	const input = {
		timezone: "Europe/Sarajevo",
		country: "ba",
		weekStartsOn: 1 as const,
	};

	test("makes the caller the owner, with a slug from the name", async () => {
		const created = await onboarding.createOrganization(benHeaders, {
			...input,
			name: "Ben's Studio",
		});
		expect(created.name).toBe("Ben's Studio");
		expect(created.slug).toBe("ben-s-studio");

		const row = await db.query.organization.findFirst({
			where: eq(organization.id, created.id),
		});
		expect(row?.country).toBe("BA");
		const owner = await db.query.member.findFirst({
			where: and(
				eq(member.organizationId, created.id),
				eq(member.userId, benId),
			),
		});
		expect(owner?.role).toBe("owner");
		expect(await auditKinds(created.id)).toContain("organization.created");
	});

	test("moves a reserved slug to a free one", async () => {
		const created = await onboarding.createOrganization(benHeaders, {
			...input,
			name: "Settings",
		});
		expect(created.slug).not.toBe("settings");
		expect(created.slug.startsWith("settings")).toBe(true);
	});

	test("single-org mode refuses it", async () => {
		setInstanceSettingsForTests({
			REGISTRATION_OPEN: "true",
			SINGLE_ORG_SLUG: "only",
		});
		try {
			expect(
				onboarding.createOrganization(benHeaders, { ...input, name: "Two" }),
			).rejects.toThrow(AccessError);
		} finally {
			setInstanceSettingsForTests({ REGISTRATION_OPEN: "true" });
		}
	});
});
