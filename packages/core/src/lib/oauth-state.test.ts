// The install `state` is the only proof, on the Slack callback, that the admin
// coming back is the one who left — nothing downstream re-checks the code. So
// each way a state can be wrong gets its own refusal here: someone else's, too
// old, from the future, tampered with.

import { beforeAll, describe, expect, test } from "bun:test";
import crypto from "node:crypto";

import { present } from "../test/harness";
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

/** Run `body` with BETTER_AUTH_SECRETS set to `value` (or removed, for
 *  undefined), and put the old value back after it. */
const withRotation = (value: string | undefined, body: () => void) => {
	const original = process.env.BETTER_AUTH_SECRETS;
	if (value === undefined) delete process.env.BETTER_AUTH_SECRETS;
	else process.env.BETTER_AUTH_SECRETS = value;
	try {
		body();
	} finally {
		if (original === undefined) delete process.env.BETTER_AUTH_SECRETS;
		else process.env.BETTER_AUTH_SECRETS = original;
	}
};

/** A state MACed under `secret` by hand, the way anyone holding it can. */
const stateUnder = (
	secret: string,
	orgId: string,
	userId: string,
	issuedAt: number,
) =>
	`${orgId}.${issuedAt}.${crypto
		.createHmac("sha256", secret)
		.update(JSON.stringify(["oauth-state/v2", orgId, userId, issuedAt]))
		.digest("base64url")}`;

const OLD = "1:the-first-secret-in-the-rotation-set";
const NEW = "2:the-second-secret-in-the-rotation-set";

describe("oauth state across a BETTER_AUTH_SECRETS rotation", () => {
	const legacySecret = () =>
		present(process.env.BETTER_AUTH_SECRET, "BETTER_AUTH_SECRET");

	test("without a rotation set, is keyed on BETTER_AUTH_SECRET as before", () => {
		withRotation(undefined, () => {
			const issued = stateUnder(legacySecret(), "org-1", "user-1", NOW);
			expect(signOrgState("org-1", "user-1", NOW)).toBe(issued);
			expect(verifyOrgState(issued, "user-1", NOW)).toBe("org-1");
		});
	});

	test("is keyed on the current version, and a rotated-away secret cannot forge one", () => {
		let beforeRotation = "";
		withRotation(OLD, () => {
			beforeRotation = signOrgState("org-1", "user-1", NOW);
			expect(verifyOrgState(beforeRotation, "user-1", NOW)).toBe("org-1");
		});
		withRotation(`${NEW},${OLD}`, () => {
			const state = signOrgState("org-1", "user-1", NOW);
			expect(verifyOrgState(state, "user-1", NOW)).toBe("org-1");
			// BETTER_AUTH_SECRET keeps the old value through a rotation, and
			// version 1 stays listed until nothing is sealed under it: neither
			// may still sign an install.
			expect(
				verifyOrgState(
					stateUnder(legacySecret(), "org-1", "user-1", NOW),
					"user-1",
					NOW,
				),
			).toBeNull();
			expect(verifyOrgState(beforeRotation, "user-1", NOW)).toBeNull();
		});
	});
});
