import crypto from "node:crypto";

import { currentAuthSecret } from "./secret-box";

// Signs the target organization id into an OAuth install `state` param so the
// post-install callback can trust which org to attach the installation to, even
// if the admin's active org changed between clicking "connect" and the redirect
// back. HMAC keyed on the app's auth secret; tamper-evident, not secret (the org
// id isn't confidential — the signature just prevents forging a different org
// id).
//
// Shared by both install flows that leave the app and come back: the GitHub App
// setup redirect and the Slack OAuth v2 callback. Nothing here is
// provider-specific, which is why it stopped being called `github-state`.
//
// The state is BOUND to the person who asked for it and EXPIRES. It used to be
// `orgId.HMAC(orgId)`: valid forever, for anybody. That made it a bearer token
// for "attach to this org" — one leaked install URL (a browser history, a
// referrer, a screenshot in a ticket) let anyone who could get an admin of that
// org to open a crafted callback URL finish an install the admin never started.
// Binding the user id means a state minted by one person does nothing in
// another's session, and the issued-at stamp means an old one does nothing at
// all. The user id is not carried in the state: the verifier already knows it
// from the session, and a state that named its own user would only give the
// verifier a second answer to disagree with.

/** How long an install round trip may take. Two consent screens and perhaps a
 *  GitHub org picker fit comfortably; a state found in yesterday's history
 *  does not. */
export const OAUTH_STATE_MAX_AGE_SECONDS = 15 * 60;

/** Allowance for a clock that is a little ahead of the verifier's — one
 *  process today, but a state from the future is otherwise refused outright. */
const CLOCK_SKEW_SECONDS = 60;

// Keyed from the CURRENT secret — the first BETTER_AUTH_SECRETS entry, or
// BETTER_AUTH_SECRET when no rotation set is configured — and checked against
// that one only. It used to be BETTER_AUTH_SECRET always, which a rotation
// leaves at the old value (it still opens older stored credentials), so a
// leaked secret that was rotated away could still forge a state for any org
// and user. Accepting the older versions too would keep that door open for as
// long as they stay configured; the price of refusing them is an install begun
// in the 15 minutes before the restart that rotated, which is started again.
//
// JSON rather than a joined string, so no choice of separator can let one
// (org, user, time) triple spell another's — ids are opaque to this module.
const mac = (orgId: string, userId: string, issuedAt: number) =>
	crypto
		.createHmac("sha256", currentAuthSecret())
		.update(JSON.stringify(["oauth-state/v2", orgId, userId, issuedAt]))
		.digest("base64url");

const nowSeconds = () => Math.floor(Date.now() / 1000);

export const signOrgState = (
	orgId: string,
	userId: string,
	issuedAt: number = nowSeconds(),
): string => `${orgId}.${issuedAt}.${mac(orgId, userId, issuedAt)}`;

/**
 * The org a `state` was signed for, or null.
 *
 * Null for anything that is not a state this app issued to `userId` within the
 * last `OAUTH_STATE_MAX_AGE_SECONDS`. Callers must treat null as a refusal —
 * never as "fall back to the session's active org", which is the CSRF this
 * exists to close.
 */
export const verifyOrgState = (
	state: string,
	userId: string,
	now: number = nowSeconds(),
): string | null => {
	// Parsed from the right, so an org id containing a dot still round-trips.
	const macDot = state.lastIndexOf(".");
	if (macDot < 0) return null;
	const iatDot = state.lastIndexOf(".", macDot - 1);
	if (iatDot < 0) return null;

	const orgId = state.slice(0, iatDot);
	const issuedAtRaw = state.slice(iatDot + 1, macDot);
	const provided = state.slice(macDot + 1);
	if (!orgId || !/^\d{1,12}$/.test(issuedAtRaw)) return null;
	const issuedAt = Number(issuedAtRaw);

	const expected = mac(orgId, userId, issuedAt);
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

	// Checked after the signature, so an expired state and a forged one are the
	// same answer to anybody probing.
	if (issuedAt > now + CLOCK_SKEW_SECONDS) return null;
	if (now - issuedAt > OAUTH_STATE_MAX_AGE_SECONDS) return null;
	return orgId;
};
