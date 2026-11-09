/**
 * The assistant's tool registry, described the way MCP describes tools.
 *
 * A mapping and nothing else. `assistant-tools.ts` holds each tool's `name`,
 * `description`, Zod schema and `run(ctx, args)`, and `toolsFor` and `findTool`
 * already scope and dispatch. MCP needs the same list under its own field
 * names, with no second registry and no second copy of the §4 matrix.
 *
 * This module imports no MCP SDK, on purpose: `packages/core` never learns
 * about a transport. The return type is plain data that `apps/web` hands to
 * the SDK.
 *
 * Two Farmer UI concepts do not survive the mapping:
 *
 *   * The approval tiers. MCP has no server-side approval, so the client
 *     prompts from the annotations. Every tool is exposed, and `kind` becomes a
 *     hint: `read` is `readOnlyHint`, `destructive` is `destructiveHint`. Hiding
 *     the destructive tools adds no safety (the services assert either way) and
 *     removes the way for an agent to undo its own mistake.
 *   * The row-by-row card. `apply_day_assembly` and `file_time_entries` suspend
 *     the turn for a ticked subset. Over MCP they are all-or-nothing writes,
 *     because `run` applies the selection to the arguments before it runs.
 */

import type { JsonRecord } from "../lib/json";
import type { Access } from "./access.service";
import {
	type AssistantTool,
	toolInputSchema,
	toolsFor,
} from "./assistant-tools";

/**
 * MCP's `ToolAnnotations`, narrowed to the two hints this registry can honestly
 * answer.
 *
 * `idempotentHint` is deliberately absent rather than false. It would be a lie
 * on both sides: `integration_status` reads and yet can refresh and store an
 * OAuth token, and several writes upsert and so ARE repeatable — a single
 * flag per tier would be wrong for some member of every tier.
 * `openWorldHint` is likewise absent: it describes whether a tool reaches a
 * system the server does not control, and "sometimes, if the org connected
 * Google Calendar" is not a static answer.
 */
export type McpToolAnnotations = {
	readOnlyHint: boolean;
	destructiveHint: boolean;
};

/** One tool as MCP's `tools/list` describes it. */
export type McpToolDefinition = {
	name: string;
	description: string;
	inputSchema: JsonRecord;
	annotations: McpToolAnnotations;
};

const annotationsFor = (tool: AssistantTool): McpToolAnnotations => ({
	readOnlyHint: tool.kind === "read",
	destructiveHint: tool.kind === "destructive",
});

/**
 * The tools this caller is offered, in MCP's shape.
 *
 * Scoped by the same `available` predicate the assistant uses, and for the same
 * reason rather than for safety: every definition is re-sent on every request
 * of every session, so a Member carrying the admin reports
 * pays for them in context on each one and buys a call that can only come back
 * refused. The service behind each tool re-resolves `Access` and asserts — that
 * is the authorization, and it is not restated here.
 */
export const mcpToolDefinitions = (access: Access): McpToolDefinition[] =>
	toolsFor(access).map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: toolInputSchema(tool),
		annotations: annotationsFor(tool),
	}));
