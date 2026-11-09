import { z } from "zod";

/**
 * What the Changelog and the front page's "latest release" pill show. The
 * build script (`scripts/fetch-releases.ts`) reads GitHub and writes
 * `src/generated/releases.json`; this module holds the shapes and the parsing
 * that both the script and the pages use. It has no network code.
 */

export const releaseNoteSchema = z.object({
	tag: z.string(),
	/** What the Changelog filters by. A `cli-v…` tag is the CLI, a `mobile-v…`
	 *  tag the mobile app, and anything else the web app. */
	kind: z.enum(["web", "cli", "mobile"]),
	/** The version without its prefix: `cli-v0.4.1` is `0.4.1`. */
	version: z.string(),
	/** The release name, or the tag when the release has none. */
	title: z.string(),
	/** ISO timestamp. */
	publishedAt: z.string(),
	/** The body's top-level `- ` bullets, as plain text. */
	notes: z.array(z.string()),
	url: z.string(),
});

export type ReleaseNote = z.infer<typeof releaseNoteSchema>;
export type ReleaseKind = ReleaseNote["kind"];

export const webCommitSchema = z.object({
	sha: z.string(),
	shortSha: z.string(),
	/** The first line of the message. */
	subject: z.string(),
	/** ISO timestamp of the commit, as the committer dated it. */
	committedAt: z.string(),
	url: z.string(),
});

export type WebCommit = z.infer<typeof webCommitSchema>;

export type CommitKind = "web" | "mobile" | "cli" | "internal";

/** The app a commit is for, from its conventional-commit type and scope:
 *  `fix(mobile): …` is the mobile app and `feat(cli): …` the CLI. CI, the
 *  dependency bumps and the public site are "internal": no app changed. */
export const commitKind = (subject: string): CommitKind => {
	const [, type, scope = ""] = /^(\w+)(?:\(([^)]*)\))?!?:/.exec(subject) ?? [];
	if (type === "ci" || scope === "site" || scope.startsWith("deps")) {
		return "internal";
	}
	return scope === "mobile" || scope === "cli" ? scope : "web";
};

/** The default branch's commits, newest first. */
export type WebChanges = { commits: WebCommit[] };

/** The file the build script writes. */
export const releaseDataSchema = z.object({
	releases: z.array(releaseNoteSchema),
	commits: z.array(webCommitSchema),
});

export type ReleaseData = z.infer<typeof releaseDataSchema>;

export const EMPTY_RELEASE_DATA: ReleaseData = { releases: [], commits: [] };

/** The fields of GitHub's release list that the site reads. */
export const githubReleaseList = z.array(
	z.object({
		tag_name: z.string(),
		name: z.string().nullable(),
		body: z.string().nullable(),
		draft: z.boolean(),
		published_at: z.string().nullable(),
		html_url: z.string(),
	}),
);

/** The fields of GitHub's commit list that the site reads. */
export const githubCommitList = z.array(
	z.object({
		sha: z.string(),
		html_url: z.string(),
		parents: z.array(z.object({ sha: z.string() })),
		commit: z.object({
			message: z.string(),
			committer: z.object({ date: z.string() }).nullable(),
		}),
	}),
);

/** The top-level bullets of a release body, with Markdown links reduced to
 *  their text and inline code to its content. The install line and the
 *  compare link are prose, not bullets, so they fall away on their own. */
export const releaseNotesFromBody = (body: string): string[] =>
	body
		.split(/\r?\n/)
		.filter((line) => /^[-*] /.test(line))
		.map((line) =>
			line
				.slice(2)
				.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
				.replace(/`([^`]+)`/g, "$1")
				.trim(),
		)
		.filter(Boolean);

const kindOf = (tag: string): ReleaseKind =>
	tag.startsWith("cli-") ? "cli" : tag.startsWith("mobile-") ? "mobile" : "web";

const versionOf = (tag: string): string => tag.replace(/^(cli-|mobile-)?v/, "");

/** A mobile body lists its files and then every commit since the last
 *  build, web ones included. Only the mobile lines of "## Changes" are notes. */
const mobileNotesFromBody = (body: string): string[] =>
	releaseNotesFromBody(
		body.split(/^## Changes\s*$/m)[1]?.split(/^## /m)[0] ?? "",
	).filter((note) => commitKind(note) === "mobile");

/** Published releases, newest first. `mobile-latest` moves to each new build
 *  and has no version, so it is left out. */
export const releaseNotesFromList = (
	list: z.infer<typeof githubReleaseList>,
): ReleaseNote[] =>
	list
		.filter(
			(release) =>
				!release.draft &&
				release.published_at &&
				release.tag_name !== "mobile-latest",
		)
		.map((release) => {
			const kind = kindOf(release.tag_name);
			const body = release.body ?? "";
			return {
				tag: release.tag_name,
				kind,
				version: versionOf(release.tag_name),
				title: release.name?.trim() || release.tag_name,
				publishedAt: release.published_at ?? "",
				notes:
					kind === "mobile"
						? mobileNotesFromBody(body)
						: releaseNotesFromBody(body),
				url: release.html_url,
			};
		})
		.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

/** The commits of the default branch, merge commits left out. */
export const webCommitsFromList = (
	list: z.infer<typeof githubCommitList>,
): WebCommit[] =>
	list
		.filter((entry) => entry.parents.length < 2)
		.map((entry) => ({
			sha: entry.sha,
			shortSha: entry.sha.slice(0, 7),
			subject: entry.commit.message.split("\n", 1)[0]?.trim() ?? "",
			committedAt: entry.commit.committer?.date ?? "",
			url: entry.html_url,
		}));
