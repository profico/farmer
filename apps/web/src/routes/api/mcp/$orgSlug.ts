import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { resolveMcpOrgContext } from "#/server/api-auth.ts";
import {
	admitMcpCaller,
	admitMcpRequest,
	admitMcpWrite,
	mcpCallerAddress,
	recordMcpAuthFailure,
} from "#/server/mcp-rate-limit.ts";

/**
 * The MCP server — the assistant's tool layer over Streamable HTTP, for Claude
 * Code and any other MCP client.
 *
 * A server ROUTE rather than a `createServerFn`, for the same reason the
 * assistant's own stream is one: this speaks a wire protocol, not a function
 * call. It authenticates through `server/api-auth.ts` rather than the
 * middleware in `server/auth.ts` — see the note at the top of that file.
 *
 * **The organization is in the URL.** An access token resolves to a `userId`
 * and scopes; there is no `session.activeOrganizationId` for it to carry, and
 * every service Ctx needs an organization. Putting the slug in the path matches
 * the service layer's own rule that tenancy is an explicit parameter, and gives
 * a person who works in two workspaces two connector entries rather than a mode
 * they have to remember they are in. The alternative — an `org` argument on
 * every one of the tools — is a second copy of something the URL already says,
 * on 52 schemas.
 *
 * **The authorization is the caller's own Ctx and nothing here.** Every tool
 * runs a service with it, and each service re-resolves `Access` and asserts. So
 * this file holds no permission logic at all: `available` below decides what
 * the client is TOLD it can do, exactly as it does for the assistant.
 *
 * **Stateless, one server per request.** There is nowhere to keep an MCP
 * session across requests in a process that may be restarted under the client,
 * so `sessionIdGenerator: undefined`, and `enableJsonResponse` because a plain
 * JSON body is what a server-route handler returns — SSE here would buy nothing
 * the assistant's own stream route does not already own.
 */

/** Every tool call's arguments, before the tool's own schema narrows them.
 *  The transport has already parsed the JSON, so unlike the assistant's own
 *  loop there is no "that wasn't JSON" case left to report — only "that wasn't
 *  an object". */
const argumentsPayload = z.record(z.string(), z.json());

/** A tool result. `isError` is written out even when false, rather than left
 *  off — the protocol's default, said out loud, so the two shapes this file
 *  returns are one shape with a flag rather than two objects to keep in step. */
const text = (body: string, isError = false) => ({
	content: [{ type: "text" as const, text: body }],
	isError,
});

/** The 401 that starts the OAuth flow.
 *
 *  `WWW-Authenticate` is the load-bearing part: it is the ONLY thing that tells
 *  a client where to discover the authorization server, so without it a fresh
 *  connection fails with no way to fix itself. `Access-Control-Expose-Headers`
 *  is what lets a browser-based client read it at all.
 *
 *  The origin is `BETTER_AUTH_URL`, NOT the request's own. It has to be the
 *  same one better-auth publishes, because the document this header points at
 *  names its own `resource` — and a client that is sent to one origin and reads
 *  another there is looking at metadata for a resource it did not ask about.
 *  Both discovery routes derive theirs from that variable, and so does
 *  `getPublicAppConfig().appOrigin`, so this is the third reader of one answer
 *  rather than a second answer. Falling back to the request origin keeps the
 *  header well-formed on a deployment that has not set it, which is already
 *  broken for the OAuth callbacks. */
const unauthorized = (requestOrigin: string) => {
	const origin =
		URL.parse(process.env.BETTER_AUTH_URL ?? "")?.origin ?? requestOrigin;
	const challenge = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
	return Response.json(
		{
			jsonrpc: "2.0",
			error: { code: -32000, message: "Unauthorized: Authentication required" },
			id: null,
		},
		{
			status: 401,
			headers: {
				"WWW-Authenticate": challenge,
				"Access-Control-Expose-Headers": "WWW-Authenticate",
			},
		},
	);
};

const tooManyRequests = (retryAfterSeconds: number) =>
	Response.json(
		{
			jsonrpc: "2.0",
			error: { code: -32000, message: "Too many requests" },
			id: null,
		},
		{ status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
	);

const handle = async (request: Request, orgSlug: string) => {
	// The kill switch, before auth and before anything is imported: a feature
	// switched off at the deployment has no live endpoint, rather than one that
	// authenticates a client and then refuses it. 404 rather than 403 for the
	// same reason as the assistant's stream — there is nothing here to be
	// authorized for. Deliberately NOT `isAssistantEnabled`: see lib/mcp-flag.ts.
	const { isMcpEnabled } = await import("@farmer/core/lib/mcp-flag");
	if (!isMcpEnabled()) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}

	// Counted by address BEFORE the credential is resolved: resolving it is a
	// session read and a token read, and the per-user limit below cannot apply
	// to a caller that never became a user. See mcp-rate-limit.ts.
	const address = mcpCallerAddress(request);
	const caller = admitMcpCaller(address);
	if (!caller.ok) return tooManyRequests(caller.retryAfterSeconds);

	const origin = new URL(request.url).origin;
	const ctx = await resolveMcpOrgContext(request, orgSlug);
	// A slug that does not exist, a caller with no credential and an ex-member
	// are one answer on purpose — see `resolveMcpOrgContext`.
	if (!ctx) {
		recordMcpAuthFailure(address);
		return unauthorized(origin);
	}

	const admitted = admitMcpRequest(ctx.userId);
	if (!admitted.ok) return tooManyRequests(admitted.retryAfterSeconds);

	const { ctxAccess, findTool, mcpToolDefinitions } =
		await import("@farmer/core/services");
	// Already resolved and memoized at the boundary; this reads the memo.
	const access = await ctxAccess(ctx);

	const [{ Server }, { WebStandardStreamableHTTPServerTransport }, types] =
		await Promise.all([
			import("@modelcontextprotocol/sdk/server/index.js"),
			import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"),
			import("@modelcontextprotocol/sdk/types.js"),
		]);

	const server = new Server(
		{ name: "farmer", version: "1.0.0" },
		{
			capabilities: { tools: {} },
			instructions:
				"Farmer is a time-tracking app for a software agency. Every tool acts as the signed-in person, in the one organization this connection names — ids are looked up with a read tool, never invented, and durations are whole quarter-hours.",
		},
	);

	server.setRequestHandler(types.ListToolsRequestSchema, () => ({
		tools: mcpToolDefinitions(access),
	}));

	server.setRequestHandler(types.CallToolRequestSchema, async (call) => {
		const tool = findTool(call.params.name);
		// Four different answers, not one, and the wording is `executeTool`'s for
		// the same reason it is worded that way there: an unknown tool, a tool the
		// caller was not offered, bad arguments and a service that refused are
		// four different mistakes, and telling the model which one it made is the
		// difference between it correcting the call and repeating it.
		if (!tool) return text(`Unknown tool "${call.params.name}".`, true);
		// Not a security check — the service behind it would refuse anyway. But a
		// client caches a tool list, and a stored connection outlives the role its
		// owner held when it was made.
		if (tool.available && !tool.available(access)) {
			return text(`"${call.params.name}" is not available to this user.`, true);
		}

		const parsed = argumentsPayload.safeParse(call.params.arguments ?? {});
		if (!parsed.success) {
			return text("The arguments were not a JSON object.", true);
		}

		if (tool.kind !== "read") {
			const write = admitMcpWrite(ctx.userId);
			if (!write.ok) {
				return text(
					`Too many writes. Wait ${write.retryAfterSeconds}s and try again.`,
					true,
				);
			}
		}

		try {
			// Uncapped, unlike the assistant's own `stringifyResult`. That cap
			// exists because the result re-enters OUR next prompt and we pay for it
			// on every step; here the client owns its context and its budget, and
			// silently truncating a JSON array into a string it might store is a
			// worse answer than a large one.
			return text(JSON.stringify((await tool.run(ctx, parsed.data)) ?? null));
		} catch (error) {
			// A refusal is information the client can act on ("you aren't assigned
			// to that project"), not a transport failure — so it comes back as a
			// tool result rather than a JSON-RPC error.
			return text(
				`Error: ${error instanceof Error ? error.message : "failed"}`,
				true,
			);
		}
	});

	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	await server.connect(transport);
	return transport.handleRequest(request);
};

export const Route = createFileRoute("/api/mcp/$orgSlug")({
	server: {
		handlers: {
			// All three verbs the Streamable HTTP transport defines. GET opens the
			// server-to-client stream and DELETE ends a session; both are answered
			// by the transport itself, which in stateless mode declines them — the
			// handlers exist so that the answer is the protocol's own 405 rather
			// than the router's 404, which a client reads as a wrong URL.
			GET: ({ request, params }) => handle(request, params.orgSlug),
			POST: ({ request, params }) => handle(request, params.orgSlug),
			DELETE: ({ request, params }) => handle(request, params.orgSlug),
		},
	},
});
