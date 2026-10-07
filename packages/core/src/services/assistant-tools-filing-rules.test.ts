// The assistant's filing rule tools.
//
// A rule files a meeting by itself on every later sync, so the two writes ask
// first. What is under test: a rule is made only from the caller's OWN entries
// that are on a project the caller may work on, a rule is changed only by its
// owner, and the approval card says what it does.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import {
	client,
	project,
	projectMember,
	task,
	timeEntry,
} from "../db/schema/domain";
import { filingRule } from "../db/schema/settings";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { AccessError } from "./access.service";
import { findTool } from "./assistant-tools";
import { filingRulesService } from "./filing-rules.service";
import type { Ctx } from "./types";

const ORG = "org-ast-rules";
const OTHER_ORG = "org-ast-rules-other";
const ME = "user-ast-rules-me";
const COLLEAGUE = "user-ast-rules-colleague";
const STRANGER = "user-ast-rules-stranger";

const ctxOf = (userId: string, organizationId = ORG): Ctx => ({
	organizationId,
	userId,
});
const tool = (name: string) => present(findTool(name), `tool ${name}`);

const remembered = z.object({
	remembered: z.number(),
	entriesFound: z.number(),
	unfiled: z.number(),
});

let harness: TestDb;
let alphaId = "";
let betaId = "";
let lockedId = "";
let meetingTaskId = "";
let devTaskId = "";
const entryIds = new Map<string, string>();
const entry = (key: string) => present(entryIds.get(key), `entry ${key}`);
let colleagueRuleId = "";
let strangerRuleId = "";

const rulesOf = (userId: string) =>
	db.select().from(filingRule).where(eq(filingRule.userId, userId));

const seedEntry = async (
	key: string,
	organizationId: string,
	userId: string,
	projectId: string | null,
	taskId: string,
	description: string,
) => {
	entryIds.set(
		key,
		at(
			await db
				.insert(timeEntry)
				.values({
					organizationId,
					userId,
					projectId,
					taskId,
					date: "2026-09-01",
					durationSeconds: 1800,
					description,
				})
				.returning(),
			0,
		).id,
	);
};

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(organization).values([
		{ id: ORG, name: "Rules tools", slug: ORG, createdAt: new Date() },
		{ id: OTHER_ORG, name: "Away", slug: OTHER_ORG, createdAt: new Date() },
	]);
	for (const [id, orgId] of [
		[ME, ORG],
		[COLLEAGUE, ORG],
		[STRANGER, OTHER_ORG],
	] as const) {
		await db.insert(user).values({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await db.insert(member).values({
			id: `member-${id}`,
			organizationId: orgId,
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
	const projects = await db
		.insert(project)
		.values([
			{ organizationId: ORG, clientId: acme.id, name: "Alpha" },
			{ organizationId: ORG, clientId: acme.id, name: "Beta" },
			{ organizationId: ORG, clientId: acme.id, name: "Locked" },
		])
		.returning();
	alphaId = at(projects, 0).id;
	betaId = at(projects, 1).id;
	lockedId = at(projects, 2).id;
	await db.insert(projectMember).values([
		{ organizationId: ORG, projectId: alphaId, userId: ME },
		{ organizationId: ORG, projectId: betaId, userId: ME },
		{ organizationId: ORG, projectId: alphaId, userId: COLLEAGUE },
	]);
	const tasks = await db
		.insert(task)
		.values([
			{
				scope: "organization" as const,
				organizationId: ORG,
				name: "Planning",
				isAbsence: false,
			},
			{
				scope: "organization" as const,
				organizationId: ORG,
				name: "Development",
				isAbsence: false,
			},
			{
				scope: "organization" as const,
				organizationId: OTHER_ORG,
				name: "Planning",
				isAbsence: false,
			},
		])
		.returning();
	meetingTaskId = at(tasks, 0).id;
	devTaskId = at(tasks, 1).id;
	const awayTaskId = at(tasks, 2).id;

	await seedEntry("weekly", ORG, ME, alphaId, meetingTaskId, "Weekly sync");
	await seedEntry("retro", ORG, ME, alphaId, meetingTaskId, "Retro");
	await seedEntry("loose", ORG, ME, null, meetingTaskId, "Loose meeting");
	await seedEntry("locked", ORG, ME, lockedId, meetingTaskId, "Locked meeting");
	await seedEntry(
		"colleague",
		ORG,
		COLLEAGUE,
		alphaId,
		meetingTaskId,
		"Colleague meeting",
	);
	await seedEntry(
		"stranger",
		OTHER_ORG,
		STRANGER,
		null,
		awayTaskId,
		"Away meeting",
	);

	// Rules of other people.
	colleagueRuleId = at(
		await db
			.insert(filingRule)
			.values({
				organizationId: ORG,
				userId: COLLEAGUE,
				projectId: alphaId,
				taskId: meetingTaskId,
				title: "Colleague standing",
				titleKey: "colleague standing",
			})
			.returning(),
		0,
	).id;
	// A stranger's project is a different organization's: use any project row.
	const awayClient = at(
		await db
			.insert(client)
			.values({ organizationId: OTHER_ORG, name: "Away client" })
			.returning(),
		0,
	);
	const awayProject = at(
		await db
			.insert(project)
			.values({
				organizationId: OTHER_ORG,
				clientId: awayClient.id,
				name: "Away",
			})
			.returning(),
		0,
	);
	strangerRuleId = at(
		await db
			.insert(filingRule)
			.values({
				organizationId: OTHER_ORG,
				userId: STRANGER,
				projectId: awayProject.id,
				taskId: awayTaskId,
				title: "Away standing",
				titleKey: "away standing",
			})
			.returning(),
		0,
	).id;
});

afterAll(async () => {
	await harness.close();
});

describe("the tiers", () => {
	test("both writes ask first, and say what they do", () => {
		for (const name of ["update_filing_rule", "remember_filing_rule"]) {
			expect(tool(name).kind).toBe("write");
			expect(tool(name).confirm).toBe(true);
			expect(tool(name).summarize).toBeDefined();
		}
	});

	test("remember takes entry ids and nothing else", () => {
		const schema = tool("remember_filing_rule").schema;
		expect(schema.safeParse({ timeEntryIds: [] }).success).toBe(false);
		expect(
			schema.safeParse({
				timeEntryIds: Array.from({ length: 51 }, () => crypto.randomUUID()),
			}).success,
		).toBe(false);
		// A project or a title from the model is not part of the call.
		const id = crypto.randomUUID();
		expect(
			schema.parse({
				timeEntryIds: [id],
				projectId: crypto.randomUUID(),
				title: "Anything",
			}),
		).toEqual({ timeEntryIds: [id] });
	});
});

describe("remember_filing_rule", () => {
	test("makes a rule from the project and the note of each own entry", async () => {
		const result = remembered.parse(
			await tool("remember_filing_rule").run(ctxOf(ME), {
				timeEntryIds: [entry("weekly"), entry("retro")],
			}),
		);
		expect(result).toEqual({ remembered: 2, entriesFound: 2, unfiled: 0 });
		const rules = await rulesOf(ME);
		expect(rules.map((rule) => [rule.title, rule.projectId]).sort()).toEqual([
			["Retro", alphaId],
			["Weekly sync", alphaId],
		]);
		expect(rules.every((rule) => rule.taskId === meetingTaskId)).toBe(true);
		expect(rules.every((rule) => rule.organizationId === ORG)).toBe(true);
	});

	test("a second call changes nothing", async () => {
		await tool("remember_filing_rule").run(ctxOf(ME), {
			timeEntryIds: [entry("weekly")],
		});
		expect(await rulesOf(ME)).toHaveLength(2);
	});

	test("an entry with no project makes no rule", async () => {
		const result = remembered.parse(
			await tool("remember_filing_rule").run(ctxOf(ME), {
				timeEntryIds: [entry("loose")],
			}),
		);
		expect(result).toEqual({ remembered: 0, entriesFound: 1, unfiled: 1 });
		expect(await rulesOf(ME)).toHaveLength(2);
	});

	test("a colleague's entry and another organization's entry are not found", async () => {
		const result = remembered.parse(
			await tool("remember_filing_rule").run(ctxOf(ME), {
				timeEntryIds: [entry("colleague"), entry("stranger")],
			}),
		);
		expect(result).toEqual({ remembered: 0, entriesFound: 0, unfiled: 0 });
		expect(await rulesOf(ME)).toHaveLength(2);
	});

	test("the card names no project for an entry that is not the person's", async () => {
		expect(
			await tool("remember_filing_rule").summarize?.(ctxOf(ME), {
				timeEntryIds: [entry("colleague"), entry("stranger"), entry("loose")],
			}),
		).not.toMatch(/ under /);
	});

	test("an entry on a project the person may not work on is refused, and nothing is written", async () => {
		await expect(
			tool("remember_filing_rule").run(ctxOf(ME), {
				timeEntryIds: [entry("weekly"), entry("locked")],
			}),
		).rejects.toBeInstanceOf(AccessError);
		expect(await rulesOf(ME)).toHaveLength(2);
	});

	test("the card names the entry and the project of the rule", async () => {
		expect(
			await tool("remember_filing_rule").summarize?.(ctxOf(ME), {
				timeEntryIds: [entry("weekly"), entry("retro")],
			}),
		).toBe(
			"Remember where 2 entries are filed (Weekly sync, ...) as filing rules under Alpha",
		);
	});
});

describe("update_filing_rule", () => {
	const ruleId = async (title: string) =>
		present(
			(await rulesOf(ME)).find((rule) => rule.title === title),
			`rule ${title}`,
		).id;

	test("the card names the meeting, the project and the task", async () => {
		expect(
			await tool("update_filing_rule").summarize?.(ctxOf(ME), {
				id: await ruleId("Retro"),
				projectId: betaId,
				targetTaskId: devTaskId,
			}),
		).toBe('File "Retro" to Beta as Development from now on');
	});

	test("moves a rule to another project of the person", async () => {
		const id = await ruleId("Retro");
		await tool("update_filing_rule").run(ctxOf(ME), {
			id,
			projectId: betaId,
			targetTaskId: devTaskId,
		});
		const row = present(
			(await db.select().from(filingRule).where(eq(filingRule.id, id)))[0],
			"rule",
		);
		expect(row.projectId).toBe(betaId);
		expect(row.targetTaskId).toBe(devTaskId);
	});

	test("refuses a project the person is not on", async () => {
		const id = await ruleId("Weekly sync");
		await expect(
			tool("update_filing_rule").run(ctxOf(ME), {
				id,
				projectId: lockedId,
				targetTaskId: null,
			}),
		).rejects.toBeInstanceOf(AccessError);
		const row = present(
			(await db.select().from(filingRule).where(eq(filingRule.id, id)))[0],
			"rule",
		);
		expect(row.projectId).toBe(alphaId);
	});

	test("does not change a colleague's rule or another organization's rule", async () => {
		for (const id of [colleagueRuleId, strangerRuleId]) {
			await expect(
				tool("update_filing_rule").run(ctxOf(ME), {
					id,
					projectId: betaId,
					targetTaskId: null,
				}),
			).rejects.toThrow("Filing rule not found");
		}
		expect(
			(await filingRulesService.list(ctxOf(COLLEAGUE))).map(
				(rule) => rule.projectId,
			),
		).toEqual([alphaId]);
	});
});
