/**
 * The security headers that the production host puts on every response: the
 * SSR document, server functions and API routes (`server.ts`'s `/*`), and the
 * static assets (`createResponseHandler` and the on-demand file route).
 *
 *  - `Content-Security-Policy: frame-ancestors 'none'` stops other sites from
 *    framing the app (clickjacking). It is not a full policy on purpose:
 *    `__root.tsx` runs the theme script and the PostHog configuration inline,
 *    and a `script-src` without hashes or a nonce would switch both off.
 *  - `X-Content-Type-Options: nosniff` stops the browser from running a JSON
 *    or text body as script.
 *  - `Referrer-Policy: strict-origin-when-cross-origin` hides paths that hold
 *    an organization slug or an id. Browsers default to it, and this keeps old
 *    browsers to it.
 *
 * There is no `Strict-Transport-Security`. TLS ends in front of this process
 * (see `docs/domains/deployment.md`), so HSTS belongs at the edge. The origin
 * cannot know that every host name that reaches it uses HTTPS.
 *
 * A header that the route set itself wins. `routes/api/files/$.ts` sends its
 * own `sandbox` policy for uploaded SVGs, and it must stay whole.
 */
export const SECURITY_HEADERS = {
	"Content-Security-Policy": "frame-ancestors 'none'",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
} as const;

/** Add each of `SECURITY_HEADERS` that the response does not already carry. */
export const applySecurityHeaders = (headers: Headers): Headers => {
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (!headers.has(name)) headers.set(name, value);
	}
	return headers;
};
