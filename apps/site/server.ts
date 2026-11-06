/// <reference types="bun-types" />
import { join, normalize } from "node:path";

import { applySecurityHeaders } from "./src/lib/security-headers.ts";

/**
 * The production host: a static file server for the prerendered site in
 * `dist/client`. There is no server rendering and no API. It answers:
 *
 *  - `/` and each page path (`/about`, `/about/`) with the page's `index.html`;
 *  - `/_site/health` with 200 "ok";
 *  - `/_site/*` with the file, hashed build files with a long cache;
 *  - anything else with 404. The app owns every other path on the domain.
 */

const HASHED_FILE = /-[A-Za-z0-9_-]{8}\.(?:js|css)$/;
const IMMUTABLE = "public, max-age=31536000, immutable";
const SHORT_CACHE = "public, max-age=3600";

const NOT_FOUND_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found · Farmer</title></head><body><h1>Not found</h1><p><a href="/">Farmer front page</a></p></body></html>`;

const reply = (body: BodyInit | null, init: ResponseInit): Response =>
	new Response(body, {
		...init,
		headers: applySecurityHeaders(new Headers(init.headers)),
	});

const notFound = () =>
	reply(NOT_FOUND_HTML, {
		status: 404,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-cache",
		},
	});

/** The file for a path under `root`, or null when there is none. A path with a
 *  `..` segment is refused before any file is read. */
const fileFor = async (root: string, relative: string) => {
	if (normalize(relative).split(/[\\/]/).includes("..")) return null;
	const file = Bun.file(join(root, relative));
	return (await file.exists()) ? file : null;
};

/** The request path as a page directory: `/about/` and `/about` are `about`,
 *  `/` is the empty string. */
const pageDirectory = (pathname: string) => pathname.replace(/^\/+|\/+$/g, "");

export const createHandler = (root: string) => {
	return async (request: Request): Promise<Response> => {
		if (request.method !== "GET" && request.method !== "HEAD") {
			return reply(null, { status: 405, headers: { Allow: "GET, HEAD" } });
		}
		let pathname: string;
		try {
			pathname = decodeURIComponent(new URL(request.url).pathname);
		} catch {
			return notFound();
		}
		// A NUL byte makes Bun.file throw.
		if (pathname.includes("\0")) return notFound();

		if (pathname === "/_site/health") {
			return reply("ok", {
				headers: {
					"Content-Type": "text/plain",
					"Cache-Control": "no-store",
				},
			});
		}

		if (pathname.startsWith("/_site/")) {
			const file = await fileFor(root, pathname.slice(1));
			if (!file) return notFound();
			return reply(file, {
				headers: {
					"Content-Type": file.type,
					"Cache-Control": HASHED_FILE.test(pathname) ? IMMUTABLE : SHORT_CACHE,
				},
			});
		}

		const page = await fileFor(
			root,
			join(pageDirectory(pathname), "index.html"),
		);
		if (!page) return notFound();
		return reply(page, {
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-cache",
			},
		});
	};
};

if (import.meta.main) {
	const root = process.env.SITE_DIR ?? join(import.meta.dir, "dist/client");
	const server = Bun.serve({
		port: Number(process.env.PORT ?? 3000),
		fetch: createHandler(root),
	});
	console.log(`[site] serving ${root} on ${server.url}`);
	// PID 1 in a container gets no default signal action, so stop on purpose.
	for (const signal of ["SIGTERM", "SIGINT"] as const) {
		process.on(signal, () => {
			void server.stop().finally(() => process.exit(0));
		});
	}
}
