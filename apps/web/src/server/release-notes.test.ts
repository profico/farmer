// The Changelog reads its notes out of the release bodies the CLI workflow
// writes: prose, a bullet list, an install line and a compare link.

import { describe, expect, test } from "bun:test";

import { releaseNotesFromBody } from "./release-notes";

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
