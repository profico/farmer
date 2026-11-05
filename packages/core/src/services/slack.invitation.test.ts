// `slackService.sendInvitation`: an invitation goes out as a Slack DM when the
// invited address is somebody in the org's workspace.
//
// Slack itself is replaced by a stub `fetch`, so what is pinned is which calls
// the service makes and what the DM says — and that it answers `false` rather
// than throwing when there is nothing to send to, since the invitation it rides
// along with must never fail on Slack's account.

import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";

import { db } from "../db";
import { organization } from "../db/schema/auth";
import { slackInstallation } from "../db/schema/slack";
import { createTestDb, type TestDb } from "../test/harness";
import { slackService } from "./slack.service";

const ORG = "si-org";
const BARE_ORG = "si-bare-org";
const TOKEN = "xoxb-test";

const invite = {
	email: "ben@example.com",
	inviterName: "Ana <Admin>",
	organizationName: "Smith & Co",
	role: "member",
	path: "/accept-invite/inv-1?email=ben%40example.com",
};

type SlackCall = {
	method: string;
	token: string | null;
	body: URLSearchParams;
};

let harness: TestDb;
let calls: SlackCall[] = [];
const realFetch = globalThis.fetch;
const origin = process.env.BETTER_AUTH_URL;

/** Stand in for Slack. `users` maps an address to a Slack user id; any other
 *  address answers `users_not_found`, as Slack does. */
const stubSlack = (users: Record<string, string>) => {
	globalThis.fetch = Object.assign(
		async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(input instanceof Request ? input.url : input);
			const method = url.pathname.replace("/api/", "");
			const body = new URLSearchParams(String(init?.body ?? ""));
			const headers = new Headers(init?.headers);
			calls.push({ method, token: headers.get("Authorization"), body });
			if (method === "users.lookupByEmail") {
				const id = users[body.get("email") ?? ""];
				return Response.json(
					id
						? { ok: true, user: { id } }
						: { ok: false, error: "users_not_found" },
				);
			}
			if (method === "chat.postMessage") {
				return Response.json({ ok: true, ts: "1.0" });
			}
			return Response.json({ ok: false, error: "unknown_method" });
		},
		{ preconnect: realFetch.preconnect },
	);
};

beforeAll(async () => {
	harness = await createTestDb();
	process.env.BETTER_AUTH_URL = "https://farmer.example";
	await db.insert(organization).values([
		{ id: ORG, name: "Slack org", slug: ORG, createdAt: new Date() },
		{ id: BARE_ORG, name: "No Slack", slug: BARE_ORG, createdAt: new Date() },
	]);
	await db
		.insert(slackInstallation)
		.values({ organizationId: ORG, teamId: "T1", botToken: TOKEN });
});

afterEach(() => {
	globalThis.fetch = realFetch;
	calls = [];
});

afterAll(async () => {
	if (origin === undefined) delete process.env.BETTER_AUTH_URL;
	else process.env.BETTER_AUTH_URL = origin;
	await harness.close();
});

describe("slackService.sendInvitation", () => {
	test("DMs the Slack user the invited address belongs to", async () => {
		stubSlack({ "ben@example.com": "U_BEN" });

		expect(await slackService.sendInvitation(ORG, invite)).toBe(true);

		expect(calls.map((c) => c.method)).toEqual([
			"users.lookupByEmail",
			"chat.postMessage",
		]);
		expect(calls.every((c) => c.token === `Bearer ${TOKEN}`)).toBe(true);
		expect(calls[0]?.body.get("email")).toBe("ben@example.com");

		const post = calls[1]?.body;
		expect(post?.get("channel")).toBe("U_BEN");
		const text =
			"*Ana &lt;Admin&gt; invited you to join Smith &amp; Co* as member.";
		expect(post?.get("text")).toBe(text);
		expect(JSON.parse(post?.get("blocks") ?? "[]")).toEqual([
			{ type: "section", text: { type: "mrkdwn", text } },
			{
				type: "actions",
				elements: [
					{
						type: "button",
						text: { type: "plain_text", text: "Accept the invitation" },
						url: "https://farmer.example/accept-invite/inv-1?email=ben%40example.com",
					},
				],
			},
		]);
	});

	test("sends nothing when the address is not in the workspace", async () => {
		stubSlack({});

		expect(await slackService.sendInvitation(ORG, invite)).toBe(false);
		expect(calls.map((c) => c.method)).toEqual(["users.lookupByEmail"]);
	});

	test("makes no Slack call for an org without Slack", async () => {
		stubSlack({ "ben@example.com": "U_BEN" });

		expect(await slackService.sendInvitation(BARE_ORG, invite)).toBe(false);
		expect(calls).toEqual([]);
	});

	test("answers false instead of throwing when Slack is unreachable", async () => {
		globalThis.fetch = Object.assign(
			async () => {
				throw new TypeError("fetch failed");
			},
			{ preconnect: realFetch.preconnect },
		);

		expect(await slackService.sendInvitation(ORG, invite)).toBe(false);
	});
});
