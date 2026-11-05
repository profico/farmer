import {
	API_VERSION,
	type ApiMeta,
	MIN_CLI_VERSION,
	MIN_MOBILE_VERSION,
} from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

/**
 * `GET /api/v1/meta` — the one unauthenticated CLI route, and the first thing
 * `farmer login` and the mobile app ask a URL.
 *
 * It answers even when `CLI_ENABLED=false`, with `cliEnabled: false`, where
 * every other CLI route answers 404. That is the difference between "this is a
 * Farmer server that does not run the CLI" and "this is not a Farmer server",
 * and the person typing the URL needs to be told which mistake they made.
 *
 * It is the version contract for the mobile app: `apiVersion`,
 * `minMobileVersion` and the sign-in methods. The methods are the ones the
 * login page draws, from the same two functions. The only read is the check
 * for a password form, which `passwordOffered` answers with at most two small
 * queries and none in development. Nothing in the answer names a person or
 * holds a secret.
 *
 * `pushRelay` tells the app whether to register with the push relay (ADR
 * 0006). The relay URL is public: it is the same for every server that uses
 * Profico's relay.
 *
 * `uploadsEnabled` and `organizationCreation` are what `getPublicAppConfig`
 * tells the browser: whether an upload control may show, and whether "New
 * workspace" may show. Two facts about the deployment, not about a person.
 *
 * No rate limit and no credential, so the password answer is kept for
 * `PASSWORD_TTL_MS`: a loop on this URL costs at most two queries in that time.
 */
const PASSWORD_TTL_MS = 30_000;
let password: { value: boolean; at: number } | null = null;

const cachedPasswordOffered = async (
	read: () => Promise<boolean>,
): Promise<boolean> => {
	const now = Date.now();
	if (password && now - password.at < PASSWORD_TTL_MS) return password.value;
	password = { value: await read(), at: now };
	return password.value;
};

export const Route = createFileRoute("/api/v1/meta")({
	server: {
		handlers: {
			GET: async () => {
				const [
					{ isCliEnabled },
					{ signInProviders, passwordOffered },
					{ pushRelayUrl },
					{ isStorageEnabled },
					{ isSingleOrgMode },
				] = await Promise.all([
					import("@farmer/core/lib/cli-flag"),
					import("@farmer/core/auth"),
					import("@farmer/core/lib/push-relay"),
					import("@farmer/core/lib/storage"),
					import("@farmer/core/lib/single-org"),
				]);
				const relayUrl = pushRelayUrl();
				const meta: ApiMeta = {
					app: "farmer",
					cliEnabled: isCliEnabled(),
					minCliVersion: MIN_CLI_VERSION,
					apiVersion: API_VERSION,
					minMobileVersion: MIN_MOBILE_VERSION,
					signInMethods: signInProviders(),
					passwordSignIn: await cachedPasswordOffered(passwordOffered),
					pushRelay: { enabled: relayUrl !== null, url: relayUrl },
					uploadsEnabled: isStorageEnabled(),
					organizationCreation: !isSingleOrgMode(),
				};
				return Response.json(meta, {
					headers: { "Cache-Control": "no-store" },
				});
			},
		},
	},
});
