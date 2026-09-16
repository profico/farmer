// The assistant's turns, as PostHog LLM analytics events.
//
// The vendor's half of `packages/core/src/services/ai-telemetry.ts`: core
// reports what happened in its own words and this file renames it to PostHog's
// `$ai_generation` and `$ai_span`. Core holds no PostHog import, so the worker,
// the CLI's API and the test suite run the identical loop with no sink
// installed and nothing to configure.
//
// Not PostHog's `@posthog/ai` OpenAI wrapper, which is the documented route:
// that wrapper instruments the OpenAI SDK, and this app does not use it. The
// model call is `lib/openrouter-client.ts` — a hand-rolled SSE reader that
// carries a stop button, a per-conversation abort and a partial-answer path
// this product depends on. Swapping it for the SDK to gain the wrapper would
// trade working behaviour for a shortcut to the same events, so the events are
// emitted directly instead.

import type { AiGeneration, AiSpan } from "@farmer/core/services";

import { getPostHogClient } from "./posthog-server";

/**
 * Whether a turn's CONTENT leaves this process.
 *
 * Off unless somebody says otherwise, and that default is the point. The
 * metadata — model, latency, tokens, cost, which tools ran and whether they
 * worked — goes either way, and it is what the dashboards are built on. The
 * content is a customer's timesheet: entry notes, colleagues' names and email
 * addresses, whatever the person typed into the box. This product is
 * multi-tenant, so that is not ours to forward by default.
 *
 * Read per call rather than once at module scope, so the switch is the
 * deployment's current answer and not whichever one the process started with.
 */
const captureContent = (): boolean =>
	process.env.POSTHOG_AI_CAPTURE_CONTENT === "true";

/** Content, or a stand-in that says why it is missing.
 *
 *  A redacted event keeps the SHAPE — the roles, the count — because "eleven
 *  messages, the last one from the user" is most of what a trace is read for,
 *  and it gives away nothing. An empty property would instead read as a turn
 *  that sent nothing. */
const messagesToSend = (messages: AiGeneration["input"]) =>
	captureContent()
		? messages
		: messages.map((message) => ({
				role: message.role,
				content: `[redacted, ${String(message.content?.length ?? 0)} characters]`,
			}));

const textToSend = (text: string) =>
	captureContent() ? text : `[redacted, ${String(text.length)} characters]`;

export const posthogAiSink = {
	generation: (event: AiGeneration): void => {
		const posthog = getPostHogClient();
		if (!posthog) return;
		// `capture` queues and returns; it is never awaited. An answer somebody
		// is waiting for does not get slower because a metric is in flight.
		posthog.capture({
			distinctId: event.userId,
			event: "$ai_generation",
			properties: {
				$ai_trace_id: event.traceId,
				$ai_span_id: event.spanId,
				$ai_session_id: event.conversationId,
				$ai_model: event.model,
				$ai_provider: "openrouter",
				$ai_latency: event.latencySeconds,
				$ai_input: messagesToSend(event.input),
				$ai_input_tokens: event.inputTokens,
				$ai_output_choices: [
					{ role: "assistant", content: textToSend(event.outputText) },
				],
				$ai_output_tokens: event.outputTokens,
				$ai_total_cost_usd: event.costUsd,
				// Tool NAMES either way: they are this app's own vocabulary and say
				// nothing about the organization. Full definitions carry the
				// descriptions, which are ours too, so they ride the same switch
				// only to keep one rule rather than two.
				$ai_tools: captureContent()
					? event.tools
					: event.tools.map((tool) => tool.function.name),
				$ai_is_error: event.error !== null,
				$ai_error: event.error,
				// Farmer's own, for reading a trace back: which step of the eight
				// this was, the organization it ran for, and what ended it.
				organization_id: event.organizationId,
				ai_step: event.step,
				ai_finish_reason: event.finishReason,
				ai_called_tools: event.calledTools,
			},
		});
	},

	span: (event: AiSpan): void => {
		const posthog = getPostHogClient();
		if (!posthog) return;
		posthog.capture({
			distinctId: event.userId,
			event: "$ai_span",
			properties: {
				$ai_trace_id: event.traceId,
				$ai_span_id: event.spanId,
				$ai_parent_id: event.parentId,
				$ai_session_id: event.conversationId,
				$ai_span_name: event.name,
				$ai_latency: event.latencySeconds,
				$ai_input_state: textToSend(event.inputState),
				$ai_output_state: textToSend(event.outputState),
				// A tool that refused is not a tool that broke — a refusal is
				// information the model acts on — but both are worth finding.
				$ai_is_error: !event.ok,
				organization_id: event.organizationId,
				// read / write / destructive, so the cost of each consent tier is
				// readable without joining anything.
				ai_tool_kind: event.kind,
			},
		});
	},
};
