// Undo of an inline write, and the replacement of the last turn.

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
	assistantUsage,
} from "../db/schema/assistant";
import { member, organization, user } from "../db/schema/auth";
import {
	client,
	project,
	projectMember,
	task,
	timeEntry,
} from "../db/schema/domain";
import type { JsonRecord } from "../lib/json";
import type { ChatMessage, ChatTurn } from "../lib/openrouter-client";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { assistantService, setChatModelForTests } from "./assistant.service";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG = "org-undo";
const ME = "u-undo-me";
const OTHER = "u-undo-other";

const mine: Ctx = { organizationId: ORG, userId: ME };
const other: Ctx = { organizationId: ORG, userId: OTHER };

let harness: TestDb;
let projectId = "";
let devTaskId = "";
let script: ChatTurn[] = [];
let seen: ChatMessage[][] = [];

const turn = (over: Partial<ChatTurn> = {}): ChatTurn => ({
	content: "",
	toolCalls: [],
	promptTokens: null,
	completionTokens: null,
	costUsd: null,
	finishReason: null,
	...over,
});

const call = (id: string, name: string, args: JsonRecord) => ({
	id,
	name,
	arguments: JSON.stringify(args),
});

const logArgs = { date: "2026-03-04", durationSeconds: 3600 };
const createCall = (id = "c1") =>
	call(id, "create_time_entry", {
		...logArgs,
		projectId,
		taskId: devTaskId,
		description: "review",
	});

const ask = async (chatId: string, message: string, turns: ChatTurn[]) => {
	script = turns;
	await assistantService.run(
		mine,
		{ conversationId: chatId, message },
		() => {},
	);
};

const toolRow = async (chatId: string) =>
	present(
		(
			await db.query.assistantMessage.findMany({
				where: eq(assistantMessage.conversationId, chatId),
			})
		).find((row) => row.role === "tool"),
		"tool row",
	);

/** A thread whose first question made one entry. */
const loggedThread = async () => {
	const chat = await assistantService.conversations.create(mine);
	await assistantService.conversations.rename(mine, {
		conversationId: chat.id,
		title: "t",
	});
	await ask(chat.id, "log an hour", [
		turn({ toolCalls: [createCall()] }),
		turn({ content: "Done." }),
	]);
	return chat.id;
};

beforeAll(async () => {
	harness = await createTestDb();
	setChatModelForTests({
		streamChatCompletion: async (opts) => {
			seen.push(opts.messages);
			return present(script.shift(), "scripted turn");
		},
		listModels: async () => [],
		verifyKey: async () => {},
	});
	await db
		.insert(organization)
		.values({ id: ORG, name: "Undo", slug: ORG, createdAt: new Date() });
	for (const id of [ME, OTHER]) {
		await db.insert(user).values({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await db.insert(member).values({
			id: `m-${id}`,
			organizationId: ORG,
			userId: id,
			role: "member",
			createdAt: new Date(),
		});
	}
	const acme = at(
		await db
			.insert(client)
			.values({ organizationId: ORG, name: "Acme" })
			.returning(),
		0,
	);
	const proj = at(
		await db
			.insert(project)
			.values({
				organizationId: ORG,
				clientId: acme.id,
				name: "Product",
				type: "product_team" as const,
			})
			.returning(),
		0,
	);
	projectId = proj.id;
	await db.insert(projectMember).values({
		organizationId: ORG,
		projectId,
		userId: ME,
		role: "member",
		active: true,
	});
	const dev = at(
		await db
			.insert(task)
			.values({
				organizationId: ORG,
				name: "Development",
				scope: "organization" as const,
				systemKey: "development" as const,
			})
			.returning(),
		0,
	);
	devTaskId = dev.id;
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
	await db.insert(assistantSettings).values({
		organizationId: ORG,
		apiKey: "sk-or-v1-undo",
		defaultModel: "test/model",
	});
});

describe("undo", () => {
	test("undoing a created entry deletes it, once", async () => {
		const chatId = await loggedThread();
		expect(await db.select().from(timeEntry)).toHaveLength(1);
		const row = await toolRow(chatId);
		expect(row.undo?.kind).toBe("delete_entry");

		await assistantService.undo(mine, {
			conversationId: chatId,
			messageId: row.id,
		});
		expect(await db.select().from(timeEntry)).toHaveLength(0);
		expect((await toolRow(chatId)).undoneAt).not.toBeNull();

		await expect(
			assistantService.undo(mine, {
				conversationId: chatId,
				messageId: row.id,
			}),
		).rejects.toThrow("cannot be undone");
	});

	test("undoing an update restores the previous fields", async () => {
		const chatId = await loggedThread();
		const entry = at(await db.select().from(timeEntry), 0);
		await ask(chatId, "change it", [
			turn({
				toolCalls: [
					call("c2", "update_time_entry", {
						timeEntryId: entry.id,
						date: "2026-03-05",
						projectId,
						taskId: devTaskId,
						durationSeconds: 7200,
						description: "changed",
					}),
				],
			}),
			turn({ content: "Changed." }),
		]);
		const changed = at(await db.select().from(timeEntry), 0);
		expect(changed.durationSeconds).toBe(7200);

		const rows = await db.query.assistantMessage.findMany({
			where: eq(assistantMessage.conversationId, chatId),
		});
		const updateRow = present(
			rows.find((r) => r.toolName === "update_time_entry"),
			"update row",
		);
		await assistantService.undo(mine, {
			conversationId: chatId,
			messageId: updateRow.id,
		});
		const restored = at(await db.select().from(timeEntry), 0);
		expect(restored.durationSeconds).toBe(3600);
		expect(restored.date).toBe("2026-03-04");
		expect(restored.description).toBe("review");
	});

	test("undo is refused after the entry changed", async () => {
		const chatId = await loggedThread();
		const entry = at(await db.select().from(timeEntry), 0);
		await timeEntriesService.updateDescription(mine, {
			timeEntryId: entry.id,
			description: "edited by hand",
		});
		const row = await toolRow(chatId);
		await expect(
			assistantService.undo(mine, {
				conversationId: chatId,
				messageId: row.id,
			}),
		).rejects.toThrow("changed since");
		expect(await db.select().from(timeEntry)).toHaveLength(1);
		expect((await toolRow(chatId)).undoneAt).toBeNull();
	});

	test("undo is refused for another person's conversation", async () => {
		const chatId = await loggedThread();
		const row = await toolRow(chatId);
		await expect(
			assistantService.undo(other, {
				conversationId: chatId,
				messageId: row.id,
			}),
		).rejects.toThrow("not found");
		expect(await db.select().from(timeEntry)).toHaveLength(1);
	});

	test("the model is told that a later turn's undone write is gone", async () => {
		const chatId = await loggedThread();
		const row = await toolRow(chatId);
		await assistantService.undo(mine, {
			conversationId: chatId,
			messageId: row.id,
		});
		seen = [];
		await ask(chatId, "what now?", [turn({ content: "Nothing." })]);
		const tool = present(
			at(seen, 0).find((m) => m.role === "tool"),
			"tool message",
		);
		expect(tool.content).toContain('"undone":true');
		expect(tool.content).toContain("The person undid this change.");
	});
});

describe("replaceLastTurn", () => {
	test("is refused while a write of the turn stands, allowed after undo", async () => {
		const chatId = await loggedThread();
		await expect(
			assistantService.replaceLastTurn(mine, { conversationId: chatId }),
		).rejects.toThrow("Undo the change first");

		const row = await toolRow(chatId);
		await assistantService.undo(mine, {
			conversationId: chatId,
			messageId: row.id,
		});
		const removed = await assistantService.replaceLastTurn(mine, {
			conversationId: chatId,
		});
		expect(removed.content).toBe("log an hour");
	});

	test("says to ask a new question when a standing write has no inverse", async () => {
		const chat = await assistantService.conversations.create(mine);
		await db.insert(assistantMessage).values([
			{
				organizationId: ORG,
				conversationId: chat.id,
				role: "user",
				content: "make a project",
				createdAt: new Date(1000),
			},
			{
				organizationId: ORG,
				createdAt: new Date(2000),
				conversationId: chat.id,
				role: "tool",
				toolCallId: "p1",
				toolName: "create_project",
				content: '{"ok":true}',
			},
		]);
		await expect(
			assistantService.replaceLastTurn(mine, { conversationId: chat.id }),
		).rejects.toThrow("Ask a new question instead");
	});

	test("deletes exactly the last turn and keeps the usage rows", async () => {
		const chat = await assistantService.conversations.create(mine);
		await assistantService.conversations.rename(mine, {
			conversationId: chat.id,
			title: "t",
		});
		await ask(chat.id, "first", [turn({ content: "One." })]);
		await ask(chat.id, "second", [turn({ content: "Two." })]);
		const usageBefore = await db.select().from(assistantUsage);
		expect(usageBefore.length).toBeGreaterThan(0);

		await assistantService.replaceLastTurn(mine, { conversationId: chat.id });
		const rows = await db.query.assistantMessage.findMany({
			where: eq(assistantMessage.conversationId, chat.id),
		});
		expect(rows.map((r) => r.content).sort()).toEqual(["first", "One."].sort());
		expect(await db.select().from(assistantUsage)).toHaveLength(
			usageBefore.length,
		);
	});

	test("is refused for another person's conversation", async () => {
		const chatId = await loggedThread();
		await expect(
			assistantService.replaceLastTurn(other, { conversationId: chatId }),
		).rejects.toThrow("not found");
	});
});
