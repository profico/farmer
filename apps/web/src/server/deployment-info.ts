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
	DEFAULT_SOURCE_REPOSITORY,
	sourceRepository,
} from "@farmer/core/lib/source-repository";
import { z } from "zod";

/**
 * What this build is, and who built it — the two facts behind the contributors
 * card at the foot of Settings.
 *
 * Server-only, and deferred inside the handler of `server/about.ts` for the
 * client-bundle rule in apps/web/CLAUDE.md: it calls GitHub and reads `.git`.
 *
 * Both halves fail soft. A GitHub outage or a spent rate limit costs the
 * roster rather than the settings screen, so every failure here comes back as
 * an empty list rather than a throw.
 */

/** How long a roster is held per process.
 *
 *  Six hours, and long on purpose. Contributors change on the order of weeks,
 *  and the read is anonymous (`lib/github-public.ts`): 60 requests an hour per
 *  IP address, shared with the CLI downloads. `queries/about.ts` keeps the
 *  same figure so the browser does not ask for a copy the server is holding. */
const CONTRIBUTORS_CACHE_MS = 6 * 60 * 60 * 1000;

/** The ceiling on how many people the roster holds. It is a popover, not a
 *  page. */
const MAX_CONTRIBUTORS = 50;

/** How long a display name is held. A week: people rename themselves rarely,
 *  and each name costs one request from the anonymous budget. */
const NAME_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

/** The most names one roster refresh looks up. The rest show their login
 *  until a later refresh reaches them, so the first refresh costs at most
 *  eleven requests of the sixty, not fifty-one. Most commits first, so the
 *  faces on the card get their names before the tail of the list does. */
const NAME_LOOKUPS_PER_REFRESH = 10;

export type Contributor = {
	login: string;
	/** Their display name on GitHub, falling back to the login when they have
	 *  not set one, or when it has not been looked up yet. */
	name: string;
	avatarUrl: string;
	profileUrl: string;
	/** Commits on the default branch, which is what GitHub sorts this list by. */
	contributions: number;
};

export type DeploymentInfo = {
	/** Most commits first. Empty when GitHub refused, or when the repository is
	 *  not public — the card renders nothing rather than an error. */
	contributors: Contributor[];
	/** The commit this process is running, or null off a real build. */
	commit: { sha: string; shortSha: string; url: string } | null;
};

const contributorList = z.array(
	z.object({
		login: z.string(),
		avatar_url: z.string(),
		html_url: z.string(),
		contributions: z.number(),
		type: z.string(),
	}),
);

const userProfile = z.object({ name: z.string().nullable() });

const USER_AGENT = "farmer-about";

const rosters = cachedRead<Contributor[]>(CONTRIBUTORS_CACHE_MS);

/** Display names by login. `null` is "has none", which is an answer too. */
const names = new Map<string, { name: string | null; at: number }>();

/** One person's display name on GitHub, or null when they have not set one
 *  or GitHub does not answer for them. */
const lookUpName = async (login: string): Promise<string | null> => {
	const profile = await githubPublicGet(
		`/users/${encodeURIComponent(login)}`,
		USER_AGENT,
	);
	if (!profile.ok) {
		await profile.body?.cancel();
		return null;
	}
	return userProfile.parse(await profile.json()).name;
};

/**
 * The display names the roster shows, filling the cache for at most
 * `NAME_LOOKUPS_PER_REFRESH` people. One at a time, so a spent rate limit stops
 * the loop after one refused request rather than after ten.
 */
const resolveNames = async (logins: string[]): Promise<void> => {
	const now = Date.now();
	const due = logins
		.filter((login) => {
			const known = names.get(login);
			return !known || now - known.at >= NAME_CACHE_MS;
		})
		.slice(0, NAME_LOOKUPS_PER_REFRESH);
	for (const login of due) {
		try {
			names.set(login, { name: await lookUpName(login), at: Date.now() });
		} catch (error) {
			// A spent budget ends the round; anything else costs that one name.
			if (error instanceof GithubPublicRateLimitError) return;
		}
	}
};

/**
 * Everyone with a commit on the default branch, most commits first, read from
 * the public repository with no token.
 *
 * FALLBACK, until the repository is public: an anonymous 404 also means
 * "private", which this card should still show a roster for while the
 * repository has not gone public yet. So when the GitHub App is configured,
 * a 404 is retried with the App's installation token, narrowed to this one
 * repository (`getRepoContentsReadToken`, `lib/github-client.ts`). Remove
 * this fallback once the repository is public for good.
 */
const readContributors = async (): Promise<Contributor[]> => {
	const repo = sourceRepository();
	if (!repo) return [];
	return rosters.read(repo, async () => {
		const response = await githubPublicGet(
			`/repos/${repo}/contributors?per_page=100`,
			USER_AGENT,
		);
		if (response.status === 404) {
			await response.body?.cancel();
			return isGithubAppConfigured() ? readContributorsWithToken(repo) : [];
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error(
				`GitHub answered ${response.status} for the contributor list`,
			);
		}
		return projectContributors(response);
	});
};

/** Turns a raw `GET /repos/:repo/contributors` `Response` into the roster the
 *  card draws: bots dropped, sorted by commit count, capped, names resolved.
 *  Shared by the anonymous read and the token fallback below, which parse the
 *  same shape from two different requests. Parses straight off the `Response`
 *  — the I/O boundary — rather than taking already-decoded JSON, which
 *  `no-unknown-parameters` would otherwise flag as an unparsed `unknown`. */
const projectContributors = async (
	response: Response,
): Promise<Contributor[]> => {
	const people = contributorList
		.parse(await response.json())
		// Dependabot and the release workflow commit like anybody else, and a
		// card that says "built by" should not be counting them.
		.filter(
			(person) => person.type !== "Bot" && !person.login.endsWith("[bot]"),
		)
		// Sorted here rather than trusted: GitHub documents this endpoint as
		// descending by commit count, but the stack shows the top four and the
		// `+N` stands for everybody else, so the order IS the meaning of the
		// card. Sorting costs nothing and makes it true rather than documented.
		.sort((a, b) => b.contributions - a.contributions)
		.slice(0, MAX_CONTRIBUTORS);

	// The contributors endpoint carries no display name, and a roster of
	// logins is a list of handles rather than of people. Looked up a few at a
	// time and kept for a week (`resolveNames`).
	await resolveNames(people.map((person) => person.login));

	return people.map((person) => ({
		login: person.login,
		name: names.get(person.login)?.name || person.login,
		avatarUrl: person.avatar_url,
		profileUrl: person.html_url,
		contributions: person.contributions,
	}));
};

/** The FALLBACK read: the App's installation token in place of the anonymous
 *  request. `[]` when the App is not installed on this repository either —
 *  from here that reads the same as "no repository". See the module comment
 *  on `readContributors`. */
const readContributorsWithToken = async (
	repo: string,
): Promise<Contributor[]> => {
	const [owner, name] = repo.split("/");
	if (!owner || !name) return [];
	const token = await getRepoContentsReadToken(owner, name);
	if (!token) return [];
	const response = await externalFetch(
		`https://api.github.com/repos/${repo}/contributors?per_page=100`,
		{
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": USER_AGENT,
			},
		},
	);
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(
			`GitHub answered ${response.status} for the contributor list (fallback token)`,
		);
	}
	return projectContributors(response);
};

/**
 * The commit this build came from, asked for three ways.
 *
 * `GIT_SHA` is a plain environment variable rather than a `VITE_` one for the
 * reason the rest of them are: `vite build` runs inside the Docker image, so a
 * `VITE_` value could only ever be what CI was given. The Dockerfile takes it as
 * a build argument and CI passes `github.sha`.
 *
 * `SOURCE_COMMIT` is Coolify's, and it is here because it fails in a different
 * way. `GIT_SHA` is baked INTO the image, so an image built before the build
 * argument existed can never report one however it is deployed; `SOURCE_COMMIT`
 * is set ON the deployment, so it answers for exactly that case and for any
 * later one where the workflow stops passing the argument. Neither is a
 * substitute for the other, which is why both are read rather than one chosen.
 *
 * Off a build there is neither, so development reads `.git` directly — two
 * small file reads, once per process. Without it the line at the foot of
 * Settings would only ever appear in Docker, which is the one place nobody is
 * looking at it while they work on it.
 */
let resolvedSha: string | null | undefined;

const SHA = /^[0-9a-f]{40}$/;

/** What a commit id may look like coming off the environment. Wider than `SHA`
 *  because a platform is free to hand over the short form, and `shortSha`
 *  below truncates either one to the same seven characters. */
const ENV_SHA = /^[0-9a-f]{7,40}$/;

/**
 * The first environment variable that names a commit, in order of how much it
 * is trusted to be THIS build's.
 */
const shaFromEnvironment = (): string | null => {
	for (const name of ["GIT_SHA", "SOURCE_COMMIT"]) {
		const value = process.env[name]?.trim().toLowerCase();
		// Tested rather than taken: a platform that sets the variable to a branch
		// name or to an empty string would otherwise put that in the link.
		if (value && ENV_SHA.test(value)) return value;
	}
	return null;
};

const readShaFromGit = async (): Promise<string | null> => {
	try {
		const { readFile } = await import("node:fs/promises");
		const { dirname, isAbsolute, join, resolve } = await import("node:path");

		// Walked up from the cwd rather than read at `.git/HEAD`, because `vite
		// dev` runs its server functions with the cwd at `apps/web` and the
		// repository root is two levels above that. `bun run worker` starts from
		// `packages/core`. Both find it here; a bundled image finds nothing and
		// says so.
		let dir = resolve(process.cwd());
		let gitDir: string | null = null;
		for (;;) {
			const candidate = join(dir, ".git");
			// A worktree's `.git` is a FILE naming the real directory, not the
			// directory itself. One read tells the two apart.
			const head = await readFile(join(candidate, "HEAD"), "utf8").catch(
				async () => {
					const pointer = await readFile(candidate, "utf8").catch(() => null);
					const named = pointer?.match(/^gitdir: (.+)$/m)?.[1]?.trim();
					if (!named) return null;
					gitDir = isAbsolute(named) ? named : join(dir, named);
					return readFile(join(gitDir, "HEAD"), "utf8").catch(() => null);
				},
			);
			if (head !== null && head !== undefined) {
				gitDir ??= candidate;
				const trimmed = head.trim();
				const ref = trimmed.startsWith("ref: ") ? trimmed.slice(5) : null;
				// A detached HEAD holds the sha outright.
				if (!ref) return SHA.test(trimmed) ? trimmed : null;
				const sha = (await readFile(join(gitDir, ref), "utf8")).trim();
				return SHA.test(sha) ? sha : null;
			}
			const parent = dirname(dir);
			if (parent === dir) return null;
			dir = parent;
		}
	} catch {
		// No `.git` above the cwd (a bundled image), or a ref that has been packed
		// away into `packed-refs`. Both mean the same thing here: nothing to show.
		return null;
	}
};

/** The commit this process is running, or null off a real build. The
 *  Changelog reads it too, to list the web changes up to this build. */
export const readCommit = async (): Promise<DeploymentInfo["commit"]> => {
	if (resolvedSha === undefined) {
		resolvedSha =
			shaFromEnvironment() ??
			(process.env.NODE_ENV === "production" ? null : await readShaFromGit());
	}
	if (!resolvedSha) return null;
	return {
		sha: resolvedSha,
		shortSha: resolvedSha.slice(0, 7),
		url: `https://github.com/${sourceRepository() ?? DEFAULT_SOURCE_REPOSITORY}/commit/${resolvedSha}`,
	};
};

export const readDeploymentInfo = async (): Promise<DeploymentInfo> => {
	const [contributors, commit] = await Promise.all([
		readContributors().catch(() => []),
		readCommit(),
	]);
	return { contributors, commit };
};
