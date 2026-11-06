import {
	cachedRead,
	GithubPublicRateLimitError,
	githubPublicGet,
} from "@farmer/core/lib/github-public";
import {
	configuredSourceRepository,
	sourceRepository,
} from "@farmer/core/lib/source-repository";
import { z } from "zod";

import type { CliReleaseAsset } from "./cli-install";

/**
 * Where `/cli/download/<asset>` sends the install script: the public download
 * URL of one asset of the newest CLI release.
 *
 * The releases repository is meant to be public, so this reads the release
 * list with no token at all (`lib/github-public.ts`) and answers with the
 * asset's `browser_download_url`. GitHub redirects that once more, to its
 * storage, and the install script follows both. So the binary never passes
 * through this server, which would otherwise hold a request open for
 * megabytes it has no reason to see, under the 255 s `idleTimeout` in
 * `server.ts`.
 *
 * The scripts still ask THIS server rather than GitHub, because a deployment
 * installs the binaries its own operator points it at (`CLI_RELEASES_REPO`,
 * `lib/source-repository.ts`), and because the asset choice, the checksum and
 * the error text stay in one place.
 *
 * "Newest CLI release" is the most recently published release whose tag starts
 * with `cli-v`, skipping drafts and pre-releases. The lookup is cached for five
 * minutes per repository: an install fetches two or three assets and a team
 * installs in a burst, and GitHub's anonymous budget is 60 requests an hour per IP
 * address, shared with the contributors card. When GitHub refuses, the last
 * good answer keeps being served; with none, the cache stops asking until the
 * limit resets (`cachedRead`).
 *
 * A 404 on the release list means the repository is missing, for example a
 * fork whose `CLI_RELEASES_REPO` names a repository that does not exist.
 */

const RELEASE_TAG_PREFIX = "cli-v";
const RELEASE_CACHE_MS = 5 * 60 * 1000;

const releaseList = z.array(
	z.object({
		tag_name: z.string(),
		draft: z.boolean(),
		prerelease: z.boolean(),
		published_at: z.string().nullable(),
		assets: z.array(
			z.object({
				name: z.string(),
				browser_download_url: z.string(),
			}),
		),
	}),
);

type Release = z.infer<typeof releaseList>[number];

export type CliDownload =
	| { kind: "redirect"; location: string }
	/** `CLI_RELEASES_REPO` is not `owner/name`. */
	| { kind: "misconfigured"; value: string }
	/** GitHub has no public repository by that name. */
	| { kind: "no-repository"; repo: string }
	/** The repository exists, and no release matches. */
	| { kind: "no-release" }
	| { kind: "missing-asset"; tag: string }
	/** GitHub's anonymous budget is spent, with nothing cached to fall back on. */
	| { kind: "rate-limited"; retryAt: number }
	/** GitHub refused or failed. The detail is for the log, not the client. */
	| { kind: "upstream-error"; detail: string };

/** A 404 on the release list: the repository is missing. Cached like an
 *  answer, not an error, so a typo does not spend the budget. */
const NO_REPOSITORY = "no-repository";

const releases = cachedRead<Release | null | typeof NO_REPOSITORY>(
	RELEASE_CACHE_MS,
);

/** Clears the release cache. Tests only. */
export const clearCliReleaseCacheForTests = (): void => releases.clear();

/** Parses a release list straight off the `Response`, the I/O boundary,
 *  rather than taking already-decoded JSON — an `unknown` parameter is what
 *  `no-unknown-parameters` exists to catch. */
const parseReleaseList = async (response: Response): Promise<Release | null> =>
	releaseList
		.parse(await response.json())
		.filter(
			(candidate) =>
				!candidate.draft &&
				!candidate.prerelease &&
				candidate.tag_name.startsWith(RELEASE_TAG_PREFIX),
		)
		// Sorted rather than trusting the order: GitHub sorts by creation
		// date, and a release drafted early and published late is newer.
		.sort((a, b) =>
			(b.published_at ?? "").localeCompare(a.published_at ?? ""),
		)[0] ?? null;

const newestCliRelease = async (
	repo: string,
): Promise<Release | null | typeof NO_REPOSITORY> => {
	// The list is newest-first. `mobile-v*` releases pile up in the same list,
	// so ask for the largest page (100) to keep a cli-v release in it.
	const response = await githubPublicGet(
		`/repos/${repo}/releases?per_page=100`,
		"farmer-cli-installer",
	);
	if (response.status === 404) {
		await response.body?.cancel();
		return NO_REPOSITORY;
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`GitHub answered ${response.status} for the release list`);
	}
	return parseReleaseList(response);
};

/** Whether a download URL is a GitHub release download. The route redirects
 *  to it, so a URL anywhere else is refused rather than passed on. The path is
 *  not matched against `repo`: GitHub answers a renamed or moved repository
 *  under its new name. */
const isReleaseDownload = (url: string): boolean => {
	const parsed = URL.parse(url);
	return (
		parsed !== null &&
		parsed.origin === "https://github.com" &&
		/^\/[^/]+\/[^/]+\/releases\/download\//.test(parsed.pathname)
	);
};

export const resolveCliDownload = async (
	asset: CliReleaseAsset,
): Promise<CliDownload> => {
	const repo = sourceRepository();
	if (!repo) {
		return { kind: "misconfigured", value: configuredSourceRepository() };
	}

	try {
		const result = await releases.read(repo, () => newestCliRelease(repo));
		if (result === NO_REPOSITORY) return { kind: "no-repository", repo };
		if (!result) return { kind: "no-release" };
		const file = result.assets.find((candidate) => candidate.name === asset);
		if (!file) return { kind: "missing-asset", tag: result.tag_name };

		if (!isReleaseDownload(file.browser_download_url)) {
			return {
				kind: "upstream-error",
				detail: `GitHub gave ${file.browser_download_url} for ${asset} of ${result.tag_name}`,
			};
		}
		return { kind: "redirect", location: file.browser_download_url };
	} catch (error) {
		if (error instanceof GithubPublicRateLimitError) {
			return { kind: "rate-limited", retryAt: error.retryAt };
		}
		return {
			kind: "upstream-error",
			detail: error instanceof Error ? error.message : String(error),
		};
	}
};
