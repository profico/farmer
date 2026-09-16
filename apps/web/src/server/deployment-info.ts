import {
	getRepoContentsReadToken,
	isGithubAppConfigured,
} from "@farmer/core/lib/github-client";
import { externalFetch } from "@farmer/core/lib/http";
import { z } from "zod";

/**
 * What this build is, and who built it — the two facts behind the contributors
 * card at the foot of Settings.
 *
 * Server-only, and deliberately NOT imported at the top of `server/about.ts`:
 * `lib/github-client` reaches `node:crypto` at module scope, which is the
 * client-bundle rule in apps/web/CLAUDE.md. The server function defers this module
 * inside its handler.
 *
 * Both halves fail soft. A deployment with no GitHub App still runs, and a
 * GitHub outage costs the roster rather than the settings screen, so every
 * failure here comes back as an empty list rather than a throw.
 */

const GITHUB_API = "https://api.github.com";

/** How long a roster is held per process.
 *
 *  Six hours, and long on purpose. Contributors change on the order of weeks,
 *  and one refresh is not one request: it is the list plus a `/users/:login`
 *  read per person, up to fifty-one calls against the installation's hourly
 *  budget that the commit sync also spends from. `queries/about.ts` keeps the
 *  same figure so the browser does not ask for a copy the server is holding. */
const CONTRIBUTORS_CACHE_MS = 6 * 60 * 60 * 1000;

/** The ceiling on how many people are looked up by name below. The roster is a
 *  popover, not a page, and one `/users/:login` request per contributor is what
 *  turns a login into a person's name. */
const MAX_CONTRIBUTORS = 50;

export type Contributor = {
	login: string;
	/** Their display name on GitHub, falling back to the login when they have
	 *  not set one. */
	name: string;
	avatarUrl: string;
	profileUrl: string;
	/** Commits on the default branch, which is what GitHub sorts this list by. */
	contributions: number;
};

export type DeploymentInfo = {
	/** Most commits first. Empty when the App is unconfigured, uninstalled, or
	 *  GitHub refused — the card renders nothing rather than an error. */
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

const githubHeaders = (token: string) => ({
	Authorization: `Bearer ${token}`,
	Accept: "application/vnd.github+json",
	"X-GitHub-Api-Version": "2022-11-28",
	"User-Agent": "farmer-about",
});

let cache: { repo: string; fetchedAt: number; rows: Contributor[] } | null =
	null;

/** The repository this deployment is built from. The same one the CLI's
 *  releases come off, because it is the same repository — see
 *  `server/cli-releases.ts`. */
export const sourceRepo = (): string =>
	process.env.CLI_RELEASES_REPO?.trim() || "profico/farmer";

/**
 * Everyone with a commit on the default branch, most commits first.
 *
 * The repository is private, so the browser cannot read this and neither can an
 * unauthenticated server. It goes through the GitHub App the commit sync and
 * the CLI installer already use, with a token narrowed to this one repository.
 */
const readContributors = async (): Promise<Contributor[]> => {
	if (!isGithubAppConfigured()) return [];
	const repo = sourceRepo();
	if (
		cache &&
		cache.repo === repo &&
		Date.now() - cache.fetchedAt < CONTRIBUTORS_CACHE_MS
	) {
		return cache.rows;
	}

	const [owner, name] = repo.split("/");
	if (!owner || !name) return [];

	const token = await getRepoContentsReadToken(owner, name);
	if (!token) return [];

	const response = await externalFetch(
		`${GITHUB_API}/repos/${repo}/contributors?per_page=100`,
		{ headers: githubHeaders(token) },
	);
	if (!response.ok) {
		throw new Error(
			`GitHub answered ${response.status} for the contributor list`,
		);
	}
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

	// The contributors endpoint carries no display name, and a roster of logins
	// is a list of handles rather than of people. One request each, settled
	// individually so a single 404 (a deleted account) costs that one name and
	// not the list. Bounded by MAX_CONTRIBUTORS and cached for an hour.
	const names = await Promise.allSettled(
		people.map(async (person) => {
			const profile = await externalFetch(
				`${GITHUB_API}/users/${person.login}`,
				{ headers: githubHeaders(token) },
			);
			if (!profile.ok) return null;
			return userProfile.parse(await profile.json()).name;
		}),
	);

	const rows = people.map((person, index) => {
		const resolved = names[index];
		const displayName =
			resolved?.status === "fulfilled" ? resolved.value : null;
		return {
			login: person.login,
			name: displayName || person.login,
			avatarUrl: person.avatar_url,
			profileUrl: person.html_url,
			contributions: person.contributions,
		};
	});
	cache = { repo, fetchedAt: Date.now(), rows };
	return rows;
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

const readCommit = async (): Promise<DeploymentInfo["commit"]> => {
	if (resolvedSha === undefined) {
		resolvedSha =
			shaFromEnvironment() ??
			(process.env.NODE_ENV === "production" ? null : await readShaFromGit());
	}
	if (!resolvedSha) return null;
	return {
		sha: resolvedSha,
		shortSha: resolvedSha.slice(0, 7),
		url: `https://github.com/${sourceRepo()}/commit/${resolvedSha}`,
	};
};

export const readDeploymentInfo = async (): Promise<DeploymentInfo> => {
	const [contributors, commit] = await Promise.all([
		readContributors().catch(() => []),
		readCommit(),
	]);
	return { contributors, commit };
};
