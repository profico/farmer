/// <reference types="bun-types" />
/**
 * Post-build step: delete client JS chunks that no browser can ever reach.
 *
 * WHY THIS EXISTS
 *
 * Every server function in this app defers its server-only imports into the
 * handler body (`await import("@farmer/core/services")` — see the "Critical,
 * non-obvious rule" in CLAUDE.md). That keeps `postgres` out of the *executed*
 * client graph, which is what stops the hydration crash. It does NOT stop the
 * bundler from seeing those dynamic imports while it is building the CLIENT
 * environment: rolldown chunks them before TanStack Start's server-fn transform
 * strips the handler, so `dist/client/assets` ends up with an orphan island of
 * server code — the better-auth config, the drizzle schema, slack.service,
 * notify — roughly 1MB that nothing imports and no route preloads.
 *
 * Dead weight would be forgivable. Being *served* is not: `server.ts` globs
 * `**\/*` under `dist/client` and registers every file it finds as a public
 * route, so `GET /assets/auth-<hash>.js` handed anyone the auth configuration,
 * the full database schema and the Slack service source. The env var VALUES are
 * never in there (they are `process.env.X` property reads, evaluated at
 * runtime), but the internals were.
 *
 * Fixing it at the bundler is not really available — the chunking happens
 * upstream of the transform that makes the code dead. So we delete it after the
 * fact, from the only vantage point that can tell reachable from unreachable:
 * the finished build.
 *
 * HOW REACHABILITY IS DECIDED
 *
 * Roots are every `assets/<name>` string that appears in the built SERVER
 * output or in the non-asset client files. That is not a heuristic about how
 * bundlers name things — it is the exact set of URLs the running app is capable
 * of putting in front of a browser: TanStack Start's route manifest (baked into
 * dist/server) lists the entry `scripts` and the per-route `preloads`, and
 * sw.js / any HTML would name anything else.
 *
 * From those roots we take the transitive closure over mentions *within* client
 * assets, which covers static `import "./chunk.js"` and the `__vite__mapDeps`
 * arrays behind lazy route components alike, because both land in the file as
 * literal filenames.
 *
 * Everything left over is unreachable by construction. Only `.js` is pruned;
 * CSS and any future font/image asset is left alone regardless, since those are
 * not where server code leaks and they can be referenced from places this scan
 * deliberately does not read.
 *
 * The guards below are the important part. A false positive here ships a broken
 * app that only fails in production, so this script aborts the build rather
 * than guess: no roots found, an implausible share of the bundle marked dead, or
 * a kept file still pointing at a pruned one all exit non-zero.
 */

import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const CLIENT_DIR = path.resolve(import.meta.dir, "..", "dist", "client");
const ASSETS_DIR = path.join(CLIENT_DIR, "assets");
const SERVER_DIR = path.resolve(import.meta.dir, "..", "dist", "server");

/** Refuse to prune more than this share of client JS. Today's build drops ~2%;
 *  anything approaching half the bundle means the root scan found the wrong
 *  thing and we are about to delete the app itself. */
const MAX_PRUNE_RATIO = 0.35;

const log = {
	info: (m: string) => {
		console.log(`[prune-client] ${m}`);
	},
	error: (m: string) => {
		console.error(`[prune-client] ERROR: ${m}`);
	},
};

/** Every file under `dir`, recursively, as absolute paths. */
const walk = async (dir: string): Promise<string[]> => {
	const entries = await readdir(dir, { withFileTypes: true });
	const out: string[] = [];
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(full)));
		else out.push(full);
	}
	return out;
};

/** Which of `names` this file's text mentions. Substring matching on the hashed
 *  basename: hashes make collisions a non-issue, and matching loosely can only
 *  ever over-keep, never over-delete. */
const mentioned = (text: string, names: Iterable<string>): string[] => {
	const hits: string[] = [];
	for (const name of names) {
		if (text.includes(name)) hits.push(name);
	}
	return hits;
};

const main = async () => {
	try {
		await stat(ASSETS_DIR);
	} catch {
		log.error(`no client assets at ${ASSETS_DIR} — did the build run?`);
		process.exit(1);
	}

	const assetNames = (await readdir(ASSETS_DIR)).filter((n) =>
		n.endsWith(".js"),
	);
	if (assetNames.length === 0) {
		log.error("no client JS assets found — refusing to continue");
		process.exit(1);
	}

	// Cache every asset's text once; the closure below re-reads otherwise.
	const textByName = new Map<string, string>();
	for (const name of assetNames) {
		textByName.set(name, await Bun.file(path.join(ASSETS_DIR, name)).text());
	}

	// ── Roots: everything the server, the service worker or an HTML document can
	//    name. These are URLs the app is able to hand a browser.
	const rootSources: string[] = [];
	try {
		rootSources.push(...(await walk(SERVER_DIR)));
	} catch {
		log.error(
			`no server build at ${SERVER_DIR} — run the full \`vite build\` first, ` +
				"pruning without it would delete every reachable chunk",
		);
		process.exit(1);
	}
	// Non-asset client files (sw.js, manifest.json, any HTML) can also name chunks.
	rootSources.push(
		...(await walk(CLIENT_DIR)).filter(
			(f) => !f.startsWith(`${ASSETS_DIR}${path.sep}`),
		),
	);

	const roots = new Set<string>();
	for (const file of rootSources) {
		let text: string;
		try {
			text = await Bun.file(file).text();
		} catch {
			continue; // binary (fonts, images) — nothing to read
		}
		for (const hit of mentioned(text, assetNames)) roots.add(hit);
	}

	if (roots.size === 0) {
		log.error(
			"found no client chunks referenced by the server build — the root scan " +
				"is broken; refusing to prune",
		);
		process.exit(1);
	}

	// ── Transitive closure over mentions inside reachable client assets. Covers
	//    static imports and __vite__mapDeps arrays, both literal filenames.
	const reachable = new Set(roots);
	const queue = [...roots];
	while (queue.length > 0) {
		const name = queue.pop();
		if (name === undefined) break;
		const text = textByName.get(name);
		if (text === undefined) continue;
		for (const hit of mentioned(text, assetNames)) {
			if (!reachable.has(hit)) {
				reachable.add(hit);
				queue.push(hit);
			}
		}
	}

	const dead = assetNames.filter((n) => !reachable.has(n));
	if (dead.length === 0) {
		log.info(
			`nothing to prune (${String(assetNames.length)} chunks, all reachable)`,
		);
		return;
	}

	const ratio = dead.length / assetNames.length;
	if (ratio > MAX_PRUNE_RATIO) {
		log.error(
			`would delete ${String(dead.length)}/${String(assetNames.length)} chunks ` +
				`(${(ratio * 100).toFixed(0)}%), over the ${(MAX_PRUNE_RATIO * 100).toFixed(0)}% ` +
				"ceiling — treating this as a broken reachability scan, not a real result",
		);
		process.exit(1);
	}

	// Belt and braces: by construction no kept file can mention a dead one, since
	// that mention is exactly what would have made it reachable. Assert it anyway
	// — this is the check that would catch a future bug in the closure above
	// before it reaches production as a missing-chunk error.
	const deadSet = new Set(dead);
	for (const name of reachable) {
		const text = textByName.get(name);
		if (text === undefined) continue;
		const stillReferenced = mentioned(text, deadSet);
		if (stillReferenced.length > 0) {
			log.error(
				`${name} references chunks marked for deletion ` +
					`(${stillReferenced.join(", ")}) — reachability is wrong, aborting`,
			);
			process.exit(1);
		}
	}

	let freed = 0;
	for (const name of dead) {
		const full = path.join(ASSETS_DIR, name);
		freed += (await stat(full)).size;
		await rm(full);
	}

	log.info(
		`pruned ${String(dead.length)} unreachable chunk(s), ` +
			`${(freed / 1024).toFixed(0)} kB of server-only code:`,
	);
	for (const name of dead.sort()) log.info(`  - ${name}`);
};

await main();
