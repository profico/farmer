/**
 * The address a request came from, read from ONE header this deployment says
 * it can trust, and from nothing a caller can choose.
 *
 * The per-address rate limits (`server/api-rate-limit.ts`) key on it. They
 * used to read `cf-connecting-ip`, then `x-real-ip`, then the first
 * `x-forwarded-for` hop, whichever came first. Only the proxy in front of this
 * process sets the right one, and a caller can send all three, so a caller
 * that went around the header the proxy sets picked its own bucket — a fresh
 * one per request.
 *
 * `TRUSTED_IP_HEADER` names the header, and only that one is read:
 *
 *  - Default `cf-connecting-ip`: Cloudflare fronts this deployment and sets it
 *    on every request it forwards, over whatever the caller sent.
 *  - `x-real-ip`, or any other single-address header a proxy overwrites.
 *  - `x-forwarded-for`: the LAST entry, the one the proxy nearest this
 *    process appended. The first entry is whatever the caller wrote. With two
 *    proxies in the chain the last entry is the outer proxy, so name the outer
 *    proxy's own header instead.
 *  - `none` (or empty): no header; the socket address only.
 *
 * When the header is missing, the socket address is the fallback. The
 * production host (`server.ts`) writes it into `SOCKET_ADDRESS_HEADER` after
 * it deletes any copy the caller sent; `vite dev` does not, so there the
 * answer is `"unknown"`, one shared bucket, which is the conservative answer.
 *
 * The header only means something if the proxy is the one way in. An origin
 * that answers on its public address as well lets a caller set
 * `cf-connecting-ip` itself; restrict the origin to Cloudflare's addresses.
 */

/** The internal header the production host writes the socket address into.
 *  Never read from a caller: `server.ts` deletes it before it writes it. */
export const SOCKET_ADDRESS_HEADER = "x-farmer-socket-address";

export const DEFAULT_TRUSTED_IP_HEADER = "cf-connecting-ip";

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

/** Warn one time when the trusted header is missing but another proxy's
 *  header is present. That is a deployment behind nginx or Traefik with the
 *  Cloudflare default: every caller shares the proxy's socket address, and so
 *  one rate limit, and nothing else says why. */
const warnIfMisconfigured = (headers: Headers, trustedHeader: string): void => {
	if (warnedHeaderMissing) return;
	const seen = OTHER_PROXY_HEADERS.find(
		(name) => name !== trustedHeader && headers.has(name),
	);
	if (!seen) return;
	warnedHeaderMissing = true;
	console.warn(
		`[client-address] no "${trustedHeader}" header, but "${seen}" is present. Every caller shares the socket address for rate limits. Set TRUSTED_IP_HEADER to the header your proxy writes.`,
	);
};

/** Let a test see the warning again. */
export const resetClientAddressWarningForTests = (): void => {
	warnedHeaderMissing = false;
};

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
		if (address) return address;
		warnIfMisconfigured(headers, trustedHeader);
	}
	return headers.get(SOCKET_ADDRESS_HEADER)?.trim() || "unknown";
};
