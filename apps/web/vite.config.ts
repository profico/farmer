import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Dev-server startup hook: ensure the site-wide built-in tasks (Vacation, Sick
// Leave) exist when
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
	new URL("../../packages/core/src/db/seed-tasks.ts", import.meta.url),
);

function seedSiteTasks(): Plugin {
	return {
		name: "farmer:seed-site-tasks",
		apply: "serve",
		configureServer() {
			const proc = spawn("bun", ["run", SEED_SCRIPT], { stdio: "pipe" });
			let stderr = "";
			proc.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			proc.on("error", (err) => {
				console.warn(`[dev] could not run site-task seed: ${err.message}`);
			});
			proc.on("close", (code) => {
				if (code === 0) {
					console.log("[dev] ensured site-wide tasks");
				} else {
					console.warn(
						`[dev] failed to seed site tasks (is the DB up?):\n${stderr.trim()}`,
					);
				}
			});
		},
	};
}

// The background task worker (@farmer/core/jobs), started alongside `vite dev`.
//
// Production runs these schedulers in-process inside server.ts, which `vite dev`
// never loads — and since the sync engines moved OFF the read path (they used to
// run inside timeEntriesService.listRange, so opening the time page is what
// imported your meetings), nothing would materialize a recurring block or import
// a meeting in development at all. Same subprocess trick as the seed above, and
// for the same reason: this config is loaded under Node, and importing
// @farmer/core here would drag `postgres` into the config graph.
//
// Set DEV_WORKER=false to run it yourself instead (`bun run worker` from
// packages/core) — or to have it stay quiet while you work on something else.
const WORKER_SCRIPT = fileURLToPath(
	new URL("../../packages/core/src/jobs/worker.ts", import.meta.url),
);

// Only the automation sweep runs by default in development. The other three
// schedulers TALK TO PEOPLE — log-reminder emails, Slack nudges and DMs, budget
// alerts to project managers — and the dev worker runs against whatever
// DATABASE_URL the local .env points at, which is routinely a shared or restored
// staging database full of real addresses. `bun run dev` is not consent to page
// a colleague. The sweep is the one that has to run locally anyway, since it is
// what replaced the write-on-read engines.
//
// Set any of these to "true" in your own .env to opt back in.
const DEV_WORKER_JOB_DEFAULTS = {
	AUTOMATION_SYNC_ENABLED: "true",
	LOG_REMINDERS_ENABLED: "false",
	SLACK_REMINDERS_ENABLED: "false",
	BUDGET_ALERTS_ENABLED: "false",
} satisfies Record<string, string>;

function devWorker(): Plugin {
	return {
		name: "farmer:dev-worker",
		apply: "serve",
		configureServer(server) {
			if (process.env.DEV_WORKER === "false") return;
			const proc = spawn("bun", ["run", WORKER_SCRIPT], {
				stdio: "inherit",
				env: {
					...DEV_WORKER_JOB_DEFAULTS,
					// After the defaults, so an explicit setting in the environment
					// always wins over them.
					...process.env,
					// Don't wait out the usual 15s startup delay every time the dev
					// server restarts; locally you want the first tick while you're
					// still looking at the page.
					SCHEDULER_STARTUP_DELAY_MS: "2000",
				},
			});
			proc.on("error", (err) => {
				console.warn(`[dev] could not start task worker: ${err.message}`);
			});
			// Vite's own SIGINT handling kills the tree, but an explicit close hook
			// covers restarts, which would otherwise stack up workers.
			server.httpServer?.on("close", () => proc.kill());
		},
	};
}

export default defineConfig(({ command }) => ({
	resolve: { tsconfigPaths: true },
	ssr: {
		// Bundle every dependency into the SSR output (dist/server) at BUILD time
		// so the production image ships almost no node_modules — react, tanstack,
		// base-ui, lucide, drizzle, postgres, etc. get inlined; only a handful of
		// packages that resist bundling (better-auth, framer-motion) survive as
		// bare imports (see Dockerfile). Scoped
		// to `build` only: forcing every dep through Vite's SSR transform in dev
		// slows startup and can break packages meant to stay external.
		noExternal: command === "build" ? true : undefined,
	},
	plugins: [
		seedSiteTasks(),
		devWorker(),
		devtools(),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
}));
