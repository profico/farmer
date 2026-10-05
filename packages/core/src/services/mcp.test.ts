// The MCP server's two halves that are not somebody else's tests.
//
// Everything the MCP endpoint can DO is `assistant-tools.ts`, and that is
// exercised through `assistant.test.ts` — an adapter onto a service that has
// its own file. What is new here is the translation on the way out, and it fails
// silently: `mcpToolDefinitions` maps the tool registry into what a client is
// told. A wrong annotation is not an error anywhere; it is a delete that a
// client stopped asking about, which nobody notices until it has happened.
//
// The other half — whether a stored connection still answers at all — is
// `orgContextService.resolveBySlug`, which the CLI shares, and is tested in
// `org-context.test.ts`.

import { describe, expect, test } from "bun:test";

import { present } from "../test/harness";
import { Access } from "./access.service";
import {
	ASSISTANT_TOOLS,
	findTool,
	toolDefinitions,
	toolsFor,
} from "./assistant-tools";
import { agentErrorMessage } from "./error-message";
import { mcpToolDefinitions } from "./mcp-tools";

// ── The mapping: a fixed Access in, a stable tool list out ──────────────────

/** An `Access` with no project assignments, admin flag as given. */
const accessWith = (isAdmin: boolean) =>
	new Access("u-1", "org-1", isAdmin, new Map());

const PLAIN = accessWith(false);
const ADMIN = accessWith(true);

const named = (name: string) =>
	mcpToolDefinitions(ADMIN).find((tool) => tool.name === name);

describe("mcpToolDefinitions", () => {
	// The list is `toolsFor` and nothing else. Said explicitly because the issue
	// this was built from decided that EVERY tool is exposed — the three tiers
	// become annotations rather than a filter — and "expose the read ones only"
	// is the obvious-looking change that would quietly halve the surface.
	test("is exactly toolsFor, in the same order", () => {
		expect(mcpToolDefinitions(ADMIN).map((tool) => tool.name)).toEqual(
			toolsFor(ADMIN).map((tool) => tool.name),
		);
		expect(mcpToolDefinitions(ADMIN)).toHaveLength(ASSISTANT_TOOLS.length);
	});

	// The caller's own scoping, unchanged from the assistant's. Not the
	// authorization — the service behind each tool re-resolves Access and
	// asserts — but a stored connection outlives the role that made it, so a
	// list that ignored `available` would offer an ex-admin the admin reports.
	test("scopes the list to the caller", () => {
		const plain = mcpToolDefinitions(PLAIN).map((tool) => tool.name);
		const admin = mcpToolDefinitions(ADMIN).map((tool) => tool.name);

		expect(plain.length).toBeLessThan(admin.length);
		for (const name of plain) expect(admin).toContain(name);

		// One anchor from each predicate, so a tool losing its `available` shows
		// up here rather than only in the count above.
		expect(plain).toContain("list_projects");
		expect(plain).toContain("absence_report"); // anyone: scoped by the service
		expect(plain).not.toContain("list_project_members"); // leadsSomething
	});

	// The tier mapping, one case per tier. `readOnlyHint` is what lets a client
	// run a read without asking, and `destructiveHint` is what makes it ask — so
	// these two booleans are the whole of what survives of the assistant's
	// approval tiers, and a `write` is neither.
	test("maps kind onto the two hints", () => {
		expect(named("list_projects")?.annotations).toEqual({
			readOnlyHint: true,
			destructiveHint: false,
		});
		expect(named("create_time_entry")?.annotations).toEqual({
			readOnlyHint: false,
			destructiveHint: false,
		});
		expect(named("delete_time_entry")?.annotations).toEqual({
			readOnlyHint: false,
			destructiveHint: true,
		});
	});

	test("no tool is both read-only and destructive", () => {
		for (const tool of mcpToolDefinitions(ADMIN)) {
			expect(
				tool.annotations.readOnlyHint && tool.annotations.destructiveHint,
			).toBe(false);
		}
	});

	// A definition a client cannot dispatch, or cannot fill in, is worse than an
	// absent one: the model spends a step discovering it.
	test("every definition is dispatchable and describes an object", () => {
		for (const tool of mcpToolDefinitions(ADMIN)) {
			expect(findTool(tool.name)).toBeDefined();
			expect(tool.description.length).toBeGreaterThan(0);
			expect(tool.inputSchema.type).toBe("object");
		}
	});

	// The reason `toolInputSchema` was extracted. The assistant's `parameters`
	// and MCP's `inputSchema` are the same document under two names, and a tool
	// that emitted its 62-day ceiling to one caller and `{}` to the other would
	// be the `api/v1/time-entries` mistake again, one layer up.
	test("publishes the same schema the assistant is given", () => {
		const assistant = new Map(
			toolDefinitions(ADMIN).map((tool) => [
				tool.function.name,
				tool.function.parameters,
			]),
		);
		for (const tool of mcpToolDefinitions(ADMIN)) {
			expect(tool.inputSchema).toEqual(
				present(assistant.get(tool.name), `assistant schema for ${tool.name}`),
			);
		}
	});
});

// ── The error message a client reads ────────────────────────────────────────

describe("agentErrorMessage", () => {
	test("adds the recovery hint to a refused task", () => {
		expect(agentErrorMessage(new Error("Task not available"))).toBe(
			"Task not available: it is archived or does not exist in this organization. Call list_tasks to get the current task ids.",
		);
	});

	test("adds the recovery hint to a refused project", () => {
		expect(agentErrorMessage(new Error("Project not found"))).toBe(
			"Project not found: it does not exist in this organization. Call list_projects to get the current project ids.",
		);
	});

	test("leaves any other readable message unchanged", () => {
		expect(agentErrorMessage(new Error("Time entry not found"))).toBe(
			"Time entry not found",
		);
		expect(agentErrorMessage(new Error("Task not available now"))).toBe(
			"Task not available now",
		);
	});

	test("never reveals an unsafe error", () => {
		expect(agentErrorMessage(new TypeError("x is undefined"))).toBeNull();
	});

	test("names tools that the registry really offers", () => {
		for (const name of ["list_tasks", "list_projects"]) {
			expect(named(name)).toBeDefined();
		}
	});
});
