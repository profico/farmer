import type { JsonValue } from "@farmer/core/lib/json";
import { createFileRoute } from "@tanstack/react-router";

// GitHub's deliveries about the App itself:
//
//  - `installation.deleted` / `installation.suspend`: the owner removed the
//    App on GitHub. Without this, the `org_github_installation` row names a
//    dead installation and every commit and pull request read fails.
//  - `installation_repositories`: the repository selection changed. This
//    clears the cached repo list.
//
// This route is PUBLIC: no session, no org, no CSRF token. The HMAC signature
// over the raw body is the only authorization. Read an id only from the
// verified payload. Give the same answer shape whether or not the
// installation is known, so an unverified caller learns nothing.
//
// Setup: set the App webhook URL to {BETTER_AUTH_URL}/api/github/webhook and
// the secret to GITHUB_WEBHOOK_SECRET. GitHub sends both events to every App,
// so the "Subscribe to events" list can stay empty.
export const Route = createFileRoute("/api/github/webhook")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const {
					isGithubWebhookConfigured,
					verifyWebhookSignature,
					// Deferred with every other core import: a static one here reaches
					// `postgres`, which touches `Buffer` at module scope and crashes
					// hydration in the browser. `routeTree.gen.ts` imports every route
					// module, so this file IS client-reachable.
				} = await import("@farmer/core/lib/github-client");

				// A deployment with no secret cannot tell a real delivery from a
				// forged one, so it refuses every delivery rather than trusting any.
				// 503 and not 404: GitHub's delivery log is the only place an
				// operator will look, and "not found" reads as a wrong URL.
				if (!isGithubWebhookConfigured()) {
					return Response.json(
						{ error: "GitHub webhooks are not configured" },
						{ status: 503 },
					);
				}

				// The RAW body, never a re-serialized parse: key order and whitespace
				// are part of what GitHub signed.
				const body = await request.text();
				if (
					!verifyWebhookSignature(
						body,
						request.headers.get("x-hub-signature-256"),
					)
				) {
					return Response.json({ error: "Bad signature" }, { status: 401 });
				}

				const event = request.headers.get("x-github-event");
				const { githubWebhookPayload } = await import("@farmer/core/schema");
				const parsed = githubWebhookPayload.safeParse(readJson(body));
				const installationId = parsed.success
					? parsed.data.installation?.id
					: undefined;
				if (installationId === undefined) {
					// Verified, but not about an installation — a ping, or an event
					// somebody subscribed the App to later. Accepted, so GitHub does not
					// retry it or mark the endpoint as failing.
					return Response.json({ ok: true, handled: false });
				}
				const action = parsed.success ? parsed.data.action : undefined;

				const { githubService } = await import("@farmer/core/services");

				// `suspend` is treated as a removal: a suspended installation mints no
				// tokens, so keeping the row would leave exactly the broken-but-
				// connected state this endpoint exists to end. Unsuspending arrives as
				// `installation.unsuspended`, which is not handled — the admin
				// reconnects, which is one click and re-reads the account from GitHub
				// rather than trusting a row we kept.
				if (
					event === "installation" &&
					(action === "deleted" || action === "suspend")
				) {
					const forgotten =
						await githubService.forgetInstallation(installationId);
					console.info(
						`[github] installation ${installationId} ${action}: forgot ${forgotten} connection(s)`,
					);
					return Response.json({ ok: true, handled: true, forgotten });
				}

				if (event === "installation_repositories") {
					githubService.forgetRepoList(installationId);
					return Response.json({ ok: true, handled: true });
				}

				return Response.json({ ok: true, handled: false });
			},
		},
	},
});

// The body is verified by then, so this really is GitHub's own JSON — but a
// parse of anything can still throw, and a 500 here makes GitHub retry a
// delivery that will never parse. `null` fails the Zod parse the caller runs
// on it, which lands on the same "not handled" answer.
const readJson = (body: string): JsonValue | null => {
	try {
		return JSON.parse(body);
	} catch {
		return null;
	}
};
