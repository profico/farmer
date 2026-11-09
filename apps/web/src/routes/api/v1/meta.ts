import {
	API_VERSION,
	type ApiMeta,
	MIN_CLI_VERSION,
	MIN_MOBILE_VERSION,
} from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

/**
 * `GET /api/v1/meta`: the one unauthenticated CLI route. `farmer login` and
 * the mobile app call it first.
 *
 * It answers even when `CLI_ENABLED=false`, with `cliEnabled: false`, where
 * every other CLI route answers 404. This tells "a Farmer server without the
 * CLI" from "not a Farmer server".
 *
 * It is the version contract for the mobile app (`apiVersion`,
 * `minMobileVersion`) and lists the sign-in methods from the same functions as
 * the login page. `pushRelay` tells the app whether to register with the push
 * relay (ADR 0006). `uploadsEnabled` and `organizationCreation` come from
 * `getPublicAppConfig`. Nothing in the answer names a person or holds a
 * secret.
 *
 * The route has no rate limit and no credential, so the password answer is
 * cached for `PASSWORD_TTL_MS`. A loop on this URL then costs at most two
 * queries in that time.
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
					{ readServerVersion },
				] = await Promise.all([
					import("@farmer/core/lib/cli-flag"),
					import("@farmer/core/auth"),
					import("@farmer/core/lib/push-relay"),
					import("@farmer/core/lib/storage"),
					import("@farmer/core/lib/single-org"),
					import("#/server/deployment-info"),
				]);
				const relayUrl = pushRelayUrl();
				const meta: ApiMeta = {
					app: "farmer",
					cliEnabled: isCliEnabled(),
					minCliVersion: MIN_CLI_VERSION,
					apiVersion: API_VERSION,
					serverVersion: readServerVersion(),
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
