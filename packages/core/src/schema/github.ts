import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");

export const linkProjectRepoInput = z.object({
	projectId: z.uuid(),
	githubRepoId: z.coerce.number().int(),
	// Which connected installation this repo came from — determines the token
	// used to read its commits later.
	installationId: z.coerce.number().int(),
});
export type LinkProjectRepoInput = z.infer<typeof linkProjectRepoInput>;

export const connectInstallationInput = z.object({
	installationId: z.coerce.number().int(),
});
export type ConnectInstallationInput = z.infer<typeof connectInstallationInput>;

// Disconnecting takes the installation away from THIS workspace. `uninstall`
// additionally removes the App from the GitHub account, for everybody — a
// different act with a different blast radius, so it is a separate, opt-in
// field rather than the meaning of the same button.
export const disconnectInstallationInput = z.object({
	installationRowId: z.uuid(),
	uninstall: z.boolean().default(false),
});
export type DisconnectInstallationInput = z.infer<
	typeof disconnectInstallationInput
>;

// A webhook delivery body, narrowed to what `api/github/webhook` acts on.
// GitHub sends far more than these two fields, and more events than the route
// subscribes to, so a payload this does not describe is answered "not handled"
// rather than as an error — an error status makes GitHub retry a delivery that
// will never parse, and mark the endpoint as failing.
export const githubWebhookPayload = z.object({
	action: z.string().optional(),
	installation: z.object({ id: z.number().int() }).optional(),
});
export type GithubWebhookPayload = z.infer<typeof githubWebhookPayload>;

export const unlinkProjectRepoInput = z.uuid();
export type UnlinkProjectRepoInput = z.infer<typeof unlinkProjectRepoInput>;

export const listProjectReposInput = z.uuid();
export type ListProjectReposInput = z.infer<typeof listProjectReposInput>;

// A GitHub `owner/name`, as `farmer init` reads it off a git remote — never a
// full URL, since parsing that is the CLI's job, not the server's.
export const repositoryProjectsInput = z.object({
	repository: z
		.string()
		.trim()
		.regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
});
export type RepositoryProjectsInput = z.infer<typeof repositoryProjectsInput>;

export const listAttachedCommitsInput = z.uuid();
export type ListAttachedCommitsInput = z.infer<typeof listAttachedCommitsInput>;

export const detachCommitInput = z.uuid();
export type DetachCommitInput = z.infer<typeof detachCommitInput>;

export const suggestCommitsInput = z.object({
	projectId: z.uuid(),
	date: dateKey,
});
export type SuggestCommitsInput = z.infer<typeof suggestCommitsInput>;

// The same scan over a span of days.
//
// `suggestCommitsInput` is day-shaped because the day assembler is: it opens on
// one date and proposes what belongs on it. Reconstructing a WEEK from commits
// through a day-shaped read costs seven round trips, and an assistant turn gets
// eight — so the interaction that motivated the feature could exhaust its step
// budget before it wrote a single entry.
//
// Bounded well below the 62-day entry ceiling because the cost here is not a
// query: every day in the span fans out across every repo linked anywhere in
// the org, against GitHub's API and its rate limit. A month is the longest span
// anyone reconstructs in one go.
const MAX_COMMIT_SCAN_DAYS = 31;

export const userCommitsRangeInput = z
	.object({ from: dateKey, to: dateKey })
	.refine((data) => data.from <= data.to, {
		message: "from must not be after to",
		path: ["to"],
	})
	.refine(
		(data) => {
			const from = new Date(`${data.from}T00:00:00Z`).getTime();
			const to = new Date(`${data.to}T00:00:00Z`).getTime();
			return (to - from) / 86_400_000 <= MAX_COMMIT_SCAN_DAYS;
		},
		{
			message: `Range too large (max ${MAX_COMMIT_SCAN_DAYS} days)`,
			path: ["to"],
		},
	);
export type UserCommitsRangeInput = z.infer<typeof userCommitsRangeInput>;

// A commit id, abbreviated or full. Constrained because `attachCommits` puts it
// into a GitHub API PATH (`/repos/{owner}/{repo}/commits/{sha}`), and that
// endpoint also resolves branch and tag names — so a free string attached
// "evidence" that was whatever a branch pointed at, and a `../` in it walked
// the installation token onto another endpoint entirely.
export const commitSha = z
	.string()
	.regex(/^[0-9a-f]{7,40}$/i, "Expected a commit SHA");

export const attachCommitsInput = z.object({
	timeEntryId: z.uuid(),
	commits: z
		.array(
			z.object({
				projectGithubRepoId: z.uuid(),
				sha: commitSha,
			}),
		)
		.min(1),
});
export type AttachCommitsInput = z.infer<typeof attachCommitsInput>;

// ── Pull requests ──────────────────────────────────────────────────────────
// Same shapes as the commit reads: one project on one day for the entry
// dialog, a span of days for the assistant.
export const suggestPullRequestsInput = suggestCommitsInput;
export type SuggestPullRequestsInput = SuggestCommitsInput;

export const userPullRequestsRangeInput = userCommitsRangeInput;
export type UserPullRequestsRangeInput = UserCommitsRangeInput;

export const listAttachedPullRequestsInput = z.uuid();
export type ListAttachedPullRequestsInput = z.infer<
	typeof listAttachedPullRequestsInput
>;

export const detachPullRequestActivityInput = z.uuid();
export type DetachPullRequestActivityInput = z.infer<
	typeof detachPullRequestActivityInput
>;

// A pull request is named by its repo row and number, and nothing the caller
// says about it is stored: the service reads the PR again and keeps only the
// caller's own events on the entry's day. Capped, because each one is a call to
// GitHub.
export const pullRequestRef = z.object({
	projectGithubRepoId: z.uuid(),
	number: z.coerce.number().int().positive(),
});

export const attachPullRequestsInput = z.object({
	timeEntryId: z.uuid(),
	pullRequests: z.array(pullRequestRef).min(1).max(50),
});
export type AttachPullRequestsInput = z.infer<typeof attachPullRequestsInput>;
