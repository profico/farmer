import {
	clientAddress,
	trustedIpHeader,
} from "@farmer/core/lib/client-address";

import { posthogCloudRegion } from "./posthog-proxy-path";
import { posthogServerConfig } from "./posthog-server";

const ASSET_PATH = /^(static|array)\//;

/** The paths posthog-js 1.433 requests. Nothing else is forwarded, so a
 *  self-hosted PostHog on a private network shows only these to the internet. */
const BROWSER_PATH =
	/^(e|i|s|flags|decide|static|array|api\/(surveys|web_experiments|product_tours|early_access_features|conversations))(\/|$)/;

/** TanStack decodes the splat, so a `..` segment, a `?`, a `#` or a backslash
 *  in it could move the path or drop the query. */
const UNSAFE_SPLAT = /(^|\/)\.\.?(\/|$)|[?#\\]/;

/** posthog-js sends small batches. A larger body is not from the SDK. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;

const REQUEST_HEADERS = [
	"content-type",
	"content-encoding",
	"accept",
	"user-agent",
	"x-conversations-token",
];
const DROPPED_RESPONSE_HEADERS = [
	"content-encoding",
	"content-length",
	"transfer-encoding",
	"set-cookie",
	"connection",
];

/**
 * The PostHog URL for a proxied path, or null when the path is not one to
 * forward.
 *
 * PostHog Cloud serves scripts from a separate assets host. A self-hosted
 * instance serves both from one host. The origin check is the SSRF guard: a
 * splat must not change the host.
 */
export const upstreamUrl = (
	host: string,
	splat: string,
	search: string,
): URL | null => {
	if (!BROWSER_PATH.test(splat) || UNSAFE_SPLAT.test(splat)) return null;
	const region = posthogCloudRegion(host);
	const origin = new URL(
		region && ASSET_PATH.test(splat)
			? `https://${region}-assets.i.posthog.com`
			: host,
	).origin;
	const url = new URL(`${origin}/${splat}${search}`);
	// The allowlist is checked again on the parsed path, because `new URL`
	// resolves an encoded dot segment such as `%2e%2e` that the splat check
	// cannot see.
	return url.origin === origin && BROWSER_PATH.test(url.pathname.slice(1))
		? url
		: null;
};

/** The client address goes upstream, because PostHog takes the GeoIP address
 *  from the request. It is right only when `TRUSTED_IP_HEADER` is set. */
const upstreamRequestHeaders = (request: Request): Headers => {
	const headers = new Headers();
	for (const name of REQUEST_HEADERS) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}
	const address = clientAddress(
		request.headers,
		trustedIpHeader(process.env.TRUSTED_IP_HEADER),
	);
	if (address !== "unknown") headers.set("x-forwarded-for", address);
	return headers;
};

/** Forward a browser request to PostHog, so an ad blocker that lists the
 *  PostHog domains does not drop the event. */
export const proxyPostHog = async (
	request: Request,
	splat: string,
): Promise<Response> => {
	const config = posthogServerConfig();
	const url = new URL(request.url);
	const target = config ? safeUpstream(config.host, splat, url.search) : null;
	if (!target) return new Response("Not found", { status: 404 });
	// Checked before the body is read, so a large body is not held in memory.
	if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES)
		return new Response("Payload too large", { status: 413 });
	const body =
		request.method === "GET" || request.method === "HEAD"
			? undefined
			: await request.arrayBuffer();
	if (body && body.byteLength > MAX_BODY_BYTES)
		return new Response("Payload too large", { status: 413 });
	try {
		const upstream = await fetch(target, {
			method: request.method,
			headers: upstreamRequestHeaders(request),
			body,
			redirect: "manual",
			signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
		});
		const headers = new Headers(upstream.headers);
		for (const name of DROPPED_RESPONSE_HEADERS) headers.delete(name);
		return new Response(upstream.body, {
			status: upstream.status,
			headers,
		});
	} catch {
		return new Response("Bad gateway", { status: 502 });
	}
};

/** `upstreamUrl`, but a host that does not parse gives null, not a throw. */
const safeUpstream = (
	host: string,
	splat: string,
	search: string,
): URL | null => {
	try {
		return upstreamUrl(host, splat, search);
	} catch {
		return null;
	}
};
