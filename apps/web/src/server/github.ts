import {
	attachCommitsInput,
	attachPullRequestsInput,
	confirmInstallationInput,
	detachCommitInput,
	detachPullRequestActivityInput,
	disconnectInstallationInput,
	linkProjectRepoInput,
	listAttachedCommitsInput,
	listAttachedPullRequestsInput,
	listProjectReposInput,
	suggestCommitsInput,
	suggestPullRequestsInput,
	unlinkProjectRepoInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgAdminMiddleware, orgMiddleware } from "./auth";

// POST (not GET) so the response is never CDN/browser-cacheable — this is
// private, cookie-scoped per-user state, and a cacheable GET let a Cloudflare
// Browser-Cache-TTL override serve one user's stale "not connected" snapshot.
export const getGithubConnectionStatus = createServerFn({
	method: "POST",
})
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { githubService } = await import("@farmer/core/services");
		return githubService.connectionStatus(context.ctx);
	});

// ── Org installations (admin-only) ─────────────────────────────────────────
export const listGithubInstallations = createServerFn({
	method: "GET",
})
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { githubService } = await import("@farmer/core/services");
		return githubService.listInstallations(context.ctx);
	});

export const getGithubInstallUrl = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const [{ setting }, { signOrgState }] = await Promise.all([
			import("@farmer/core/lib/instance-settings"),
			import("@farmer/core/lib/oauth-state"),
		]);
		const slug = setting("GITHUB_APP_SLUG");
		if (!slug) throw new Error("GITHUB_APP_SLUG not configured");
		const url = new URL(`https://github.com/apps/${slug}/installations/new`);
		url.searchParams.set(
			"state",
			signOrgState(context.ctx.organizationId, context.ctx.userId),
		);
		return { url: url.toString() };
	});

// The second half of an install that GitHub started. An App installed (or
// changed) from GitHub's own settings comes back to `api/github/setup` with no
// signed `state`, so that route cannot tell it from a crafted link and only
// hands the installation id on to Integrations. This POST is the admin's
// explicit choice to attach it to THIS workspace, and it sits behind the CSRF
// check every server function has (`start.ts`). `connectInstallation` still
// requires the installation to be in the admin's own GitHub list.
export const connectGithubInstallation = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(confirmInstallationInput)
	.handler(async ({ data, context }) => {
		// The workspace the admin was shown, not only the session's active one:
		// another tab can have moved that since the page was drawn.
		if (data.organizationId !== context.ctx.organizationId) {
			throw new Error(
				"Your active workspace changed in another tab. Reload this page and confirm again.",
			);
		}
		const { githubService } = await import("@farmer/core/services");
		await githubService.connectInstallation(context.ctx, {
			installationId: data.installationId,
		});
	});

export const disconnectGithubInstallation = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(disconnectInstallationInput)
	.handler(async ({ data, context }) => {
		const { githubService } = await import("@farmer/core/services");
		return githubService.disconnectInstallation(context.ctx, data);
	});

// Admin-only, like linking: the list is every repo every connected installation
// can reach, private ones included, and the only UI that reads it (the
// project panel's GitHub tab) is shown to admins alone. The service asserts it
// too, so the assistant and MCP paths cannot reach it either.
export const listAvailableGithubRepos = createServerFn({
	method: "GET",
})
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { githubService } = await import("@farmer/core/services");
		return githubService.listAvailableRepos(context.ctx);
	});

// The same list, read past the server's cache — the Refresh button, for a repo
// created since the list was fetched. POST because it is a request for work,
// not a read a browser or a CDN may answer from a copy.
export const refreshAvailableGithubRepos = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { githubService } = await import("@farmer/core/services");
		return githubService.listAvailableRepos(context.ctx, { refresh: true });
	});

export const linkProjectGithubRepo = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(linkProjectRepoInput)
	.handler(async ({ data, context }) => {
		const { githubService } = await import("@farmer/core/services");
		return githubService.linkRepo(context.ctx, data);
	});

export const unlinkProjectGithubRepo = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(unlinkProjectRepoInput)
	.handler(async ({ data: projectGithubRepoId, context }) => {
		const { githubService } = await import("@farmer/core/services");
		return githubService.unlinkRepo(context.ctx, projectGithubRepoId);
	});

export const listProjectGithubRepos = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(listProjectReposInput)
	.handler(async ({ data: projectId, context }) => {
		const { githubService } = await import("@farmer/core/services");
		return githubService.listLinkedRepos(context.ctx, projectId);
	});

export const suggestCommitsForEntry = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(suggestCommitsInput)
	.handler(async ({ data, context }) => {
		const { githubService } = await import("@farmer/core/services");
		return githubService.suggestCommits(context.ctx, data);
	});

export const attachCommitsToEntry = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(attachCommitsInput)
	.handler(async ({ data, context }) => {
		const { githubService } = await import("@farmer/core/services");
		return githubService.attachCommits(context.ctx, data);
	});

export const listAttachedCommits = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(listAttachedCommitsInput)
	.handler(async ({ data: timeEntryId, context }) => {
		const { githubService } = await import("@farmer/core/services");
		return githubService.listAttachedCommits(context.ctx, timeEntryId);
	});

export const detachCommitFromEntry = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(detachCommitInput)
	.handler(async ({ data: timeEntryGithubCommitId, context }) => {
		const { githubService } = await import("@farmer/core/services");
		return githubService.detachCommit(context.ctx, timeEntryGithubCommitId);
	});

export const suggestPullRequestsForEntry = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(suggestPullRequestsInput)
	.handler(async ({ data, context }) => {
		const { githubService } = await import("@farmer/core/services");
		return githubService.suggestPullRequests(context.ctx, data);
	});

export const attachPullRequestsToEntry = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(attachPullRequestsInput)
	.handler(async ({ data, context }) => {
		const { githubService } = await import("@farmer/core/services");
		return githubService.attachPullRequests(context.ctx, data);
	});

export const listAttachedPullRequests = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(listAttachedPullRequestsInput)
	.handler(async ({ data: timeEntryId, context }) => {
		const { githubService } = await import("@farmer/core/services");
		return githubService.listAttachedPullRequestActivity(
			context.ctx,
			timeEntryId,
		);
	});

export const detachPullRequestFromEntry = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(detachPullRequestActivityInput)
	.handler(async ({ data: activityId, context }) => {
		const { githubService } = await import("@farmer/core/services");
		return githubService.detachPullRequestActivity(context.ctx, activityId);
	});
