import { queryOptions } from "@tanstack/react-query";

import {
	getOrgPolicySettings,
	getOrgSettings,
	listMyOrganizations,
} from "#/server/organization.ts";

import { queryKeys } from "./keys.ts";

export const orgSettingsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).organization, "settings"],
		queryFn: () => getOrgSettings(),
	});

// This product's own per-org config, distinct from better-auth's organization
// row above. One field today (the compliance threshold) by design — every other
// compliance number is deliberately hardcoded.
export const orgPolicySettingsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).organization, "policy-settings"],
		queryFn: () => getOrgPolicySettings(),
	});

// The workspaces the caller may switch to, for the sidebar's switcher. Not
// better-auth's `organization.list`, which lists every membership row and so
// offered an organization whose Harvest import claim the person has not
// accepted yet, only for the guard to send them away from it. This is the list
// the chooser and `farmer login` read (`orgContextService.organizationsFor`).
// It is about the person rather than the workspace, but it is keyed under the
// current one anyway: a switch refetches a short list, and an org-blind key is
// what this file's rule exists to prevent.
export const myOrganizationsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).organization, "mine"],
		queryFn: async () => (await listMyOrganizations())?.organizations ?? [],
	});
