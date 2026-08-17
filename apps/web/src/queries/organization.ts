import { queryOptions } from "@tanstack/react-query";
import { getOrgPolicySettings, getOrgSettings } from "#/server/organization.ts";
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
