// Deciding whether a push subscription's endpoint is a browser push service.
//
// A push subscription arrives from the browser as a URL, and `web-push` POSTs
// to that URL from the server. Any URL would let a caller make the server
// connect to a host and port of their choice (blind SSRF, and a port probe
// through the timing and the logged status). A real subscription names only
// the push service of its browser, so the rule is an allowlist, not an address
// guard like `webhook-url.ts`:
//
//   * `https:` only, on the default port, with no credentials in the URL.
//   * The host is one of the push services of the major browsers:
//       - `fcm.googleapis.com`: Chrome and the Chromium browsers.
//       - `updates.push.services.mozilla.com`: Firefox.
//       - `*.push.apple.com`: Safari on macOS 13+ and iOS/iPadOS 16.4+.
//       - `*.notify.windows.com`: Microsoft Edge, through WNS.
//
// A browser with a push service not on this list cannot subscribe until the
// list adds it. A closed list fails loudly for one new browser. An open list
// lets a caller make the server send requests.
//
// Pure and dependency-free, because the Zod schema that calls it also runs in
// the browser as the form resolver.

/** Exact hosts. */
const PUSH_HOSTS: ReadonlySet<string> = new Set([
	"fcm.googleapis.com",
	"updates.push.services.mozilla.com",
]);

/** Any subdomain of these (the leading dot is required, so `evilpush.apple.com`
 *  does not match `.push.apple.com`). */
const PUSH_HOST_SUFFIXES: readonly string[] = [
	".push.apple.com",
	".notify.windows.com",
];

/** Whether the server may send a Web Push message to `endpoint`. */
export const isAllowedPushEndpoint = (endpoint: string): boolean => {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return false;
	}
	if (url.protocol !== "https:") return false;
	// An explicit port is never part of a real subscription, and it is exactly
	// what a port probe needs.
	if (url.port !== "") return false;
	if (url.username !== "" || url.password !== "") return false;
	// `URL` lowercases the host. A trailing dot is a different name to the
	// resolver's search list and to this list alike, so it simply fails both.
	const host = url.hostname;
	if (PUSH_HOSTS.has(host)) return true;
	return PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
};

export const PUSH_ENDPOINT_MESSAGE =
	"Push endpoint must be a browser push service";
