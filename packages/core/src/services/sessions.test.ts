// Preferences → Signed-in devices.
//
// What is pinned is the line between people: a session list shows exactly the
// caller's own live sessions and never a token, and a revoke can end only the
// caller's own session — another person's id deletes nothing and says the same
// thing a made-up id says. The labels are presentation, but the CLI row is the
// reason the page exists, so its name is pinned too.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { CLI_USER_AGENT_PREFIX } from "../api/errors";
import { db } from "../db";
import { organization, session, user } from "../db/schema/auth";
import { at, createTestDb, type TestDb } from "../test/harness";
import {
	CurrentSessionRevokeError,
	describeUserAgent,
	sessionsService,
} from "./sessions.service";
import type { Ctx } from "./types";

const ORG = "se-org";
const ALICE = "u-se-alice";
const BOB = "u-se-bob";

const CHROME_MAC =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const CLI = `${CLI_USER_AGENT_PREFIX}0.1.0 (linux; x64)`;

let harness: TestDb;

const ctx = (userId: string): Ctx => ({ organizationId: ORG, userId });

const HOUR = 60 * 60 * 1000;

const sessionRow = (
	id: string,
	userId: string,
	userAgent: string | null,
	expiresInMs: number,
	updatedAt = new Date(),
) => ({
	id,
	userId,
	token: `token-${id}`,
	userAgent,
	ipAddress: "203.0.113.7",
	createdAt: new Date(Date.now() - 2 * HOUR),
	updatedAt,
	expiresAt: new Date(Date.now() + expiresInMs),
});

const sessionIds = async (userId: string) =>
	(
		await db
			.select({ id: session.id })
			.from(session)
			.where(eq(session.userId, userId))
	)
		.map((row) => row.id)
		.sort();

beforeAll(async () => {
	harness = await createTestDb();

	await db
		.insert(organization)
		.values({ id: ORG, name: "Sessions", slug: ORG, createdAt: new Date() });
	await db.insert(user).values(
		[ALICE, BOB].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	await db.insert(session).values([
		// The browser Alice is using now — renewed longest ago, still listed first.
		sessionRow(
			"s-alice-browser",
			ALICE,
			CHROME_MAC,
			24 * HOUR,
			new Date(Date.now() - HOUR),
		),
		sessionRow("s-alice-cli", ALICE, CLI, 24 * HOUR),
		sessionRow(
			"s-alice-cli-2",
			ALICE,
			CLI,
			24 * HOUR,
			new Date(Date.now() - 2 * HOUR),
		),
		sessionRow("s-alice-expired", ALICE, CHROME_MAC, -HOUR),
		sessionRow("s-bob-browser", BOB, CHROME_MAC, 24 * HOUR),
	]);
});

afterAll(async () => {
	await harness.close();
});

describe("sessionsService.listMine", () => {
	test("lists only the caller's live sessions, the current one first", async () => {
		const rows = await sessionsService.listMine(ctx(ALICE), "s-alice-browser");

		expect(rows.map((row) => row.id)).toEqual([
			"s-alice-browser",
			"s-alice-cli",
			"s-alice-cli-2",
		]);
		expect(rows.map((row) => row.isCurrent)).toEqual([true, false, false]);
	});

	test("names the CLI and the browser, and never returns the token", async () => {
		const rows = await sessionsService.listMine(ctx(ALICE), "s-alice-browser");

		expect(at(rows, 0)).toMatchObject({
			kind: "browser",
			label: "Chrome on macOS",
			ipAddress: "203.0.113.7",
		});
		expect(at(rows, 1)).toMatchObject({
			kind: "cli",
			label: "Farmer CLI (linux x64)",
		});
		for (const row of rows) {
			expect(Object.keys(row)).not.toContain("token");
			expect(Object.keys(row)).not.toContain("userAgent");
		}
	});

	test("another user sees none of the caller's sessions", async () => {
		const rows = await sessionsService.listMine(ctx(BOB), "s-bob-browser");

		expect(rows.map((row) => row.id)).toEqual(["s-bob-browser"]);
	});

	test("the organization in the Ctx does not narrow the list", async () => {
		const rows = await sessionsService.listMine(
			{ organizationId: "some-other-org", userId: ALICE },
			"s-alice-browser",
		);

		expect(rows).toHaveLength(3);
	});
});

describe("sessionsService.currentIdFor", () => {
	test("names the caller's live session for its token", async () => {
		expect(
			await sessionsService.currentIdFor(ctx(ALICE), "token-s-alice-browser"),
		).toBe("s-alice-browser");
	});

	test("answers null for another person's token, an expired one and a made-up one", async () => {
		const alice = ctx(ALICE);
		expect(
			await sessionsService.currentIdFor(alice, "token-s-bob-browser"),
		).toBeNull();
		expect(
			await sessionsService.currentIdFor(alice, "token-s-alice-expired"),
		).toBeNull();
		expect(await sessionsService.currentIdFor(alice, "nope")).toBeNull();
	});
});

describe("sessionsService.revoke", () => {
	test("cannot revoke another user's session, and says so as it would for a made-up id", async () => {
		const theirs = await sessionsService.revoke(
			ctx(ALICE),
			"s-bob-browser",
			"s-alice-browser",
		);
		const madeUp = await sessionsService.revoke(
			ctx(ALICE),
			"s-does-not-exist",
			"s-alice-browser",
		);

		expect(theirs).toEqual({ revoked: false });
		expect(madeUp).toEqual({ revoked: false });
		expect(await sessionIds(BOB)).toEqual(["s-bob-browser"]);
	});

	test("refuses the session the request is using", async () => {
		await expect(
			sessionsService.revoke(ctx(ALICE), "s-alice-browser", "s-alice-browser"),
		).rejects.toThrow(CurrentSessionRevokeError);

		expect(await sessionIds(ALICE)).toContain("s-alice-browser");
	});

	test("ends one of the caller's own sessions and nothing else", async () => {
		const result = await sessionsService.revoke(
			ctx(ALICE),
			"s-alice-cli",
			"s-alice-browser",
		);

		expect(result).toEqual({ revoked: true });
		expect(await sessionIds(ALICE)).toEqual([
			"s-alice-browser",
			"s-alice-cli-2",
			"s-alice-expired",
		]);
		expect(await sessionIds(BOB)).toEqual(["s-bob-browser"]);
	});
});

describe("describeUserAgent", () => {
	test.each([
		[CLI, "cli", "Farmer CLI (linux x64)"],
		[`${CLI_USER_AGENT_PREFIX}0.1.0`, "cli", "Farmer CLI"],
		[
			`${CLI_USER_AGENT_PREFIX}0.2.0 darwin-arm64`,
			"cli",
			"Farmer CLI (darwin-arm64)",
		],
		["farmer-mobile/0.1.0 (android 35)", "mobile", "Farmer app on Android"],
		["farmer-mobile/0.1.0 (ios 18.6)", "mobile", "Farmer app on iOS"],
		["farmer-mobile/0.1.0", "mobile", "Farmer app"],
		[CHROME_MAC, "browser", "Chrome on macOS"],
		[
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/139.0.0.0 Safari/537.36",
			"browser",
			"Chrome on Linux",
		],
		[
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0",
			"browser",
			"Edge on Windows",
		],
		[
			"Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0",
			"browser",
			"Firefox on Linux",
		],
		[
			"Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
			"browser",
			"Safari on iOS",
		],
		[
			"Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
			"browser",
			"Chrome on Android",
		],
		["curl/8.9.1", "browser", "Unknown browser"],
		[null, "browser", "Unknown browser"],
	] as const)("%p", (userAgent, kind, label) => {
		expect(describeUserAgent(userAgent)).toEqual({ kind, label });
	});
});
