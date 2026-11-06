import {
	clientAddress,
	trustedIpHeader,
} from "@farmer/core/lib/client-address";

import { posthogServerConfig } from "./posthog-server";

const CLOUD_HOST = /^https:\/\/(us|eu)\.i\.posthog\.com\/?$/;
const ASSET_PATH = /^(static|array)\//;

const REQUEST_HEADERS = [
	"content-type",
	"content-encoding",
	"accept",
	"user-agent",
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
 * splat such as `/evil.example/x` or `@evil.example/x` must not change the host.
 */
export const upstreamUrl = (
	host: string,
	splat: string,
	search: string,
): URL | null => {
	if (splat === "") return null;
	const region = CLOUD_HOST.exec(host)?.[1];
	const origin = new URL(
		region && ASSET_PATH.test(splat)
			? `https://${region}-assets.i.posthog.com`
			: host,
	).origin;
	const url = new URL(`${origin}/${splat}${search}`);
	return url.origin === origin ? url : null;
};

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
	const hasBody = request.method !== "GET" && request.method !== "HEAD";
	try {
		const upstream = await fetch(target, {
			method: request.method,
			headers: upstreamRequestHeaders(request),
			body: hasBody ? await request.arrayBuffer() : undefined,
			redirect: "manual",
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
