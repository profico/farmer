import { describe, expect, test } from "bun:test";

import { FarmerClient } from "./client";
import { ApiClientError } from "./errors";
import type { AssistantEvent } from "./schemas-assistant";
import { parseAssistantEvent, SseDecoder } from "./sse";
import { ORIGIN, jsonReply, scriptedServer } from "./test-server";

const failureOf = async (promise: Promise<object | void>) => {
	try {
		await promise;
	} catch (error) {
		if (error instanceof ApiClientError) return error;
		throw error;
	}
	throw new Error("The call did not fail.");
};

const collect = async (events: AsyncIterable<AssistantEvent>) => {
	const all: AssistantEvent[] = [];
	for await (const event of events) all.push(event);
	return all;
};

/** A streamed answer whose body arrives in the given chunks. */
const streamReply = (chunks: string[]) => {
	const encoder = new TextEncoder();
	return new Response(
		new ReadableStream({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
				controller.close();
			},
		}),
		{ status: 200, headers: { "content-type": "text/event-stream" } },
	);
};

describe("the api/v1 routes", () => {
	test("a report read sends its query and parses the answer", async () => {
		const { transport, requests } = scriptedServer([
			jsonReply(200, {
				rows: [
					{
						id: "p1",
						name: "Site",
						secondsTotal: 3600,
						timeOffSeconds: 0,
						count: 2,
						clientName: "Acme",
						code: null,
						archived: false,
						addedLater: true,
					},
				],
				totalSeconds: 3600,
				unfiledSeconds: 0,
			}),
		]);
		const report = await new FarmerClient(transport, "tok").getTimeReport(
			"acme",
			{
				from: "2026-10-01",
				to: "2026-10-31",
				tab: "projects",
				activeOnly: true,
				q: undefined,
			},
		);
		expect(report.rows[0]?.name).toBe("Site");
		expect(report.rows[0]).not.toHaveProperty("addedLater");
		expect(requests[0]?.url).toBe(
			`${ORIGIN}/api/v1/orgs/acme/reports/time?from=2026-10-01&to=2026-10-31&tab=projects&activeOnly=true`,
		);
	});

	test("the project list keeps the stats and the money", async () => {
		const { transport, requests } = scriptedServer([
			jsonReply(200, [
				{
					id: "p1",
					name: "Site",
					code: "ST",
					status: "archived",
					client: { id: "c1", name: "Acme" },
					role: "pm",
					type: "hourly",
					icon: null,
					openToOrg: false,
					budgetSeconds: null,
					budgetAmount: null,
					hourlyPrice: "85.00",
					stats: {
						scope: "project",
						monthSeconds: 7200,
						allTimeSeconds: 36000,
						contributorCount: 2,
						contributors: [{ id: "u1", name: "Ana" }],
					},
				},
			]),
		]);
		const projects = await new FarmerClient(transport, "tok").listProjects(
			"acme",
		);
		expect(projects[0]?.stats.monthSeconds).toBe(7200);
		expect(projects[0]?.hourlyPrice).toBe("85.00");
		expect(requests[0]?.url).toBe(`${ORIGIN}/api/v1/orgs/acme/projects`);
	});

	test("a write sends its body as JSON", async () => {
		const { transport, requests } = scriptedServer([
			jsonReply(200, [
				{
					userId: "u2",
					name: "Bo",
					email: "bo@example.com",
					role: "member",
					active: true,
					allTimeSeconds: 0,
					lastEntry: null,
				},
			]),
		]);
		const team = await new FarmerClient(transport, "tok").addProjectMember(
			"acme",
			"p 1",
			{ userId: "u2" },
		);
		expect(team.map((member) => member.userId)).toEqual(["u2"]);
		expect(requests[0]?.method).toBe("POST");
		expect(requests[0]?.url).toBe(
			`${ORIGIN}/api/v1/orgs/acme/projects/p%201/members`,
		);
		expect(requests[0]?.headers.get("content-type")).toBe("application/json");
		expect(JSON.parse(requests[0]?.body ?? "null")).toEqual({ userId: "u2" });
	});

	test("a 403 carries the server's sentence", async () => {
		const { transport } = scriptedServer([
			jsonReply(403, {
				error: "Only an admin can change the organization.",
				code: "forbidden",
			}),
		]);
		const error = await failureOf(
			new FarmerClient(transport, "tok").updateOrganization("acme", {
				name: "Acme 2",
			}),
		);
		expect(error.kind).toBe("http");
		expect(error.status).toBe(403);
		expect(error.code).toBe("forbidden");
		expect(error.message).toBe("Only an admin can change the organization.");
	});

	test("whoami with no capabilities field reads as no capabilities", async () => {
		const { transport } = scriptedServer([
			jsonReply(200, {
				userId: "u1",
				name: "Ana",
				email: "ana@example.com",
				organization: { slug: "acme", name: "Acme" },
				orgRole: "member",
				isAdmin: false,
				timezone: "Europe/Sarajevo",
				today: "2026-10-06",
				weekStartsOn: 1,
				workingDays: [],
				projects: [],
			}),
		]);
		const whoami = await new FarmerClient(transport, "tok").whoami("acme");
		expect(Object.values(whoami.capabilities)).toEqual([
			false,
			false,
			false,
			false,
			false,
		]);
	});
});

describe("the assistant stream", () => {
	test("streams the events of a turn, split across chunks", async () => {
		const { transport, requests } = scriptedServer([
			streamReply([
				'data: {"type":"message","messageId":"m1","role":"user"}\r\n\r\n',
				'data: {"type":"delta","te',
				'xt":"Hel"}\n\n: keep-alive\n\ndata: {"type":"delta","text":"lo"}\r',
				'\n\r\ndata: {"type":"done"}',
			]),
		]);
		const events = await collect(
			new FarmerClient(transport, "tok").sendAssistantMessage("acme", "t1", {
				message: "Hi",
			}),
		);
		expect(events.map((event) => event.type)).toEqual([
			"message",
			"delta",
			"delta",
			"done",
		]);
		expect(requests[0]?.url).toBe(
			`${ORIGIN}/api/v1/orgs/acme/assistant/threads/t1/messages`,
		);
		expect(requests[0]?.headers.get("accept")).toBe("text/event-stream");
	});

	test("a stream that closes early ends with an error event", async () => {
		const { transport } = scriptedServer([
			streamReply(['data: {"type":"delta","text":"Hel"}\n\n']),
		]);
		const events = await collect(
			new FarmerClient(transport, "tok").answerAssistantApproval("acme", "t1", {
				toolCallId: "c1",
				decision: "approved",
			}),
		);
		expect(events.at(-1)?.type).toBe("error");
	});

	test("a refused turn throws before the first event", async () => {
		const { transport } = scriptedServer([
			jsonReply(429, {
				error: "Too many messages in a minute. Try again in 20 seconds.",
				code: "rate_limited",
			}),
		]);
		const events = new FarmerClient(transport, "tok").sendAssistantMessage(
			"acme",
			"t1",
			{ message: "Hi" },
		);
		const error = await failureOf(collect(events));
		expect(error.code).toBe("rate_limited");
		expect(error.message).toContain("20 seconds");
	});

	test("the decoder joins data lines and skips an unknown event", () => {
		const decoder = new SseDecoder();
		expect(decoder.push("data: a\ndata: b\n\nda")).toEqual(["a\nb"]);
		expect(decoder.end()).toEqual([]);
		expect(parseAssistantEvent('{"type":"new_kind"}')).toBeNull();
		expect(parseAssistantEvent("not json")).toBeNull();
	});
});
