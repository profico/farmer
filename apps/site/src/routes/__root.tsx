import { IconContext } from "@phosphor-icons/react";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import { displayInitScript } from "../lib/display-init.ts";
import { themeInitScript } from "../lib/theme.ts";

import appCss from "../styles.css?url";

const DESCRIPTION = "Farmer — a simple, open-source time tracker.";

/** The public origin. A link preview follows only an absolute image URL, and
 *  the crawlers that fetch one never run JavaScript, so the prerendered HTML
 *  has to carry it. */
const ORIGIN = "https://farmer.profi.co";
const OG_IMAGE = `${ORIGIN}/_site/og.png`;

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
			},
			{ title: "Farmer" },
			{ name: "description", content: DESCRIPTION },
			{ property: "og:type", content: "website" },
			{ property: "og:site_name", content: "Farmer" },
			{ property: "og:title", content: "Farmer" },
			{ property: "og:description", content: DESCRIPTION },
			{ property: "og:image", content: OG_IMAGE },
			{ property: "og:image:width", content: "1200" },
			{ property: "og:image:height", content: "630" },
			{ property: "og:image:alt", content: "Farmer, by Profico" },
			{ name: "twitter:card", content: "summary_large_image" },
			{ name: "twitter:image", content: OG_IMAGE },
		],
		// The icon and the manifest are the app's own files on the same origin.
		links: [
			{ rel: "icon", href: "/Icon.svg", type: "image/svg+xml" },
			{ rel: "manifest", href: "/manifest.json" },
			{ rel: "stylesheet", href: appCss },
		],
	}),
	shellComponent: RootDocument,
});

/** Light/dark and the display switches, in one inline script before paint, so
 *  the stored choice does not flash the light palette. */
const headInitScript = themeInitScript + displayInitScript;

function RootDocument({ children }: { children: React.ReactNode }) {
	// `suppressHydrationWarning`: the script writes `data-theme` and the display
	// attributes onto <html> before React sees it. The server cannot render the
	// same values.
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* oxlint-disable-next-line react/no-danger -- fixed strings built from constants: the no-flash theme and display scripts have to be inline to run before paint */}
				<script dangerouslySetInnerHTML={{ __html: headInitScript }} />
				<HeadContent />
			</head>
			<body>
				<IconContext.Provider value={{ weight: "duotone" }}>
					{children}
				</IconContext.Provider>
				<Scripts />
			</body>
		</html>
	);
}
