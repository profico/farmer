import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The typst compiler is a NAPI package (native .node binaries) reached through
// @farmer/core's report-pdf. It can't be bundled or pre-optimized, so it always
// stays a bare import — in dev and in the SSR build alike.
const TYPST = "@myriaddreamin/typst-ts-node-compiler";

// Dev-server startup hook: ensure the site-wide default entry types exist when
// `vite dev` boots. Prod covers this via the Docker entrypoint (which runs the
// bundled seed script after migrations); dev never touches that entrypoint, so
// a fresh local DB would otherwise lack the defaults the app depends on. We run
// the exact same CLI script the entrypoint runs, as a `bun run` subprocess —
// importing it into the config graph fails resolution (@farmer/core uses
// extensionless relative imports that vite's config loader can't resolve) and
// would also risk pulling `postgres` into the client bundle. (Vite loads this
// config under Node, so we shell out to `bun` rather than use Bun APIs here.)
// Failures are logged, not fatal — a missing DB shouldn't block dev startup.
const SEED_SCRIPT = fileURLToPath(
	new URL("../../packages/core/src/db/seed-entry-types.ts", import.meta.url),
);

function seedSiteEntryTypes(): Plugin {
	return {
		name: "farmer:seed-site-entry-types",
		apply: "serve",
		configureServer() {
			const proc = spawn("bun", ["run", SEED_SCRIPT], { stdio: "pipe" });
			let stderr = "";
			proc.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			proc.on("error", (err) => {
				console.warn(`[dev] could not run entry-types seed: ${err.message}`);
			});
			proc.on("close", (code) => {
				if (code === 0) {
					console.log("[dev] ensured site-wide entry types");
				} else {
					console.warn(
						`[dev] failed to seed site entry types (is the DB up?):\n${stderr.trim()}`,
					);
				}
			});
		},
	};
}

export default defineConfig(({ command }) => ({
	resolve: { tsconfigPaths: true },
	optimizeDeps: { exclude: [TYPST] },
	ssr: {
		// Bundle every dependency into the SSR output (dist/server) at BUILD time
		// so the production image ships almost no node_modules — react, tanstack,
		// base-ui, lucide, drizzle, postgres, etc. get inlined; only a handful of
		// packages that resist bundling (better-auth, framer-motion) plus the
		// native typst compiler survive as bare imports (see Dockerfile). Scoped
		// to `build` only: forcing every dep through Vite's SSR transform in dev
		// slows startup and can break packages meant to stay external.
		noExternal: command === "build" ? true : undefined,
		external: [TYPST],
		optimizeDeps: { exclude: [TYPST] },
	},
	plugins: [
		seedSiteEntryTypes(),
		devtools(),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
}));
