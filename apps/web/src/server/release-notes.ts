import { cachedRead, githubPublicGet } from "@farmer/core/lib/github-public";
import { sourceRepository } from "@farmer/core/lib/source-repository";
import { z } from "zod";

/**
 * What the public Changelog and the front page's "latest release" pill show,
 * read from the source repository on GitHub: the releases (only the CLI is
 * released today), and for the web app the commits on the default branch.
 * The web app is deployed from a commit, not a tag, so its history is the
 * commit log, with the commit this server runs marked.
 *
 * Server-only, and deferred inside the handlers of `server/releases.ts` for the
 * client-bundle rule in apps/web/CLAUDE.md.
 *
 * The pages are public, so anybody can make this read happen. That is why it
 * is cached for fifteen minutes per repository (`cachedRead`): four requests an
 * hour at most, out of the anonymous budget of sixty that the CLI downloads and
 * the contributors card share. It fails soft — a refusal with nothing cached
 * is an empty list, and the Changelog says so, rather than a broken page.
 */

const RELEASE_NOTES_CACHE_MS = 15 * 60 * 1000;

/** How many commits the Changelog lists. The rest are one link away. */
const WEB_COMMIT_LIMIT = 60;

/** What the Changelog filters by. A `cli-v…` tag is the CLI; anything else is
 *  the web app. */
export type ReleaseKind = "web" | "cli";

export type ReleaseNote = {
	tag: string;
	kind: ReleaseKind;
	/** The version without its prefix: `cli-v0.4.1` is `0.4.1`. */
	version: string;
	/** The release name, or the tag when the release has none. */
	title: string;
	/** ISO timestamp. */
	publishedAt: string;
	/** The body's top-level `- ` bullets, as plain text. */
	notes: string[];
	url: string;
};

const releaseList = z.array(
	z.object({
		tag_name: z.string(),
		name: z.string().nullable(),
		body: z.string().nullable(),
		draft: z.boolean(),
		published_at: z.string().nullable(),
		html_url: z.string(),
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

const readReleaseNotes = async (repo: string): Promise<ReleaseNote[]> => {
	const response = await githubPublicGet(
		`/repos/${repo}/releases?per_page=30`,
		"farmer-changelog",
	);
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`GitHub answered ${response.status} for the release list`);
	}
	return releaseList
		.parse(await response.json())
		.filter((release) => !release.draft && release.published_at)
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
};

const cache = cachedRead<ReleaseNote[]>(RELEASE_NOTES_CACHE_MS);

/** Newest first. Empty when GitHub refused and nothing was cached. */
export const listReleaseNotes = async (): Promise<ReleaseNote[]> => {
	const repo = sourceRepository();
	if (!repo) return [];
	try {
		return await cache.read(repo, () => readReleaseNotes(repo));
	} catch (error) {
		console.warn(
			`[changelog] no release notes for ${repo}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
};

export type WebCommit = {
	sha: string;
	shortSha: string;
	/** The first line of the message. */
	subject: string;
	/** ISO timestamp of the commit, as the committer dated it. */
	committedAt: string;
	url: string;
	/** Whether this server runs this commit. At most one is. */
	deployed: boolean;
};

export type WebChanges = {
	/** The commit this server runs, or null when it cannot tell (see
	 *  `readCommit`). It may be missing from `commits`: older than the list,
	 *  or never pushed (a development server, a fork read against upstream). */
	deployed: { sha: string; shortSha: string; url: string } | null;
	/** The default branch, newest first, merge commits left out. Commits above
	 *  the deployed one are not on this server yet. */
	commits: WebCommit[];
};

const commitList = z.array(
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

type BranchCommit = Omit<WebCommit, "deployed">;

const readCommits = async (repo: string): Promise<BranchCommit[]> => {
	const response = await githubPublicGet(
		`/repos/${repo}/commits?per_page=${WEB_COMMIT_LIMIT}`,
		"farmer-changelog",
	);
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`GitHub answered ${response.status} for the commit list`);
	}
	return commitList
		.parse(await response.json())
		.filter((entry) => entry.parents.length < 2)
		.map((entry) => ({
			sha: entry.sha,
			shortSha: entry.sha.slice(0, 7),
			subject: entry.commit.message.split("\n", 1)[0]?.trim() ?? "",
			committedAt: entry.commit.committer?.date ?? "",
			url: entry.html_url,
		}));
};

const commitCache = cachedRead<BranchCommit[]>(RELEASE_NOTES_CACHE_MS);

/**
 * Every recent commit on the default branch, with the one this server runs
 * marked. One cached list for every deployment of the same repository,
 * whatever commit each runs. Empty `commits` when GitHub refused and nothing
 * was cached.
 */
export const listWebChanges = async (): Promise<WebChanges> => {
	const { readCommit } = await import("./deployment-info");
	const deployed = await readCommit();
	const repo = sourceRepository();
	if (!repo) return { deployed, commits: [] };
	try {
		const commits = await commitCache.read(repo, () => readCommits(repo));
		return {
			deployed,
			commits: commits.map((commit) => ({
				...commit,
				deployed: commit.sha === deployed?.sha,
			})),
		};
	} catch (error) {
		console.warn(
			`[changelog] no commits for ${repo}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return { deployed, commits: [] };
	}
};
