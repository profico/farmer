// Recovery for a tab that was opened before a deploy.
//
// Each deploy replaces the hashed files in `/assets/`. A tab that loaded the
// old index still names the old files, so the first lazy route chunk it needs
// is gone. The server answers that URL with the app's 404 page: a 404 status
// with `text/html` (the `/*` fallback in `server.ts`, because no static route
// matches). The browser refuses it as a module, and the import fails with
// "Failed to fetch dynamically imported module". The fix is a reload, which
// fetches the new index.
//
// Two paths see the failure: Vite's `vite:preloadError` event, and the error
// that a route loader or component throws to the route error screen. Both use
// `reloadIfStaleChunk`. It reloads once per time window, so a file that is
// really missing, or a network that is down, cannot cause a reload loop.

import { z } from "zod";

/** One reload at most in this time, in milliseconds. */
export const RELOAD_WINDOW_MS = 30_000;

const GUARD_KEY = "farmer-stale-chunk-reload";
const REPORT_KEY = "farmer-stale-chunk-report";

/** The part of `Storage` that this file uses. */
export type ChunkStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

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

/** Read the failure that caused the last reload, one time. */
export function takeStaleChunkReport(
	storage: ChunkStorage | undefined,
): { message: string } | undefined {
	if (!storage) return undefined;
	try {
		const raw = storage.getItem(REPORT_KEY);
		if (raw === null) return undefined;
		storage.removeItem(REPORT_KEY);
		const parsed = thrown.safeParse(JSON.parse(raw));
		if (parsed.success) return { message: parsed.data.message };
	} catch {
		// A corrupt report is not worth an event.
	}
	return undefined;
}

/** The part of a `vite:preloadError` event that this file uses. */
type PreloadErrorEvent = { payload: Thrown; preventDefault: () => void };

type PreloadErrorTarget = {
	addEventListener: (
		type: "vite:preloadError",
		listener: (event: PreloadErrorEvent) => void,
	) => void;
};

/**
 * Reload on Vite's `vite:preloadError`. Vite throws the error again after the
 * event unless a listener calls `preventDefault`, so the listener calls it only
 * when a reload starts. When the guard blocks the reload, the error goes on to
 * the route error screen and to PostHog as before.
 */
export function installStaleChunkHandler(
	target: PreloadErrorTarget,
	env: ReloadEnv,
): void {
	target.addEventListener("vite:preloadError", (event) => {
		if (reloadIfStaleChunk(event.payload, env)) event.preventDefault();
	});
}

const preloadEvent = z.object({ payload: thrown });

let installed = false;

/** Install the handler on `window`, one time. Does nothing on the server. */
export function installBrowserStaleChunkHandler(): void {
	if (installed || globalThis.window === undefined) return;
	installed = true;
	installStaleChunkHandler(
		{
			// Vite dispatches a plain `Event` with the error in `payload`.
			addEventListener: (type, listener) =>
				window.addEventListener(type, (event) =>
					listener({
						payload: preloadEvent.safeParse(event).data?.payload,
						preventDefault: () => event.preventDefault(),
					}),
				),
		},
		browserEnv(),
	);
}
