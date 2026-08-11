import { queryOptions } from "@tanstack/react-query";
import { getOrgPolicySettings, getOrgSettings } from "#/server/organization.ts";

export const orgSettingsQuery = () =>
	queryOptions({
		queryKey: ["organization", "settings"],
		queryFn: () => getOrgSettings(),
	});

// This product's own per-org config, distinct from better-auth's organization
// row above. One field today (the compliance threshold) by design — every other
// compliance number is deliberately hardcoded.
export const orgPolicySettingsQuery = () =>
	queryOptions({
		queryKey: ["organization", "policy-settings"],
		queryFn: () => getOrgPolicySettings(),
	});
