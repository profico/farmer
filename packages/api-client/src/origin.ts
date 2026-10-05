import { ApiClientError } from "./errors";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|\[::1\])(:|\/|$)/i;
const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;
const AUTHORITY = /^(https?):\/\/([^/?#\s]+)(?:[/?#]|$)/i;
const HOST =
	/^(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)(?::(\d{1,5}))?$/i;

/**
 * The origin of a Server address as a person types it:
 * `farmer.example.com`, `https://farmer.example.com/acme/time`,
 * `localhost:3000`. A bare host gets `https://`, except a local one, which is
 * almost always a development server on http. The same rule as the CLI's
 * `normalizeOrigin`; the Android emulator's `10.0.2.2` also counts as local.
 *
 * Parsed by hand, because React Native's `URL` reads a string with regular
 * expressions and accepts anything.
 */
export const normalizeOrigin = (input: string): string => {
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
