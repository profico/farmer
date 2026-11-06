/// <reference types="bun-types" />
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHandler } from "./server.ts";

let root = "";
let handle: ReturnType<typeof createHandler>;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "site-host-"));
	mkdirSync(join(root, "about"));
	mkdirSync(join(root, "_site"));
	writeFileSync(join(root, "index.html"), "<h1>front</h1>");
	writeFileSync(join(root, "about/index.html"), "<h1>about</h1>");
	writeFileSync(join(root, "_site/app-AbCd1234.js"), "export {}");
	writeFileSync(join(root, "_site/og.png"), "png");
	handle = createHandler(root);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const get = (path: string) => handle(new Request(`http://site.test${path}`));

describe("static host", () => {
	test("serves a page for its path, with or without a slash", async () => {
		for (const [path, text] of [
			["/", "front"],
			["/about", "about"],
			["/about/", "about"],
		] as const) {
			const response = await get(path);
			expect(response.status).toBe(200);
			expect(await response.text()).toContain(text);
		}
	});

	test("caches a hashed build file for a year and other files briefly", async () => {
		expect(
			(await get("/_site/app-AbCd1234.js")).headers.get("Cache-Control"),
		).toContain("immutable");
		expect((await get("/_site/og.png")).headers.get("Cache-Control")).toBe(
			"public, max-age=3600",
		);
	});

	test("answers the health check", async () => {
		const response = await get("/_site/health");
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("ok");
	});

	test("answers 404 for the app's paths and for a path outside the root", async () => {
		for (const path of [
			"/nope",
			"/login",
			"/Icon.svg",
			"/_site/missing.js",
			"/_site/../server.ts",
			"/%2e%2e/server.ts",
		]) {
			expect({ path, status: (await get(path)).status }).toEqual({
				path,
				status: 404,
			});
		}
	});

	test("sets the security headers", async () => {
		const response = await get("/");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(response.headers.get("Content-Security-Policy")).toBe(
			"frame-ancestors 'none'",
		);
	});
});
