/// <reference types="bun-types" />
/**
 * Production server entry — run with `bun run start` (i.e. `bun run server.ts`)
 * from `apps/web/` after `bun run build`.
 *
 * `vite build` here emits a web-standard `{ fetch }` handler
 * (`dist/server/server.js`) plus static client assets (`dist/client/`), but
 * nothing that listens on a port or serves those assets — TanStack Start only
 * wires that up automatically behind a hosting preset (Nitro), which doesn't
 * resolve under Bun's node_modules in this repo. So we bring our own host.
 *
 * This is TanStack's official "Production server with Bun" reference
 * (examples/react/start-bun/server.ts), adapted only by adding the bun-types
 * reference above. Keep the body in sync with upstream so it stays low-maintenance:
 * hybrid asset loading (preload small files into memory, stream large ones on
 * demand), ETag/304, gzip, and cache headers — all env-configurable.
 *
 * It also starts the background schedulers in-process. Those live in
 * @farmer/core/jobs (not here) so they can run as a standalone worker too —
 * `bun run worker` from packages/core, which is what runs them under `vite dev`.
 * Their env vars are documented there.
 *
 * Environment Variables:
 *
 * PORT (number)
 *   - Server port number
 *   - Default: 3000
 *
 * ASSET_PRELOAD_MAX_SIZE (number)
 *   - Maximum file size in bytes to preload into memory
 *   - Files larger than this will be served on-demand from disk
 *   - Default: 5242880 (5MB)
 *
 * ASSET_PRELOAD_INCLUDE_PATTERNS (string)
 *   - Comma-separated list of glob patterns for files to include
 *   - If specified, only matching files are eligible for preloading
 *   - Patterns are matched against filenames only, not full paths
 *   - Example: ASSET_PRELOAD_INCLUDE_PATTERNS="*.js,*.css,*.woff2"
 *
 * ASSET_PRELOAD_EXCLUDE_PATTERNS (string)
 *   - Comma-separated list of glob patterns for files to exclude
 *   - Applied after include patterns
 *   - Patterns are matched against filenames only, not full paths
 *   - Example: ASSET_PRELOAD_EXCLUDE_PATTERNS="*.map,*.txt"
 *
 * ASSET_PRELOAD_VERBOSE_LOGGING (boolean)
 *   - Enable detailed logging of loaded and skipped files
 *   - Default: false
 *
 * ASSET_PRELOAD_ENABLE_ETAG (boolean)
 *   - Enable ETag generation for preloaded assets
 *   - Default: true
 *
 * ASSET_PRELOAD_ENABLE_GZIP (boolean)
 *   - Enable Gzip compression for eligible assets
 *   - Default: true
 *
 * ASSET_PRELOAD_GZIP_MIN_SIZE (number)
 *   - Minimum file size in bytes required for Gzip compression
 *   - Default: 1024 (1KB)
 *
 * ASSET_PRELOAD_GZIP_MIME_TYPES (string)
 *   - Comma-separated list of MIME types eligible for Gzip compression
 *   - Supports partial matching for types ending with "/"
 *   - Default: text/,application/javascript,application/json,application/xml,image/svg+xml
 *
 * MAX_REQUEST_BODY_BYTES (number)
 *   - The largest request body the server reads; a larger one gets a 413
 *   - Default: 33554432 (32MB) — see `MAX_REQUEST_BODY_BYTES` below for why
 */

import path from "node:path";

// Type-only, so this erases at runtime and the postgres client is still only
// loaded by the deferred import inside startBackgroundSchedulers().
import type { SchedulerHandle } from "@farmer/core/jobs";
import { SOCKET_ADDRESS_HEADER } from "@farmer/core/lib/client-address";
import { loggableErrorLine } from "@farmer/core/lib/loggable-error";

import { acceptsGzip } from "./src/lib/accept-encoding.ts";
import { applySecurityHeaders } from "./src/lib/security-headers.ts";

// Configuration
const SERVER_PORT = Number(process.env.PORT ?? 3000);
const CLIENT_DIRECTORY = "./dist/client";
const SERVER_ENTRY_POINT = "./dist/server/server.js";

/**
 * The largest request body Bun reads, for every route, before any handler runs.
 *
 * TanStack Start's server-function handler calls `request.formData()` or
 * `request.json()` before any middleware — so before the session is checked —
 * and Bun's default ceiling is 128MB. Any unauthenticated POST could make the
 * process buffer that much. Bun answers 413 past this limit, for a
 * `Content-Length` body and a chunked one alike.
 *
 * The largest legitimate body is a Harvest import step. `importDays` carries
 * up to `HARVEST_CHUNK_MAX_ROWS` (5,000) rows, and measured through the same
 * seroval encoding the browser sends, a chunk is about 2-3MB with ordinary
 * notes and 6.7MB when EVERY note is 1,000 characters long. `start` is smaller
 * in practice (its 50,000 project memberships are two short keys each). An
 * upload is 1MB (`MAX_UPLOAD_BYTES`) in a multipart body, and an assistant
 * message or an MCP request is a few kilobytes. 32MB keeps about five times the
 * worst realistic import chunk in hand, so no import fails on this, and it is
 * still a quarter of the default. The schema itself would admit a ~52MB chunk
 * (5,000 rows of 10,000-character notes); a file like that is not an export
 * anyone has, and the import can be retried after raising this variable.
 *
 * Only the production host reads this: `vite dev` never loads `server.ts`.
 */
const DEFAULT_MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;
// A value that is not a positive number falls back to the default rather than
// to NaN, which Bun would read as no usable limit.
const configuredBodyLimit = Number(process.env.MAX_REQUEST_BODY_BYTES);
const MAX_REQUEST_BODY_BYTES =
	Number.isFinite(configuredBodyLimit) && configuredBodyLimit > 0
		? configuredBodyLimit
		: DEFAULT_MAX_REQUEST_BODY_BYTES;

// Logging utilities for professional output
const log = {
	info: (message: string) => {
		console.log(`[INFO] ${message}`);
	},
	success: (message: string) => {
		console.log(`[SUCCESS] ${message}`);
	},
	warning: (message: string) => {
		console.log(`[WARNING] ${message}`);
	},
	error: (message: string) => {
		console.log(`[ERROR] ${message}`);
	},
	header: (message: string) => {
		console.log(`\n${message}\n`);
	},
};

// Preloading configuration from environment variables
const MAX_PRELOAD_BYTES = Number(
	process.env.ASSET_PRELOAD_MAX_SIZE ?? 5 * 1024 * 1024, // 5MB default
);

// Parse comma-separated include patterns (no defaults)
const INCLUDE_PATTERNS = (process.env.ASSET_PRELOAD_INCLUDE_PATTERNS ?? "")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean)
	.map((pattern: string) => convertGlobToRegExp(pattern));

// Parse comma-separated exclude patterns (no defaults)
const EXCLUDE_PATTERNS = (process.env.ASSET_PRELOAD_EXCLUDE_PATTERNS ?? "")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean)
	.map((pattern: string) => convertGlobToRegExp(pattern));

// Verbose logging flag
const VERBOSE = process.env.ASSET_PRELOAD_VERBOSE_LOGGING === "true";

// Optional ETag feature
const ENABLE_ETAG =
	(process.env.ASSET_PRELOAD_ENABLE_ETAG ?? "true") === "true";

// Optional Gzip feature
const ENABLE_GZIP =
	(process.env.ASSET_PRELOAD_ENABLE_GZIP ?? "true") === "true";
const GZIP_MIN_BYTES = Number(process.env.ASSET_PRELOAD_GZIP_MIN_SIZE ?? 1024); // 1KB
const GZIP_TYPES = (
	process.env.ASSET_PRELOAD_GZIP_MIME_TYPES ??
	"text/,application/javascript,application/json,application/xml,image/svg+xml"
)
	.split(",")
	.map((v) => v.trim())
	.filter(Boolean);

/**
 * Convert a simple glob pattern to a regular expression
 * Supports * wildcard for matching any characters
 */
function convertGlobToRegExp(globPattern: string): RegExp {
	// Escape regex special chars except *, then replace * with .*
	const escapedPattern = globPattern
		.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
		.replace(/\*/g, ".*");
	return new RegExp(`^${escapedPattern}$`, "i");
}

/**
 * Compute ETag for a given data buffer
 */
function computeEtag(data: Uint8Array): string {
	const hash = Bun.hash(data);
	return `W/"${hash.toString(16)}-${data.byteLength.toString()}"`;
}

/**
 * Metadata for preloaded static assets
 */
interface AssetMetadata {
	route: string;
	size: number;
	type: string;
}

/**
 * In-memory asset with ETag and Gzip support
 */
interface InMemoryAsset {
	raw: Uint8Array;
	gz?: Uint8Array;
	etag?: string;
	type: string;
	immutable: boolean;
	size: number;
}

/**
 * Result of static asset preloading process
 */
interface PreloadResult {
	routes: Record<string, (req: Request) => Response | Promise<Response>>;
	loaded: AssetMetadata[];
	skipped: AssetMetadata[];
}

/**
 * Check if a file is eligible for preloading based on configured patterns
 */
function isFileEligibleForPreloading(relativePath: string): boolean {
	const fileName = relativePath.split(/[/\\]/).pop() ?? relativePath;

	// If include patterns are specified, file must match at least one
	if (INCLUDE_PATTERNS.length > 0) {
		if (!INCLUDE_PATTERNS.some((pattern) => pattern.test(fileName))) {
			return false;
		}
	}

	// If exclude patterns are specified, file must not match any
	if (EXCLUDE_PATTERNS.some((pattern) => pattern.test(fileName))) {
		return false;
	}

	return true;
}

/**
 * Check if a MIME type is compressible
 */
function isMimeTypeCompressible(mimeType: string): boolean {
	return GZIP_TYPES.some((type) =>
		type.endsWith("/") ? mimeType.startsWith(type) : mimeType === type,
	);
}

/**
 * Conditionally compress data based on size and MIME type
 */
function compressDataIfAppropriate(
	data: Uint8Array,
	mimeType: string,
): Uint8Array | undefined {
	if (!ENABLE_GZIP) return undefined;
	if (data.byteLength < GZIP_MIN_BYTES) return undefined;
	if (!isMimeTypeCompressible(mimeType)) return undefined;
	try {
		// SAFETY: these Uint8Arrays come from `Bun.file().bytes()`, which allocates a
		// plain ArrayBuffer, never a SharedArrayBuffer. The call is inside a try/catch
		// that falls back to serving the asset uncompressed.
		return Bun.gzipSync(data.buffer as ArrayBuffer);
	} catch {
		return undefined;
	}
}

/**
 * Whether a route may be cached for a year without revalidation.
 *
 * Only a content-hashed filename may: its URL changes when its bytes change, so
 * a stale copy is unreachable rather than merely old. `vite build` emits those
 * into `assets/` as `[name]-[hash][extname]`, and nothing else in `dist/client`
 * is hashed — `public/` is copied across verbatim.
 *
 * This used to be an unconditional `immutable: true` on every preloaded asset,
 * which pinned `manifest.json`, `robots.txt`, the logos and `sw.js` in every
 * browser cache for a year with no way to revalidate. `sw.js` is the one that
 * turns a bad deploy into a permanent one: a service worker that cannot be
 * re-fetched keeps serving the build it shipped with until the user clears site
 * data, which is not something to ask of them.
 *
 * The hash test is deliberate rather than a bare `startsWith("/assets/")`. A
 * file that fails it falls back to an hour, which is the harmless direction.
 */
const HASHED_ASSET = /-[A-Za-z0-9_-]{8,}\.[^./]+$/;

function isImmutableRoute(route: string): boolean {
	return route.startsWith("/assets/") && HASHED_ASSET.test(route);
}

/**
 * Create response handler function with ETag and Gzip support
 */
function createResponseHandler(
	asset: InMemoryAsset,
): (req: Request) => Response {
	const cacheControl = asset.immutable
		? "public, max-age=31536000, immutable"
		: "public, max-age=3600";

	return (req: Request) => {
		// The static routes answer before the `/*` wrapper that adds the
		// security headers, so they add their own: an `/assets/*.svg` without
		// `nosniff` or `frame-ancestors` is the gap the wrapper exists to close.
		const headers = applySecurityHeaders(
			new Headers({
				"Content-Type": asset.type,
				"Cache-Control": cacheControl,
			}),
		);
		// An asset with a gzip variant answers differently per Accept-Encoding,
		// so a shared cache must key on it. Without `Vary`, a CDN that stored the
		// gzip body could serve it to a client that never asked for gzip. On the
		// 304 too: it refreshes the stored response, and must describe it.
		const varies = ENABLE_GZIP && asset.gz !== undefined;
		if (varies) headers.set("Vary", "Accept-Encoding");

		if (ENABLE_ETAG && asset.etag) {
			const ifNone = req.headers.get("if-none-match");
			if (ifNone && ifNone === asset.etag) {
				// A 304 has to repeat Cache-Control. It is what refreshes the stored
				// freshness lifetime, so omitting it left the client revalidating a
				// still-good asset on every single request.
				const notModified = applySecurityHeaders(
					new Headers({
						ETag: asset.etag,
						"Cache-Control": cacheControl,
					}),
				);
				if (varies) notModified.set("Vary", "Accept-Encoding");
				return new Response(null, { status: 304, headers: notModified });
			}
			headers.set("ETag", asset.etag);
		}

		if (
			ENABLE_GZIP &&
			asset.gz &&
			acceptsGzip(req.headers.get("accept-encoding"))
		) {
			headers.set("Content-Encoding", "gzip");
			headers.set("Content-Length", String(asset.gz.byteLength));
			const gzCopy = new Uint8Array(asset.gz);
			return new Response(gzCopy, { status: 200, headers });
		}

		headers.set("Content-Length", String(asset.raw.byteLength));
		const rawCopy = new Uint8Array(asset.raw);
		return new Response(rawCopy, { status: 200, headers });
	};
}

/**
 * Create composite glob pattern from include patterns
 */
function createCompositeGlobPattern(): Bun.Glob {
	const raw = (process.env.ASSET_PRELOAD_INCLUDE_PATTERNS ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	if (raw.length === 0) return new Bun.Glob("**/*");
	if (raw.length === 1) return new Bun.Glob(raw[0]);
	return new Bun.Glob(`{${raw.join(",")}}`);
}

type RouteHandler = (req: Request) => Response | Promise<Response>;

/**
 * Print the preload settings. Only verbose mode shows them.
 */
function logPreloadConfig(): void {
	if (!VERBOSE) return;
	console.log(
		`Max preload size: ${(MAX_PRELOAD_BYTES / 1024 / 1024).toFixed(2)} MB`,
	);
	if (INCLUDE_PATTERNS.length > 0) {
		console.log(
			`Include patterns: ${process.env.ASSET_PRELOAD_INCLUDE_PATTERNS ?? ""}`,
		);
	}
	if (EXCLUDE_PATTERNS.length > 0) {
		console.log(
			`Exclude patterns: ${process.env.ASSET_PRELOAD_EXCLUDE_PATTERNS ?? ""}`,
		);
	}
}

/**
 * Handler for a file that is read from disk on each request
 */
function onDemandHandler(filepath: string, type: string): RouteHandler {
	return () =>
		new Response(Bun.file(filepath), {
			headers: applySecurityHeaders(
				new Headers({
					"Content-Type": type,
					"Cache-Control": "public, max-age=3600",
				}),
			),
		});
}

/**
 * Build the route for one file in the client directory.
 * Return null for a file that does not exist or is empty.
 */
async function routeForFile(
	clientDirectory: string,
	relativePath: string,
): Promise<{
	route: string;
	handler: RouteHandler;
	metadata: AssetMetadata;
	preloaded: boolean;
} | null> {
	const filepath = path.join(clientDirectory, relativePath);
	const route = `/${relativePath.split(path.sep).join(path.posix.sep)}`;
	const file = Bun.file(filepath);

	// Skip if file doesn't exist or is empty
	if (!(await file.exists()) || file.size === 0) return null;

	const type = file.type || "application/octet-stream";
	const metadata: AssetMetadata = { route, size: file.size, type };

	// Determine if file should be preloaded
	const preloaded =
		isFileEligibleForPreloading(relativePath) && file.size <= MAX_PRELOAD_BYTES;
	if (!preloaded) {
		// Serve large or filtered files on-demand
		return {
			route,
			handler: onDemandHandler(filepath, type),
			metadata,
			preloaded,
		};
	}

	// Preload small files into memory with ETag and Gzip support
	const bytes = new Uint8Array(await file.arrayBuffer());
	const asset: InMemoryAsset = {
		raw: bytes,
		gz: compressDataIfAppropriate(bytes, type),
		etag: ENABLE_ETAG ? computeEtag(bytes) : undefined,
		type,
		immutable: isImmutableRoute(route),
		size: bytes.byteLength,
	};
	return {
		route,
		handler: createResponseHandler(asset),
		metadata: { ...metadata, size: bytes.byteLength },
		preloaded,
	};
}

/**
 * The glob yields directories too, and opening one throws EISDIR —
 * expected, not worth a line in the log. The code is on `.code`;
 * `.name` is plain "Error", so the old test never matched and every
 * directory under `dist/client` was reported as a failed asset.
 */
function isExpectedScanError(error: Error): boolean {
	const code = "code" in error ? error.code : undefined;
	return code === "EISDIR";
}

/**
 * Format file size with KB and actual gzip size
 */
function formatFileSize(bytes: number, gzBytes?: number) {
	const kb = bytes / 1024;
	const sizeStr = kb < 100 ? kb.toFixed(2) : kb.toFixed(1);

	if (gzBytes !== undefined) {
		const gzKb = gzBytes / 1024;
		const gzStr = gzKb < 100 ? gzKb.toFixed(2) : gzKb.toFixed(1);
		return {
			size: sizeStr,
			gzip: gzStr,
		};
	}

	// Rough gzip estimation (typically 30-70% compression) if no actual gzip data
	const gzipKb = kb * 0.35;
	return {
		size: sizeStr,
		gzip: gzipKb < 100 ? gzipKb.toFixed(2) : gzipKb.toFixed(1),
	};
}

/**
 * Print one table of files. Sort the list in place.
 */
function printFileTable(
	title: string,
	files: AssetMetadata[],
	width: number,
): void {
	if (files.length === 0) return;
	console.log(title);
	console.log(
		"Path                                          │    Size │ Gzip Size",
	);
	files
		.sort((a, b) => a.route.localeCompare(b.route))
		.forEach((file) => {
			const { size, gzip } = formatFileSize(file.size);
			const paddedPath = file.route.padEnd(width);
			const sizeStr = `${size.padStart(7)} kB`;
			const gzipStr = `${gzip.padStart(7)} kB`;
			console.log(`${paddedPath} │ ${sizeStr} │  ${gzipStr}`);
		});
}

/**
 * Print the file tables and the detail list. Only verbose mode calls this.
 */
function printVerboseDetails(
	loaded: AssetMetadata[],
	skipped: AssetMetadata[],
): void {
	if (loaded.length === 0 && skipped.length === 0) {
		console.log("\n📊 No files found to display");
		return;
	}
	const allFiles = [...loaded, ...skipped].sort((a, b) =>
		a.route.localeCompare(b.route),
	);

	// Calculate max path length for alignment
	const maxPathLength = Math.min(
		Math.max(...allFiles.map((f) => f.route.length)),
		60,
	);
	printFileTable("\n📁 Preloaded into memory:", loaded, maxPathLength);
	printFileTable("\n💾 Served on-demand:", skipped, maxPathLength);

	console.log("\n📊 Detailed file information:");
	console.log(
		"Status       │ Path                            │ MIME Type                    │ Reason",
	);
	allFiles.forEach((file) => {
		const isPreloaded = loaded.includes(file);
		const status = isPreloaded ? "MEMORY" : "ON-DEMAND";
		const reason = isPreloaded
			? "preloaded"
			: file.size > MAX_PRELOAD_BYTES
				? "too large"
				: "filtered";
		const route =
			file.route.length > 30 ? `${file.route.substring(0, 27)}...` : file.route;
		console.log(
			`${status.padEnd(12)} │ ${route.padEnd(30)} │ ${file.type.padEnd(28)} │ ${reason.padEnd(10)}`,
		);
	});
}

/**
 * Print the summary line for the preloaded and the on-demand files
 */
function logPreloadSummary(
	loaded: AssetMetadata[],
	skipped: AssetMetadata[],
	totalBytes: number,
): void {
	console.log(); // Empty line for separation
	if (loaded.length > 0) {
		log.success(
			`Preloaded ${String(loaded.length)} files (${(totalBytes / 1024 / 1024).toFixed(2)} MB) into memory`,
		);
	} else {
		log.info("No files preloaded into memory");
	}

	if (skipped.length > 0) {
		const tooLarge = skipped.filter((f) => f.size > MAX_PRELOAD_BYTES).length;
		const filtered = skipped.length - tooLarge;
		log.info(
			`${String(skipped.length)} files will be served on-demand (${String(tooLarge)} too large, ${String(filtered)} filtered)`,
		);
	}
}

/**
 * Initialize static routes with intelligent preloading strategy
 * Small files are loaded into memory, large files are served on-demand
 */
async function initializeStaticRoutes(
	clientDirectory: string,
): Promise<PreloadResult> {
	const routes: Record<string, RouteHandler> = {};
	const loaded: AssetMetadata[] = [];
	const skipped: AssetMetadata[] = [];

	log.info(`Loading static assets from ${clientDirectory}...`);
	logPreloadConfig();

	let totalPreloadedBytes = 0;

	try {
		const glob = createCompositeGlobPattern();
		for await (const relativePath of glob.scan({ cwd: clientDirectory })) {
			try {
				const entry = await routeForFile(clientDirectory, relativePath);
				if (!entry) continue;
				routes[entry.route] = entry.handler;
				if (entry.preloaded) {
					loaded.push(entry.metadata);
					totalPreloadedBytes += entry.metadata.size;
				} else {
					skipped.push(entry.metadata);
				}
			} catch (error: unknown) {
				if (error instanceof Error && !isExpectedScanError(error)) {
					log.error(
						`Failed to load ${path.join(clientDirectory, relativePath)}: ${error.message}`,
					);
				}
			}
		}

		if (VERBOSE) printVerboseDetails(loaded, skipped);
		logPreloadSummary(loaded, skipped, totalPreloadedBytes);
	} catch (error) {
		log.error(
			`Failed to load static files from ${clientDirectory}: ${String(error)}`,
		);
	}

	return { routes, loaded, skipped };
}

/**
 * Initialize the server
 */
async function initializeServer() {
	log.header("Starting Production Server");

	// Load TanStack Start server handler
	let handler: { fetch: (request: Request) => Response | Promise<Response> };
	try {
		// SAFETY: a dynamic import of a path only known at runtime, so there is no
		// module to type against. The shape is `vite build`'s own output contract for
		// the SSR entry; a build that stopped matching it throws in the catch below.
		const serverModule = (await import(SERVER_ENTRY_POINT)) as {
			default: { fetch: (request: Request) => Response | Promise<Response> };
		};
		handler = serverModule.default;
		log.success("TanStack Start application handler initialized");
	} catch (error) {
		log.error(`Failed to load server handler: ${String(error)}`);
		process.exit(1);
	}

	// Build static routes with intelligent preloading
	const { routes } = await initializeStaticRoutes(CLIENT_DIRECTORY);

	// Create Bun server
	const server = Bun.serve({
		port: SERVER_PORT,
		// Bun closes a request that sends nothing for 10 seconds by default, with
		// an empty reply and while the handler keeps running. Some server functions
		// work longer than that before they answer: "Re-match people" makes one
		// Slack call per person, and a Harvest import step writes thousands of rows.
		// The browser then got an unreadable reply ("Invariant failed") for work
		// that went on to succeed. 255 is Bun's maximum.
		idleTimeout: 255,
		maxRequestBodySize: MAX_REQUEST_BODY_BYTES,

		routes: {
			// Serve static assets (preloaded or on-demand)
			...routes,

			// A hashed asset that is not in the map above is gone, for example a
			// chunk that a deploy replaced. It can never be a page, so answer a bare
			// 404 and skip the SSR handler. The exact routes above win over this
			// wildcard. A short `no-cache` keeps a proxy from holding the 404 after
			// a rollback puts the file back.
			"/assets/*": () =>
				new Response(null, {
					status: 404,
					headers: applySecurityHeaders(
						new Headers({ "Cache-Control": "no-cache" }),
					),
				}),

			// Fallback to TanStack Start handler for all other routes.
			//
			// Everything reaching this fallback is dynamic — the SSR HTML document,
			// server functions, and API routes (static assets are served by the
			// `routes` map above and never get here). None of it may be cached by a
			// shared cache: the SSR HTML embeds per-build hashed chunk names, so a
			// cached document from a previous deploy points browsers at chunk URLs
			// that no longer exist → "Failed to fetch dynamically imported module"
			// and a dead app until the cache expires. Worse, server-function URLs are
			// identical for every user/org (auth rides on the cookie, not the URL), so
			// a shared cache that ignores cookies would serve one org's private data —
			// or a stale empty response — to another. We therefore stamp
			// `private, no-store` (plus `Vary: Cookie`) on any response that doesn't
			// already set its own Cache-Control: `private` forbids shared/CDN caches,
			// `no-store` forbids the browser from storing it at all, and a handler that
			// genuinely wants caching can still opt in by setting its own header.
			//
			// This is only the origin's half. A Cloudflare "Cache Everything" rule
			// with an Edge/Browser Cache TTL OVERRIDES these headers and will cache
			// this dynamic traffic anyway — that rule must be scoped to static assets
			// (`/assets/*`) only, or set to "respect existing headers", or these
			// directives are moot. (This was the cause of the time-off list showing
			// empty until the browser cache was disabled.)
			//
			// Every response here also gets the baseline security headers (see
			// `lib/security-headers.ts`), including one that sets its own
			// Cache-Control. A header the route set itself is kept.
			"/*": async (req, bunServer) => {
				try {
					// The socket address, for the per-address rate limits when the
					// trusted proxy header is missing (`lib/client-address.ts`). The
					// caller's own copy of the header is deleted first, so the only
					// value it can hold is the one written here.
					req.headers.delete(SOCKET_ADDRESS_HEADER);
					const socketAddress = bunServer.requestIP(req)?.address;
					if (socketAddress)
						req.headers.set(SOCKET_ADDRESS_HEADER, socketAddress);
					const res = await handler.fetch(req);
					const headers = applySecurityHeaders(new Headers(res.headers));
					if (!headers.has("Cache-Control")) {
						headers.set("Cache-Control", "private, no-store, must-revalidate");
						headers.append("Vary", "Cookie");
					}
					return new Response(res.body, {
						status: res.status,
						statusText: res.statusText,
						headers,
					});
				} catch (error) {
					log.error(`Server handler error: ${loggableErrorLine(error)}`);
					return new Response("Internal Server Error", { status: 500 });
				}
			},
		},

		// Global error handler
		error(error) {
			log.error(`Uncaught server error: ${loggableErrorLine(error)}`);
			return new Response("Internal Server Error", { status: 500 });
		},
	});

	log.success(`Server listening on http://localhost:${String(server.port)}`);

	// In-process background schedulers, run on timers so work happens without a
	// user present: the automation sweep (recurring blocks, calendar meetings,
	// commit work-time blocks) and the reminder/alert jobs. The scheduler itself
	// lives in @farmer/core/jobs so it can also run as its own process — see
	// `bun run worker` there, which is how these run under `vite dev`.
	//
	// Fire-and-forget: a scheduler failure must never take the HTTP server down
	// with it. Set AUTOMATION_SYNC_ENABLED=false (and friends) here if you run a
	// separate worker container.
	const schedulersHandle = startBackgroundSchedulers().catch(
		(error: unknown): SchedulerHandle[] => {
			log.error(`Failed to start background schedulers: ${String(error)}`);
			return [];
		},
	);

	setupGracefulShutdown(server, schedulersHandle);
}

/**
 * Start the schedulers from @farmer/core/jobs.
 *
 * Deferred import: pulling in @farmer/core loads the postgres client, so keep
 * it out of module scope and only touch the DB layer once the server is up.
 */
async function startBackgroundSchedulers(): Promise<SchedulerHandle[]> {
	const { startSchedulers } = await import("@farmer/core/jobs");
	return startSchedulers({
		info: log.info,
		warn: log.warning,
		error: log.error,
	});
}

/**
 * Wire SIGTERM/SIGINT to a clean shutdown: stop the schedulers' timers, let any
 * in-flight tick finish (bounded by a grace period so a stuck tick can't hang
 * the process forever), stop accepting HTTP connections, then exit.
 */
function setupGracefulShutdown(
	server: ReturnType<typeof Bun.serve>,
	schedulersHandle: Promise<SchedulerHandle[]>,
) {
	const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS ?? 10_000);
	let shuttingDown = false;

	const shutdown = async (signal: string) => {
		if (shuttingDown) return;
		shuttingDown = true;
		log.header(`Received ${signal}, shutting down gracefully...`);

		try {
			const { stopSchedulers } = await import("@farmer/core/jobs");
			await stopSchedulers(await schedulersHandle, SHUTDOWN_GRACE_MS, {
				info: log.info,
				warn: log.warning,
				error: log.error,
			});
		} catch (error) {
			log.error(`Error while stopping background schedulers: ${String(error)}`);
		}

		// Stop accepting new connections and close existing ones.
		try {
			server.stop(true);
			log.success("HTTP server closed");
		} catch (error) {
			log.error(`Error while closing HTTP server: ${String(error)}`);
		}

		process.exit(0);
	};

	process.on("SIGTERM", () => {
		void shutdown("SIGTERM");
	});
	process.on("SIGINT", () => {
		void shutdown("SIGINT");
	});
}

// Initialize the server
initializeServer().catch((error: unknown) => {
	log.error(`Failed to start server: ${String(error)}`);
	process.exit(1);
});
