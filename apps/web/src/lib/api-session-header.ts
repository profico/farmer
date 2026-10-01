/**
 * The header `/api-docs` adds when the reader chose to send requests as
 * themselves. It is what lets a write under `api/v1/orgs/*` take the session
 * cookie — see `provesSameOrigin` in `server/api-route.ts`. Its own module so
 * the browser side can import it without the server one.
 */
export const SESSION_REQUEST_HEADER = "x-farmer-session";
