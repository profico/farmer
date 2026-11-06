import { createFileRoute } from "@tanstack/react-router";

// The browser sends its PostHog traffic here, on the app's own origin, so an
// ad blocker that lists the PostHog domains does not drop it. The prefix is a
// fixed random word on purpose: block lists match words like "ingest". It must
// match `POSTHOG_PROXY_PATH` in `lib/posthog-proxy-path.ts`.
const forward = async ({
	request,
	params,
}: {
	request: Request;
	params: { _splat?: string };
}) => {
	const { proxyPostHog } = await import("#/lib/posthog-proxy.ts");
	return proxyPostHog(request, params._splat ?? "");
};

export const Route = createFileRoute("/api/k7v2q9/$")({
	server: { handlers: { GET: forward, POST: forward } },
});
