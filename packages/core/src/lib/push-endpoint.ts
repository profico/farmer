// Deciding whether a push subscription's endpoint is a browser push service.
//
// A push subscription arrives from the browser as a URL, and `web-push` POSTs
// to that URL from the server. Accepted as any URL, it was a way to make the
// server connect to a host and port of the caller's choosing (blind SSRF, and
// a port probe through the timing and the status it logged). A real
// subscription never names anything but the push service of the browser that
// made it, so the rule is an allowlist rather than an address guard like
// `webhook-url.ts`:
//
//   * `https:` only, on the default port, with no credentials in the URL.
//   * The host is one of the push services the major browsers use:
//       - `fcm.googleapis.com` — Chrome and every Chromium browser that ships
//         Google's push (Brave, Opera, Vivaldi, Samsung Internet).
//       - `updates.push.services.mozilla.com` — Firefox (Mozilla autopush).
//       - `*.push.apple.com` — Safari on macOS 13+ and iOS/iPadOS 16.4+
//         (`web.push.apple.com` today).
//       - `*.notify.windows.com` — Microsoft Edge, through WNS
//         (`wns2-<region>.notify.windows.com` and similar).
//
// A browser that uses a push service not on this list cannot subscribe until
// it is added here. That is the trade: a closed list fails loudly for one new
// browser, an open one is a request the server makes on anyone's behalf.
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
