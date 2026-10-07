import { z } from "zod";

import { dayKeySchema } from "./day-key";

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

// An admin confirming an installation that GitHub sent back with no signed
// state. It names the workspace the page showed, because the server function
// otherwise acts on the session's active one, which another tab may have moved.
export const confirmInstallationInput = connectInstallationInput.extend({
	organizationId: z.string().min(1),
});
export type ConfirmInstallationInput = z.infer<typeof confirmInstallationInput>;

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
	date: dayKeySchema,
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

const fromNotAfterTo = (data: { from: string; to: string }) =>
	data.from <= data.to;

const withinScanSpan = (data: { from: string; to: string }) => {
	const from = new Date(`${data.from}T00:00:00Z`).getTime();
	const to = new Date(`${data.to}T00:00:00Z`).getTime();
	return (to - from) / 86_400_000 <= MAX_COMMIT_SCAN_DAYS;
};

export const userCommitsRangeInput = z
	.object({ from: dayKeySchema, to: dayKeySchema })
	.refine(fromNotAfterTo, {
		message: "from must not be after to",
		path: ["to"],
	})
	.refine(withinScanSpan, {
		message: `Range too large (max ${MAX_COMMIT_SCAN_DAYS} days)`,
		path: ["to"],
	});
export type UserCommitsRangeInput = z.infer<typeof userCommitsRangeInput>;

// A commit id, abbreviated or full. Constrained because `attachCommits` puts it
// into a GitHub API PATH (`/repos/{owner}/{repo}/commits/{sha}`), and that
// endpoint also resolves branch and tag names — so a free string attached
// "evidence" that was whatever a branch pointed at, and a `../` in it walked
// the installation token onto another endpoint entirely.
export const commitSha = z
	.string()
	.regex(/^[0-9a-f]{7,40}$/i, "Expected a commit SHA");

// The evidence already attached to the person's own entries, over the entry
// dates. It reads the database only, so the span has the same ceiling as the
// GitHub reads for one reason: a longer span is more rows than a model reads.
// `repository` is `owner/name`, matched without regard to case.
export const attachedEvidenceRangeInput = z
	.object({
		from: dayKeySchema,
		to: dayKeySchema,
		repository: repositoryProjectsInput.shape.repository.optional(),
		// One entry's evidence. The dates still bound the read.
		timeEntryId: z.uuid().optional(),
	})
	.refine(fromNotAfterTo, {
		message: "from must not be after to",
		path: ["to"],
	})
	.refine(withinScanSpan, {
		message: `Range too large (max ${MAX_COMMIT_SCAN_DAYS} days)`,
		path: ["to"],
	});
export type AttachedEvidenceRangeInput = z.infer<
	typeof attachedEvidenceRangeInput
>;

// How many attachments one unlink call may name. A session is a few dozen
// commits. A larger batch is more than a person reads on one approval card.
export const MAX_UNLINK_PER_CALL = 100;

// Any string, not a uuid: a model can send one malformed id among good ones,
// and the tool reports that id as not found and unlinks the rest. A uuid
// check here refused the whole call.
export const unlinkCommitsInput = z.object({
	attachmentIds: z.array(z.string()).min(1).max(MAX_UNLINK_PER_CALL),
});
export type UnlinkCommitsInput = z.infer<typeof unlinkCommitsInput>;

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

// Any string, for the reason `unlinkCommitsInput` gives.
export const unlinkPullRequestsInput = z.object({
	activityIds: z.array(z.string()).min(1).max(MAX_UNLINK_PER_CALL),
});
export type UnlinkPullRequestsInput = z.infer<typeof unlinkPullRequestsInput>;

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

// The repos the assistant lists to link. One installation can show hundreds of
// repos, so the read takes a filter, and the tool caps what it returns.
export const listAvailableReposInput = z.object({
	query: z.string().trim().max(100).optional(),
	onlyUnlinked: z.boolean().optional(),
});
export type ListAvailableReposInput = z.infer<typeof listAvailableReposInput>;

// An unlink names the project as well as the repo row. The assistant shows
// both on its approval card, and the tool refuses a row that is not on that
// project, so a wrong id cannot unlink some other project's repo.
export const unlinkGithubRepoInput = z.object({
	projectId: z.uuid(),
	projectGithubRepoId: unlinkProjectRepoInput,
});
export type UnlinkGithubRepoInput = z.infer<typeof unlinkGithubRepoInput>;
