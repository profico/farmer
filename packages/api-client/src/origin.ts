import { ApiClientError } from "./errors";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|\[::1\])(:|\/|$)/i;
const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;
const AUTHORITY = /^(https?):\/\/([^/?#\s]+)(?:[/?#]|$)/i;
const HOST =
	/^(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)(?::(\d{1,5}))?$/i;

/** A strict dotted IPv4 address: four numbers, each 0 to 255. Null for any
 *  other text, so `10.evil.example` is not an address in 10.0.0.0/8. */
const ipv4Octets = (host: string): number[] | null => {
	const parts = host.split(".");
	if (parts.length !== 4) return null;
	if (!parts.every((part) => /^\d{1,3}$/.test(part))) return null;
	const octets = parts.map(Number);
	return octets.every((octet) => octet <= 255) ? octets : null;
};

/** The eight 16-bit groups of an IPv6 address, or null. */
const ipv6Groups = (host: string): number[] | null => {
	const halves = host.split("::");
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

/**
 * Whether a host is on this machine or on a local network, where plain http
 * is acceptable: `localhost`, a `.local` name, 127.0.0.0/8, 10.0.0.0/8
 * (with the Android emulator's 10.0.2.2), 172.16.0.0/12, 192.168.0.0/16, the
 * IPv6 loopback and an IPv6 unique local address (fc00::/7).
 */
export const isLocalHost = (host: string): boolean => {
	const name = host.toLowerCase().replace(/^\[|\]$/g, "");
	if (name === "localhost" || name.endsWith(".local")) return true;
	const octets = ipv4Octets(name);
	if (octets) {
		const [a = 0, b = 0] = octets;
		return (
			a === 127 ||
			a === 10 ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168)
		);
	}
	const groups = name.includes(":") ? ipv6Groups(name) : null;
	if (!groups) return false;
	const loopback =
		groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
	const uniqueLocal = ((groups[0] ?? 0) & 0xfe00) === 0xfc00;
	return loopback || uniqueLocal;
};

export type NormalizeOptions = {
	/** Accept plain `http://` for a host that is not local. Off by default:
	 *  the session token would cross the network in clear text. */
	allowRemoteHttp?: boolean;
};

/**
 * The origin of a Server address as a person types it:
 * `farmer.example.com`, `https://farmer.example.com/acme/time`,
 * `localhost:3000`. A bare host gets `https://`, except a local one, which is
 * almost always a development server on http. The same rule as the CLI's
 * `normalizeOrigin`; the Android emulator's `10.0.2.2` also counts as local.
 *
 * Plain `http://` is refused for a host that is not local (`isLocalHost`),
 * unless `options.allowRemoteHttp` is set: the token would cross the network
 * in clear text.
 *
 * Parsed by hand, because React Native's `URL` reads a string with regular
 * expressions and accepts anything.
 */
export const normalizeOrigin = (
	input: string,
	options: NormalizeOptions = {},
): string => {
	const trimmed = input.trim();
	if (!trimmed) {
		throw new ApiClientError("http", "Enter the address of the Farmer server.");
	}
	const scheme = SCHEME.exec(trimmed)?.[1]?.toLowerCase();
	if (scheme && scheme !== "http" && scheme !== "https") {
		throw new ApiClientError(
			"http",
			`"${input}" is not an http or https address.`,
		);
	}
	const withScheme = scheme
		? trimmed
		: `${LOCAL_HOST.test(trimmed) ? "http" : "https"}://${trimmed}`;
	const authority = AUTHORITY.exec(withScheme);
	const host = authority?.[2] ? HOST.exec(authority[2]) : null;
	if (!authority?.[1] || !host?.[1]) {
		throw new ApiClientError("http", `"${input}" is not a server address.`);
	}
	const protocol = authority[1].toLowerCase();
	if (
		protocol === "http" &&
		!options.allowRemoteHttp &&
		!isLocalHost(host[1])
	) {
		throw new ApiClientError(
			"http",
			`"${input}" uses plain http, which sends your password and token unencrypted. Use an https address. Plain http works only for a server on this phone or on your local network.`,
		);
	}
	const port = host[2];
	const defaultPort = protocol === "https" ? "443" : "80";
	const portPart = port && port !== defaultPort ? `:${port}` : "";
	return `${protocol}://${host[1].toLowerCase()}${portPart}`;
};

/** A path or an absolute address the server answered, resolved against the
 *  origin. The device flow's `verification_uri` can be either. */
export const resolveAgainst = (origin: string, pathOrUrl: string): string => {
	if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
	return `${origin}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
};
