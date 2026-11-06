import { describe, expect, test } from "bun:test";

import { upstreamUrl } from "./posthog-proxy";

const EU = "https://eu.i.posthog.com";

describe("upstreamUrl", () => {
	test("sends an API path to the API host and keeps the query", () => {
		expect(upstreamUrl(EU, "e/", "?ip=1&v=2")?.href).toBe(
			"https://eu.i.posthog.com/e/?ip=1&v=2",
		);
	});

	test("sends static and array paths to the assets host", () => {
		expect(upstreamUrl(EU, "static/x.js", "")?.href).toBe(
			"https://eu-assets.i.posthog.com/static/x.js",
		);
		expect(
			upstreamUrl("https://us.i.posthog.com/", "array/k/config.js", "")?.href,
		).toBe("https://us-assets.i.posthog.com/array/k/config.js");
	});

	test("keeps a self-hosted host for both kinds of path", () => {
		const host = "https://ph.example.org";
		expect(upstreamUrl(host, "static/x.js", "")?.href).toBe(
			"https://ph.example.org/static/x.js",
		);
		expect(upstreamUrl(host, "e/", "")?.href).toBe("https://ph.example.org/e/");
	});

	test("forwards each path posthog-js requests", () => {
		for (const splat of [
			"e/",
			"i/v0/e/",
			"s/",
			"flags/",
			"decide/",
			"api/surveys/",
			"api/conversations/v1/widget",
		])
			expect(upstreamUrl(EU, splat, "")?.pathname).toBe(`/${splat}`);
	});

	test("refuses any other path, an empty splat and a host change", () => {
		for (const splat of [
			"",
			"admin/",
			"api/projects/1",
			"//evil.example/x",
			"@evil.example/x",
		])
			expect(upstreamUrl(EU, splat, "")).toBeNull();
	});

	test("refuses a decoded splat that could move the path", () => {
		for (const splat of [
			"static/../api/projects/",
			"e/../admin",
			"e/..",
			"e/x?y",
			"e/x#y",
			"e\\..\\admin",
		])
			expect(upstreamUrl(EU, splat, "")).toBeNull();
	});
});
