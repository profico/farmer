/**
 * The address a request came from, read from one header that this deployment
 * trusts, and from nothing a caller can choose.
 *
 * The per-address rate limits (`server/api-rate-limit.ts`) key on it. Only the
 * proxy in front of this process sets the right header, and a caller can send
 * all of them. A caller that used another header would get its own rate-limit
 * bucket on each request.
 *
 * `TRUSTED_IP_HEADER` names the header, and only that one is read:
 *
 *  - Default `none` (or empty): no header; the socket address only. No header
 *    is trusted until the operator names one.
 *  - `x-forwarded-for`: the last entry, which the proxy nearest this process
 *    appended. The caller wrote the first entry. With two proxies, the last
 *    entry is the outer proxy, so name the header of the outer proxy instead.
 *  - `cf-connecting-ip` behind Cloudflare, `x-real-ip`, or any other
 *    single-address header that a proxy overwrites.
 *
 * When the header is missing, the socket address is the fallback. The
 * production host (`server.ts`) writes it into `SOCKET_ADDRESS_HEADER` after
 * it deletes any copy from the caller. `vite dev` does not, so there the answer
 * is `"unknown"`, one shared bucket, which is the safe answer.
 *
 * The header only means something if the proxy is the one way in. An origin
 * that answers on its public address as well lets a caller set the header
 * itself; keep the origin reachable only through the proxy.
 */

/** The internal header the production host writes the socket address into.
 *  Never read from a caller: `server.ts` deletes it before it writes it. */
export const SOCKET_ADDRESS_HEADER = "x-farmer-socket-address";

export const DEFAULT_TRUSTED_IP_HEADER = "none";

/** The header `TRUSTED_IP_HEADER` names, lower-cased, or null for `none`. */
export const trustedIpHeader = (
	configured: string | undefined,
): string | null => {
	const name = (configured ?? DEFAULT_TRUSTED_IP_HEADER).trim().toLowerCase();
	return name === "" || name === "none" ? null : name;
};

/** Headers a proxy other than the configured one would set. */
const OTHER_PROXY_HEADERS = ["x-forwarded-for", "x-real-ip"];

let warnedHeaderMissing = false;

/** Warn once when another proxy's header is present but the trusted one is
 *  not. Behind a proxy every caller then shares one rate limit. */
const warnIfMisconfigured = (
	headers: Headers,
	trustedHeader: string | null,
): void => {
	if (warnedHeaderMissing) return;
	const seen = OTHER_PROXY_HEADERS.find(
		(name) => name !== trustedHeader && headers.has(name),
	);
	if (!seen) return;
	warnedHeaderMissing = true;
	const missing = trustedHeader
		? `no "${trustedHeader}" header`
		: "TRUSTED_IP_HEADER is not set";
	console.warn(
		`[client-address] ${missing}, but "${seen}" is present. Every caller shares the socket address for rate limits. Set TRUSTED_IP_HEADER to the header your proxy writes.`,
	);
};

/** Let a test see the warning again. */
export const resetClientAddressWarningForTests = (): void => {
	warnedHeaderMissing = false;
};

/** `::ffff:10.0.1.6` is how a dual-stack socket reports an IPv4 peer, and what
 *  `Bun.serve`'s `requestIP` hands `server.ts`. The address it names is
 *  `10.0.1.6`, so return that: one caller is then one bucket whichever socket
 *  took the request, and the audit log shows an address a person recognises. */
const unmapIpv4 = (address: string): string =>
	/^::ffff:(\d{1,3}(\.\d{1,3}){3})$/i.exec(address)?.[1] ?? address;

/** The client's address, per the rules above. */
export const clientAddress = (
	headers: Headers,
	trustedHeader: string | null,
): string => {
	if (trustedHeader) {
		const value = headers.get(trustedHeader);
		const address =
			trustedHeader === "x-forwarded-for"
				? value?.split(",").at(-1)?.trim()
				: value?.trim();
		if (address) return unmapIpv4(address);
	}
	warnIfMisconfigured(headers, trustedHeader);
	const socket = headers.get(SOCKET_ADDRESS_HEADER)?.trim();
	return socket ? unmapIpv4(socket) : "unknown";
};
