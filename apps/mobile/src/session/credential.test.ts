import { describe, expect, test } from "bun:test";

import { revokesOnSignOut } from "./credential";

describe("revokesOnSignOut", () => {
	test("a session token from a sign-in is revoked", () => {
		expect(revokesOnSignOut("a1b2c3d4e5f6.session-signature")).toBe(true);
	});

	test("a pasted API token is only forgotten", () => {
		expect(revokesOnSignOut(`fmr_${"A".repeat(43)}`)).toBe(false);
	});
});
