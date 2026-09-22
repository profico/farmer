/**
 * The security headers the production host puts on every dynamic response —
 * the SSR document, server functions and API routes (`server.ts`'s `/*`).
 *
 *  - `Content-Security-Policy: frame-ancestors 'none'` — no other site may
 *    frame the app, which is what a clickjacking page needs. Deliberately NOT
 *    a full policy: `__root.tsx` runs the theme script and the PostHog
 *    configuration inline in `<head>`, and a `script-src` without hashes or a
 *    nonce for them would switch both off.
 *  - `X-Content-Type-Options: nosniff` — the browser keeps to the declared
 *    type, so a JSON answer or a text body is never run as script.
 *  - `Referrer-Policy: strict-origin-when-cross-origin` — another origin sees
 *    this origin, never a path with an organization slug or an id in it. It is
 *    the browsers' default already; saying it keeps an older browser to it.
 *
 * No `Strict-Transport-Security`. TLS ends in front of this process (Cloudflare,
 * then the platform's proxy — see `docs/domains/deployment.md`), so the edge is
 * where HSTS belongs, and it can only be undone there. The origin cannot tell
 * whether every host name that reaches it is served over HTTPS.
 *
 * A header the route set itself wins. `routes/api/files/$.ts` sends its own
 * `sandbox` policy for uploaded SVGs, and that policy must stay whole.
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
