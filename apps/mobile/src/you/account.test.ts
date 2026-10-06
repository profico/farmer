/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import type { PersonalToken, Session } from "@farmer/api-client";

import {
	newTokenDraft,
	scopeLabel,
	sessionIcon,
	sessionRevokeMessage,
	sessionSubtitle,
	TOKEN_NAME_MAX,
	tokenNameProblem,
	tokenSubtitle,
} from "./account";

// The text of a date is the ISO day, so no locale is involved.
const format = (iso: string) => iso.slice(0, 10);

const session: Session = {
	id: "s-1",
	label: "Farmer app on Android",
	kind: "mobile",
	ipAddress: "203.0.113.7",
	createdAt: "2026-10-01T08:00:00.000Z",
	updatedAt: "2026-10-05T08:00:00.000Z",
	expiresAt: "2026-10-31T08:00:00.000Z",
	isCurrent: false,
};

const token: PersonalToken = {
	id: "t-1",
	name: "Export",
	hint: "AbCd",
	scope: "read",
	workspace: { slug: "acme", name: "Acme" },
	createdAt: "2026-10-01T08:00:00.000Z",
	lastUsedAt: null,
	expiresAt: "2026-12-30T08:00:00.000Z",
	expired: false,
};

describe("sessionIcon", () => {
	test("names a phone, a terminal and a browser", () => {
		expect(sessionIcon("mobile")).toBe("phone");
		expect(sessionIcon("cli")).toBe("terminal");
		expect(sessionIcon("browser")).toBe("browser");
	});

	test("reads a kind from a newer server as a browser", () => {
		expect(sessionIcon("watch")).toBe("browser");
	});
});

describe("sessionSubtitle", () => {
	test("gives the sign-in with its address, and the last activity", () => {
		expect(sessionSubtitle(session, format)).toBe(
			"Signed in 2026-10-01 from 203.0.113.7\nLast active 2026-10-05",
		);
	});

	test("leaves out an address the server does not know", () => {
		expect(sessionSubtitle({ ...session, ipAddress: null }, format)).toBe(
			"Signed in 2026-10-01\nLast active 2026-10-05",
		);
	});
});

describe("sessionRevokeMessage", () => {
	test("says what the device sees, by its kind", () => {
		expect(sessionRevokeMessage({ ...session, kind: "cli" })).toContain(
			"farmer login",
		);
		expect(sessionRevokeMessage(session)).toContain("The app is signed out");
		expect(sessionRevokeMessage({ ...session, kind: "browser" })).toContain(
			"browser",
		);
	});
});

describe("newTokenDraft", () => {
	test("starts with the defaults of the web form", () => {
		expect(newTokenDraft()).toEqual({
			name: "",
			scope: "read",
			workspace: "this",
			expiresInDays: 90,
		});
	});
});

describe("tokenNameProblem", () => {
	test("refuses a name with no characters", () => {
		expect(tokenNameProblem("")).toBe("Give the token a name.");
		expect(tokenNameProblem("   ")).toBe("Give the token a name.");
	});

	test("refuses a name over the limit and accepts the limit itself", () => {
		expect(tokenNameProblem("a".repeat(TOKEN_NAME_MAX + 1))).toBe(
			"Use 80 characters or fewer.",
		);
		expect(tokenNameProblem("a".repeat(TOKEN_NAME_MAX))).toBeNull();
	});

	test("does not count the spaces around a name", () => {
		expect(tokenNameProblem(`  ${"a".repeat(TOKEN_NAME_MAX)}  `)).toBeNull();
	});
});

describe("tokenSubtitle", () => {
	test("gives the hint, the access and the workspace, then the use and the end", () => {
		expect(tokenSubtitle(token, format)).toBe(
			"…AbCd · Read only · Acme\nNever used\nExpires 2026-12-30",
		);
	});

	test("marks an expired token and a token that never expires", () => {
		expect(
			tokenSubtitle(
				{
					...token,
					scope: "write",
					workspace: null,
					lastUsedAt: "2026-10-02T09:30:00.000Z",
					expired: true,
				},
				format,
			),
		).toBe(
			"…AbCd · Read and write · All workspaces\nLast used 2026-10-02\nExpired 2026-12-30",
		);
		expect(tokenSubtitle({ ...token, expiresAt: null }, format)).toContain(
			"Never expires",
		);
	});
});

describe("scopeLabel", () => {
	test("reads a scope from a newer server as read only", () => {
		expect(scopeLabel("write")).toBe("Read and write");
		expect(scopeLabel("admin")).toBe("Read only");
	});
});
