// The projections of a person's sign-ins and API tokens. What is pinned is
// the line a credential must not cross: a session goes out without its token
// and its User-Agent, and an API token goes out with its hint and never its
// hash. An instant goes out as an ISO string, because that is what JSON
// carries.

import { describe, expect, test } from "bun:test";

import { toApiPersonalToken, toApiSession } from "./account";

describe("toApiSession", () => {
	test("keeps exactly the fields it names", () => {
		const row = {
			id: "s-1",
			label: "Farmer app on Android",
			kind: "mobile" as const,
			ipAddress: "203.0.113.7",
			createdAt: new Date("2026-10-01T08:00:00Z"),
			updatedAt: new Date("2026-10-05T08:00:00Z"),
			expiresAt: new Date("2026-10-31T08:00:00Z"),
			isCurrent: true,
			token: "secret",
			userAgent: "farmer-mobile/0.1.0 (android 35)",
		};
		expect(toApiSession(row)).toStrictEqual({
			id: "s-1",
			label: "Farmer app on Android",
			kind: "mobile",
			ipAddress: "203.0.113.7",
			createdAt: "2026-10-01T08:00:00.000Z",
			updatedAt: "2026-10-05T08:00:00.000Z",
			expiresAt: "2026-10-31T08:00:00.000Z",
			isCurrent: true,
		});
	});
});

describe("toApiPersonalToken", () => {
	const row = {
		id: "t-1",
		name: "Monthly export",
		hint: "AbCd",
		scope: "read" as const,
		organization: { slug: "acme", name: "Acme" },
		createdAt: new Date("2026-10-01T08:00:00Z"),
		lastUsedAt: null,
		expiresAt: new Date("2026-12-30T08:00:00Z"),
		expired: false,
		tokenHash: "deadbeef",
	};

	test("keeps exactly the fields it names", () => {
		expect(toApiPersonalToken(row)).toStrictEqual({
			id: "t-1",
			name: "Monthly export",
			hint: "AbCd",
			scope: "read",
			workspace: { slug: "acme", name: "Acme" },
			createdAt: "2026-10-01T08:00:00.000Z",
			lastUsedAt: null,
			expiresAt: "2026-12-30T08:00:00.000Z",
			expired: false,
		});
	});

	test("a token for all workspaces that never expires has nulls", () => {
		expect(
			toApiPersonalToken({
				...row,
				organization: null,
				expiresAt: null,
				lastUsedAt: new Date("2026-10-02T09:30:00Z"),
			}),
		).toMatchObject({
			workspace: null,
			expiresAt: null,
			lastUsedAt: "2026-10-02T09:30:00.000Z",
		});
	});
});
