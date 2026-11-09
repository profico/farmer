import { z } from "zod";

/**
 * What the Changelog and the front page's "latest release" pill show. The
 * build script (`scripts/fetch-releases.ts`) reads GitHub and writes
 * `src/generated/releases.json`; this module holds the shapes and the parsing
 * that both the script and the pages use. It has no network code.
 */

export const releaseNoteSchema = z.object({
	tag: z.string(),
	/** What the Changelog filters by. A `cli-v…` tag is the CLI; anything else
	 *  is the web app. */
	kind: z.enum(["web", "cli"]),
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

export type CommitKind = "web" | "mobile" | "cli";

/** The app a commit is for, from its conventional-commit scope:
 *  `fix(mobile): …` is the mobile app, `feat(cli): …` the CLI, all else web. */
export const commitKind = (subject: string): CommitKind => {
	const scope = /^\w+\((mobile|cli)\)!?:/.exec(subject)?.[1];
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
	tag.startsWith("cli-") ? "cli" : "web";

const versionOf = (tag: string): string => tag.replace(/^(cli-)?v/, "");

/** Published releases, newest first. A `mobile-` tag is the store app. It has
 *  no place in the changelog, so it is left out. */
export const releaseNotesFromList = (
	list: z.infer<typeof githubReleaseList>,
): ReleaseNote[] =>
	list
		.filter(
			(release) =>
				!release.draft &&
				release.published_at &&
				!release.tag_name.startsWith("mobile-"),
		)
		.map((release) => ({
			tag: release.tag_name,
			kind: kindOf(release.tag_name),
			version: versionOf(release.tag_name),
			title: release.name?.trim() || release.tag_name,
			publishedAt: release.published_at ?? "",
			notes: releaseNotesFromBody(release.body ?? ""),
			url: release.html_url,
		}))
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
