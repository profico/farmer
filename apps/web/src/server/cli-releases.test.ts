// `/cli/download/<asset>` reads the public release list with no token and
// answers with the asset's public download URL.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { setInstanceSettingsForTests } from "@farmer/core/lib/instance-settings";

import {
	clearCliReleaseCacheForTests,
	resolveCliDownload,
} from "./cli-releases";

const realFetch = globalThis.fetch;
const savedRepo = process.env.CLI_RELEASES_REPO;

let requested: string[] = [];
let sentAuthorization: (string | null)[] = [];

const asset = (name: string, tag: string) => ({
	name,
	browser_download_url: `https://github.com/a-fork/farmer/releases/download/${tag}/${name}`,
});

const release = (
	tag: string,
	published: string,
	extra: { draft?: boolean; prerelease?: boolean } = {},
) => ({
	tag_name: tag,
	draft: extra.draft ?? false,
	prerelease: extra.prerelease ?? false,
	published_at: published,
	assets: [asset("farmer-linux-x64", tag), asset("SHA256SUMS", tag)],
});

/** What the stub answers: a release list, or GitHub's error body. */
type GithubReply =
	| ReturnType<typeof release>[]
	| { message: string }
	| {
			tag_name: string;
			assets: { name: string; browser_download_url: string }[];
	  }[];

const serve = (status: number, body: GithubReply, headers = {}) => {
	// SAFETY: a stub for the one call shape `externalFetch` makes, a URL and an
	// init object; nothing else calls fetch in this file.
	globalThis.fetch = (async (input: string, init?: RequestInit) => {
		requested.push(String(input));
		sentAuthorization.push(new Headers(init?.headers).get("authorization"));
		return new Response(JSON.stringify(body), { status, headers });
	}) as typeof fetch;
};

beforeEach(() => {
	delete process.env.CLI_RELEASES_REPO;
	setInstanceSettingsForTests({ CLI_RELEASES_REPO: "a-fork/farmer" });
	clearCliReleaseCacheForTests();
	requested = [];
	sentAuthorization = [];
});

afterEach(() => {
	globalThis.fetch = realFetch;
	setInstanceSettingsForTests(undefined);
	// Assigning `undefined` would store the string "undefined".
	if (savedRepo === undefined) delete process.env.CLI_RELEASES_REPO;
	else process.env.CLI_RELEASES_REPO = savedRepo;
});

describe("resolveCliDownload", () => {
	test("redirects to the newest cli-v release, with no token", async () => {
		serve(200, [
			release("v2.0.0", "2026-09-10T00:00:00Z"),
			release("cli-v0.3.0", "2026-09-09T00:00:00Z", { draft: true }),
			release("cli-v0.2.1", "2026-09-08T00:00:00Z", { prerelease: true }),
			release("cli-v0.1.0", "2026-08-01T00:00:00Z"),
			// Created before 0.1.0, published after it: the newer one.
			release("cli-v0.2.0", "2026-09-01T00:00:00Z"),
		]);

		expect(await resolveCliDownload("farmer-linux-x64")).toEqual({
			kind: "redirect",
			location:
				"https://github.com/a-fork/farmer/releases/download/cli-v0.2.0/farmer-linux-x64",
		});
		expect(requested).toEqual([
			"https://api.github.com/repos/a-fork/farmer/releases?per_page=100",
		]);
		expect(sentAuthorization).toEqual([null]);
	});

	test("an install burst reads the release list once", async () => {
		serve(200, [release("cli-v0.1.0", "2026-08-01T00:00:00Z")]);

		await Promise.all([
			resolveCliDownload("farmer-linux-x64"),
			resolveCliDownload("SHA256SUMS"),
		]);
		await resolveCliDownload("farmer-linux-x64");
		expect(requested).toHaveLength(1);
	});

	test("an asset the release lacks is missing, not a redirect", async () => {
		serve(200, [release("cli-v0.1.0", "2026-08-01T00:00:00Z")]);

		expect(await resolveCliDownload("farmer-darwin-arm64.gz")).toEqual({
			kind: "missing-asset",
			tag: "cli-v0.1.0",
		});
	});

	test("no matching release is no-release", async () => {
		serve(200, [release("v1.0.0", "2026-08-01T00:00:00Z")]);

		expect(await resolveCliDownload("farmer-linux-x64")).toEqual({
			kind: "no-release",
		});
	});

	test("a missing repository says so", async () => {
		serve(404, { message: "Not Found" });

		expect(await resolveCliDownload("farmer-linux-x64")).toEqual({
			kind: "no-repository",
			repo: "a-fork/farmer",
		});
	});

	test("a spent anonymous budget is reported with its reset time", async () => {
		serve(
			403,
			{ message: "API rate limit exceeded" },
			{ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2000000000" },
		);

		expect(await resolveCliDownload("farmer-linux-x64")).toEqual({
			kind: "rate-limited",
			retryAt: 2_000_000_000_000,
		});
	});

	test("a download URL off github.com is refused", async () => {
		serve(200, [
			{
				...release("cli-v0.1.0", "2026-08-01T00:00:00Z"),
				assets: [
					{
						name: "farmer-linux-x64",
						browser_download_url: "https://evil.test/farmer-linux-x64",
					},
				],
			},
		]);

		const download = await resolveCliDownload("farmer-linux-x64");
		expect(download.kind).toBe("upstream-error");
	});

	test("a malformed repository setting asks GitHub nothing", async () => {
		setInstanceSettingsForTests({ CLI_RELEASES_REPO: "owner/../x" });
		serve(200, []);

		expect(await resolveCliDownload("farmer-linux-x64")).toEqual({
			kind: "misconfigured",
			value: "owner/../x",
		});
		expect(requested).toEqual([]);
	});
});
