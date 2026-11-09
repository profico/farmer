// Deciding whether the server may call a URL a person typed.
//
// This module is the SSRF boundary of outbound webhooks. An admin's browser
// sends the URL, and the process that holds the database credentials, the
// object-store keys and (on a managed host) the cloud metadata endpoint makes
// the call. A text field can reach `http://169.254.169.254/...` by default.
//
// Four rules:
//
//   1. HTTPS only. Plain HTTP sends the payload (timesheet notes) in the clear.
//   2. No credentials in the URL. `https://user:pass@host/` reaches services
//      that trust basic auth, and the password goes into every log line.
//   3. No non-public address, typed as a literal or returned by DNS: loopback,
//      private, carrier-grade NAT, link-local (the metadata address),
//      multicast, reserved, and the IPv6 forms of these (IPv4-mapped, 6to4).
//   4. Check again on every attempt, and follow no redirect. A name can resolve
//      to 127.0.0.1 later (DNS rebinding), and a 3xx points to an unchecked
//      host. A 3xx counts as a failed delivery.
//
// Rule 3 also needs the connection to match the check. `fetch` would resolve
// the name a second time, and a different answer would win. So
// `fetchWebhookTarget` connects to an address that this module checked. The
// name goes only in the `Host` header and the TLS server name.
//
// A refusal gives one text for a name that does not resolve and for a name that
// resolves to a private address, and it never holds an address. The specific
// cause goes to the server log only. Else an admin could map the internal DNS
// through the URL field.
//
// `WEBHOOK_ALLOW_PRIVATE_HOSTS=true` switches rules 1 and 3 off, for a
// self-hosted receiver on the same private network. Only the operator sets it,
// never an organization. See `docs/domains/webhooks.md`.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { MAX_WEBHOOK_URL_LENGTH } from "../api/webhooks";
import { externalFetch } from "./http";

/** Whether this deployment lets webhooks reach a private address. An operator's
 *  switch, read at call time so a test can set it. */
export const allowsPrivateWebhookHosts = (): boolean =>
	process.env.WEBHOOK_ALLOW_PRIVATE_HOSTS === "true";

/** Why a URL was refused, in the words the admin sees. */
export type WebhookUrlRefusal = {
	ok: false;
	reason: string;
};

export type WebhookUrlAccepted = {
	ok: true;
	url: URL;
	/** The addresses the host resolved to, empty when only the rules above were
	 *  checked and no lookup was made. */
	addresses: string[];
};

export type WebhookUrlCheck = WebhookUrlAccepted | WebhookUrlRefusal;

const refuse = (reason: string): WebhookUrlRefusal => ({ ok: false, reason });

// ── Address classification ──────────────────────────────────────────────────

const ipv4Bytes = (address: string): number[] | null => {
	const parts = address.split(".");
	if (parts.length !== 4) return null;
	const bytes: number[] = [];
	for (const part of parts) {
		// No leading zeros: `0177.0.0.1` is 127.0.0.1 to some parsers and a
		// different address to others, and a guard that disagrees with the
		// resolver is not a guard.
		if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
		const value = Number(part);
		if (value > 255) return null;
		bytes.push(value);
	}
	return bytes;
};

/** Every IPv4 block that is not a host on the public internet. */
const isPublicIpv4 = (bytes: number[]): boolean => {
	const [a = 0, b = 0, c = 0] = bytes;
	if (a === 0) return false; // 0.0.0.0/8 "this network"
	if (a === 10) return false; // private
	if (a === 127) return false; // loopback
	if (a === 100 && b >= 64 && b <= 127) return false; // 100.64/10 CGNAT
	if (a === 169 && b === 254) return false; // link-local — the metadata address
	if (a === 172 && b >= 16 && b <= 31) return false; // 172.16/12 private
	if (a === 192 && b === 168) return false; // private
	if (a === 192 && b === 0 && c === 0) return false; // IETF protocol assignments
	if (a === 192 && b === 0 && c === 2) return false; // documentation
	if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay anycast
	if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
	if (a === 198 && b === 51 && c === 100) return false; // documentation
	if (a === 203 && b === 0 && c === 113) return false; // documentation
	if (a >= 224) return false; // multicast, reserved, broadcast
	return true;
};

/** An IPv6 literal as 16 bytes, or null when it is not one. Handles the `::`
 *  run and the trailing-IPv4 form (`::ffff:127.0.0.1`). */
const ipv6Bytes = (address: string): number[] | null => {
	let text = address;
	// A zone index (`fe80::1%eth0`) names an interface, which is as local as an
	// address gets. Strip it and let the prefix rules refuse it.
	const zone = text.indexOf("%");
	if (zone !== -1) text = text.slice(0, zone);

	// The trailing-IPv4 form: `::ffff:127.0.0.1`, `64:ff9b::192.0.2.1`. Peel the
	// dotted quad off as the last four bytes, then parse what is left as groups.
	let tail: number[] = [];
	if (text.includes(".")) {
		const lastColon = text.lastIndexOf(":");
		if (lastColon === -1) return null;
		const embedded = ipv4Bytes(text.slice(lastColon + 1));
		if (!embedded) return null;
		tail = embedded;
		text = text.slice(0, lastColon);
		// A trailing colon here is the second colon of a `::` run, which the
		// slice took half of. Put it back, or `::127.0.0.1` parses as `:`.
		if (text.endsWith(":")) text += ":";
	}

	const halves = text.split("::");
	if (halves.length > 2) return null;
	const groupsOf = (part: string): number[][] | null => {
		if (part === "") return [];
		const out: number[][] = [];
		for (const group of part.split(":")) {
			if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
			const value = Number.parseInt(group, 16);
			out.push([value >> 8, value & 0xff]);
		}
		return out;
	};
	const head = groupsOf(halves[0] ?? "");
	const rest = halves.length === 2 ? groupsOf(halves[1] ?? "") : [];
	if (!head || !rest) return null;

	const headBytes = head.flat();
	const restBytes = rest.flat();
	const fixed = headBytes.length + restBytes.length + tail.length;
	if (fixed > 16) return null;
	if (halves.length === 1) {
		if (fixed !== 16) return null;
		return [...headBytes, ...tail];
	}
	return [
		...headBytes,
		...new Array<number>(16 - fixed).fill(0),
		...restBytes,
		...tail,
	];
};

const isPublicIpv6 = (bytes: number[]): boolean => {
	const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = bytes;

	// :: and ::1
	if (bytes.every((byte, index) => (index === 15 ? byte <= 1 : byte === 0))) {
		return false;
	}
	// ::ffff:a.b.c.d — an IPv4 address wearing an IPv6 coat. Classify what is
	// actually inside it, or `::ffff:127.0.0.1` walks straight through.
	if (
		bytes.slice(0, 10).every((byte) => byte === 0) &&
		bytes[10] === 0xff &&
		bytes[11] === 0xff
	) {
		return isPublicIpv4(bytes.slice(12));
	}
	// 64:ff9b::/96 NAT64, same reasoning.
	if (
		b0 === 0x00 &&
		b1 === 0x64 &&
		b2 === 0xff &&
		b3 === 0x9b &&
		bytes.slice(4, 12).every((byte) => byte === 0)
	) {
		return isPublicIpv4(bytes.slice(12));
	}
	// 2002::/16 6to4 carries the v4 address in the next four bytes.
	if (b0 === 0x20 && b1 === 0x02) return isPublicIpv4(bytes.slice(2, 6));
	if ((b0 & 0xfe) === 0xfc) return false; // fc00::/7 unique local
	if (b0 === 0xfe && (b1 & 0xc0) === 0x80) return false; // fe80::/10 link-local
	if (b0 === 0xff) return false; // ff00::/8 multicast
	if (b0 === 0x20 && b1 === 0x01 && b2 === 0x0d && b3 === 0xb8) return false; // 2001:db8::/32
	if (b0 === 0x01 && b1 === 0x00 && bytes.slice(2, 8).every((x) => x === 0)) {
		return false; // 100::/64 discard-only
	}
	return true;
};

/**
 * Whether an address is a host somebody else operates, on the public internet.
 *
 * Pure and exported for the tests: the table above is the security boundary,
 * and a boundary with no test of `169.254.169.254` is a comment.
 */
export const isPublicIpAddress = (address: string): boolean => {
	const v4 = ipv4Bytes(address);
	if (v4) return isPublicIpv4(v4);
	const v6 = ipv6Bytes(address);
	if (v6) return isPublicIpv6(v6);
	// Not an address this module can classify. Refusing is the only safe answer.
	return false;
};

// ── The URL itself ──────────────────────────────────────────────────────────

/** The one refusal text for a private address and for a name that does not
 *  resolve. Two texts would let an admin map the internal DNS. */
const NOT_PUBLIC_REASON =
	"That address is not reachable from the public internet";

/**
 * Everything decidable without a name lookup: the scheme, the credentials, the
 * length, and a literal address in the host position.
 *
 * Split from the lookup so a typo is refused without a DNS round trip, and so
 * the tests of these rules need no network.
 */
export const checkWebhookUrlRules = (raw: string): WebhookUrlCheck => {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return refuse("Enter a URL");
	if (trimmed.length > MAX_WEBHOOK_URL_LENGTH) {
		return refuse(
			`Keep the URL under ${String(MAX_WEBHOOK_URL_LENGTH)} characters`,
		);
	}

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return refuse("That is not a valid URL");
	}

	const allowPrivate = allowsPrivateWebhookHosts();
	if (
		url.protocol !== "https:" &&
		!(allowPrivate && url.protocol === "http:")
	) {
		return refuse("The URL must start with https://");
	}
	if (url.username !== "" || url.password !== "") {
		return refuse("Remove the username and password from the URL");
	}
	if (url.hostname === "") return refuse("The URL has no host");

	// A literal address is refused here rather than at the lookup, so the error
	// names the actual problem instead of "could not resolve".
	const hostname = url.hostname.startsWith("[")
		? url.hostname.slice(1, -1)
		: url.hostname;
	if (isIP(hostname) !== 0 && !allowPrivate && !isPublicIpAddress(hostname)) {
		return refuse(NOT_PUBLIC_REASON);
	}

	return { ok: true, url, addresses: [] };
};

/**
 * The rules above, then the name lookup, then the address check on every
 * answer.
 *
 * Every answer, not the first: a name that resolves to both a public address
 * and 127.0.0.1 would otherwise be accepted and then connected to whichever the
 * runtime picked.
 *
 * Called once when an endpoint is saved, and again before EVERY attempt — see
 * the header on rebinding.
 */
export const resolveWebhookTarget = async (
	raw: string,
): Promise<WebhookUrlCheck> => {
	const checked = checkWebhookUrlRules(raw);
	if (!checked.ok) return checked;
	if (allowsPrivateWebhookHosts()) return checked;

	const hostname = checked.url.hostname.startsWith("[")
		? checked.url.hostname.slice(1, -1)
		: checked.url.hostname;
	if (isIP(hostname) !== 0) return { ...checked, addresses: [hostname] };

	let answers: { address: string }[];
	try {
		answers = await lookup(hostname, { all: true });
	} catch {
		console.warn(`[webhooks] ${hostname} does not resolve`);
		return refuse(NOT_PUBLIC_REASON);
	}
	if (answers.length === 0) {
		console.warn(`[webhooks] ${hostname} does not resolve`);
		return refuse(NOT_PUBLIC_REASON);
	}

	for (const answer of answers) {
		// Same text as a name that does not resolve, with no host and no address
		// in it: any other text would read out the deployment's internal DNS one
		// text field at a time. The cause goes to the server log only.
		if (!isPublicIpAddress(answer.address)) {
			console.warn(`[webhooks] ${hostname} resolves to a private address`);
			return refuse(NOT_PUBLIC_REASON);
		}
	}
	return { ...checked, addresses: answers.map((answer) => answer.address) };
};

/**
 * `fetch` a target `resolveWebhookTarget` accepted, connecting to an address
 * it checked rather than to whatever the name resolves to next.
 *
 * The URL's host is swapped for the checked address, so the runtime has no
 * name to resolve. The name goes where the receiver needs it: the `Host`
 * header, and the TLS server name that SNI sends and the certificate is
 * verified against. A receiver sees the same request as before.
 *
 * The addresses are tried in the resolver's order, moving on only when no
 * connection was made at all, which is what `fetch` does itself with a name
 * that has several. Nothing reached an address that refused, so the next one
 * cannot receive a second copy. One deadline covers every address.
 */
export const fetchWebhookTarget = async (
	target: WebhookUrlAccepted,
	init: RequestInit & { headers: Record<string, string> },
	timeoutMs: number,
): Promise<Response> => {
	const hostname = target.url.hostname.startsWith("[")
		? target.url.hostname.slice(1, -1)
		: target.url.hostname;
	// Nothing to resolve a second time: the operator's switch skipped the
	// lookup, or the host is a literal address `fetch` connects to as it is.
	if (target.addresses.length === 0 || isIP(hostname) !== 0) {
		return externalFetch(target.url, init, timeoutMs);
	}

	const deadline = AbortSignal.timeout(timeoutMs);
	const signal = init.signal
		? AbortSignal.any([init.signal, deadline])
		: deadline;
	for (const [index, address] of target.addresses.entries()) {
		const pinned = new URL(target.url);
		pinned.hostname = isIP(address) === 6 ? `[${address}]` : address;
		// `tls` is Bun's extension to `fetch`, and `externalFetch` passes the
		// init through to it unchanged.
		const pinnedInit: BunFetchRequestInit = {
			...init,
			headers: { ...init.headers, Host: target.url.host },
			tls: { serverName: hostname },
			signal,
		};
		try {
			return await externalFetch(pinned, pinnedInit, timeoutMs);
		} catch (error) {
			// Bun's codes for "no socket was ever connected", checked on Bun
			// 1.4.2. `FailedToOpenSocket` is what an AAAA answer gives on a box
			// with no IPv6 route, at once, so the A answer after it still gets
			// its turn. A timeout stays out: a packet may have left, and the
			// deadline is shared, so no time is left for another address anyway.
			const code =
				error instanceof Error && "code" in error ? error.code : undefined;
			const connected =
				code !== "ConnectionRefused" && code !== "FailedToOpenSocket";
			if (connected || index === target.addresses.length - 1) throw error;
		}
	}
	// Not reached: the loop returns, or throws on its last address.
	throw new Error(`Could not connect to ${hostname}`);
};
