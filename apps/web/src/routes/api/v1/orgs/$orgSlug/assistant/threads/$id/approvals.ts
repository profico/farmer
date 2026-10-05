import { runAssistantInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import {
	type ApiRequest,
	apiStreamRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";
import {
	assertAssistantAvailable,
	streamAssistantTurn,
} from "#/server/assistant-stream.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/assistant/threads/$id/approvals` — answers a
 * write the assistant asked permission for, and streams the rest of the turn.
 *
 * `toolCallId` is the call on the message with `pendingApproval`. For a batch,
 * `selectedRowIds` names the rows the person kept ticked; an empty list is a
 * rejection. The per-person limit on assistant turns applies, because an
 * approval is a turn. 404 when the deployment has the assistant switched off.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/assistant/threads/$id/approvals",
)({
	server: {
		handlers: {
			POST: apiStreamRoute({
				input: runAssistantInput,
				// The body is the decision itself; `runAssistantInput` checks it.
				raw: ({ params, body }: ApiRequest<OrgRowParams>) => ({
					conversationId: params.id,
					resolve: body,
				}),
				stream: async (ctx, input, request) => {
					await assertAssistantAvailable();
					return streamAssistantTurn(ctx, input, request);
				},
			}),
		},
	},
});
