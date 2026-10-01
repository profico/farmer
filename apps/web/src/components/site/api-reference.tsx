import { ApiReferenceReact } from "@scalar/api-reference-react";

import "@scalar/api-reference-react/style.css";
import { useEffect, useMemo, useRef } from "react";

import { SESSION_REQUEST_HEADER } from "#/lib/api-session-header.ts";
import { useTheme } from "#/lib/theme.ts";

/**
 * Scalar's palette, pointed at the site's own tokens. Both palettes already
 * flip on `data-theme`, so one mapping serves light and dark.
 */
const CUSTOM_CSS = `
.scalar-app {
	--scalar-font: var(--sans);
	--scalar-font-code: var(--mono);
	--scalar-custom-header-height: var(--fm-api-header, 62px);
}
.light-mode, .dark-mode {
	--scalar-background-1: var(--bg);
	--scalar-background-2: color-mix(in oklab, var(--fg) 4%, var(--bg));
	--scalar-background-3: color-mix(in oklab, var(--fg) 8%, var(--bg));
	--scalar-color-1: var(--fg);
	--scalar-color-2: var(--mut);
	--scalar-color-3: var(--faint);
	--scalar-color-accent: var(--acc);
	--scalar-border-color: var(--line);
}
/* Scalar has no option for its "Powered by Scalar" link at the foot of the
   sidebar, so it is hidden by its target. */
.scalar-app a[href="https://www.scalar.com"] {
	display: none;
}
`;

/**
 * The API reference itself. Its own module so that `/api-docs` can load it
 * lazily: Scalar is a Vue app with a large bundle, and it reads `window` as it
 * starts, so it never renders on the server.
 */
export default function ApiReference({
	onLoaded,
	signedIn,
	orgSlug,
}: {
	/** Called once Scalar has fetched the document and drawn it. */
	onLoaded: () => void;
	signedIn: boolean;
	/** The reader's workspace, filled in as every `orgSlug` path parameter. */
	orgSlug: string | null;
}) {
	const { theme } = useTheme();
	// Read through a ref so that a new callback does not rebuild the
	// configuration below.
	const loadedRef = useRef(onLoaded);
	useEffect(() => {
		loadedRef.current = onLoaded;
	});
	// A signed-in reader in a workspace gets the `session` scheme, chosen for
	// them and switchable to a token in Scalar's Authentication menu.
	const asMe = signedIn && orgSlug !== null;
	// `ApiReferenceReact` pushes a new configuration into Scalar each time the
	// object changes, so it changes only with the theme.
	const configuration = useMemo(
		() => ({
			url: asMe
				? `/api/v1/openapi.json?org=${encodeURIComponent(orgSlug)}`
				: "/api/v1/openapi.json",
			// Scalar types this as `typeof fetch`, which in Bun's types carries
			// a `preconnect` too.
			customFetch: Object.assign(
				(input: RequestInfo | URL, init?: RequestInit) =>
					send(new Request(input, init)),
				{ preconnect: fetch.preconnect },
			),
			authentication: asMe
				? {
						preferredSecurityScheme: "session",
						securitySchemes: { session: { value: "1" } },
					}
				: undefined,
			theme: "none" as const,
			layout: "modern" as const,
			customCss: CUSTOM_CSS,
			withDefaultFonts: false,
			forceDarkModeState: theme,
			hideDarkModeToggle: true,
			// A token that stays in the tab. Scalar would otherwise keep it in
			// localStorage, where every script on the site can read it.
			persistAuth: false,
			// Scalar sends each request through https://proxy.scalar.com when
			// this is not set. The proxy would then see the bearer token. An
			// empty string turns the proxy off. Do not use undefined: it takes
			// the default.
			proxyUrl: "",
			telemetry: false,
			showDeveloperTools: "never" as const,
			hideModels: false,
			defaultOpenFirstTag: true,
			agent: { disabled: true },
			// Scalar's "Generate MCP" builds a server on Scalar's side. Farmer has
			// its own, at `/api/mcp/<org-slug>`.
			mcp: { disabled: true },
			onLoaded: () => loadedRef.current(),
		}),
		[theme, asMe, orgSlug],
	);
	return <ApiReferenceReact configuration={configuration} />;
}

/**
 * Every request Scalar makes: the document, and each "Send".
 *
 * An API request goes out with exactly one credential. With the `session`
 * scheme picked, Scalar sends its header: then the cookie goes and no
 * `Authorization`, so a token left in the panel is not what answers. With a
 * token: no cookie at all, so a missing token is the 401 a script would get
 * rather than a quiet answer as the reader.
 */
const send = (request: Request): Promise<Response> => {
	const url = new URL(request.url);
	// A request to another origin would carry the reader's token to a third
	// party. Scalar can build such a request from a server entry in the
	// document, so refuse it here.
	if (url.origin !== window.location.origin) {
		throw new Error(
			`The API reference sends requests to ${window.location.origin} only. It refused a request to ${url.origin}, because the request would carry your token to another site.`,
		);
	}
	if (
		!url.pathname.startsWith("/api/v1/") ||
		url.pathname === "/api/v1/openapi.json"
	) {
		return fetch(request);
	}
	const headers = new Headers(request.headers);
	const asMe = headers.get(SESSION_REQUEST_HEADER) === "1";
	if (asMe) headers.delete("authorization");
	else headers.delete(SESSION_REQUEST_HEADER);
	return fetch(
		new Request(request, {
			headers,
			credentials: asMe ? "same-origin" : "omit",
		}),
	);
};
