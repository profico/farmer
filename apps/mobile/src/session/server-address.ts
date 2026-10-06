import { normalizeOrigin } from "@farmer/api-client";

const CONNECT = "farmer://connect";

/**
 * The server address in a scanned QR code, or null when the code holds none.
 * Two forms count: the web app's `farmer://connect?server=<address>` link,
 * and a plain https address. Any other text is refused, so a QR code on a
 * poster cannot send the app to a page that is not a server address.
 */
export const serverFromScan = (data: string): string | null => {
	const text = data.trim();
	if (text.startsWith(`${CONNECT}?`)) {
		const query = text.slice(CONNECT.length + 1).split("#")[0] ?? "";
		const server = new URLSearchParams(query).get("server");
		return server ? originOrNull(server) : null;
	}
	if (!/^https:\/\//i.test(text)) return null;
	return originOrNull(text);
};

const originOrNull = (value: string): string | null => {
	try {
		return normalizeOrigin(value);
	} catch {
		return null;
	}
};

/**
 * The origin in the sign-in screen's `server` parameter, when it is one that
 * the Server screen could have sent: an address that `normalizeOrigin`
 * accepts and returns unchanged. A deep link can set the parameter, so the
 * sign-in screen does not trust it. Null sends the person to the Server
 * screen, which checks the address.
 */
export const signInOrigin = (server: string | undefined): string | null => {
	if (!server) return null;
	return originOrNull(server) === server ? server : null;
};
