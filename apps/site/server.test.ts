/// <reference types="bun-types" />
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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

describe("traefik.example.yml", () => {
	const yml = readFileSync(
		join(import.meta.dir, "traefik.example.yml"),
		"utf8",
	);
	const pattern = new RegExp(
		/PathRegexp\(`([^`]+)`\)/.exec(yml)?.[1] ?? "(?!)",
	);
	const routes = readdirSync(join(import.meta.dir, "src/routes"))
		.filter((name) => name.endsWith(".tsx") && !name.startsWith("__"))
		.map((name) => name.replace(/\.tsx$/, ""))
		.filter((name) => name !== "index");

	test("the regular expression matches exactly the site pages", () => {
		expect(routes.length).toBe(7);
		for (const route of routes) {
			expect(pattern.test(`/${route}`)).toBe(true);
			expect(pattern.test(`/${route}/`)).toBe(true);
		}
		for (const path of ["/about-1", "/privacyx", "/_", "/_/settings", "/"]) {
			expect(pattern.test(path)).toBe(false);
		}
		expect(yml).toContain("Path(`/`)");
		expect(yml).toContain("PathPrefix(`/_site/`)");
	});
});

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
			"/_site/%00",
			"/about%00",
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
