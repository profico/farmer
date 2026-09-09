/**
 * The assistant's tool registry, described the way MCP describes tools.
 *
 * A mapping and nothing else. `assistant-tools.ts` already holds a `name`, a
 * `description`, a Zod schema and a `run(ctx, args)` per tool, `toolsFor`
 * already scopes the list to a caller and `findTool` already dispatches by
 * name — so an MCP server needs no registry of its own, no layer that invents
 * tool names from HTTP routes, and no second copy of the §4 matrix. What it
 * needs is the same list under MCP's field names.
 *
 * It lives in `packages/core` and imports no MCP SDK, on purpose. The
 * boundary rule says this package never learns about a transport, and the
 * return type below is plain data that `apps/web` hands to the SDK — which is
 * also what lets a future `apps/mcp` process use it without either of them
 * owning the mapping.
 *
 * Two things do not survive the trip, and both are Farmer UI concepts rather
 * than losses:
 *
 *   * **The approval tiers.** MCP has no server-side approval protocol — the
 *     CLIENT prompts, from the annotations below. So every tool is exposed and
 *     `kind` becomes a hint: `read` is `readOnlyHint`, `destructive` is
 *     `destructiveHint`. Withholding the destructive tools instead would not
 *     make anything safer (the services assert either way) and would take the
 *     one thing an agent needs to correct its own mistake — deleting the entry
 *     it just created wrong.
 *   * **The row-by-row card.** `apply_day_assembly` and `file_time_entries`
 *     suspend the assistant's turn and come back with a ticked subset;
 *     `preview`/`withSelection` have no MCP spelling, so over this transport
 *     they are all-or-nothing writes. Their `run` already behaves that way —
 *     the selection is applied to the ARGUMENTS before it is called — so this
 *     costs the partial "yes", not correctness.
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
 * on both sides: `list_time_entries` reads and yet writes (see the write-on-read
 * note in CLAUDE.md's Gotchas), and several writes upsert and so ARE repeatable
 * — a single flag per tier would be wrong for some member of every tier.
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
 * of every session, so a Member carrying the close sheet and the admin reports
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
