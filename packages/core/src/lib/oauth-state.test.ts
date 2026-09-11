// The install `state` is the only proof, on the Slack callback, that the admin
// coming back is the one who left — nothing downstream re-checks the code. So
// each way a state can be wrong gets its own refusal here: someone else's, too
// old, from the future, tampered with.

import { beforeAll, describe, expect, test } from "bun:test";

import {
	OAUTH_STATE_MAX_AGE_SECONDS,
	signOrgState,
	verifyOrgState,
} from "./oauth-state";

const NOW = 1_800_000_000;

beforeAll(() => {
	process.env.BETTER_AUTH_SECRET ??= "test-secret-for-oauth-state";
});

describe("oauth state", () => {
	test("round-trips for the user it was signed for", () => {
		const state = signOrgState("org-1", "user-1", NOW);
		expect(verifyOrgState(state, "user-1", NOW + 60)).toBe("org-1");
	});

	test("keeps an org id that contains a dot", () => {
		const state = signOrgState("org.with.dots", "user-1", NOW);
		expect(verifyOrgState(state, "user-1", NOW)).toBe("org.with.dots");
	});

	test("is refused in another user's session", () => {
		const state = signOrgState("org-1", "user-1", NOW);
		expect(verifyOrgState(state, "user-2", NOW)).toBeNull();
	});

	test("expires", () => {
		const state = signOrgState("org-1", "user-1", NOW);
		expect(
			verifyOrgState(state, "user-1", NOW + OAUTH_STATE_MAX_AGE_SECONDS),
		).toBe("org-1");
		expect(
			verifyOrgState(state, "user-1", NOW + OAUTH_STATE_MAX_AGE_SECONDS + 1),
		).toBeNull();
	});

	test("is refused when issued in the future", () => {
		const state = signOrgState("org-1", "user-1", NOW + 3600);
		expect(verifyOrgState(state, "user-1", NOW)).toBeNull();
	});

	test("is refused when the org, the time or the signature is edited", () => {
		const state = signOrgState("org-1", "user-1", NOW);
		const [, iat, sig] = state.split(".");
		expect(verifyOrgState(`org-2.${iat}.${sig}`, "user-1", NOW)).toBeNull();
		expect(
			verifyOrgState(`org-1.${String(NOW + 1)}.${sig}`, "user-1", NOW),
		).toBeNull();
		expect(verifyOrgState(`${state}x`, "user-1", NOW)).toBeNull();
	});

	test("refuses the old unbound, undated shape and plain garbage", () => {
		expect(verifyOrgState("org-1.c2lnbmF0dXJl", "user-1", NOW)).toBeNull();
		expect(verifyOrgState("", "user-1", NOW)).toBeNull();
		expect(verifyOrgState("no-dots", "user-1", NOW)).toBeNull();
	});
});
