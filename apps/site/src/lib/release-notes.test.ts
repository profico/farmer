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
			["2.0.0", "web"],
			["0.1.0", "cli"],
		]);
		expect(notes[0]?.title).toBe("v2.0.0");
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
	test("reads the mobile and CLI scopes and calls the rest web", () => {
		expect(commitKind("fix(mobile): inset screens for the iOS keyboard")).toBe(
			"mobile",
		);
		expect(commitKind("ci(mobile): sign the simulator build")).toBe("mobile");
		expect(commitKind("feat(cli)!: rename the timer command")).toBe("cli");
		expect(commitKind("fix(web): keep the week view")).toBe("web");
		expect(commitKind("chore: remove the token fallback")).toBe("web");
		expect(commitKind("feat(mobile-relay): x")).toBe("web");
	});
});
