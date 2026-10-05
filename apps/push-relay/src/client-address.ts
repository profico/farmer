/**
 * The address a request came from, for the per-address rate limits. The
 * rules are the same as in the web app (`packages/core/src/lib/client-address.ts`),
 * but the relay must not import `@farmer/core`, so this is a small copy.
 *
 * `TRUSTED_IP_HEADER` names the ONE header that the proxy in front of the
 * relay sets. Default `cf-connecting-ip`. For `x-forwarded-for` the relay
 * reads the LAST entry, the one the nearest proxy appended. `none` (or empty)
 * means the socket address only. When the header is missing, the socket
 * address is the fallback, and then `"unknown"`, one shared bucket.
 */

export const DEFAULT_TRUSTED_IP_HEADER = "cf-connecting-ip";

/** The header `TRUSTED_IP_HEADER` names, lower-case, or null for `none`. */
export const trustedIpHeader = (
	configured: string | undefined,
): string | null => {
	const name = (configured ?? DEFAULT_TRUSTED_IP_HEADER).trim().toLowerCase();
	return name === "" || name === "none" ? null : name;
};

/** A dual-stack socket reports an IPv4 peer as `::ffff:10.0.1.6`. One caller
 *  is one bucket, so return `10.0.1.6`. */
const unmapIpv4 = (address: string): string =>
	/^::ffff:(\d{1,3}(\.\d{1,3}){3})$/i.exec(address)?.[1] ?? address;

export const clientAddress = (
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
