import { serializeSignedCookie } from "better-call";

import { auth } from "./index";

/**
 * The `Cookie` header value that names a session token, signed the way
 * better-auth reads its own session cookie.
 *
 * For a REST caller that holds a session token (the CLI's device flow, the
 * mobile app) and asks for a write that only a better-auth endpoint can do,
 * such as an invitation. Those endpoints find the session in the cookie and
 * nowhere else, because the `bearer` plugin is off on purpose (see the
 * comment on `deviceAuthorization` in `./index.ts`).
 *
 * The signature uses `better-call`, the library better-auth signs with, at
 * the version better-auth pins, so the two cannot disagree on the format.
 * The cookie name comes from the live auth context, so it carries the
 * `__Secure-` prefix when the deployment uses one. `serializeSignedCookie`
 * writes a `Set-Cookie` value, and a `Cookie` header takes only the part
 * before the first `;`.
 */
export const sessionCookieHeader = async (token: string): Promise<string> => {
	const context = await auth.$context;
	const serialized = await serializeSignedCookie(
		context.authCookies.sessionToken.name,
		token,
		context.secret,
	);
	const [pair] = serialized.split(";");
	return pair ?? serialized;
};
