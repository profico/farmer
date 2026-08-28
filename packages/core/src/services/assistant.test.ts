// The assistant loop, pinned.
//
// Four properties are what this suite is built around, and all four are things
// that look fine in a manual demo and fail quietly in production:
//
//   1. A WRITE DOES NOT HAPPEN WITHOUT CONSENT. The model asking to log four
//      hours and the four hours existing are two events, and the second one is
//      the user's to authorise. A regression here is silent: the assistant
//      looks helpful and the timesheet is wrong.
//   2. TOOLS INHERIT THE CALLER'S ACCESS. Every tool runs on the caller's own
//      Ctx, so a Member asking about "hours" gets their own. This is asserted
//      rather than assumed because the tool layer is the one place in the app
//      where the caller of a service is chosen by a language model.
//   3. CONVERSATIONS ARE PRIVATE. Scoped (org, user), so another member's
//      thread is not found rather than refused.
//   4. THE WIRE HISTORY STAYS PAIRED. An assistant turn carrying tool_calls
//      must be followed by one tool result per call id or the next request
//      400s — including when a call was REJECTED. That is what makes the
//      approval suspend/resume safe to reload through.
//
// Runs on PGLite (src/test/harness) with a scripted model port, so the loop is
// deterministic and nothing is billed.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import {
	assistantConversation,
	assistantMessage,
	assistantSettings,
} from "../db/schema/assistant";
import { member, organization, user } from "../db/schema/auth";
import {
	client,
	project,
	projectMember,
	projectTask,
	task,
	timeEntry,
} from "../db/schema/domain";
import type { ChatMessage, ChatTurn } from "../lib/openrouter-client";
import { at, createTestDb, type TestDb } from "../test/harness";
import { type Access, accessService } from "./access.service";
import { findTool, toolDefinitions, toolsFor } from "./assistant-tools";
import {
	type AssistantEvent,
	assistantService,
	setChatModelForTests,
} from "./assistant.service";
import { clientsService } from "./clients.service";
import { projectsService } from "./projects.service";
import type { Ctx } from "./types";

const ORG = "ai-org";
const OTHER_ORG = "ai-org-2";
const ADMIN = "u-ai-admin";
const WORKER = "u-ai-worker";
const STRANGER = "u-ai-stranger";
// Deliberately non-repeating: the mask test asserts the TAIL never appears, and
// a key like "…testkeytestkey" would satisfy that by coincidence.
const KEY = "sk-or-v1-abc123def456ghi789xyz";

let harness: TestDb;
let projectId: string;
let devTaskId: string;

const ctxFor = (userId: string, organizationId = ORG): Ctx => ({
	organizationId,
	userId,
});

// ── the scripted model ───────────────────────────────────────────────────────
//
// `script` is a queue of turns; each `streamChatCompletion` call shifts one.
// Every call's outgoing messages are recorded so the tests can assert on what
// the model was actually shown — which is the only way to check property 4.

let script: ChatTurn[] = [];
let seen: ChatMessage[][] = [];

const turn = (over: Partial<ChatTurn> = {}): ChatTurn => ({
	content: "",
	toolCalls: [],
	promptTokens: null,
	completionTokens: null,
	finishReason: null,
	...over,
});

const collect = async (
	ctx: Ctx,
	input: Parameters<typeof assistantService.run>[1],
) => {
	const events: AssistantEvent[] = [];
	await assistantService.run(ctx, input, (event) => events.push(event));
	return events;
};

beforeAll(async () => {
	harness = await createTestDb();

	setChatModelForTests({
		streamChatCompletion: async (opts) => {
			seen.push(opts.messages);
			const next = script.shift();
			if (!next) throw new Error("scripted model ran out of turns");
			if (next.content) opts.onDelta?.(next.content);
			return next;
		},
		listModels: async () => [
			{
				id: "test/model",
				name: "Test Model",
				contextLength: 8000,
				promptPrice: 0,
				supportsTools: true,
			},
		],
		verifyKey: async () => {},
	});

	await db.insert(organization).values([
		{ id: ORG, name: "AI Org", slug: "ai-org", createdAt: new Date() },
		{
			id: OTHER_ORG,
			name: "Other Org",
			slug: "ai-org-2",
			createdAt: new Date(),
		},
	]);

	await db.insert(user).values(
		[ADMIN, WORKER, STRANGER].map((id) => ({
			id,
			name: id.replace("u-ai-", ""),
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);

	await db.insert(member).values([
		{
			id: "m-ai-admin",
			organizationId: ORG,
			userId: ADMIN,
			role: "admin",
			createdAt: new Date(),
		},
		{
			id: "m-ai-worker",
			organizationId: ORG,
			userId: WORKER,
			role: "member",
			createdAt: new Date(),
		},
		{
			id: "m-ai-stranger",
			organizationId: ORG,
			userId: STRANGER,
			role: "member",
			createdAt: new Date(),
		},
	]);

	const [c] = await db
		.insert(client)
		.values({ organizationId: ORG, name: "Acme" })
		.returning();
	if (!c) throw new Error("Failed to seed client");

	const [p] = await db
		.insert(project)
		.values({
			organizationId: ORG,
			clientId: c.id,
			name: "Product",
			type: "product_team" as const,
		})
		.returning();
	if (!p) throw new Error("Failed to seed project");
	projectId = p.id;

	await db.insert(projectMember).values([
		{
			organizationId: ORG,
			projectId,
			userId: WORKER,
			role: "member",
			active: true,
		},
		{
			organizationId: ORG,
			projectId,
			userId: STRANGER,
			role: "member",
			active: true,
		},
	]);

	// Migration 0024 already seeds the site-scoped Meeting and Break tasks, so
	// this adds only the org task it needs — inserting Meeting again would
	// violate task_site_name_uidx.
	const [t] = await db
		.insert(task)
		.values({
			organizationId: ORG,
			name: "Development",
			scope: "organization" as const,
			systemKey: "development" as const,
		})
		.returning();
	if (!t) throw new Error("Failed to seed task");
	devTaskId = t.id;

	await db
		.insert(projectTask)
		.values({ organizationId: ORG, projectId, taskId: devTaskId });
});

afterAll(async () => {
	setChatModelForTests(null);
	await harness.close();
});

beforeEach(async () => {
	script = [];
	seen = [];
	await db.delete(assistantConversation);
	await db.delete(assistantSettings);
	await db.delete(timeEntry);
	await db
		.insert(assistantSettings)
		.values({ organizationId: ORG, apiKey: KEY, defaultModel: "test/model" });
});

/**
 * A conversation that is already named.
 *
 * Naming a thread costs a real (small) completion, so an unnamed one would eat
 * a scripted turn at the end of every test that sends a first message —
 * shifting the queue out from under assertions that are about the LOOP, not
 * about titling. Titling gets its own block below, where it is the subject.
 */
const startChat = async (ctx: Ctx) => {
	const conversation = await assistantService.conversations.create(ctx);
	await assistantService.conversations.rename(ctx, {
		conversationId: conversation.id,
		title: "Test chat",
	});
	return conversation;
};

describe("settings", () => {
	test("the API key never comes back out", async () => {
		const view = await assistantService.settings.get(ctxFor(WORKER));
		expect(view.configured).toBe(true);
		// Leading characters only, and never the tail — the end of the key is the
		// unguessable part, so it is the part the hint must not carry.
		expect(view.keyHint).toBe("sk-or-v1-abc123••••••••");
		expect(view.keyHint).not.toContain(KEY.slice(-4));
		expect(JSON.stringify(view)).not.toContain(KEY);
	});

	test("an unconfigured org reports as not connected rather than throwing", async () => {
		await db.delete(assistantSettings);
		const view = await assistantService.settings.get(ctxFor(WORKER));
		expect(view.configured).toBe(false);
		expect(view.keyHint).toBeNull();
	});

	test("only an admin may connect or change it", async () => {
		await expect(
			assistantService.settings.set(ctxFor(WORKER), {
				apiKey: KEY,
				defaultModel: "test/model",
			}),
		).rejects.toThrow(/Admin access required/);
		await expect(
			assistantService.settings.update(ctxFor(WORKER), { enabled: false }),
		).rejects.toThrow(/Admin access required/);
		await expect(
			assistantService.settings.listModels(ctxFor(WORKER)),
		).rejects.toThrow(/Admin access required/);
	});

	test("disabled is a real state — the loop refuses, the history survives", async () => {
		const chat = await startChat(ctxFor(WORKER));
		await assistantService.settings.update(ctxFor(ADMIN), { enabled: false });

		script = [turn({ content: "hi" })];
		await expect(
			collect(ctxFor(WORKER), { conversationId: chat.id, message: "hello" }),
		).rejects.toThrow(/not connected/i);

		const rows = await assistantService.conversations.list(ctxFor(WORKER));
		expect(rows).toHaveLength(1);
	});
});

// The operator's kill switch, distinct from the org's own pause. Every path
// that could spend money or write an entry has to be closed by it, and the one
// path that cleans up after it has to stay open.
describe("the ASSISTANT_ENABLED switch", () => {
	const off =
		<T>(work: () => Promise<T>) =>
		async () => {
			process.env.ASSISTANT_ENABLED = "false";
			try {
				return await work();
			} finally {
				// `delete`, not `= undefined`: assigning undefined to a process.env slot
				// coerces to the STRING "undefined" in Node, which is not "true" and so
				// would leave the switch stuck off for every test after this one.
				delete process.env.ASSISTANT_ENABLED;
			}
		};

	test("closes the loop", async () => {
		const chat = await startChat(ctxFor(WORKER));
		script = [turn({ content: "hi" })];
		await off(async () => {
			await expect(
				collect(ctxFor(WORKER), { conversationId: chat.id, message: "hello" }),
			).rejects.toThrow(/switched off/i);
		})();
		// The model was never reached, so nothing was billed.
		expect(script).toHaveLength(1);
	});

	test("closes starting a conversation, storing a key, and the catalogue", async () => {
		await off(async () => {
			await expect(
				assistantService.conversations.create(ctxFor(WORKER)),
			).rejects.toThrow(/switched off/i);
			await expect(
				assistantService.settings.set(ctxFor(ADMIN), {
					apiKey: KEY,
					defaultModel: "test/model",
				}),
			).rejects.toThrow(/switched off/i);
			await expect(
				assistantService.settings.listModels(ctxFor(ADMIN)),
			).rejects.toThrow(/switched off/i);
		})();
	});

	test("but NOT disconnecting — the key must stay removable", async () => {
		await off(async () => {
			// The likely sequence: the operator switches the feature off because
			// something went wrong, and an admin then wants the credential out of
			// the database. Refusing here would strand it.
			await assistantService.settings.disconnect(ctxFor(ADMIN));
		})();
		const view = await assistantService.settings.get(ctxFor(ADMIN));
		expect(view.configured).toBe(false);
	});

	test("default is on, so an unset variable changes nothing", async () => {
		expect(process.env.ASSISTANT_ENABLED).toBeUndefined();
		const chat = await startChat(ctxFor(WORKER));
		script = [turn({ content: "still here" })];
		const events = await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "hello",
		});
		expect(events.at(-1)).toEqual({ type: "done" });
	});
});

describe("conversations", () => {
	test("belong to one person — another member's is not found", async () => {
		const chat = await startChat(ctxFor(WORKER));
		await expect(
			assistantService.conversations.get(ctxFor(STRANGER), chat.id),
		).rejects.toThrow(/not found/i);
		expect(await assistantService.conversations.list(ctxFor(STRANGER))).toEqual(
			[],
		);
	});

	test("and to one org — the same user in another org sees nothing", async () => {
		await startChat(ctxFor(WORKER));
		expect(
			await assistantService.conversations.list(ctxFor(WORKER, OTHER_ORG)),
		).toEqual([]);
	});

	test("a rename sticks — the namer only ever fills in a placeholder", async () => {
		const chat = await assistantService.conversations.create(ctxFor(WORKER));
		await assistantService.conversations.rename(ctxFor(WORKER), {
			conversationId: chat.id,
			title: "Weekly check",
		});

		script = [turn({ content: "Sure." })];
		await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "how many hours did I log?",
		});
		const [row] = await assistantService.conversations.list(ctxFor(WORKER));
		expect(row?.title).toBe("Weekly check");
		// And no title call was made, so the queue is untouched.
		expect(script).toHaveLength(0);
	});
});

describe("thread titles", () => {
	test("are written by the model, not truncated from the message", async () => {
		const chat = await assistantService.conversations.create(ctxFor(WORKER));
		script = [
			turn({ content: "You logged 12 hours." }),
			// The second call is the titler: no tools, one short answer.
			turn({ content: "Acme hours in March" }),
		];

		const events = await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message:
				"How many hours did I log against the Acme rebrand project in March?",
		});

		const [row] = await assistantService.conversations.list(ctxFor(WORKER));
		expect(row?.title).toBe("Acme hours in March");
		// The client is told, so the rail relabels without a refetch.
		expect(events).toContainEqual({
			type: "title",
			title: "Acme hours in March",
		});

		// The titler is asked on its own, with the message and no conversation
		// history or tools — otherwise it would be billed for the whole thread.
		const titleCall = seen.at(-1) ?? [];
		expect(titleCall).toHaveLength(2);
		expect(titleCall[0]?.role).toBe("system");
		expect(titleCall[0]?.content).toMatch(/title/i);
	});

	test("a placeholder stands in until it lands", async () => {
		const chat = await assistantService.conversations.create(ctxFor(WORKER));
		script = [turn({ content: "ok" }), turn({ content: "Unfiled time" })];
		const events = await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "what is not filed yet?",
		});
		// Two title events: the truncation first, so the rail is never blank, then
		// the real one.
		const titles = events.filter((e) => e.type === "title");
		expect(titles).toHaveLength(2);
		expect(titles[0]).toEqual({
			type: "title",
			title: "what is not filed yet?",
		});
		expect(titles[1]).toEqual({ type: "title", title: "Unfiled time" });
	});

	test("a failed or rambling title leaves the placeholder alone", async () => {
		const chat = await assistantService.conversations.create(ctxFor(WORKER));
		// One turn only: the titler's call finds an empty queue and throws, which
		// is the same path as a rate limit or a refusal.
		script = [turn({ content: "ok" })];
		await collect(ctxFor(WORKER), { conversationId: chat.id, message: "hi" });
		let [row] = await assistantService.conversations.list(ctxFor(WORKER));
		expect(row?.title).toBe("hi");

		const rambler = await assistantService.conversations.create(ctxFor(WORKER));
		script = [
			turn({ content: "ok" }),
			turn({
				content:
					"Certainly! Here is a title for your conversation, which I have chosen because it captures the essence of what you were asking about in some detail.",
			}),
		];
		await collect(ctxFor(WORKER), {
			conversationId: rambler.id,
			message: "second question",
		});
		[row] = await assistantService.conversations.list(ctxFor(WORKER));
		expect(row?.title).toBe("second question");
	});

	test("the turn still completes when naming the thread fails", async () => {
		const chat = await assistantService.conversations.create(ctxFor(WORKER));
		script = [turn({ content: "Here is your answer." })];
		const events = await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "anything",
		});
		expect(events.some((e) => e.type === "delta")).toBe(true);
		expect(events.some((e) => e.type === "done")).toBe(true);
	});
});

describe("read tools", () => {
	beforeEach(async () => {
		await db.insert(timeEntry).values([
			{
				organizationId: ORG,
				userId: WORKER,
				projectId,
				taskId: devTaskId,
				date: "2026-03-02",
				durationSeconds: 4 * 3600,
				description: "worker's own work",
			},
			{
				organizationId: ORG,
				userId: STRANGER,
				projectId,
				taskId: devTaskId,
				date: "2026-03-02",
				durationSeconds: 7 * 3600,
				description: "somebody else's work",
			},
		]);
	});

	test("unfiled entries can be listed and then filed", async () => {
		// The round trip that was impossible: `file_time_entries` takes entry ids
		// and nothing produced any. `unfiled_summary` counts them, and
		// `list_time_entries` reports a null project for absence too — so the one
		// action that clears what blocks the close could only be aimed by guessing.
		const [unfiled] = await db
			.insert(timeEntry)
			.values({
				organizationId: ORG,
				userId: WORKER,
				projectId: null,
				taskId: devTaskId,
				date: "2026-03-04",
				durationSeconds: 3600,
				description: "synced standup",
			})
			.returning();
		if (!unfiled) throw new Error("Failed to seed unfiled entry");

		const range = { from: "2026-03-01", to: "2026-03-31" };
		// SAFETY: `list_unfiled_entries` is asserted to exist by the `?.run` returning
		// a value at all, and its projection is fixed in assistant-tools.ts. Only `id`
		// is read, and the expectation below fails loudly if the shape ever changed.
		const listed = (await findTool("list_unfiled_entries")?.run(
			ctxFor(WORKER),
			range,
		)) as { id: string }[];

		// Only the unattributed one — the two filed entries seeded above are not
		// somebody's to-do.
		expect(listed.map((row) => row.id)).toEqual([unfiled.id]);

		await findTool("file_time_entries")?.run(ctxFor(WORKER), {
			timeEntryIds: listed.map((row) => row.id),
			projectId,
		});

		expect(
			await findTool("list_unfiled_entries")?.run(ctxFor(WORKER), range),
		).toEqual([]);
	});

	test("run inline and answer as the caller, not as the org", async () => {
		const chat = await startChat(ctxFor(WORKER));
		script = [
			turn({
				toolCalls: [
					{
						id: "call-1",
						name: "list_time_entries",
						arguments: JSON.stringify({ from: "2026-03-01", to: "2026-03-31" }),
					},
				],
			}),
			turn({ content: "You logged 4 hours." }),
		];

		const events = await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "what did I log in March?",
		});
		expect(events.some((e) => e.type === "tool_start")).toBe(true);
		expect(events.at(-1)).toEqual({ type: "done" });

		// Property 2: the tool result the model was shown contains the caller's
		// entry and not their colleague's, because listRange filtered on ctx.userId.
		const toolRow = (
			await db.query.assistantMessage.findMany({
				where: eq(assistantMessage.conversationId, chat.id),
			})
		).find((row) => row.role === "tool");
		expect(toolRow?.content).toContain("worker's own work");
		expect(toolRow?.content).not.toContain("somebody else's work");
	});

	test("the 62-day range ceiling still holds when the model asks", async () => {
		const chat = await startChat(ctxFor(WORKER));
		script = [
			turn({
				toolCalls: [
					{
						id: "call-1",
						name: "list_time_entries",
						arguments: JSON.stringify({ from: "2020-01-01", to: "2026-12-31" }),
					},
				],
			}),
			turn({ content: "That range is too wide." }),
		];

		await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "everything I've ever logged",
		});

		const toolRow = (
			await db.query.assistantMessage.findMany({
				where: eq(assistantMessage.conversationId, chat.id),
			})
		).find((row) => row.role === "tool");
		expect(toolRow?.content).toMatch(/Error/);
		expect(toolRow?.content).toMatch(/62 days/);
	});

	test("an org-wide-looking report is still gated on the caller's role", async () => {
		// The one read whose SHAPE is organization-wide. WORKER is a plain member
		// with no Team Lead or PM assignment, so `reportScope` refuses — exactly as
		// it does for the Reports screen, which they cannot reach either. Worth
		// pinning explicitly: every other read is obviously self-scoped by its own
		// WHERE clause, and this is the one that would quietly answer for the whole
		// organization if the gate ever moved into the route instead of the service.
		//
		// There are now two layers, and the test names both. The tool is not in
		// WORKER's list at all, so an honest model never reaches for it; a model
		// that names it anyway — from an earlier turn, or from a conversation
		// started while its owner still held the role — is refused before the
		// service is called. Neither layer is the authorization: the service's own
		// `reportScope` still is, and it is what the ADMIN case below goes through.
		const chat = await startChat(ctxFor(WORKER));
		script = [
			turn({
				toolCalls: [
					{
						id: "call-rep",
						name: "time_report_summary",
						arguments: JSON.stringify({
							from: "2026-03-01",
							to: "2026-03-31",
							tab: "teammates",
						}),
					},
				],
			}),
			turn({ content: "You can't see that report." }),
		];

		await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "how did the whole team do in March?",
		});

		const toolRow = (
			await db.query.assistantMessage.findMany({
				where: eq(assistantMessage.conversationId, chat.id),
			})
		).find((row) => row.role === "tool");
		expect(toolRow?.content).toMatch(/not available to this user/i);
		// And no colleague's hours reached the model.
		expect(toolRow?.content).not.toContain("somebody else's work");
	});

	test("the tool list is scoped to the caller", async () => {
		// Every definition is re-sent on every step of every turn, so a tool the
		// caller can never use is both a standing token cost and a step spent
		// being refused. Asserted on the two ends of the matrix rather than on a
		// count, which would be a test of how many tools exist.
		const [workerAccess, adminAccess] = await Promise.all([
			accessService.resolve(ctxFor(WORKER)),
			accessService.resolve(ctxFor(ADMIN)),
		]);
		const names = (access: Access) => toolsFor(access).map((tool) => tool.name);

		const worker = names(workerAccess);
		const admin = names(adminAccess);

		// A plain member keeps everything about their own time...
		for (const own of [
			"whoami",
			"list_time_entries",
			"list_unfiled_entries",
			"log_absence",
			"copy_day",
			"delete_time_entry",
		]) {
			expect(worker).toContain(own);
		}
		// ...and is offered nothing about anyone else's, the close, or the org.
		for (const theirs of [
			"time_report_summary",
			"close_sheet",
			"close_finalize",
			"absence_report",
			"create_task",
			"assign_project_member",
		]) {
			expect(worker).not.toContain(theirs);
			expect(admin).toContain(theirs);
		}
	});

	test("every tool the model is offered can be dispatched", async () => {
		// The list the model is shown and the list `findTool` can dispatch are two
		// places, and a tool present in one and absent from the other fails only at
		// the moment somebody asks for it.
		const access = await accessService.resolve(ctxFor(ADMIN));
		for (const definition of toolDefinitions(access)) {
			expect(findTool(definition.function.name)).toBeDefined();
		}
	});

	test("a tool error is handed back to the model, not thrown at the user", async () => {
		const chat = await startChat(ctxFor(WORKER));
		script = [
			turn({
				toolCalls: [
					{ id: "call-1", name: "list_time_entries", arguments: "{not json" },
				],
			}),
			turn({ content: "Sorry, let me try again." }),
		];

		const events = await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "hmm",
		});
		expect(events.some((e) => e.type === "error")).toBe(false);
		expect(events.some((e) => e.type === "tool_result" && e.ok === false)).toBe(
			true,
		);
	});
});

describe("approval, on the tier that asks for it", () => {
	// Deletion is the shape every approval property is easiest to state against:
	// the row either survives or it doesn't. Creates and corrections deliberately
	// do NOT come through here any more — see "approval tiers" below.
	const seedEntry = async () => {
		const [row] = await db
			.insert(timeEntry)
			.values({
				organizationId: ORG,
				userId: WORKER,
				projectId,
				taskId: devTaskId,
				date: "2026-03-03",
				durationSeconds: 2 * 3600,
				description: "code review",
			})
			.returning();
		if (!row) throw new Error("Failed to seed entry");
		return row;
	};

	const deleteCall = (timeEntryId: string) => ({
		id: "call-del",
		name: "delete_time_entry",
		arguments: JSON.stringify({ timeEntryId }),
	});

	test("the card names the thing, not its id", async () => {
		// What is being consented to has to be recognisable. "Delete a time entry"
		// and "Archive project 3f2a9b1c…" are both things nobody can meaningfully
		// agree to, and the second one looks like it says something.
		const entry = await seedEntry();
		const chat = await startChat(ctxFor(WORKER));
		script = [turn({ toolCalls: [deleteCall(entry.id)] })];

		const events = await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "delete my code review entry",
		});

		const card = events.find((e) => e.type === "approval_required");
		expect(card?.summary).toContain("code review");
		expect(card?.summary).toContain("2026-03-03");
		// And the id it was aimed with is not what the person is asked about.
		expect(card?.summary).not.toContain(entry.id);
	});

	test("an approval card whose lookup fails still renders", async () => {
		// This runs on the way to ASKING for consent. A summary that threw would
		// leave a person with a pending write and no card to answer it with.
		const chat = await startChat(ctxFor(WORKER));
		script = [
			turn({ toolCalls: [deleteCall("00000000-0000-4000-8000-000000000000")] }),
		];

		const events = await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "delete something that isn't there",
		});
		expect(events.find((e) => e.type === "approval_required")?.summary).toMatch(
			/delete a time entry/i,
		);
	});

	test("suspends before acting, and nothing changes until approved", async () => {
		const entry = await seedEntry();
		const chat = await startChat(ctxFor(WORKER));
		script = [turn({ toolCalls: [deleteCall(entry.id)] })];

		const events = await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "delete my code review entry",
		});

		expect(events.some((e) => e.type === "approval_required")).toBe(true);
		expect(await db.select().from(timeEntry)).toHaveLength(1);
		// The model was not asked to continue — the queue is untouched.
		expect(script).toHaveLength(0);
	});

	test("approving executes exactly once and the loop continues", async () => {
		const entry = await seedEntry();
		const chat = await startChat(ctxFor(WORKER));
		script = [turn({ toolCalls: [deleteCall(entry.id)] })];
		await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "delete it",
		});

		script = [turn({ content: "Deleted." })];
		const events = await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			resolve: { toolCallId: "call-del", decision: "approved" },
		});
		expect(await db.select().from(timeEntry)).toHaveLength(0);
		expect(events.at(-1)).toEqual({ type: "done" });

		// Double-approve (two tabs, or a double click) is a no-op rather than a
		// second execution — which for a delete would surface as a spurious error.
		await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			resolve: { toolCallId: "call-del", decision: "approved" },
		});
		expect(await db.select().from(timeEntry)).toHaveLength(0);
	});

	test("rejecting changes nothing but still completes the tool call", async () => {
		const entry = await seedEntry();
		const chat = await startChat(ctxFor(WORKER));
		script = [turn({ toolCalls: [deleteCall(entry.id)] })];
		await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "delete it",
		});

		script = [turn({ content: "No problem." })];
		await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			resolve: { toolCallId: "call-del", decision: "rejected" },
		});

		expect(await db.select().from(timeEntry)).toHaveLength(1);

		// Property 4: the turn the model was last shown pairs every tool_call with
		// a tool result, so the next request is well-formed even though the user
		// said no.
		const last = seen.at(-1) ?? [];
		const calls = last.flatMap((m) =>
			m.role === "assistant" && m.tool_calls
				? m.tool_calls.map((c) => c.id)
				: [],
		);
		const results = last.flatMap((m) =>
			m.role === "tool" ? [m.tool_call_id] : [],
		);
		expect(calls).toEqual(["call-del"]);
		expect(results).toEqual(["call-del"]);
	});

	test("the pending action survives a reload — it lives on the row", async () => {
		const entry = await seedEntry();
		const chat = await startChat(ctxFor(WORKER));
		script = [turn({ toolCalls: [deleteCall(entry.id)] })];
		await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "delete it",
		});

		// Nothing in memory: this is what the page's loader would read.
		const { messages } = await assistantService.conversations.get(
			ctxFor(WORKER),
			chat.id,
		);
		const pending = messages.find((row) => row.pendingApproval);
		expect(pending?.toolCalls?.[0]?.id).toBe("call-del");
		expect(pending?.approvalDecision).toBeNull();
		// The wording the card shows is stored, not recomputed: the summaries come
		// from `assistant-tools.ts`, which the browser cannot import at all.
		expect(pending?.approvalSummary).toMatch(/delete/i);

		// And the resume path re-offers it, so a page that rebuilt the card from
		// that row can act on it.
		script = [turn({ content: "Done." })];
		const events = await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			resolve: { toolCallId: "call-del", decision: "approved" },
		});
		expect(events.some((e) => e.type === "tool_result" && e.ok)).toBe(true);
		expect(await db.select().from(timeEntry)).toHaveLength(0);
	});

	test("consent is not authorisation — the service still gets the last word", async () => {
		// STRANGER is a real member of the same project, and approves deleting an
		// entry that belongs to WORKER. The approval is genuine; the delete must
		// still fail, because `remove` is scoped to the caller's own rows.
		const victim = await seedEntry();
		const chat = await startChat(ctxFor(STRANGER));
		script = [turn({ toolCalls: [deleteCall(victim.id)] })];
		await collect(ctxFor(STRANGER), {
			conversationId: chat.id,
			message: "delete that entry",
		});

		script = [turn({ content: "I couldn't delete it." })];
		const events = await collect(ctxFor(STRANGER), {
			conversationId: chat.id,
			resolve: { toolCallId: "call-del", decision: "approved" },
		});

		expect(events.some((e) => e.type === "tool_result" && e.ok === false)).toBe(
			true,
		);
		expect(await db.select().from(timeEntry)).toHaveLength(1);
		const toolRow = (
			await db.query.assistantMessage.findMany({
				where: eq(assistantMessage.conversationId, chat.id),
			})
		).find((row) => row.role === "tool");
		expect(toolRow?.content).toMatch(/nothing was deleted/i);
	});
});

// notice.
describe("approval tiers", () => {
	test("creating runs inline — no card, and it actually happened", async () => {
		const chat = await startChat(ctxFor(ADMIN));
		script = [
			turn({
				toolCalls: [
					{
						id: "call-client",
						name: "create_client",
						arguments: JSON.stringify({ name: "Northwind" }),
					},
				],
			}),
			turn({ content: "Created Northwind." }),
		];

		const events = await collect(ctxFor(ADMIN), {
			conversationId: chat.id,
			message: "make a client called Northwind",
		});
		expect(events.some((e) => e.type === "approval_required")).toBe(false);
		expect(events.some((e) => e.type === "tool_result" && e.ok)).toBe(true);

		const clients = await clientsService.list(ctxFor(ADMIN));
		expect(clients.map((row) => row.name)).toContain("Northwind");
	});

	test("archiving asks first, and archives nothing until it is allowed", async () => {
		const chat = await startChat(ctxFor(ADMIN));
		script = [
			turn({
				toolCalls: [
					{
						id: "call-arch",
						name: "archive_project",
						arguments: JSON.stringify({ projectId }),
					},
				],
			}),
		];

		const events = await collect(ctxFor(ADMIN), {
			conversationId: chat.id,
			message: "archive the Product project",
		});
		expect(events.some((e) => e.type === "approval_required")).toBe(true);

		const [before] = await db
			.select()
			.from(project)
			.where(eq(project.id, projectId));
		expect(before?.status).toBe("active");

		script = [turn({ content: "Archived." })];
		await collect(ctxFor(ADMIN), {
			conversationId: chat.id,
			resolve: { toolCallId: "call-arch", decision: "approved" },
		});
		const [after] = await db
			.select()
			.from(project)
			.where(eq(project.id, projectId));
		expect(after?.status).toBe("archived");

		// Put it back for the tests that follow.
		await projectsService.unarchive(ctxFor(ADMIN), projectId);
	});

	test("a member's create is refused by the service, not by the tool", async () => {
		// WORKER is a plain member with no project role, so `canCreateProjects`
		// says no. The tool doesn't know that and doesn't need to — the point is
		// that the refusal comes back as a tool result the model can explain.
		const chat = await startChat(ctxFor(WORKER));
		script = [
			turn({
				toolCalls: [
					{
						id: "call-proj",
						name: "create_project",
						arguments: JSON.stringify({
							name: "Sneaky",
							clientId: "00000000-0000-4000-8000-000000000000",
							type: "internal",
							taskIds: [],
						}),
					},
				],
			}),
			turn({ content: "You aren't allowed to create projects." }),
		];
		const events = await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "make a project",
		});
		expect(events.some((e) => e.type === "tool_result" && !e.ok)).toBe(true);
		const made = await db
			.select()
			.from(project)
			.where(eq(project.name, "Sneaky"));
		expect(made).toHaveLength(0);
	});
});

describe("a batch write, approved row by row", () => {
	// `file_time_entries` is the shape the diff table exists for: one call that
	// touches N rows, where "yes, but not that one" is a thing people mean and
	// approve/reject alone cannot express. Every property below is about the
	// gap between what the model asked for and what the person agreed to.
	const seedUnfiled = async (count: number) => {
		const rows = await db
			.insert(timeEntry)
			.values(
				Array.from({ length: count }, (_, index) => ({
					organizationId: ORG,
					userId: WORKER,
					projectId: null,
					taskId: devTaskId,
					date: `2026-04-0${index + 1}`,
					durationSeconds: 3600,
					description: `unfiled ${index + 1}`,
				})),
			)
			.returning();
		return rows;
	};

	const fileCall = (ids: string[]) => ({
		id: "call-file",
		name: "file_time_entries",
		arguments: JSON.stringify({ timeEntryIds: ids, projectId }),
	});

	test("it asks first, with a row per entry, and files nothing yet", async () => {
		const entries = await seedUnfiled(3);
		const chat = await startChat(ctxFor(WORKER));
		script = [turn({ toolCalls: [fileCall(entries.map((row) => row.id))] })];

		const events = await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "file all my unfiled time to Product",
		});

		const card = events.find((e) => e.type === "approval_required");
		expect(card?.preview?.rows).toHaveLength(3);
		expect(card?.selectable).toBe(true);
		// The rows say what they are, not which uuid they are.
		expect(card?.preview?.rows[0]?.cells.join(" ")).toContain("unfiled 1");
		expect(card?.preview?.rows[0]?.cells.join(" ")).not.toContain(
			entries[0]?.id,
		);

		// And nothing has moved.
		const after = await db
			.select()
			.from(timeEntry)
			.where(eq(timeEntry.userId, WORKER));
		expect(
			after
				.filter((row) => row.description?.startsWith("unfiled"))
				.every((row) => row.projectId === null),
		).toBe(true);
	});

	test("approving a subset files exactly that subset", async () => {
		const entries = await seedUnfiled(3);
		const ids = entries.map((row) => row.id);
		const chat = await startChat(ctxFor(WORKER));
		script = [turn({ toolCalls: [fileCall(ids)] })];
		await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "file these",
		});

		script = [turn({ content: "Filed two of them." })];
		await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			resolve: {
				toolCallId: "call-file",
				decision: "approved",
				// The middle row was un-ticked.
				selectedRowIds: [at(ids, 0), at(ids, 2)],
			},
		});

		const rows = await db
			.select()
			.from(timeEntry)
			.where(eq(timeEntry.userId, WORKER));
		const byId = new Map(rows.map((row) => [row.id, row]));
		expect(byId.get(at(ids, 0))?.projectId).toBe(projectId);
		expect(byId.get(at(ids, 2))?.projectId).toBe(projectId);
		// The un-ticked one is the whole point: it must still be unfiled.
		expect(byId.get(at(ids, 1))?.projectId).toBeNull();
	});

	test("approving with nothing ticked writes nothing and is answered as a refusal", async () => {
		// "None of these" arrives on the approve path (the card sends an empty
		// selection), and must not be read as "the whole batch" — nor left as a
		// tool call with no result, which 400s the next request.
		const entries = await seedUnfiled(2);
		const ids = entries.map((row) => row.id);
		const chat = await startChat(ctxFor(WORKER));
		script = [turn({ toolCalls: [fileCall(ids)] })];
		await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "file these",
		});

		script = [turn({ content: "Nothing filed then." })];
		await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			resolve: {
				toolCallId: "call-file",
				decision: "approved",
				selectedRowIds: [],
			},
		});

		const rows = await db
			.select()
			.from(timeEntry)
			.where(eq(timeEntry.userId, WORKER));
		const byId = new Map(rows.map((row) => [row.id, row]));
		expect(byId.get(at(ids, 0))?.projectId).toBeNull();
		expect(byId.get(at(ids, 1))?.projectId).toBeNull();

		const messages = await db
			.select()
			.from(assistantMessage)
			.where(eq(assistantMessage.conversationId, chat.id));
		const result = messages.find((row) => row.toolCallId === "call-file");
		expect(result?.role).toBe("tool");
		expect(result?.content).toMatch(/selected none/i);
	});

	test("the rows are stored on the message, so a reload shows what was consented to", async () => {
		const entries = await seedUnfiled(2);
		const chat = await startChat(ctxFor(WORKER));
		script = [turn({ toolCalls: [fileCall(entries.map((row) => row.id))] })];
		await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "file these",
		});

		const [pending] = await db
			.select()
			.from(assistantMessage)
			.where(eq(assistantMessage.pendingApproval, true));
		expect(pending?.approvalPreview?.rows).toHaveLength(2);
		expect(pending?.approvalPreview?.selectable).toBe(true);
	});
});

describe("house rules", () => {
	test("are appended below the built-in prompt, never instead of it", async () => {
		await assistantService.settings.update(ctxFor(ADMIN), {
			systemPrompt: "We bill in 30-minute blocks.",
		});
		const chat = await startChat(ctxFor(WORKER));
		script = [turn({ content: "ok" })];
		await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "hi",
		});

		const system = seen.at(-1)?.[0];
		expect(system?.role).toBe("system");
		const text = system?.content ?? "";
		// Both halves present, in that order, and the org's half fenced and
		// explicitly ranked lower.
		expect(text).toContain("multiple of 900");
		expect(text).toContain("We bill in 30-minute blocks.");
		expect(text.indexOf("multiple of 900")).toBeLessThan(
			text.indexOf("We bill in 30-minute blocks."),
		);
		expect(text).toContain("<house-rules>");
		expect(text).toMatch(/the rules above win/i);
	});

	test("an empty string clears them; absent leaves them alone", async () => {
		await assistantService.settings.update(ctxFor(ADMIN), {
			systemPrompt: "Something.",
		});
		await assistantService.settings.update(ctxFor(ADMIN), { enabled: true });
		expect(
			(await assistantService.settings.get(ctxFor(ADMIN))).systemPrompt,
		).toBe("Something.");

		await assistantService.settings.update(ctxFor(ADMIN), {
			systemPrompt: null,
		});
		expect(
			(await assistantService.settings.get(ctxFor(ADMIN))).systemPrompt,
		).toBeNull();
	});

	test("only an admin may set them", async () => {
		await expect(
			assistantService.settings.update(ctxFor(WORKER), {
				systemPrompt: "mine now",
			}),
		).rejects.toThrow(/Admin access required/);
	});
});

describe("the loop's ceiling", () => {
	test("stops and says so rather than calling tools forever", async () => {
		const chat = await startChat(ctxFor(WORKER));
		script = Array.from({ length: 12 }, (_, i) =>
			turn({
				toolCalls: [
					{
						id: `call-${i}`,
						name: "list_projects",
						arguments: "{}",
					},
				],
			}),
		);

		const events = await collect(ctxFor(WORKER), {
			conversationId: chat.id,
			message: "go forever",
		});
		const error = events.find((e) => e.type === "error");
		expect(error).toBeDefined();
		// Eight steps, not twelve.
		expect(script).toHaveLength(4);
	});
});
