// Search across a person's chats, and sharing a chat with the organization.

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
} from "../db/schema/assistant";
import { auditEvent } from "../db/schema/audit";
import { member, organization, user } from "../db/schema/auth";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { assistantService } from "./assistant.service";
import type { Ctx } from "./types";

const ORG = "org-share";
const OTHER_ORG = "org-share-other";
const ME = "u-share-me";
const PEER = "u-share-peer";
const ADMIN = "u-share-admin";
const STRANGER = "u-share-stranger";

const mine: Ctx = { organizationId: ORG, userId: ME };
const peer: Ctx = { organizationId: ORG, userId: PEER };
const admin: Ctx = { organizationId: ORG, userId: ADMIN };
const stranger: Ctx = { organizationId: OTHER_ORG, userId: STRANGER };

let harness: TestDb;

const chat = async (
	owner: Ctx,
	title: string,
	rows: { role: "user" | "assistant" | "tool"; content: string }[] = [],
) => {
	const row = at(
		await db
			.insert(assistantConversation)
			.values({
				organizationId: owner.organizationId,
				userId: owner.userId,
				title,
				model: "test/model",
			})
			.returning(),
		0,
	);
	for (const [index, message] of rows.entries()) {
		await db.insert(assistantMessage).values({
			organizationId: owner.organizationId,
			conversationId: row.id,
			createdAt: new Date(2026, 0, 1, 0, 0, index),
			...message,
		});
	}
	return row.id;
};

const auditKinds = async () =>
	(
		await db
			.select({ kind: auditEvent.kind })
			.from(auditEvent)
			.where(eq(auditEvent.organizationId, ORG))
	)
		.map((row) => row.kind)
		.sort();

beforeAll(async () => {
	harness = await createTestDb();
	for (const id of [ORG, OTHER_ORG]) {
		await db
			.insert(organization)
			.values({ id, name: id, slug: id, createdAt: new Date() });
	}
	const people = [
		[ME, ORG, "member"],
		[PEER, ORG, "member"],
		[ADMIN, ORG, "admin"],
		[STRANGER, OTHER_ORG, "member"],
	] as const;
	for (const [id, organizationId, role] of people) {
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
			organizationId,
			userId: id,
			role,
			createdAt: new Date(),
		});
	}
});

afterAll(async () => {
	await harness.close();
});

beforeEach(async () => {
	await db.delete(assistantConversation);
	await db.delete(auditEvent);
});

describe("search", () => {
	test("matches the title and the body, ignoring case", async () => {
		const byTitle = await chat(mine, "Budget review");
		const byBody = await chat(mine, "Other", [
			{ role: "user", content: "How is the BUDGET for May?" },
		]);
		await chat(mine, "Unrelated", [{ role: "user", content: "hello" }]);
		const hits = await assistantService.search(mine, { q: "budget" });
		expect(hits.map((hit) => hit.id).sort()).toEqual([byTitle, byBody].sort());
		const body = present(
			hits.find((hit) => hit.id === byBody),
			"body hit",
		);
		expect(body.snippet).toContain("BUDGET");
		expect(
			present(
				hits.find((hit) => hit.id === byTitle),
				"title hit",
			).snippet,
		).toBeNull();
	});

	test("a snippet is plain text without fences", async () => {
		const id = await chat(mine, "Chart", [
			{
				role: "assistant",
				content:
					'```farmer-chart\n{"value":6.5}\n```\nBusiest day was [[2026-11-11]].\n```farmer-next\nWhat next?',
			},
		]);
		const [inText, inFence] = await Promise.all([
			assistantService.search(mine, { q: "busiest" }),
			assistantService.search(mine, { q: "value" }),
		]);
		expect(at(inText, 0).id).toBe(id);
		expect(at(inText, 0).snippet).toBe("Busiest day was 2026-11-11.");
		expect(at(inFence, 0).snippet).toBe("Busiest day was 2026-11-11.");
	});

	test("a snippet from a long message sits around the match", async () => {
		const id = await chat(mine, "Long", [
			{
				role: "assistant",
				content: `${"filler ".repeat(500)}the NEEDLE here${" tail".repeat(500)}`,
			},
		]);
		const [hit] = await assistantService.search(mine, { q: "needle" });
		expect(present(hit, "hit").id).toBe(id);
		expect(present(hit, "hit").snippet).toMatch(/^….*the NEEDLE here.*…$/);
		expect(present(hit, "hit").snippet?.length).toBeLessThan(130);
	});

	test("never returns another person's or another org's chat", async () => {
		await chat(peer, "Secret plan", [{ role: "user", content: "secret" }]);
		await chat(stranger, "Secret plan", [{ role: "user", content: "secret" }]);
		expect(await assistantService.search(mine, { q: "secret" })).toEqual([]);
	});

	test("percent and underscore are literal", async () => {
		const percent = await chat(mine, "a", [
			{ role: "user", content: "we hit 100% today" },
		]);
		await chat(mine, "b", [{ role: "user", content: "we hit 1000 today" }]);
		await chat(mine, "c", [{ role: "user", content: "snake_case name" }]);
		await chat(mine, "d", [{ role: "user", content: "snakeXcase name" }]);
		const pct = await assistantService.search(mine, { q: "0%" });
		expect(pct.map((hit) => hit.id)).toEqual([percent]);
		const under = await assistantService.search(mine, { q: "e_c" });
		expect(under).toHaveLength(1);
		expect(at(under, 0).title).toBe("c");
	});

	test("the snippet comes from the earliest match", async () => {
		await chat(mine, "Two", [
			{ role: "user", content: "first needle here" },
			{ role: "assistant", content: "second needle there" },
		]);
		const hits = await assistantService.search(mine, { q: "needle" });
		expect(hits).toHaveLength(1);
		expect(at(hits, 0).snippet).toBe("first needle here");
	});

	test("tool rows do not match", async () => {
		await chat(mine, "t", [
			{ role: "user", content: "show me" },
			{ role: "tool", content: "needle in a tool result" },
		]);
		expect(await assistantService.search(mine, { q: "needle" })).toEqual([]);
	});
});

describe("share", () => {
	test("the owner shares and unshares, and each is audited", async () => {
		const id = await chat(mine, "Team report");
		await assistantService.share(mine, id);
		const shared = await assistantService.conversations.get(mine, id);
		expect(shared.conversation.sharedAt).not.toBeNull();
		expect(shared.conversation.sharedBy).toBe(ME);
		await assistantService.unshare(mine, id);
		const after = await assistantService.conversations.get(mine, id);
		expect(after.conversation.sharedAt).toBeNull();
		expect(after.conversation.sharedBy).toBeNull();
		expect(await auditKinds()).toEqual([
			"assistant_chat.shared",
			"assistant_chat.unshared",
		]);
	});

	test("a non-owner cannot share, and a member cannot unshare", async () => {
		const id = await chat(mine, "Team report");
		await expect(assistantService.share(peer, id)).rejects.toThrow(
			"Conversation not found",
		);
		await assistantService.share(mine, id);
		await expect(assistantService.unshare(peer, id)).rejects.toThrow(
			"Conversation not found",
		);
	});

	test("an admin can unshare any shared chat", async () => {
		const id = await chat(mine, "Team report");
		await assistantService.share(mine, id);
		await assistantService.unshare(admin, id);
		await expect(assistantService.getShared(peer, id)).rejects.toThrow(
			"Conversation not found",
		);
	});
});

describe("getShared", () => {
	test("a member reads a shared chat, read only", async () => {
		const id = await chat(mine, "Team report", [
			{ role: "user", content: "who is late?" },
			{ role: "assistant", content: "Nobody." },
		]);
		await db
			.update(assistantMessage)
			.set({
				pendingApproval: true,
				undo: {
					kind: "delete_entry",
					entryId: "e1",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			})
			.where(eq(assistantMessage.conversationId, id));
		await assistantService.share(mine, id);
		const view = await assistantService.getShared(peer, id);
		expect(view.messages.map((row) => row.content)).toEqual([
			"who is late?",
			"Nobody.",
		]);
		expect(
			view.messages.every((row) => !row.pendingApproval && !row.undo),
		).toBe(true);
		expect(view.sharedBy.name).toBe(ME);
		expect(view.sharedAt).toBeInstanceOf(Date);
	});

	test("a shared chat exposes no tool rows and no tool calls", async () => {
		const id = await chat(mine, "Team report", [
			{ role: "user", content: "who is late?" },
			{ role: "assistant", content: "Checking." },
			{ role: "tool", content: '{"secret":"owner-only data"}' },
		]);
		await db
			.update(assistantMessage)
			.set({
				toolCalls: [{ id: "c1", name: "list_entries", arguments: "{}" }],
				approvalSummary: "Delete 3 entries",
				approvalPreview: { columns: ["a"], rows: [{ id: "r", cells: ["x"] }] },
			})
			.where(eq(assistantMessage.role, "assistant"));
		await assistantService.share(mine, id);
		const view = await assistantService.getShared(peer, id);
		expect(view.messages.map((row) => row.role)).toEqual(["user", "assistant"]);
		expect(
			view.messages.every(
				(row) =>
					row.toolCalls === null &&
					row.approvalSummary === null &&
					row.approvalPreview === null,
			),
		).toBe(true);
		expect(JSON.stringify(view)).not.toContain("owner-only data");
	});

	test("an unshared chat and another org's chat are not found", async () => {
		const id = await chat(mine, "Private");
		await expect(assistantService.getShared(peer, id)).rejects.toThrow(
			"Conversation not found",
		);
		await assistantService.share(mine, id);
		await expect(assistantService.getShared(stranger, id)).rejects.toThrow(
			"Conversation not found",
		);
	});
});
