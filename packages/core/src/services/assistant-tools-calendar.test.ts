// The assistant's calendar read.
//
// Google is answered in memory through the calendar port. What is under test
// is the adapter: whose calendar it asks for, what it hands the model, and the
// answer for a person with no connected calendar, which is a result and not an
// error.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { z } from "zod";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { createTestDb, present, type TestDb } from "../test/harness";
import { findTool } from "./assistant-tools";
import { type CalendarSource, setCalendarSourceForTests } from "./ports";
import type { Ctx } from "./types";

const ORG = "org-ast-calendar";
const ME = "user-ast-calendar-me";
const COLLEAGUE = "user-ast-calendar-colleague";

const ctxOf = (userId: string): Ctx => ({ organizationId: ORG, userId });
const tool = () => present(findTool("list_calendar_events"), "tool");

const result = z.object({
	connected: z.boolean(),
	truncated: z.boolean(),
	events: z.array(
		z.object({
			calendarEventId: z.string(),
			title: z.string(),
			start: z.string(),
			end: z.string(),
			meetingUrl: z.string().nullable(),
		}),
	),
});

let harness: TestDb;

/** Whose calendar each call asked for, and for which days. */
let asked: {
	organizationId: string;
	userId: string;
	from: string;
	to: string;
}[] = [];

const eventsFor = (count: number) =>
	Array.from({ length: count }, (_, index) => ({
		id: `event-${index}`,
		title: `Meeting ${index}`,
		start: "2026-09-01T08:00:00Z",
		end: "2026-09-01T08:30:00Z",
		meetingUrl: index === 0 ? "https://meet.example.com/abc" : null,
		htmlLink: "https://calendar.example.com/e",
	}));

const fakeSource = (
	eventsOf: (userId: string) => ReturnType<typeof eventsFor> | null,
): CalendarSource => ({
	listEventsForRange: async (ctx, input) => {
		asked.push({
			organizationId: ctx.organizationId,
			userId: ctx.userId,
			...input,
		});
		return eventsOf(ctx.userId);
	},
	listEventsForDay: async () => {
		throw new Error("The tool must not use the day read");
	},
	lookupEvents: async () => new Map(),
});

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(organization).values({
		id: ORG,
		name: "Calendar tools",
		slug: ORG,
		createdAt: new Date(),
	});
	for (const id of [ME, COLLEAGUE]) {
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
			organizationId: ORG,
			userId: id,
			role: "member",
			createdAt: new Date(),
		});
	}
});

afterAll(async () => {
	setCalendarSourceForTests(null);
	await harness.close();
});

const range = { from: "2026-09-01", to: "2026-09-02" };

describe("list_calendar_events", () => {
	test("is a read that does not run beside another read", () => {
		expect(tool().kind).toBe("read");
		expect(tool().serial).toBe(true);
	});

	test("says the calendar is not connected, and does not throw", async () => {
		// No stub: a person with no Google account row gets null from the service.
		setCalendarSourceForTests(null);
		expect(await tool().run(ctxOf(ME), range)).toEqual({
			connected: false,
			truncated: false,
			events: [],
			note: expect.stringContaining("not connected"),
		});
	});

	test("hands over only what a model needs, for the caller's own calendar", async () => {
		asked = [];
		setCalendarSourceForTests(
			fakeSource((userId) => (userId === ME ? eventsFor(2) : [])),
		);
		const mine = result.parse(await tool().run(ctxOf(ME), range));
		expect(mine.connected).toBe(true);
		expect(mine.events).toEqual([
			{
				calendarEventId: "event-0",
				title: "Meeting 0",
				start: "2026-09-01T08:00:00Z",
				end: "2026-09-01T08:30:00Z",
				meetingUrl: "https://meet.example.com/abc",
			},
			{
				calendarEventId: "event-1",
				title: "Meeting 1",
				start: "2026-09-01T08:00:00Z",
				end: "2026-09-01T08:30:00Z",
				meetingUrl: null,
			},
		]);

		// A colleague asks, and the port is asked for the colleague.
		const theirs = result.parse(await tool().run(ctxOf(COLLEAGUE), range));
		expect(theirs.events).toEqual([]);
		expect(asked.map((call) => call.userId)).toEqual([ME, COLLEAGUE]);
		expect(asked.every((call) => call.organizationId === ORG)).toBe(true);
	});

	test("an empty calendar is connected with no events", async () => {
		setCalendarSourceForTests(fakeSource(() => []));
		const answer = result.parse(await tool().run(ctxOf(ME), range));
		expect(answer).toMatchObject({ connected: true, events: [] });
	});

	test("cuts a long list and says so", async () => {
		setCalendarSourceForTests(fakeSource(() => eventsFor(130)));
		const answer = result.parse(await tool().run(ctxOf(ME), range));
		expect(answer.events).toHaveLength(100);
		expect(answer.truncated).toBe(true);
	});

	test("refuses a span over 31 days and a span that runs backwards", () => {
		expect(
			tool().schema.safeParse({ from: "2026-09-01", to: "2026-10-15" }).success,
		).toBe(false);
		expect(
			tool().schema.safeParse({ from: "2026-09-02", to: "2026-09-01" }).success,
		).toBe(false);
		expect(
			tool().schema.safeParse({ from: "2026-09-01", to: "2026-10-02" }).success,
		).toBe(true);
	});
});
