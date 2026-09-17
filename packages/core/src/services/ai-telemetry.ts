// What the assistant's turns report to whoever is watching them.
//
// A seam rather than a direct call, for the same reason `ports.ts` and
// `notify.ts` are: `packages/core` must stay runnable from a process that has
// no analytics vendor in it — the worker, the CLI's API, the test suite — and
// the vendor's client belongs beside its own configuration in `apps/web`, not
// wired into the agent loop.
//
// Two adapters justify it: PostHog in the web app, and nothing at all
// everywhere else. The default sink drops every event on the floor, so a
// deployment with no analytics runs the identical code path and pays one
// function call per turn.
//
// **Nothing here may ever throw or wait.** An answer the person is waiting for
// must not be slower, or fail, because a metric could not be recorded.
// `report` swallows whatever the sink does; a sink that wants to send over the
// network queues rather than awaits.

import type { ChatMessage, ChatTool, ChatTurn } from "../lib/openrouter-client";

/** One billed model call.
 *
 *  Maps onto PostHog's `$ai_generation`, but named for what it is rather than
 *  for the event: a second sink should not have to learn PostHog's vocabulary
 *  to read it. The adapter does the renaming.
 *
 *  `input`, `tools` and `output` are the CONTENT — somebody's timesheet, their
 *  colleagues' names, whatever they typed. They are handed over whole and the
 *  ADAPTER decides whether any of it leaves the process, because that is a
 *  deployment's decision and it belongs next to the credentials it is made
 *  with, not spread through the loop that produces it. */
export type AiGeneration = {
	organizationId: string;
	userId: string;
	/** The whole question: one per `run`, shared by every step it takes and
	 *  every tool those steps call. What makes "this question cost four calls
	 *  and eleven cents" a thing anybody can see. */
	traceId: string;
	/** This one call. */
	spanId: string;
	/** The thread, so a trace can be read in the context of the conversation it
	 *  belongs to. */
	conversationId: string;
	model: string;
	/** Which step of the turn this was, counting from 1. The closing
	 *  out-of-steps call is `null`: it is the loop talking to the model about
	 *  its own ceiling, not a step anybody asked for. */
	step: number | null;
	latencySeconds: number;
	inputTokens: number | null;
	outputTokens: number | null;
	/** What OpenRouter says the call cost, in USD. Null when it did not say. */
	costUsd: number | null;
	/** OpenRouter's own stop reason, or `aborted` when the person stopped it. */
	finishReason: string | null;
	/** The tools the model asked to run, in order, exactly as the stream
	 *  reported them.
	 *
	 *  The whole call rather than its name, because PostHog reads the tool
	 *  names off the RESPONSE at ingestion time — a generation whose output
	 *  carries no `tool_calls` is a generation that called nothing, however
	 *  many spans follow it. The name is metadata; `arguments` is content and
	 *  the adapter redacts it under the same rule as the rest. */
	toolCalls: ChatTurn["toolCalls"];
	input: ChatMessage[];
	tools: ChatTool[];
	outputText: string;
	/** Present only when the call failed. */
	error: string | null;
};

/** One tool run inside a turn. Maps onto PostHog's `$ai_span`. */
export type AiSpan = {
	organizationId: string;
	userId: string;
	traceId: string;
	spanId: string;
	/** The generation whose `tool_calls` asked for this. */
	parentId: string;
	conversationId: string;
	/** The tool's name — `list_time_entries`, `create_time_entry`. */
	name: string;
	/** `read`, `write` or `destructive`, so the cost of the consent tiers can
	 *  be read off without joining anything. */
	kind: string;
	latencySeconds: number;
	/** False when the tool answered with a refusal or an error. The turn goes
	 *  on either way — a refusal is information the model acts on. */
	ok: boolean;
	/** Content again, and redacted by the adapter under the same rule as a
	 *  generation's. The arguments name ids and dates; the result is rows. */
	inputState: string;
	outputState: string;
};

export type AiTelemetrySink = {
	generation: (event: AiGeneration) => void;
	span: (event: AiSpan) => void;
};

let sink: AiTelemetrySink | null = null;

/** Install the adapter. `apps/web` does this before it runs a turn; nothing
 *  else does, and nothing else has to. */
export const setAiTelemetrySink = (next: AiTelemetrySink | null): void => {
	sink = next;
};

/** Whether anything is listening. Lets a caller skip building an event nobody
 *  will read — the generation carries the whole message list. */
export const aiTelemetryEnabled = (): boolean => sink !== null;

export const reportGeneration = (event: AiGeneration): void => {
	if (!sink) return;
	try {
		sink.generation(event);
	} catch (error) {
		// Never the turn's problem. Logged rather than swallowed silently,
		// because a sink that throws every time is a broken deployment somebody
		// should be able to find.
		console.error("[ai-telemetry] the sink refused a generation", error);
	}
};

export const reportSpan = (event: AiSpan): void => {
	if (!sink) return;
	try {
		sink.span(event);
	} catch (error) {
		console.error("[ai-telemetry] the sink refused a span", error);
	}
};
