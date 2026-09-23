import {
	getRepoContentsReadToken,
	isGithubAppConfigured,
} from "@farmer/core/lib/github-client";
import { externalFetch } from "@farmer/core/lib/http";
import { setting } from "@farmer/core/lib/instance-settings";
import { z } from "zod";

import type { CliReleaseAsset } from "./cli-install";

/**
 * Where `/cli/download/<asset>` sends the install script: GitHub's signed,
 * short-lived URL for one asset of the newest CLI release.
 *
 * The repository is private, so the script cannot read releases itself. This
 * server can, through the GitHub App it already holds for the commit sync
 * (`GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY`), provided the App is installed on
 * the repository with Contents: read. It mints an installation token narrowed to
 * that one repository and that one permission (`getRepoContentsReadToken`) and
 * uses it for exactly two requests: the release list, and the asset's API URL,
 * which GitHub answers with a 302 to a signed download link. The route passes
 * that `Location` on. So:
 *
 *  - the token never leaves this process — the client is redirected to a URL
 *    that carries its own short-lived signature instead;
 *  - the binary never passes through this server, which would otherwise hold
 *    a request open for megabytes it has no reason to see, under the 255 s
 *    `idleTimeout` in `server.ts`.
 *
 * "Newest CLI release" is the most recently published release whose tag starts
 * with `cli-v`, skipping drafts and pre-releases. The lookup is cached for five
 * minutes per process: an install fetches two assets and a team installs in a
 * burst, and every uncached lookup spends from the installation's hourly API
 * budget, which the commit sync shares. The signed `Location` is never cached,
 * because GitHub expires it within minutes. A failed lookup is not cached
 * either, so a fixed installation works on the next try.
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
		assets: z.array(z.object({ name: z.string(), url: z.string() })),
	}),
);

type Release = z.infer<typeof releaseList>[number];

export type CliDownload =
	| { kind: "redirect"; location: string }
	/** No GitHub App credentials on this deployment. */
	| { kind: "unconfigured" }
	/** The App is configured, and not installed on the releases repository. */
	| { kind: "not-installed"; repo: string }
	/** The App can read the repository, and no release matches. */
	| { kind: "no-release" }
	| { kind: "missing-asset"; tag: string }
	/** GitHub refused or failed. The detail is for the log, not the client. */
	| { kind: "upstream-error"; detail: string };

let cache: {
	repo: string;
	fetchedAt: number;
	release: Release | null;
} | null = null;

const githubHeaders = (token: string, accept: string) => ({
	Authorization: `Bearer ${token}`,
	Accept: accept,
	"X-GitHub-Api-Version": "2022-11-28",
	"User-Agent": "farmer-cli-installer",
});

const newestCliRelease = async (
	repo: string,
	token: string,
): Promise<Release | null> => {
	if (
		cache &&
		cache.repo === repo &&
		Date.now() - cache.fetchedAt < RELEASE_CACHE_MS
	) {
		return cache.release;
	}
	// The list is newest-first, and 30 releases is far more history than a
	// single cli-v line needs to find its latest in, even with app releases
	// interleaved.
	const response = await externalFetch(
		`${GITHUB_API}/repos/${repo}/releases?per_page=30`,
		{ headers: githubHeaders(token, "application/vnd.github+json") },
	);
	if (!response.ok) {
		throw new Error(`GitHub answered ${response.status} for the release list`);
	}
	const releases = releaseList.parse(await response.json());
	const release =
		releases
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
	cache = { repo, fetchedAt: Date.now(), release };
	return release;
};

export const resolveCliDownload = async (
	asset: CliReleaseAsset,
): Promise<CliDownload> => {
	if (!isGithubAppConfigured()) return { kind: "unconfigured" };
	const repo = setting("CLI_RELEASES_REPO")?.trim() || "profico/farmer";
	const [owner, name] = repo.split("/");
	if (!owner || !name) {
		return {
			kind: "upstream-error",
			detail: `CLI_RELEASES_REPO is "${repo}", not owner/name`,
		};
	}

	try {
		const token = await getRepoContentsReadToken(owner, name);
		if (!token) return { kind: "not-installed", repo };

		const release = await newestCliRelease(repo, token);
		if (!release) return { kind: "no-release" };
		const file = release.assets.find((candidate) => candidate.name === asset);
		if (!file) return { kind: "missing-asset", tag: release.tag_name };

		// `redirect: "manual"` is the point: followed, this request would
		// download the binary into this process. A server-side fetch sees the
		// 302 and its `Location` in full; only a browser gets an opaque answer.
		const response = await externalFetch(file.url, {
			headers: githubHeaders(token, "application/octet-stream"),
			redirect: "manual",
		});
		const location = response.headers.get("location");
		if (response.status >= 300 && response.status < 400 && location) {
			return { kind: "redirect", location };
		}
		// Do not fall back to streaming a 200 body: that is exactly the proxying
		// this module exists to avoid. It has never been GitHub's answer.
		await response.body?.cancel();
		return {
			kind: "upstream-error",
			detail: `GitHub answered ${response.status} for asset ${asset} of ${release.tag_name}`,
		};
	} catch (error) {
		return {
			kind: "upstream-error",
			detail: error instanceof Error ? error.message : String(error),
		};
	}
};
