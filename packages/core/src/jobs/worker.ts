/**
 * Standalone task worker — `bun run worker` from `packages/core`.
 *
 * The production web host (apps/web/server.ts) starts the same schedulers
 * in-process, so this entrypoint exists for two cases:
 *
 *   - **Development.** `vite dev` never loads server.ts, and the sync engines no
 *     longer run on page load, so without this nothing would materialize a
 *     recurring block or import a meeting while you're working on the app.
 *   - **Splitting the worker out.** Run this container instead of letting the
 *     web host schedule, and set AUTOMATION_SYNC_ENABLED=false (and friends) on
 *     the web host, and the two halves are separate processes with no code
 *     change. Run exactly one — the jobs are idempotent, but a second replica
 *     is just wasted API quota.
 *
 * Unlike the in-process case, the timers here are the only reason to stay
 * alive, and they're unref'd — so hold the process open explicitly and release
 * on the same signals the web host handles.
 */

import { startSchedulers, stopSchedulers } from "./scheduler";

const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS ?? 10_000);

console.log("[INFO] Starting task worker");

const handles = startSchedulers();

if (handles.length === 0) {
	console.log("[WARNING] No schedulers enabled; nothing to do, exiting");
	process.exit(0);
}

// The unref'd timers cannot keep Bun alive on their own. This interval is the
// process's only hold, and shutdown clears it.
const keepAlive = setInterval(() => {}, 1 << 30);

let shuttingDown = false;

const shutdown = async (signal: string) => {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`\n[INFO] Received ${signal}, shutting down worker...`);
	await stopSchedulers(handles, SHUTDOWN_GRACE_MS);
	clearInterval(keepAlive);
	process.exit(0);
};

process.on("SIGTERM", () => {
	void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
	void shutdown("SIGINT");
});
