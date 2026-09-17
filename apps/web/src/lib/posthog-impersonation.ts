// The impersonation ledger: who became whom, and when they stopped.
//
// The fifth PostHog adapter, beside `posthog-ai.ts` (the assistant's turns),
// `posthog-mcp.ts` (the MCP server's requests), `posthog-api.ts` (the REST
// API's requests and failures) and the `capture` calls in `server/*.ts` (what a
// person did in the browser). All five read `posthog-server.ts` for the client,
// so a deployment with no token has none of them — and a ledger nobody
// configured a destination for is the same as no ledger, which is why the
// grant itself, and not this file, is the control that actually holds.
//
// **Captured on the server, from the server's own session state.** The two
// events are the audit record, so neither the ids nor the fact may come from
// the browser: `routes/api/auth/$.ts` takes them from better-auth's own answer
// and from the session row behind the request. A browser can refuse to send an
// event; it cannot refuse to have one sent about it.
//
// **The distinct id is the OPERATOR, never the person impersonated.** An audit
// trail answers "what has this administrator done", so both ends belong on the
// one profile that is the same person before, during and after. Who they became
// rides as `impersonated_user_id`, which is filterable either way round.
//
// Reached with a deferred `import()` and never a static one. `routeTree.gen.ts`
// imports every route module, `api/auth/$.ts` is in that graph, and
// `posthog-node` at the top of this file would therefore ship to the browser.

import { getPostHogClient } from "./posthog-server";

/** One end of one impersonation. */
export type ImpersonationLedgerEntry = {
	/** The platform admin who pressed the button. */
	operatorId: string;
	/** The person whose account they entered. */
	impersonatedUserId: string;
};

/**
 * Write one entry.
 *
 * Awaits the flush, unlike `captureApiRequest`, because the request this runs
 * inside is the last thing the process does for that operator before the
 * browser reloads as somebody else — `flushAt: 1` sends immediately, but the
 * send is still in flight when the handler returns.
 *
 * Never throws. A PostHog outage must not turn Stop into an error the operator
 * cannot get past; the session change has already happened by the time this
 * runs, so failing here would only strand them.
 */
const write = async (
	event: "impersonation_started" | "impersonation_stopped",
	entry: ImpersonationLedgerEntry,
): Promise<void> => {
	const posthog = getPostHogClient();

	if (!posthog) return;

	try {
		posthog.capture({
			distinctId: entry.operatorId,
			event,
			properties: {
				impersonated_user_id: entry.impersonatedUserId,
				// The same name the browser registers as a super property while the
				// impersonation is live (`routes/__root.tsx`), so one filter reads
				// both the ledger and the activity it brackets.
				impersonated: true,
			},
		});
		await posthog.flush();
	} catch (error) {
		console.error("[impersonation] the ledger entry was not written", error);
	}
};

export const captureImpersonationStarted = (
	entry: ImpersonationLedgerEntry,
): Promise<void> => write("impersonation_started", entry);

export const captureImpersonationStopped = (
	entry: ImpersonationLedgerEntry,
): Promise<void> => write("impersonation_stopped", entry);
