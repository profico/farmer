import crypto from "node:crypto";

// Signs the target organization id into the GitHub App install `state` param so
// the post-install callback can trust which org to attach the installation to,
// even if the admin's active org changed between clicking "connect" and the
// redirect back. HMAC keyed on the app's auth secret; tamper-evident, not
// secret (the org id isn't confidential — the signature just prevents forging
// a different org id).
const secret = () => {
	const s = process.env.BETTER_AUTH_SECRET;
	if (!s) throw new Error("BETTER_AUTH_SECRET not configured");
	return s;
};

const mac = (orgId: string) =>
	crypto.createHmac("sha256", secret()).update(orgId).digest("base64url");

export const signOrgState = (orgId: string): string => `${orgId}.${mac(orgId)}`;

export const verifyOrgState = (state: string): string | null => {
	const dot = state.lastIndexOf(".");
	if (dot < 0) return null;
	const orgId = state.slice(0, dot);
	const provided = state.slice(dot + 1);
	const expected = mac(orgId);
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
	return orgId;
};
