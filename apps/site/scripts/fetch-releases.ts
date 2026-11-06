/// <reference types="bun-types" />
import {
	EMPTY_RELEASE_DATA,
	githubCommitList,
	githubReleaseList,
	releaseNotesFromList,
	webCommitsFromList,
	type ReleaseData,
} from "../src/lib/release-notes.ts";

/**
 * Reads the releases and the recent commits of the repository from GitHub and
 * writes `src/generated/releases.json`, which the Changelog and the front page
 * import. It runs at the start of `bun run build`.
 *
 * `GITHUB_TOKEN` is used when set, to avoid the anonymous rate limit. On a
 * network error or a rate limit the script prints a warning and writes empty
 * data, so a build never fails for GitHub. `SITE_STRICT_RELEASES=1` turns that
 * warning into a failure, which is what the image build sets.
 */

const REPOSITORY = "profico/farmer";
const OUTPUT = new URL("../src/generated/releases.json", import.meta.url);
const RELEASE_LIMIT = 30;
const COMMIT_LIMIT = 60;

const headers = (): Headers => {
	const result = new Headers({
		Accept: "application/vnd.github+json",
		"User-Agent": "farmer-site-build",
		"X-GitHub-Api-Version": "2022-11-28",
	});
	const token = process.env.GITHUB_TOKEN;
	if (token) result.set("Authorization", `Bearer ${token}`);
	return result;
};

const get = async (path: string) => {
	const response = await fetch(`https://api.github.com${path}`, {
		headers: headers(),
	});
	if (!response.ok) {
		throw new Error(`GitHub answered ${response.status} for ${path}`);
	}
	return response.json();
};

const readData = async (): Promise<ReleaseData> => {
	const [releases, commits] = await Promise.all([
		get(`/repos/${REPOSITORY}/releases?per_page=${RELEASE_LIMIT}`),
		get(`/repos/${REPOSITORY}/commits?per_page=${COMMIT_LIMIT}`),
	]);
	return {
		releases: releaseNotesFromList(githubReleaseList.parse(releases)),
		commits: webCommitsFromList(githubCommitList.parse(commits)),
	};
};

const main = async () => {
	let data = EMPTY_RELEASE_DATA;
	try {
		data = await readData();
		console.log(
			`[releases] ${data.releases.length} releases, ${data.commits.length} commits`,
		);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		if (process.env.SITE_STRICT_RELEASES === "1") {
			console.error(`[releases] ${reason}`);
			process.exit(1);
		}
		console.warn(`[releases] warning: no release data (${reason})`);
	}
	await Bun.write(OUTPUT, `${JSON.stringify(data, null, "\t")}\n`);
};

await main();
