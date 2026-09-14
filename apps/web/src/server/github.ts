import {
	attachCommitsInput,
	detachCommitInput,
	disconnectInstallationInput,
	linkProjectRepoInput,
	listAttachedCommitsInput,
	listProjectReposInput,
	suggestCommitsInput,
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
		const slug = process.env.GITHUB_APP_SLUG;
		if (!slug) throw new Error("GITHUB_APP_SLUG not configured");
		const { signOrgState } = await import("@farmer/core/lib/oauth-state");
		const url = new URL(`https://github.com/apps/${slug}/installations/new`);
		url.searchParams.set(
			"state",
			signOrgState(context.ctx.organizationId, context.ctx.userId),
		);
		return { url: url.toString() };
	});

export const disconnectGithubInstallation = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(disconnectInstallationInput)
	.handler(async ({ data: installationRowId, context }) => {
		const { githubService } = await import("@farmer/core/services");
		return githubService.disconnectInstallation(context.ctx, installationRowId);
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
