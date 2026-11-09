import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** The routes of the site. Each one is prerendered to static HTML. Keep the
 *  list in step with `src/routes`: a route that is not here has no HTML. */
const SITE_PAGES = [
	"/",
	"/about",
	"/changelog",
	"/early-access",
	"/privacy",
	"/terms",
	"/delete-account",
	"/self-hosting",
];

/** The web dev server. In production a proxy splits the domain by path; in
 *  dev this proxy does the same job for the paths the site does not own. */
const WEB_DEV_SERVER = "http://localhost:3000";

// `/_` exactly, `/_/` and what follows. `/_site` is the site's own and is
// never proxied.
const APP_PATHS = [
	"^/_$",
	"^/_/",
	"/login",
	"/api",
	"/api-docs",
	"/cli",
	"/device",
	"/Icon.svg",
	"/manifest.json",
];

export default defineConfig({
	resolve: { tsconfigPaths: true },
	build: {
		// Built files go to `/_site/<hash>.js`, so the site never claims
		// `/assets/*`, which the app owns on the same domain.
		assetsDir: "_site",
	},
	server: {
		proxy: Object.fromEntries(
			APP_PATHS.map((path) => [path, { target: WEB_DEV_SERVER }]),
		),
	},
	plugins: [
		tanstackStart({
			prerender: {
				enabled: true,
				crawlLinks: false,
				autoSubfolderIndex: true,
			},
			pages: SITE_PAGES.map((path) => ({ path })),
		}),
		viteReact(),
	],
});
