/**
 * The address a request came from, for the per-address rate limits. The
 * rules are the same as in the web app (`packages/core/src/lib/client-address.ts`),
 * but the relay must not import `@farmer/core`, so this is a small copy.
 *
 * `TRUSTED_IP_HEADER` names the ONE header that the proxy in front of the
 * relay sets. It has no default: empty or `none` means the socket
 * address only, so a caller cannot pick its own bucket with a header. In
 * production, `readConfig` refuses to start when it is unset. Behind
 * Cloudflare, set `cf-connecting-ip`. For `x-forwarded-for` the relay reads
 * the LAST entry, the one the nearest proxy appended. When the header is
 * missing, the socket address is the fallback, and then `"unknown"`, one
 * shared bucket.
 *
 * An IPv6 caller gets its /64 prefix as the bucket, not its full address. One
 * host usually has a full /64, and it can pick a new address in it for each
 * request, so a bucket per address would not limit it.
 *
 * The relay trusts the header. The origin must thus accept traffic only
 * through the proxy that sets it (README, "Environment").
 */

/** The header `TRUSTED_IP_HEADER` names, lower-case, or null for the socket
 *  address only. */
export const trustedIpHeader = (
	configured: string | undefined,
): string | null => {
	const name = (configured ?? "").trim().toLowerCase();
	return name === "" || name === "none" ? null : name;
};

/** A dual-stack socket reports an IPv4 peer as `::ffff:10.0.1.6`. One caller
 *  is one bucket, so return `10.0.1.6`. */
const unmapIpv4 = (address: string): string =>
	/^::ffff:(\d{1,3}(\.\d{1,3}){3})$/i.exec(address)?.[1] ?? address;

/** The eight 16-bit groups of an IPv6 address, or null when the text is not
 *  one. Accepts `::`, a zone (`%eth0`) and an IPv4 tail (`64:ff9b::1.2.3.4`). */
const ipv6Groups = (address: string): number[] | null => {
	let text = address.split("%")[0] ?? "";
	const ipv4Tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
	if (ipv4Tail) {
		const bytes = ipv4Tail.slice(1).map(Number);
		if (bytes.some((byte) => byte > 255)) return null;
		const [a = 0, b = 0, c = 0, d = 0] = bytes;
		const high = ((a << 8) | b).toString(16);
		const low = ((c << 8) | d).toString(16);
		text = `${text.slice(0, ipv4Tail.index)}${high}:${low}`;
	}
	const halves = text.split("::");
	if (halves.length > 2) return null;
	const parse = (part: string | undefined): number[] | null => {
		if (!part) return [];
		const groups = part.split(":");
		if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return null;
		return groups.map((group) => Number.parseInt(group, 16));
	};
	const head = parse(halves[0]);
	const tail = parse(halves[1]);
	if (!head || !tail) return null;
	if (halves.length === 1) return head.length === 8 ? head : null;
	const missing = 8 - head.length - tail.length;
	if (missing < 1) return null;
	return [...head, ...Array<number>(missing).fill(0), ...tail];
};

/** The rate-limit bucket of an address: an IPv6 address becomes its /64
 *  prefix (`2001:db8:1:2::/64`), and any other value stays as it is. */
export const rateLimitBucket = (address: string): string => {
	if (!address.includes(":")) return address;
	const groups = ipv6Groups(address);
	if (!groups) return address;
	const prefix = groups
		.slice(0, 4)
		.map((group) => group.toString(16))
		.join(":");
	return `${prefix}::/64`;
};

const resolveAddress = (
	headers: Headers,
	trustedHeader: string | null,
	socketAddress: string | null,
): string => {
	if (trustedHeader) {
		const value = headers.get(trustedHeader);
		const address =
			trustedHeader === "x-forwarded-for"
				? value?.split(",").at(-1)?.trim()
				: value?.trim();
		if (address) return unmapIpv4(address);
	}
	const socket = socketAddress?.trim();
	return socket ? unmapIpv4(socket) : "unknown";
};

/** The rate-limit bucket of a request: see the comment at the top. */
export const clientAddress = (
	headers: Headers,
	trustedHeader: string | null,
	socketAddress: string | null,
): string =>
	rateLimitBucket(resolveAddress(headers, trustedHeader, socketAddress));
