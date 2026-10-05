// Recovery for a tab that was opened before a deploy.
//
// Each deploy replaces the hashed files in `/assets/`. A tab that loaded the
// old index still names the old files, so the first lazy route chunk it needs
// is gone. The server answers that URL with a bare 404 (the `/assets/*` route
// in `server.ts`, because no static route matches). The browser refuses it as
// a module, and the import fails with "Failed to fetch dynamically imported
// module". The fix is a reload, which fetches the new index.
//
// There are two reload paths.
//
// 1. TanStack's `lazyRouteComponent` reloads once for each message of a missing
//    JS chunk. It keeps its own guard in `sessionStorage`. This file never
//    removes that guard, because a removed guard can cause a reload loop.
// 2. The route error screen calls `reloadIfStaleChunk` for the error that a
//    route loader or component throws. It reloads once per time window, but
//    only for an error that TanStack does not handle (the Vite stylesheet
//    failure). It never repeats a reload that TanStack already did.
//
// Vite's `vite:preloadError` event has no handler on purpose. TanStack Router
// preloads a route on link intent (hover or touch). A failed preload of a
// component chunk is swallowed there and the reload happens on the later
// render. The event cannot tell a preload from a navigation, so a reload there
// would drop the unsaved input of a person who only moved the pointer.

import { z } from "zod";

/** One reload at most in this time, in milliseconds. */
export const RELOAD_WINDOW_MS = 30_000;

const GUARD_KEY = "farmer-stale-chunk-reload";
const REPORT_KEY = "farmer-stale-chunk-report";
/** The router guard keys that an event already reported. */
const ROUTER_REPORTED_KEY = "farmer-stale-chunk-router-reported";

/**
 * Dependency contract: `lazyRouteComponent.js` in `@tanstack/react-router`
 * writes `tanstack_router_reload:<error.message>` before it reloads, and a
 * second failure with the same message throws. Check this prefix again when
 * the package is upgraded.
 */
const TANSTACK_RELOAD_PREFIX = "tanstack_router_reload:";

/** The part of `Storage` that this file uses. */
export type ChunkStorage = Pick<
	Storage,
	"getItem" | "setItem" | "removeItem" | "key" | "length"
>;

/** What a reload needs. Tests give fakes; the browser gives `browserEnv()`. */
export type ReloadEnv = {
	storage: ChunkStorage | undefined;
	now: () => number;
	reload: () => void;
};

/** Messages of a failed dynamic import: Chrome, Firefox, Safari, and the
 *  stylesheet failure that Vite raises itself. */
const STALE_CHUNK_MESSAGES = [
	"Failed to fetch dynamically imported module",
	"error loading dynamically imported module",
	"Importing a module script failed",
	"Unable to preload CSS for",
];

/** A thrown value with a message, which is all this file reads of it. */
const thrown = z.object({ message: z.string() });

/** What a caller may hold: an `Error`, or nothing usable. */
export type Thrown = { message?: string } | null | undefined;

/** Whether a value is the failure of a dynamic import or a preload. */
export function isStaleChunkError(error: Thrown): error is { message: string } {
	const parsed = thrown.safeParse(error);
	return (
		parsed.success &&
		STALE_CHUNK_MESSAGES.some((prefix) =>
			parsed.data.message.startsWith(prefix),
		)
	);
}

/** Envs with a reload under way. The page unloads soon, so more failures
 *  from the same page are part of that reload and not new faults. */
const reloading = new WeakSet<ReloadEnv>();

let cachedEnv: ReloadEnv | undefined;

/** Whether this page started a reload that has not yet unloaded it. */
export function isReloadPending(env: ReloadEnv): boolean {
	return reloading.has(env);
}

/** The browser's reload environment (one object, so the flag is shared). Storage is missing when the browser
 *  blocks it, and then no reload happens, because the guard cannot work. */
export function browserEnv(): ReloadEnv {
	cachedEnv ??= createBrowserEnv();
	return cachedEnv;
}

function createBrowserEnv(): ReloadEnv {
	let storage: Storage | undefined;
	try {
		storage = window.sessionStorage;
	} catch {
		storage = undefined;
	}
	return {
		storage,
		now: () => Date.now(),
		reload: () => window.location.reload(),
	};
}

/**
 * Reload the page when the error is a stale chunk and the guard allows it.
 * Returns true when a reload started or is already under way in this page,
 * and then the caller must not report the
 * error as a fault: the page that loads next reports it with
 * `takeStaleChunkReport`.
 */
export function reloadIfStaleChunk(error: Thrown, env: ReloadEnv): boolean {
	if (!isStaleChunkError(error)) return false;
	// A reload is under way: this failure is part of it. Do not report it.
	if (reloading.has(env)) return true;
	if (!env.storage) return false;
	const { storage } = env;
	const now = env.now();
	try {
		// TanStack already reloaded once for this message. A second reload
		// would not help: show the error screen.
		if (storage.getItem(`${TANSTACK_RELOAD_PREFIX}${error.message}`) !== null) {
			return false;
		}
		const last = Number(storage.getItem(GUARD_KEY));
		// A stamp from the future (the clock moved) or a corrupt one does not block.
		if (Number.isFinite(last) && last > 0) {
			const elapsed = now - last;
			if (elapsed >= 0 && elapsed < RELOAD_WINDOW_MS) return false;
		}
		storage.setItem(GUARD_KEY, String(now));
		storage.setItem(REPORT_KEY, JSON.stringify({ message: error.message }));
	} catch {
		// Storage that throws cannot hold the guard, so a reload could loop.
		return false;
	}
	reloading.add(env);
	env.reload();
	return true;
}

/** Which path reloaded the page. */
export type ReloadSource = "router" | "error-screen";

export type StaleChunkReport = { message: string; source: ReloadSource };

/** Messages of stale chunk errors that the error screen already captured. */
const capturedFaults = new Set<string>();

/**
 * Whether the error screen must capture this error as a fault. Returns true
 * once for each stale chunk message in a page load. A later render or a click
 * on "Try again" gets false. Other errors always get true.
 */
export function claimStaleChunkFault(error: Thrown): boolean {
	if (!isStaleChunkError(error)) return true;
	if (capturedFaults.has(error.message)) return false;
	capturedFaults.add(error.message);
	return true;
}

const reportedKeys = z.array(z.string());

function readReportedKeys(storage: ChunkStorage): string[] {
	const raw = storage.getItem(ROUTER_REPORTED_KEY);
	if (raw === null) return [];
	const parsed = reportedKeys.safeParse(JSON.parse(raw));
	return parsed.success ? parsed.data : [];
}

/** The failures that TanStack reloaded for, each one not yet reported. */
function takeRouterReports(storage: ChunkStorage): StaleChunkReport[] {
	const reported = new Set(readReportedKeys(storage));
	const fresh: string[] = [];
	for (let i = 0; i < storage.length; i += 1) {
		const key = storage.key(i);
		if (key?.startsWith(TANSTACK_RELOAD_PREFIX) && !reported.has(key)) {
			fresh.push(key);
		}
	}
	if (fresh.length === 0) return [];
	// The router keys stay in place: they are the router's own loop guard.
	storage.setItem(ROUTER_REPORTED_KEY, JSON.stringify([...reported, ...fresh]));
	return fresh.map((key) => ({
		message: key.slice(TANSTACK_RELOAD_PREFIX.length),
		source: "router",
	}));
}

/**
 * Read the failures that caused a reload, one time each: the one that the
 * error screen stored, and each one that TanStack reloaded for.
 */
export function takeStaleChunkReports(
	storage: ChunkStorage | undefined,
): StaleChunkReport[] {
	if (!storage) return [];
	const reports: StaleChunkReport[] = [];
	try {
		const raw = storage.getItem(REPORT_KEY);
		if (raw !== null) {
			storage.removeItem(REPORT_KEY);
			const parsed = thrown.safeParse(JSON.parse(raw));
			if (parsed.success) {
				reports.push({ message: parsed.data.message, source: "error-screen" });
			}
		}
	} catch {
		// A corrupt report is not worth an event.
	}
	try {
		reports.push(...takeRouterReports(storage));
	} catch {
		// Storage that throws or a corrupt list: no router report.
	}
	return reports;
}

/** The part of a PostHog client that `sendStaleChunkReports` uses. */
export type ReportSink = {
	capture: (event: string, properties: StaleChunkReport) => void;
};

/**
 * Send one `stale_chunk_reloaded` event for each stored report. Call it only
 * when the client can capture: before `init` ends, `capture` drops the event,
 * and the report is already gone from storage.
 */
export function sendStaleChunkReports(
	sink: ReportSink,
	storage: ChunkStorage | undefined,
): void {
	for (const report of takeStaleChunkReports(storage)) {
		sink.capture("stale_chunk_reloaded", report);
	}
}
