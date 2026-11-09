/// <reference types="bun-types" />
// The Changelog reads its notes out of the release bodies the CLI workflow
// writes: prose, a bullet list, an install line and a compare link.

import { describe, expect, test } from "bun:test";

import {
	commitKind,
	githubCommitList,
	githubReleaseList,
	releaseNotesFromBody,
	releaseNotesFromList,
	webCommitsFromList,
} from "./release-notes.ts";

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

describe("releaseNotesFromList", () => {
	const release = (tag: string, publishedAt: string | null, draft = false) => ({
		tag_name: tag,
		name: null,
		body: "- a change",
		draft,
		published_at: publishedAt,
		html_url: `https://example.com/${tag}`,
	});

	test("drops drafts, sorts newest first and reads the kind", () => {
		const list = githubReleaseList.parse([
			release("cli-v0.1.0", "2026-01-01T00:00:00Z"),
			release("v2.0.0", "2026-03-01T00:00:00Z"),
			release("cli-v0.2.0", "2026-02-01T00:00:00Z", true),
			release("v1.0.0", null),
			release("mobile-latest", "2026-04-01T00:00:00Z"),
			release("mobile-v1.0.0", "2026-04-02T00:00:00Z"),
		]);
		const notes = releaseNotesFromList(list);
		expect(notes.map((n) => [n.version, n.kind])).toEqual([
			["1.0.0", "mobile"],
			["2.0.0", "web"],
			["0.1.0", "cli"],
		]);
		expect(notes[1]?.title).toBe("v2.0.0");
	});

	test("keeps only the mobile lines of a mobile release's Changes", () => {
		const [note] = releaseNotesFromList(
			githubReleaseList.parse([
				{
					...release("mobile-v1.0.1", "2026-11-09T00:00:00Z"),
					body: [
						"Farmer mobile 1.0.1.",
						"## Files",
						"- `farmer-1.0.1.apk` is for Android.",
						"## Changes",
						"- fix(mobile): inset screens for the iOS keyboard (#239)",
						"- feat: finish the versions plan (#230)",
						"## Next",
						"- feat(mobile): not a change",
					].join("\n"),
				},
			]),
		);
		expect(note?.notes).toEqual([
			"fix(mobile): inset screens for the iOS keyboard (#239)",
		]);
	});
});

describe("webCommitsFromList", () => {
	test("leaves out merge commits and keeps the first line", () => {
		const entry = (sha: string, parents: number, message: string) => ({
			sha,
			html_url: `https://example.com/${sha}`,
			parents: Array.from({ length: parents }, () => ({ sha: "p" })),
			commit: { message, committer: { date: "2026-01-01T00:00:00Z" } },
		});
		const commits = webCommitsFromList(
			githubCommitList.parse([
				entry("abcdef1234", 1, "fix: one\n\nbody"),
				entry("1234567890", 2, "Merge branch"),
			]),
		);
		expect(commits).toEqual([
			{
				sha: "abcdef1234",
				shortSha: "abcdef1",
				subject: "fix: one",
				committedAt: "2026-01-01T00:00:00Z",
				url: "https://example.com/abcdef1234",
			},
		]);
	});
});

describe("commitKind", () => {
	test("marks CI, dependency and site commits internal", () => {
		expect(commitKind("ci(mobile): sign the build")).toBe("internal");
		expect(commitKind("chore(deps): bump actions/cache")).toBe("internal");
		expect(commitKind("chore(deps-dev): bump vite")).toBe("internal");
		expect(commitKind("feat(site): add the public site")).toBe("internal");
	});

	test("reads the mobile and CLI scopes and calls the rest web", () => {
		expect(commitKind("fix(mobile): inset screens for the iOS keyboard")).toBe(
			"mobile",
		);
		expect(commitKind("feat(cli)!: rename the timer command")).toBe("cli");
		expect(commitKind("fix(web): keep the week view")).toBe("web");
		expect(commitKind("chore: remove the token fallback")).toBe("web");
		expect(commitKind("feat(mobile-relay): x")).toBe("web");
	});
});
