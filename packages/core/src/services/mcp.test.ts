// The MCP server's two halves that are not somebody else's tests.
//
// Everything the MCP endpoint can DO is `assistant-tools.ts`, and that is
// exercised through `assistant.test.ts` — an adapter onto a service that has
// its own file. What is new here is the two translations either side of it, and
// both fail silently:
//
//   * `mcpToolDefinitions` maps the tool registry into what a client is told.
//     A wrong annotation is not an error anywhere; it is a delete that a client
//     stopped asking about, which nobody notices until it has happened.
//   * `mcpService.resolveOrgContext` decides whether a stored connection still
//     answers. It is the only membership check in front of the whole surface,
//     and its inputs are a slug and a user id — the two things an MCP access
//     token cannot tell apart from a revoked one.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { createTestDb, present, type TestDb } from "../test/harness";
import { Access } from "./access.service";
import {
	ASSISTANT_TOOLS,
	findTool,
	toolDefinitions,
	toolsFor,
} from "./assistant-tools";
import { mcpToolDefinitions } from "./mcp-tools";
import { mcpService } from "./mcp.service";

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

// ── The tenancy decision, against a real database ───────────────────────────

let harness: TestDb;

const ORG = "mcp-org";
const OTHER_ORG = "mcp-org-other";

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values([
		{ id: ORG, name: "Mcp Org", slug: "mcp-org", createdAt: new Date() },
		{
			id: OTHER_ORG,
			name: "Other Org",
			slug: "mcp-org-other",
			createdAt: new Date(),
		},
	]);

	await db.insert(user).values(
		["member", "former", "outsider"].map((id) => ({
			id: `u-${id}`,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);

	await db.insert(member).values([
		{
			id: "m-member",
			organizationId: ORG,
			userId: "u-member",
			role: "member",
			createdAt: new Date(),
		},
		// A member of the OTHER org only — the cross-org case below.
		{
			id: "m-outsider",
			organizationId: OTHER_ORG,
			userId: "u-outsider",
			role: "admin",
			createdAt: new Date(),
		},
	]);
});

afterAll(async () => {
	await harness.close();
});

describe("mcpService.resolveOrgContext", () => {
	test("resolves the slug to a Ctx for a member", async () => {
		expect(await mcpService.resolveOrgContext("u-member", "mcp-org")).toEqual({
			organizationId: ORG,
			userId: "u-member",
		});
	});

	// The case this function exists for. An MCP access token is a credential a
	// client keeps in a config file until somebody revokes it, so it outlives a
	// membership by far more than a session does — and nothing in the request
	// after this point re-asks.
	test("refuses a member who has since been removed", async () => {
		await db.insert(member).values({
			id: "m-former",
			organizationId: ORG,
			userId: "u-former",
			role: "member",
			createdAt: new Date(),
		});
		expect(await mcpService.resolveOrgContext("u-former", "mcp-org")).not.toBe(
			null,
		);

		await db.delete(member).where(eq(member.id, "m-former"));

		expect(await mcpService.resolveOrgContext("u-former", "mcp-org")).toBe(
			null,
		);
	});

	test("refuses a member of another organization", async () => {
		expect(await mcpService.resolveOrgContext("u-outsider", "mcp-org")).toBe(
			null,
		);
	});

	// Both null, deliberately: a valid token must not be usable to find out
	// which workspaces exist on the deployment.
	test("answers a slug nobody owns the same way as a non-membership", async () => {
		const missing = await mcpService.resolveOrgContext(
			"u-member",
			"no-such-org",
		);
		const forbidden = await mcpService.resolveOrgContext(
			"u-member",
			"mcp-org-other",
		);
		expect(missing).toBe(null);
		expect(forbidden).toBe(null);
	});
});
