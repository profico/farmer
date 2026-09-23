// The registration gate (`./registration.ts`) and the production password
// gates (`./sign-in-methods.ts`), through better-auth's own endpoints, so the
// hooks run exactly as a sign-up or a sign-in runs them.
//
// `bun test` runs with NODE_ENV=test, which is development auth: the password
// endpoints are open and only the registration gate applies. The production
// cases set NODE_ENV=production for the one call and put it back.

import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { account, invitation, organization, user } from "../db/schema/auth";
import { setInstanceSettingsForTests } from "../lib/instance-settings";
import { PLATFORM_ADMIN_ROLE } from "../lib/platform-admin";
import { createTestDb, present, type TestDb } from "../test/harness";
import { auth, passwordSignIn } from "./index";
import { assertMayRegister } from "./registration";

const PASSWORD = "correct horse battery";

let harness: TestDb;

beforeAll(async () => {
	harness = await createTestDb();
});

afterEach(() => {
	setInstanceSettingsForTests(undefined);
});

afterAll(async () => {
	await harness.close();
});

const signUp = (email: string) =>
	auth.api.signUpEmail({
		body: { name: email.split("@")[0] ?? "Someone", email, password: PASSWORD },
	});

const signIn = (email: string) =>
	auth.api.signInEmail({ body: { email, password: PASSWORD } });

const inProduction = async <T>(run: () => Promise<T>): Promise<T> => {
	const previous = process.env.NODE_ENV;
	process.env.NODE_ENV = "production";
	try {
		return await run();
	} finally {
		process.env.NODE_ENV = previous;
	}
};

const userByEmail = async (email: string) =>
	present(
		await db.query.user.findFirst({ where: eq(user.email, email) }),
		`the user ${email}`,
	);

const invite = async (email: string) => {
	const owner = await userByEmail("first@example.com");
	const org = present(
		await db.query.member.findFirst({
			where: (m, { eq: equals }) => equals(m.userId, owner.id),
		}),
		"the first account's membership",
	);
	await db.insert(invitation).values({
		id: crypto.randomUUID(),
		organizationId: org.organizationId,
		email: email.toUpperCase(),
		role: "member",
		status: "pending",
		expiresAt: new Date(Date.now() + 86_400_000),
		inviterId: owner.id,
		createdAt: new Date(),
	});
};

describe("the registration gate", () => {
	test("offers the first-account form in production while there is no user", async () => {
		expect(await inProduction(passwordSignIn)).toBe("first-account");
	});

	test("lets the first account in, and makes it the platform admin", async () => {
		await signUp("first@example.com");
		expect((await userByEmail("first@example.com")).role).toBe(
			PLATFORM_ADMIN_ROLE,
		);
	});

	test("refuses the second account", async () => {
		await expect(signUp("second@example.com")).rejects.toMatchObject({
			body: { code: "REGISTRATION_CLOSED" },
		});
		expect(
			await db.query.user.findFirst({
				where: eq(user.email, "second@example.com"),
			}),
		).toBeUndefined();
	});

	test("lets in a person with a pending invitation, whatever its casing", async () => {
		await invite("invited@example.com");
		await signUp("invited@example.com");
		await userByEmail("invited@example.com");
	});

	// An OpenID Connect source with open self-registration hands out any
	// address, unverified. That address must not take somebody's invitation.
	test("an invitation needs a verified address outside development", async () => {
		await invite("cfo@example.com");
		await expect(
			inProduction(() =>
				assertMayRegister(
					{ email: "cfo@example.com", emailVerified: false },
					"/oauth2/callback/:providerId",
				),
			),
		).rejects.toMatchObject({ body: { code: "REGISTRATION_CLOSED" } });
		await inProduction(() =>
			assertMayRegister(
				{ email: "cfo@example.com", emailVerified: true },
				"/oauth2/callback/:providerId",
			),
		);
	});

	test("lets anybody in while REGISTRATION_OPEN is on", async () => {
		setInstanceSettingsForTests({ REGISTRATION_OPEN: "true" });
		await signUp("open@example.com");
		await userByEmail("open@example.com");
	});

	test("single-org mode keeps its own gate, even with registration open", async () => {
		await db.insert(organization).values({
			id: "org-single",
			name: "Single",
			slug: "single",
			createdAt: new Date(),
		});
		setInstanceSettingsForTests({
			SINGLE_ORG_SLUG: "single",
			REGISTRATION_OPEN: "true",
		});
		await expect(
			assertMayRegister(
				{ email: "stranger@example.com", emailVerified: true },
				"/callback/:id",
			),
		).rejects.toMatchObject({ body: { code: "INVITE_ONLY" } });
	});
});

describe("password sign-up and sign-in in production", () => {
	test("sign-up is refused once an account exists, even with registration open", async () => {
		setInstanceSettingsForTests({ REGISTRATION_OPEN: "true" });
		await expect(
			inProduction(() => signUp("late@example.com")),
		).rejects.toMatchObject({ body: { code: "REGISTRATION_CLOSED" } });
	});

	test("the first account signs in with its password while it has no provider", async () => {
		expect(await inProduction(passwordSignIn)).toBe("administrator");
		const result = await inProduction(() => signIn("first@example.com"));
		expect(result.user.email).toBe("first@example.com");
	});

	test("an account that is not a platform admin cannot use a password", async () => {
		await expect(
			inProduction(() => signIn("invited@example.com")),
		).rejects.toMatchObject({ body: { code: "PASSWORD_SIGN_IN_CLOSED" } });
	});

	test("the first account's password closes once it connects a configured provider", async () => {
		const first = await userByEmail("first@example.com");
		await db.insert(account).values({
			id: "account-first-google",
			accountId: "google-sub-first",
			providerId: "google",
			userId: first.id,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		setInstanceSettingsForTests({
			GOOGLE_CLIENT_ID: "client-id",
			GOOGLE_CLIENT_SECRET: "client-secret",
		});
		expect(await inProduction(passwordSignIn)).toBeNull();
		await expect(
			inProduction(() => signIn("first@example.com")),
		).rejects.toMatchObject({ body: { code: "PASSWORD_SIGN_IN_CLOSED" } });
	});

	test("a wrong password gets better-auth's own answer, not the gate's", async () => {
		await expect(
			inProduction(() =>
				auth.api.signInEmail({
					body: { email: "invited@example.com", password: "wrong password" },
				}),
			),
		).rejects.toMatchObject({ body: { code: "INVALID_EMAIL_OR_PASSWORD" } });
	});
});
