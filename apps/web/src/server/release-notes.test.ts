// The Changelog reads its notes out of the release bodies the CLI workflow
// writes: prose, a bullet list, an install line and a compare link.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { setInstanceSettingsForTests } from "@farmer/core/lib/instance-settings";

import {
	clearReleaseNotesCacheForTests,
	listReleaseNotes,
	listWebChanges,
	releaseNotesFromBody,
} from "./release-notes";

describe("releaseNotesFromBody", () => {
	test("keeps the bullets and drops the prose around them", () => {
		const body = [
			"What changed in the CLI since cli-v0.4.0.",
			"",
			"- fix(cli): read the `--org` flag ([#120](https://github.com/profico/farmer/pull/120))",
			"* add farmer today",
			"",
			"Install it with `curl -fsSL https://example.com/cli/install.sh | sh`.",
			"",
			"[Every commit in between](https://github.com/profico/farmer/compare/a...b)",
		].join("\n");
		expect(releaseNotesFromBody(body)).toEqual([
			"fix(cli): read the --org flag (#120)",
			"add farmer today",
		]);
	});

	test("ignores nested bullets and an empty body", () => {
		expect(releaseNotesFromBody("  - nested\n-\n")).toEqual([]);
		expect(releaseNotesFromBody("")).toEqual([]);
	});
});

describe("a repository GitHub does not show", () => {
	const realFetch = globalThis.fetch;
	const savedRepo = process.env.CLI_RELEASES_REPO;
	let requested: string[] = [];

	beforeEach(() => {
		delete process.env.CLI_RELEASES_REPO;
		setInstanceSettingsForTests({ CLI_RELEASES_REPO: "a-fork/private" });
		clearReleaseNotesCacheForTests();
		requested = [];
		// SAFETY: a stub for the one call shape `externalFetch` makes; nothing
		// else calls fetch in these tests.
		globalThis.fetch = (async (input: string) => {
			requested.push(String(input));
			return new Response(JSON.stringify({ message: "Not Found" }), {
				status: 404,
			});
		}) as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = realFetch;
		setInstanceSettingsForTests(undefined);
		// Assigning `undefined` would store the string "undefined".
		if (savedRepo === undefined) delete process.env.CLI_RELEASES_REPO;
		else process.env.CLI_RELEASES_REPO = savedRepo;
	});

	// A 404 thrown as a failure backed off one minute, so a private repository
	// cost a request a minute from the budget the CLI install shares.
	test("caches a 404 as an empty answer, not a failure", async () => {
		expect(await listReleaseNotes()).toEqual([]);
		expect(await listReleaseNotes()).toEqual([]);
		expect((await listWebChanges()).commits).toEqual([]);
		expect((await listWebChanges()).commits).toEqual([]);
		expect(requested).toHaveLength(2);
	});
});
