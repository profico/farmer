/**
 * The baseline security headers that the static host puts on every response.
 * A copy of `apps/web/src/lib/security-headers.ts`: the site is its own
 * deployment and does not import from the app.
 *
 *  - `Content-Security-Policy: frame-ancestors 'none'` — no other site may
 *    frame the page. Not a full policy: `__root.tsx` runs the theme script
 *    inline, and a `script-src` without a hash would switch it off.
 *  - `X-Content-Type-Options: nosniff` — the browser keeps to the declared
 *    type.
 *  - `Referrer-Policy: strict-origin-when-cross-origin`.
 *
 * No `Strict-Transport-Security`: TLS ends in front of this process, so HSTS
 * belongs at the edge.
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
