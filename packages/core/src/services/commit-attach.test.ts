// Where the commit work-time engine puts things, and what it is allowed to put
// back.
//
// The engine has two jobs that used to be welded into one. It ATTACHES commits
// to the entry that describes the day — evidence, so a block can answer "what
// was this?" — and it CREATES a rest-of-day block when nothing else accounts for
// the day. Written as a single action, only the second one ever happened: the
// engine wrote its own fill block and attached to that, so a person who had
// already logged their day properly got `computeDayFillSeconds() <= 0`, hit a
// `continue`, and lost the evidence entirely. The best-behaved case was the one
// that dropped data.
//
// The other half of this file is the deletion story. Every other automation had
// a way to be told no — a deleted meeting leaves a tombstone, a deleted
// recurring block leaves a skip — and this one had nothing but the
// one-fill-per-day unique index, which the deletion itself clears. On the old
// write-on-read path that meant the block returned when you reloaded; on a
// twenty-minute timer it means a block that will not stay deleted.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { client, project, task, timeEntry } from "../db/schema/domain";
import { projectGithubRepo, timeEntryGithubCommit } from "../db/schema/github";
import { memberWorkingHoursDay } from "../db/schema/schedule";
import {
	commitFillTombstone,
	integrationSettings,
	orgSettings,
} from "../db/schema/settings";
import { dayKeyInTz } from "../lib/time";
import { createTestDb, type TestDb } from "../test/harness";
import { integrationSettingsService } from "./integration-settings.service";
import { setCommitSourceForTests } from "./ports";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-attach";

const USER_ID = "user-attach";

/** Yesterday relative to TODAY below — this engine only writes to days that are
 *  over, so every assertion has to land on a complete one. */
const YESTERDAY = "2026-08-11";

const TODAY = "2026-08-12";

const ctx: Ctx = { organizationId: ORG_ID, userId: USER_ID };

let harness: TestDb;

let devTaskId: string;

let projectId: string;

let otherProjectId: string;

let repoId: string;

let otherRepoId: string;

const runAutomations = () =>
	timeEntriesService.runAutomationsForUser(ctx, {
		now: new Date(`${TODAY}T12:00:00.000Z`),
	});

const entriesOn = (date: string) =>
	db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ORG_ID),
			eq(timeEntry.userId, USER_ID),
			eq(timeEntry.date, date),
		),
	});

const commitsAttachedTo = async (timeEntryId: string) =>
	db.query.timeEntryGithubCommit.findMany({
		where: eq(timeEntryGithubCommit.timeEntryId, timeEntryId),
	});

/** One commit per (day, project), so "which entry did it land on?" has a single
 *  unambiguous answer per project. */
const commitsFor = (entries: { day: string; project: "main" | "other" }[]) => ({
	listUserCommitsForDay: async () => [],
	listUserCommitsByDay: async (
		_ctx: Ctx,
		range: { from: string; to: string },
	) => {
		const inRange = entries.filter(
			(e) => e.day >= range.from && e.day <= range.to,
		);

		const byDay = new Map<string, typeof inRange>();

		for (const entry of inRange) {
			byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
		}

		return [...byDay].map(([dayKey, group]) => ({
			dayKey,
			commits: group.map((g) => ({
				projectGithubRepoId: g.project === "main" ? repoId : otherRepoId,
				projectId: g.project === "main" ? projectId : otherProjectId,
				sha: `sha-${dayKey}-${g.project}`,
				message: `Work on ${g.project}`,
				authorLogin: "tester",
				committedAt: new Date(`${dayKey}T12:00:00.000Z`),
				url: `https://example.com/${dayKey}/${g.project}`,
			})),
		}));
	},
});

const addEntry = async (values: {
	date: string;
	projectId?: string | null;
	fillsDay?: boolean;
	durationSeconds: number;
	description?: string;
}) => {
	const [row] = await db
		.insert(timeEntry)
		.values({
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId: devTaskId,
			projectId: values.projectId ?? null,
			date: values.date,
			durationSeconds: values.durationSeconds,
			description: values.description ?? "",
			fillsDay: values.fillsDay ?? false,
		})
		.returning();

	if (!row) throw new Error("fixture insert failed");

	return row;
};

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Attach Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "attach@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "member-attach",
		organizationId: ORG_ID,
		userId: USER_ID,
		role: "owner",
		createdAt: new Date(),
	});

	const [c] = await db
		.insert(client)
		.values({ organizationId: ORG_ID, name: "Acme" })
		.returning();

	const [p] = await db
		.insert(project)
		.values({ organizationId: ORG_ID, clientId: c?.id ?? "", name: "Farmer" })
		.returning();

	projectId = p?.id ?? "";

	const [other] = await db
		.insert(project)
		.values({ organizationId: ORG_ID, clientId: c?.id ?? "", name: "Other" })
		.returning();

	otherProjectId = other?.id ?? "";

	for (const [index, pid] of [projectId, otherProjectId].entries()) {
		const [repo] = await db
			.insert(projectGithubRepo)
			.values({
				organizationId: ORG_ID,
				projectId: pid,
				githubRepoId: index + 1,
				owner: "profico",
				name: `repo-${String(index)}`,
				fullName: `profico/repo-${String(index)}`,
			})
			.returning({ id: projectGithubRepo.id });

		if (index === 0) repoId = repo?.id ?? "";
		else otherRepoId = repo?.id ?? "";
	}

	const [dev] = await db
		.insert(task)
		.values({
			scope: "organization" as const,
			organizationId: ORG_ID,
			name: "Development",
			systemKey: "development" as const,
			isAbsence: false,
		})
		.returning({ id: task.id });

	devTaskId = dev?.id ?? "";

	for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
		const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
		await db.insert(memberWorkingHoursDay).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			dayOfWeek,
			enabled: isWeekday,
			startTime: isWeekday ? "09:00" : null,
			endTime: isWeekday ? "17:00" : null,
		});
	}
});

afterAll(async () => {
	setCommitSourceForTests(null);
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
	await db.delete(commitFillTombstone);
	await db.delete(integrationSettings);
	await db.delete(orgSettings);
	await integrationSettingsService.update(ctx, {
		githubSyncCommitsAsWorkTime: true,
	});
	// `update` stamps the switch as flipped at the real wall-clock now, which is
	// in the future relative to the pinned TODAY and would close the window
	// entirely. Backdate it so these tests are about attachment, not about the
	// `*_since` floor — that floor has its own suite in automation-since.test.ts.
	await db
		.update(integrationSettings)
		.set({
			githubSyncCommitsAsWorkTimeSince: new Date("2026-08-01T00:00:00.000Z"),
		})
		.where(
			and(
				eq(integrationSettings.organizationId, ORG_ID),
				eq(integrationSettings.userId, USER_ID),
			),
		);
});

describe("where the commit engine attaches", () => {
	test("to the project's own work entry when there is one", async () => {
		const entry = await addEntry({
			date: YESTERDAY,
			projectId,
			durationSeconds: 4 * 60 * 60,
		});

		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));

		await runAutomations();

		expect(await commitsAttachedTo(entry.id)).toHaveLength(1);
	});

	test("to a full day's existing entry, where it used to drop them", async () => {
		// The regression this file exists for. Eight hours logged means
		// computeDayFillSeconds returns 0, which used to `continue` past the whole
		// day — no block, and no attachment either.
		const entry = await addEntry({
			date: YESTERDAY,
			projectId,
			durationSeconds: 8 * 60 * 60,
		});

		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));

		await runAutomations();

		expect(await commitsAttachedTo(entry.id)).toHaveLength(1);
		// And still no second entry: a full day gets no fill block.
		expect(await entriesOn(YESTERDAY)).toHaveLength(1);
	});

	test("each project's commits to that project's entry", async () => {
		const main = await addEntry({
			date: YESTERDAY,
			projectId,
			durationSeconds: 4 * 60 * 60,
		});

		const other = await addEntry({
			date: YESTERDAY,
			projectId: otherProjectId,
			durationSeconds: 4 * 60 * 60,
		});

		setCommitSourceForTests(
			commitsFor([
				{ day: YESTERDAY, project: "main" },
				{ day: YESTERDAY, project: "other" },
			]),
		);

		await runAutomations();

		const [mainCommit] = await commitsAttachedTo(main.id);
		const [otherCommit] = await commitsAttachedTo(other.id);
		expect(mainCommit?.sha).toBe(`sha-${YESTERDAY}-main`);
		expect(otherCommit?.sha).toBe(`sha-${YESTERDAY}-other`);
	});

	test("to a project-less work entry when nothing better matches", async () => {
		// Someone logging "Development, 6h" with no project is unmistakably saying
		// "this is the work I did"; a second block competing with it would be
		// worse than attaching to it.
		const entry = await addEntry({
			date: YESTERDAY,
			projectId: null,
			durationSeconds: 6 * 60 * 60,
		});

		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));

		await runAutomations();

		expect(await commitsAttachedTo(entry.id)).toHaveLength(1);
		expect(await entriesOn(YESTERDAY)).toHaveLength(1);
	});

	test("to a fill block it creates when the day holds nothing", async () => {
		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));

		await runAutomations();

		const [created] = await entriesOn(YESTERDAY);
		expect(created?.fillsDay).toBe(true);
		expect(created?.taskId).toBe(devTaskId);
		expect(await commitsAttachedTo(created?.id ?? "")).toHaveLength(1);
	});

	test("never overwrites a description somebody wrote", async () => {
		await addEntry({
			date: YESTERDAY,
			projectId,
			durationSeconds: 4 * 60 * 60,
			description: "Pairing on the importer",
		});
		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));

		await runAutomations();

		const [after] = await entriesOn(YESTERDAY);
		expect(after?.description).toBe("Pairing on the importer");
	});

	test("fills a blank one", async () => {
		const entry = await addEntry({
			date: YESTERDAY,
			projectId,
			durationSeconds: 4 * 60 * 60,
			description: "",
		});

		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));

		await runAutomations();

		const [after] = await entriesOn(YESTERDAY);
		expect(after?.id).toBe(entry.id);
		expect(after?.description).not.toBe("");
	});

	test("re-running attaches nothing twice", async () => {
		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));

		await runAutomations();
		await runAutomations();

		const entries = await entriesOn(YESTERDAY);
		expect(entries).toHaveLength(1);
		expect(await commitsAttachedTo(entries[0]?.id ?? "")).toHaveLength(1);
	});
});

describe("which project the rest-of-day block is filed against", () => {
	// A repo belongs to exactly one project org-wide, so one project across the
	// day's homeless commits is not a guess — it is the only project the day's
	// evidence points at. Two projects and the block stays unfiled, because it is
	// sized from the whole remaining day and nothing in the commits says how to
	// divide it.
	test("the one project all its commits came from", async () => {
		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));

		await runAutomations();

		const [fill] = await entriesOn(YESTERDAY);
		expect(fill?.fillsDay).toBe(true);
		expect(fill?.projectId).toBe(projectId);
	});

	test("nothing, when its commits span two projects", async () => {
		setCommitSourceForTests(
			commitsFor([
				{ day: YESTERDAY, project: "main" },
				{ day: YESTERDAY, project: "other" },
			]),
		);

		await runAutomations();

		const [fill] = await entriesOn(YESTERDAY);
		expect(fill?.fillsDay).toBe(true);
		expect(fill?.projectId).toBeNull();
		// Both projects' commits still land on it — unfiled, but not lost.
		expect(await commitsAttachedTo(fill?.id ?? "")).toHaveLength(2);
	});

	test("nothing, when the commits already found a home", async () => {
		// The block is only ever created for HOMELESS commits. A day whose commits
		// all attached to an existing entry produces no block at all.
		const entry = await addEntry({
			date: YESTERDAY,
			projectId,
			durationSeconds: 4 * 60 * 60,
		});

		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));

		await runAutomations();

		const rows = await entriesOn(YESTERDAY);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.id).toBe(entry.id);
	});
});

describe("a deleted rest-of-day block", () => {
	test("stays deleted", async () => {
		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));
		await runAutomations();
		const [created] = await entriesOn(YESTERDAY);
		expect(created).toBeDefined();

		await timeEntriesService.remove(ctx, created?.id ?? "");
		await runAutomations();

		// Before the tombstone, this is where the block came back — twenty minutes
		// after the person deleted it, with nobody watching.
		expect(await entriesOn(YESTERDAY)).toHaveLength(0);
	});

	test("records the day, not the row", async () => {
		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));
		await runAutomations();
		const [created] = await entriesOn(YESTERDAY);
		await timeEntriesService.remove(ctx, created?.id ?? "");

		const tombstones = await db.query.commitFillTombstone.findMany({
			where: and(
				eq(commitFillTombstone.organizationId, ORG_ID),
				eq(commitFillTombstone.userId, USER_ID),
			),
		});

		expect(tombstones).toHaveLength(1);
		expect(tombstones[0]?.date).toBe(YESTERDAY);
	});

	test("is retracted by deliberately making a new one", async () => {
		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));
		await runAutomations();
		const [created] = await entriesOn(YESTERDAY);
		await timeEntriesService.remove(ctx, created?.id ?? "");

		// Asking for a rest-of-day block is a change of mind, and a tombstone that
		// outlived the decision it recorded would suppress the engine on this day
		// forever.
		await timeEntriesService.create(ctx, {
			taskId: devTaskId,
			date: YESTERDAY,
			fillsDay: true,
			overtime: false,
		});

		const remaining = await db.query.commitFillTombstone.findMany({
			where: eq(commitFillTombstone.organizationId, ORG_ID),
		});

		expect(remaining).toHaveLength(0);
	});

	test("does not stop commits attaching to what is still there", async () => {
		// The "no" was to the block, not to the evidence.
		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));
		await runAutomations();
		const [created] = await entriesOn(YESTERDAY);
		await timeEntriesService.remove(ctx, created?.id ?? "");

		const own = await addEntry({
			date: YESTERDAY,
			projectId,
			durationSeconds: 3 * 60 * 60,
		});

		await runAutomations();

		expect(await commitsAttachedTo(own.id)).toHaveLength(1);
		expect(await entriesOn(YESTERDAY)).toHaveLength(1);
	});
});

// GitHub filters `since`/`until` on the COMMITTER date, and the source buckets
// by AUTHOR date. A rebase rewrites the first and keeps the second, so a branch
// rebased inside the window hands back commits written weeks before it — and
// the engine filed a rest-of-day block on each of those days.
describe("a commit from before the window", () => {
	test("is dropped, however GitHub came to return it", async () => {
		// A Monday, and before the window opens on the 9th (TODAY minus grace).
		const AUTHORED_ON = "2026-08-03";
		setCommitSourceForTests({
			listUserCommitsForDay: async () => [],
			// Ignores the range on purpose: that is what the real source does in
			// effect, since the range it is asked for is not the date it buckets on.
			listUserCommitsByDay: async () => [
				{
					dayKey: AUTHORED_ON,
					commits: [
						{
							projectGithubRepoId: repoId,
							projectId,
							sha: "sha-rebased",
							message: "Rebased work",
							authorLogin: "tester",
							committedAt: new Date(`${TODAY}T08:00:00.000Z`),
							url: "https://example.com/rebased",
						},
					],
				},
			],
		});

		await runAutomations();

		expect(await entriesOn(AUTHORED_ON)).toHaveLength(0);
	});
});

// `listRange` drops a fill block the day has squeezed to nothing, and the
// block's commits cascade with it. Nothing brings them back: the engine only
// files a block when the day has room, which is exactly what this day lacks.
describe("a fill block the day squeezes out", () => {
	test("hands its commits to the day's own work entry", async () => {
		// Today, because the read path only rewrites what an automation may, and
		// `listRange` has no clock of its own to pin.
		const today = dayKeyInTz(new Date(), "Europe/Zagreb");

		const fill = await addEntry({
			date: today,
			fillsDay: true,
			durationSeconds: 8 * 60 * 60,
			description: "Rest of day",
		});

		await db.insert(timeEntryGithubCommit).values({
			timeEntryId: fill.id,
			projectGithubRepoId: repoId,
			sha: "sha-squeezed",
			message: "Fix the importer",
			authorLogin: "tester",
			committedAt: new Date(),
			url: "https://example.com/squeezed",
		});

		// The person then logs the whole day against the project by hand.
		const own = await addEntry({
			date: today,
			projectId,
			durationSeconds: 8 * 60 * 60,
			description: "Importer",
		});

		await timeEntriesService.listRange(ctx, { from: today, to: today });

		expect((await entriesOn(today)).map((entry) => entry.id)).toEqual([own.id]);
		const moved = await commitsAttachedTo(own.id);
		expect(moved.map((commit) => commit.sha)).toEqual(["sha-squeezed"]);
	});

	// The write path drops an emptied block too (`recomputeDayFill`), and it is
	// the commoner one: logging the day by hand is what fills it.
	test("does the same when a hand-made entry fills the day", async () => {
		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));
		await runAutomations();
		const [fill] = await entriesOn(YESTERDAY);
		expect(fill?.fillsDay).toBe(true);

		const own = await timeEntriesService.create(ctx, {
			taskId: devTaskId,
			projectId,
			description: "Importer",
			date: YESTERDAY,
			durationSeconds: 8 * 60 * 60,
			overtime: false,
			fillsDay: false,
		});

		expect((await entriesOn(YESTERDAY)).map((entry) => entry.id)).toEqual([
			own.id,
		]);
		const moved = await commitsAttachedTo(own.id);
		expect(moved.map((commit) => commit.sha)).toEqual([
			`sha-${YESTERDAY}-main`,
		]);
	});
});
