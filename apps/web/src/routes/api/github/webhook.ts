import type { JsonValue } from "@farmer/core/lib/json";
import { createFileRoute } from "@tanstack/react-router";

// GitHub's deliveries about the App itself. One event matters and one is a
// courtesy:
//
//  - `installation.deleted` / `installation.suspend` — the App was removed or
//    suspended on GitHub. Without this the `org_github_installation` row
//    outlives the installation it names, and every commit and pull request
//    read fails against a dead installation id: a sync that is broken while
//    Integrations still shows the account as connected. Disconnecting inside
//    the app can uninstall on GitHub (Settings → Integrations), but nothing
//    stops an owner doing it from GitHub's own settings page, which is where
//    most of them will.
//  - `installation_repositories` — the repository selection changed. The repo
//    list is cached for five minutes to a day, so an admin who just changed it
//    on GitHub would come back to the old list.
//
// This route is PUBLIC: no session, no org, no CSRF token. The HMAC signature
// over the raw body is the entire authorization, so nothing here reads an id
// from anywhere but the verified payload, and every answer is the same shape
// whether or not the installation was known — an unverified caller learns
// nothing about which accounts this deployment holds.
//
// Configure it in the App settings: Webhook URL {BETTER_AUTH_URL}/api/github/webhook,
// a secret matching GITHUB_WEBHOOK_SECRET, and the "Installation" and
// "Installation repositories" event subscriptions.
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
