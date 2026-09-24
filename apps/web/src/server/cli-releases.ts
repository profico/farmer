import {
	getRepoContentsReadToken,
	isGithubAppConfigured,
} from "@farmer/core/lib/github-client";
import {
	cachedRead,
	GithubPublicRateLimitError,
	githubPublicGet,
} from "@farmer/core/lib/github-public";
import { externalFetch } from "@farmer/core/lib/http";
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
 * FALLBACK, until the repository is public: an anonymous 404 means "missing
 * or private", and this cannot tell the two apart with no token. So when the
 * GitHub App is configured, a 404 is retried with the App's installation
 * token (`getRepoContentsReadToken`), narrowed to this one repository. A
 * private repo answers a private asset with its API `url`, not the public
 * `browser_download_url`, so that request also carries the token and follows
 * GitHub's redirect to a short-lived signed URL rather than reading the body.
 * Remove this whole fallback (and `getRepoContentsReadToken`) once the
 * repository is public for good.
 */

const RELEASE_TAG_PREFIX = "cli-v";
const RELEASE_CACHE_MS = 5 * 60 * 1000;
const GITHUB_API = "https://api.github.com";

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
				// Only read on the token fallback path (`signedAssetUrl`), where a
				// private asset needs the API url rather than the public one. GitHub
				// always sends it; optional so a test fixture built for the public
				// path (which never reads it) does not have to carry a field it
				// never uses.
				url: z.string().optional(),
			}),
		),
	}),
);

type Release = z.infer<typeof releaseList>[number];

/** A release read with the App's fallback token also carries the token, so
 *  the asset lookup can ask GitHub's authenticated download endpoint instead
 *  of the public `browser_download_url` a private repository will not serve
 *  anonymously. */
type ReleaseRead = { release: Release; token: string | null };

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

/** A 404 on the release list: the repository is missing or private. Cached
 *  like an answer, not an error, so a typo does not spend the budget. */
const NO_REPOSITORY = "no-repository";

const releases = cachedRead<ReleaseRead | null | typeof NO_REPOSITORY>(
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

/** The FALLBACK read: the App's installation token, narrowed to this one
 *  repository, in place of the anonymous request. Only tried when the
 *  anonymous read answered 404 and the App is configured — see the module
 *  comment. `null` means the App is not installed on this repository either,
 *  which reads the same as "no repository" from here. */
const newestCliReleaseWithToken = async (
	repo: string,
): Promise<ReleaseRead | null | typeof NO_REPOSITORY> => {
	const [owner, name] = repo.split("/");
	if (!owner || !name) return NO_REPOSITORY;
	const token = await getRepoContentsReadToken(owner, name);
	if (!token) return NO_REPOSITORY;
	const response = await externalFetch(
		`${GITHUB_API}/repos/${repo}/releases?per_page=30`,
		{
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": "farmer-cli-installer",
			},
		},
	);
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(
			`GitHub answered ${response.status} for the release list (fallback token)`,
		);
	}
	const release = await parseReleaseList(response);
	return release ? { release, token } : null;
};

const newestCliRelease = async (
	repo: string,
): Promise<ReleaseRead | null | typeof NO_REPOSITORY> => {
	// The list is newest-first, and 30 releases is far more history than a
	// single cli-v line needs to find its latest in, even with app releases
	// interleaved.
	const response = await githubPublicGet(
		`/repos/${repo}/releases?per_page=30`,
		"farmer-cli-installer",
	);
	if (response.status === 404) {
		await response.body?.cancel();
		return isGithubAppConfigured()
			? newestCliReleaseWithToken(repo)
			: NO_REPOSITORY;
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`GitHub answered ${response.status} for the release list`);
	}
	const release = await parseReleaseList(response);
	return release ? { release, token: null } : null;
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

/** The signed, short-lived download URL for a private asset: GitHub's
 *  authenticated asset endpoint answers a 302 to it, which this follows once
 *  (`redirect: "manual"`) without ever reading the body. Only used on the
 *  fallback path — see the module comment. */
const signedAssetUrl = async (
	assetUrl: string,
	token: string,
	asset: CliReleaseAsset,
	tag: string,
): Promise<CliDownload> => {
	const response = await externalFetch(assetUrl, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/octet-stream",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "farmer-cli-installer",
		},
		redirect: "manual",
	});
	const location = response.headers.get("location");
	if (
		response.status >= 300 &&
		response.status < 400 &&
		location?.startsWith("https://")
	) {
		await response.body?.cancel();
		return { kind: "redirect", location };
	}
	await response.body?.cancel();
	return {
		kind: "upstream-error",
		detail: `GitHub answered ${response.status} for asset ${asset} of ${tag}`,
	};
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
		const { release, token } = result;
		const file = release.assets.find((candidate) => candidate.name === asset);
		if (!file) return { kind: "missing-asset", tag: release.tag_name };

		if (token) {
			// The token goes only to GitHub's own API, whatever the list said.
			if (!file.url?.startsWith(`${GITHUB_API}/`)) {
				return {
					kind: "upstream-error",
					detail: `GitHub gave no API url for ${asset} of ${release.tag_name}`,
				};
			}
			return signedAssetUrl(file.url, token, asset, release.tag_name);
		}
		if (!isReleaseDownload(file.browser_download_url)) {
			return {
				kind: "upstream-error",
				detail: `GitHub gave ${file.browser_download_url} for ${asset} of ${release.tag_name}`,
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
