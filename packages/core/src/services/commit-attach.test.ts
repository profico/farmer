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
	spyOn,
	test,
} from "bun:test";

import { and, eq, sql } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import {
	client,
	project,
	projectMember,
	task,
	timeEntry,
} from "../db/schema/domain";
import {
	projectGithubRepo,
	timeEntryGithubCommit,
	timeEntryGithubPrActivity,
} from "../db/schema/github";
import { memberWorkingHoursDay } from "../db/schema/schedule";
import {
	commitDetachTombstone,
	commitFillTombstone,
	integrationSettings,
	orgSettings,
} from "../db/schema/settings";
import { dayKeyInTz } from "../lib/time";
import { emptyCalendar } from "../test/calendar";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { invalidateCtxAccess } from "./context";
import { dayAssemblyService } from "./day-assembly.service";
import {
	githubService,
	type ScannedPullRequestActivity,
	setGithubClientForTests,
} from "./github.service";
import { integrationSettingsService } from "./integration-settings.service";
import {
	setCalendarSourceForTests,
	setCommitSourceForTests,
	setPullRequestSourceForTests,
} from "./ports";
import { tasksService } from "./tasks.service";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-attach";
const USER_ID = "user-attach";
/** Yesterday relative to TODAY below — this engine only writes to days that are
 *  over, so every assertion has to land on a complete one. */
const YESTERDAY = "2026-08-11";
const TODAY = "2026-08-12";

const ctx: Ctx = { organizationId: ORG_ID, userId: USER_ID };
const OTHER_USER_ID = "user-attach-other";
const otherCtx: Ctx = { organizationId: ORG_ID, userId: OTHER_USER_ID };

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
const commitsFor = (
	entries: { day: string; project: "main" | "other"; count?: number }[],
) => {
	const byDayOf = (range: { from: string; to: string }) => {
		const inRange = entries.filter(
			(e) => e.day >= range.from && e.day <= range.to,
		);
		const byDay = new Map<string, typeof inRange>();
		for (const entry of inRange) {
			byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
		}
		return [...byDay].map(([dayKey, group]) => ({
			dayKey,
			commits: group.flatMap((g) =>
				Array.from({ length: g.count ?? 1 }, (_, index) => ({
					projectGithubRepoId: g.project === "main" ? repoId : otherRepoId,
					projectId: g.project === "main" ? projectId : otherProjectId,
					sha: `sha-${dayKey}-${g.project}${index === 0 ? "" : `-${String(index)}`}`,
					message: `Work on ${g.project} ${String(index)}`,
					authorLogin: "tester",
					committedAt: new Date(`${dayKey}T12:00:00.000Z`),
					url: `https://example.com/${dayKey}/${g.project}/${String(index)}`,
					repoFullName:
						g.project === "main" ? "profico/repo-0" : "profico/repo-1",
				})),
			),
		}));
	};
	return {
		listUserCommitsForDay: async (_ctx: Ctx, date: string) =>
			byDayOf({ from: date, to: date })[0]?.commits ?? [],
		listUserCommitsByDay: async (
			_ctx: Ctx,
			range: { from: string; to: string },
		) => byDayOf(range),
	};
};

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

	await db.insert(user).values({
		id: OTHER_USER_ID,
		name: "Colleague",
		email: "attach-other@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "member-attach-other",
		organizationId: ORG_ID,
		userId: OTHER_USER_ID,
		role: "member",
		createdAt: new Date(),
	});
	// A manual attach reads the repo through the caller's project membership.
	await db.insert(projectMember).values({
		organizationId: ORG_ID,
		projectId,
		userId: USER_ID,
	});
	await db
		.update(projectGithubRepo)
		.set({ installationId: 100 })
		.where(eq(projectGithubRepo.id, repoId));

	for (const userId of [USER_ID, OTHER_USER_ID]) {
		for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
			const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
			await db.insert(memberWorkingHoursDay).values({
				organizationId: ORG_ID,
				userId,
				dayOfWeek,
				enabled: isWeekday,
				startTime: isWeekday ? "09:00" : null,
				endTime: isWeekday ? "17:00" : null,
			});
		}
	}
});

afterAll(async () => {
	setCommitSourceForTests(null);
	setPullRequestSourceForTests(null);
	setCalendarSourceForTests(null);
	setGithubClientForTests(null);
	await harness.close();
});

beforeEach(async () => {
	setCalendarSourceForTests(emptyCalendar);
	await db.delete(timeEntry);
	await db.delete(commitFillTombstone);
	await db.delete(commitDetachTombstone);
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

	test("to the fill block another run filed first, when the insert loses the race", async () => {
		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));
		// The other run's block lands between the engine's read and its insert.
		// A trigger files it as the engine's own insert starts, so the unique
		// index turns that insert into "nothing returned".
		await db.execute(sql`
			create function race_fill() returns trigger as $$
			begin
				if new.fills_day and new.description <> 'Other run' then
					insert into time_entry
						(organization_id, user_id, task_id, date, description,
						 duration_seconds, fills_day)
					values
						(new.organization_id, new.user_id, new.task_id, new.date,
						 'Other run', 3600, true);
				end if;
				return new;
			end;
			$$ language plpgsql`);
		await db.execute(sql`
			create trigger race_fill before insert on time_entry
			for each row execute function race_fill()`);

		try {
			await runAutomations();
		} finally {
			await db.execute(sql`drop trigger race_fill on time_entry`);
			await db.execute(sql`drop function race_fill()`);
		}

		const entries = await entriesOn(YESTERDAY);
		expect(entries).toHaveLength(1);
		const [theirs] = entries;
		expect(theirs?.description).toBe("Other run");
		expect(await commitsAttachedTo(theirs?.id ?? "")).toHaveLength(1);
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

	test("each project, when its commits span two", async () => {
		setCommitSourceForTests(
			commitsFor([
				{ day: YESTERDAY, project: "main", count: 3 },
				{ day: YESTERDAY, project: "other", count: 1 },
			]),
		);

		await runAutomations();

		const rows = await entriesOn(YESTERDAY);
		expect(rows).toHaveLength(2);
		const main = present(
			rows.find((r) => r.projectId === projectId),
			"main entry",
		);
		const other = present(
			rows.find((r) => r.projectId === otherProjectId),
			"other entry",
		);
		// Split by commit count, three to one, of an eight hour day. The larger
		// share is the fill block, so the day still resizes.
		expect(main.fillsDay).toBe(true);
		expect(main.durationSeconds).toBe(6 * 60 * 60);
		expect(other.fillsDay).toBe(false);
		expect(other.durationSeconds).toBe(2 * 60 * 60);
		expect(main.durationSeconds + other.durationSeconds).toBe(8 * 60 * 60);
		// Each project's commits sit on its own entry.
		expect(await commitsAttachedTo(main.id)).toHaveLength(3);
		expect(
			(await commitsAttachedTo(other.id)).map((c) => c.projectGithubRepoId),
		).toEqual([otherRepoId]);
	});

	test("the shares add up to what the rest of the day holds", async () => {
		// 7h15 left: 29 quarter hours, which the weights two and one do not divide.
		const [admin] = await db
			.insert(task)
			.values({
				scope: "organization" as const,
				organizationId: ORG_ID,
				name: "Admin",
				isAbsence: false,
			})
			.returning({ id: task.id });
		await db.insert(timeEntry).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId: present(admin, "admin task").id,
			date: YESTERDAY,
			durationSeconds: 45 * 60,
			description: "Admin",
		});
		setCommitSourceForTests(
			commitsFor([
				{ day: YESTERDAY, project: "main", count: 2 },
				{ day: YESTERDAY, project: "other", count: 1 },
			]),
		);

		await runAutomations();

		const rows = (await entriesOn(YESTERDAY)).filter(
			(r) => r.taskId === devTaskId,
		);
		expect(rows).toHaveLength(2);
		expect(rows.reduce((sum, r) => sum + r.durationSeconds, 0)).toBe(
			8 * 60 * 60 - 45 * 60,
		);
		for (const row of rows.filter((r) => !r.fillsDay)) {
			expect(row.durationSeconds % 900).toBe(0);
		}
		await db.delete(timeEntry);
		await db.delete(task).where(eq(task.id, present(admin, "admin task").id));
	});

	// Assemble my day counts distinct pull requests. An opened and a merged event
	// on one pull request are one pull request, not two.
	test("a pull request weighs once, however many events it has", async () => {
		const events = (["opened", "merged"] as const).map(
			(kind): ScannedPullRequestActivity => ({
				eventId: `PR_1:${kind}`,
				kind,
				reviewState: null,
				number: 1,
				title: "Change 1",
				pullRequestUrl: "https://github.com/profico/repo-0/pull/1",
				url: "https://github.com/profico/repo-0/pull/1",
				occurredAt: new Date(`${YESTERDAY}T12:00:00.000Z`),
				projectGithubRepoId: repoId,
				projectId,
				repoFullName: "profico/repo-0",
			}),
		);
		setPullRequestSourceForTests({
			listUserPullRequestActivityForDay: async () => [],
			listUserPullRequestActivityByDay: async () => [
				{ dayKey: YESTERDAY, activity: events },
			],
		});
		setCommitSourceForTests(
			commitsFor([{ day: YESTERDAY, project: "other", count: 1 }]),
		);

		try {
			await runAutomations();
		} finally {
			setPullRequestSourceForTests(null);
		}

		const rows = await entriesOn(YESTERDAY);
		expect(rows.map((r) => r.durationSeconds).sort()).toEqual([
			4 * 60 * 60,
			4 * 60 * 60,
		]);
	});

	test("only the projects the person may track on get a share", async () => {
		await db
			.update(member)
			.set({ role: "member" })
			.where(eq(member.userId, USER_ID));
		// The suite's own assignment on the main project is what the gate reads.
		invalidateCtxAccess(ctx);
		setCommitSourceForTests(
			commitsFor([
				{ day: YESTERDAY, project: "main", count: 1 },
				{ day: YESTERDAY, project: "other", count: 3 },
			]),
		);

		try {
			await runAutomations();

			// The other project's commits weigh more, and it still gets nothing: the
			// whole day goes to the one project the engine may write time on.
			const rows = await entriesOn(YESTERDAY);
			expect(rows).toHaveLength(1);
			expect(rows[0]?.projectId).toBe(projectId);
			expect(rows[0]?.fillsDay).toBe(true);
			expect(rows[0]?.durationSeconds).toBe(8 * 60 * 60);
			// And its commits are left alone rather than hung on the first project.
			expect(await commitsAttachedTo(rows[0]?.id ?? "")).toHaveLength(1);
		} finally {
			await db
				.update(member)
				.set({ role: "owner" })
				.where(eq(member.userId, USER_ID));
			invalidateCtxAccess(ctx);
		}
	});

	test("nothing, when no project can take the time", async () => {
		// A member with no assignment: neither project passes the gate, so the
		// block is the project-less one it was before the split.
		await db
			.update(member)
			.set({ role: "member" })
			.where(eq(member.userId, USER_ID));
		await db.delete(projectMember);
		invalidateCtxAccess(ctx);
		setCommitSourceForTests(
			commitsFor([
				{ day: YESTERDAY, project: "main" },
				{ day: YESTERDAY, project: "other" },
			]),
		);

		try {
			await runAutomations();
		} finally {
			// Put back the suite's own assignment.
			await db.insert(projectMember).values({
				organizationId: ORG_ID,
				projectId,
				userId: USER_ID,
			});
			await db
				.update(member)
				.set({ role: "owner" })
				.where(eq(member.userId, USER_ID));
			invalidateCtxAccess(ctx);
		}

		const [fill] = await entriesOn(YESTERDAY);
		expect(fill?.fillsDay).toBe(true);
		expect(fill?.projectId).toBeNull();
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

describe("a fill block filed against one project", () => {
	const lateCommits = commitsFor([
		{ day: YESTERDAY, project: "main" },
		{ day: YESTERDAY, project: "other" },
	]);

	// An earlier run saw one project and filed the day on it. Another project's
	// commits turning up later used to stay unattached for good.
	test("late evidence for another project is carved out of the fill", async () => {
		const fill = await addEntry({
			date: YESTERDAY,
			projectId,
			fillsDay: true,
			durationSeconds: 8 * 60 * 60,
			description: "Rest of day",
		});
		setCommitSourceForTests(lateCommits);

		await runAutomations();

		const rows = await entriesOn(YESTERDAY);
		expect(rows).toHaveLength(2);
		const other = present(
			rows.find((r) => r.projectId === otherProjectId),
			"carved entry",
		);
		const kept = present(
			rows.find((r) => r.id === fill.id),
			"fill",
		);
		expect(other.fillsDay).toBe(false);
		expect(other.durationSeconds).toBe(4 * 60 * 60);
		expect(kept.durationSeconds).toBe(4 * 60 * 60);
		expect((await commitsAttachedTo(fill.id)).map((c) => c.sha)).toEqual([
			`sha-${YESTERDAY}-main`,
		]);
		expect((await commitsAttachedTo(other.id)).map((c) => c.sha)).toEqual([
			`sha-${YESTERDAY}-other`,
		]);

		// A second run changes nothing.
		await runAutomations();
		expect(await entriesOn(YESTERDAY)).toHaveLength(2);
	});

	// A fill made by hand, or from Assemble my day, holds no evidence. It is still
	// the person's block on that project and keeps a share.
	test("a fill with no evidence still gives a late project its share", async () => {
		const fill = await addEntry({
			date: YESTERDAY,
			projectId,
			fillsDay: true,
			durationSeconds: 8 * 60 * 60,
			description: "Rest of day",
		});
		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "other" }]));

		await runAutomations();

		const rows = await entriesOn(YESTERDAY);
		expect(rows).toHaveLength(2);
		const other = present(
			rows.find((r) => r.projectId === otherProjectId),
			"carved entry",
		);
		expect(other.durationSeconds).toBe(4 * 60 * 60);
		expect(
			present(
				rows.find((r) => r.id === fill.id),
				"fill",
			).durationSeconds,
		).toBe(4 * 60 * 60);
		expect((await commitsAttachedTo(other.id)).map((c) => c.sha)).toEqual([
			`sha-${YESTERDAY}-other`,
		]);

		await runAutomations();
		expect(await entriesOn(YESTERDAY)).toHaveLength(2);
	});

	test("a share of nothing leaves the evidence for later", async () => {
		const fill = await addEntry({
			date: YESTERDAY,
			projectId,
			fillsDay: true,
			durationSeconds: 15 * 60,
			description: "Rest of day",
		});
		setCommitSourceForTests(lateCommits);

		await runAutomations();

		expect(await entriesOn(YESTERDAY)).toHaveLength(1);
		expect(await commitsAttachedTo(fill.id)).toHaveLength(1);
	});

	test("a project the person cannot track on gets no entry from the fill", async () => {
		await db
			.update(member)
			.set({ role: "member" })
			.where(eq(member.userId, USER_ID));
		invalidateCtxAccess(ctx);
		const fill = await addEntry({
			date: YESTERDAY,
			projectId,
			fillsDay: true,
			durationSeconds: 8 * 60 * 60,
			description: "Rest of day",
		});
		setCommitSourceForTests(lateCommits);

		try {
			await runAutomations();
		} finally {
			await db
				.update(member)
				.set({ role: "owner" })
				.where(eq(member.userId, USER_ID));
			invalidateCtxAccess(ctx);
		}

		expect(await entriesOn(YESTERDAY)).toHaveLength(1);
		expect(await commitsAttachedTo(fill.id)).toHaveLength(1);
	});

	test("still takes a project-less commit", async () => {
		// A project-less fill is the "nobody could take it" block: every
		// project's evidence belongs on it.
		const fill = await addEntry({
			date: YESTERDAY,
			fillsDay: true,
			durationSeconds: 8 * 60 * 60,
			description: "Rest of day",
		});
		setCommitSourceForTests(
			commitsFor([
				{ day: YESTERDAY, project: "main" },
				{ day: YESTERDAY, project: "other" },
			]),
		);

		await runAutomations();

		expect(await commitsAttachedTo(fill.id)).toHaveLength(2);
	});

	// Deleting a project's split entry is that person saying no to the project
	// on that day: the engine neither recreates it nor carves it out of the fill
	// again, and its commits do not land on the other project's fill.
	test("a deleted split entry stays deleted, and its commits stay off the fill", async () => {
		setCommitSourceForTests(
			commitsFor([
				{ day: YESTERDAY, project: "main", count: 3 },
				{ day: YESTERDAY, project: "other", count: 1 },
			]),
		);
		await runAutomations();
		const split = present(
			(await entriesOn(YESTERDAY)).find((r) => r.projectId === otherProjectId),
			"split entry",
		);

		await timeEntriesService.remove(ctx, split.id);
		await runAutomations();
		await runAutomations();

		const rows = await entriesOn(YESTERDAY);
		expect(rows).toHaveLength(1);
		const [fill] = rows;
		expect(fill?.projectId).toBe(projectId);
		expect(fill?.fillsDay).toBe(true);
		expect((await commitsAttachedTo(fill?.id ?? "")).map((c) => c.sha)).toEqual(
			[
				`sha-${YESTERDAY}-main`,
				`sha-${YESTERDAY}-main-1`,
				`sha-${YESTERDAY}-main-2`,
			].sort(),
		);
	});

	test("deleting the fill says no to its project only", async () => {
		setCommitSourceForTests(
			commitsFor([
				{ day: YESTERDAY, project: "main", count: 3 },
				{ day: YESTERDAY, project: "other", count: 1 },
			]),
		);
		await runAutomations();
		const fill = present(
			(await entriesOn(YESTERDAY)).find((r) => r.fillsDay),
			"fill",
		);

		await timeEntriesService.remove(ctx, fill.id);
		await runAutomations();

		// The other project still has its entry and no block is made for main.
		const rows = await entriesOn(YESTERDAY);
		expect(rows.map((r) => r.projectId)).toEqual([otherProjectId]);
	});

	test("a project-less no still stops every block that day", async () => {
		await db
			.insert(commitFillTombstone)
			.values({ organizationId: ORG_ID, userId: USER_ID, date: YESTERDAY });
		setCommitSourceForTests(
			commitsFor([
				{ day: YESTERDAY, project: "main" },
				{ day: YESTERDAY, project: "other" },
			]),
		);

		await runAutomations();

		expect(await entriesOn(YESTERDAY)).toHaveLength(0);
	});
});

describe("Assemble my day and a deleted project block", () => {
	const deleteOtherSplit = async () => {
		setCommitSourceForTests(
			commitsFor([
				{ day: YESTERDAY, project: "main", count: 3 },
				{ day: YESTERDAY, project: "other", count: 1 },
			]),
		);
		await runAutomations();
		const split = present(
			(await entriesOn(YESTERDAY)).find((r) => r.projectId === otherProjectId),
			"split entry",
		);
		await timeEntriesService.remove(ctx, split.id);
		// Free the whole day so the assembler has something to propose.
		await db.delete(timeEntry);
	};
	const workFor = <T extends { key: string }>(suggestions: T[]) =>
		suggestions.find((s) => s.key === `work:${otherProjectId}`);

	test("holds the work suggestion back and counts it", async () => {
		await deleteOtherSplit();

		const assembly = await dayAssemblyService.suggest(ctx, { date: YESTERDAY });

		expect(workFor(assembly.suggestions)).toBeUndefined();
		expect(assembly.dismissedCount).toBe(1);
		expect(
			assembly.suggestions.some((s) => s.key === `work:${projectId}`),
		).toBe(true);
	});

	test("includeDismissed brings it back flagged, and applying it clears the no", async () => {
		await deleteOtherSplit();

		const assembly = await dayAssemblyService.suggest(ctx, {
			date: YESTERDAY,
			includeDismissed: true,
		});
		const work = present(workFor(assembly.suggestions), "the work row");
		expect(work.dismissed).toBe(true);
		expect(assembly.dismissedCount).toBe(1);

		const result = await dayAssemblyService.apply(ctx, {
			date: YESTERDAY,
			entries: [
				{
					taskId: work.taskId,
					projectId: otherProjectId,
					description: work.description,
					durationSeconds: work.durationSeconds,
				},
			],
		});
		expect(result.created).toBe(1);
		expect(
			await db.query.commitFillTombstone.findMany({
				where: eq(commitFillTombstone.organizationId, ORG_ID),
			}),
		).toHaveLength(0);

		await runAutomations();
		const entry = present(
			(await entriesOn(YESTERDAY)).find((r) => r.projectId === otherProjectId),
			"applied entry",
		);
		expect((await commitsAttachedTo(entry.id)).map((c) => c.sha)).toEqual([
			`sha-${YESTERDAY}-other`,
		]);
	});

	test("applying the day-level rest-of-day suggestion clears its no", async () => {
		await db
			.insert(commitFillTombstone)
			.values({ organizationId: ORG_ID, userId: USER_ID, date: YESTERDAY });
		setCommitSourceForTests(commitsFor([]));

		const assembly = await dayAssemblyService.suggest(ctx, {
			date: YESTERDAY,
			includeDismissed: true,
		});
		const fill = present(
			assembly.suggestions.find((s) => s.kind === "fill"),
			"fill row",
		);
		expect(fill.dismissed).toBe(true);

		await dayAssemblyService.apply(ctx, {
			date: YESTERDAY,
			entries: [
				{
					taskId: fill.taskId,
					description: fill.description,
					fillsDay: true,
				},
			],
		});

		expect(
			await db.query.commitFillTombstone.findMany({
				where: eq(commitFillTombstone.organizationId, ORG_ID),
			}),
		).toHaveLength(0);
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

	test("records the day and the project", async () => {
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
		expect(tombstones.map((t) => t.date)).toEqual([YESTERDAY, YESTERDAY]);
		expect(tombstones.map((t) => t.projectId).sort()).toEqual(
			[null, projectId].sort(),
		);
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
			projectId,
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

// Unlinking a commit used to delete one row, and the next pass attached the
// commit again: the engine re-reads every day in its window. The tombstone is
// per person and commit, so it holds whichever entry the engine would choose.
describe("a detached commit", () => {
	// A manual attach checks the sha's shape, so this one is a real-looking id.
	const SHA = "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0";

	/** The day's one commit, on the main project, with the id above. */
	const mainCommit = (): Parameters<typeof setCommitSourceForTests>[0] => ({
		listUserCommitsForDay: async () => [],
		listUserCommitsByDay: async (_ctx, range) =>
			YESTERDAY < range.from || YESTERDAY > range.to
				? []
				: [
						{
							dayKey: YESTERDAY,
							commits: [
								{
									projectGithubRepoId: repoId,
									projectId,
									sha: SHA,
									message: "Work on main",
									authorLogin: "tester",
									committedAt: new Date(`${YESTERDAY}T12:00:00.000Z`),
									url: `https://github.com/profico/repo-0/commit/${SHA}`,
								},
							],
						},
					],
	});

	const attachedRows = (sha: string) =>
		db.query.timeEntryGithubCommit.findMany({
			where: eq(timeEntryGithubCommit.sha, sha),
		});

	const attachNow = (timeEntryId: string) => {
		setGithubClientForTests({
			getInstallationToken: async () => "installation-token",
			getCommit: async (_token, _owner, _repo, sha) => ({
				sha,
				html_url: `https://github.com/profico/repo-0/commit/${sha}`,
				commit: {
					message: "Work on main",
					author: { date: `${YESTERDAY}T12:00:00Z` },
				},
				author: { login: "tester" },
			}),
			listInstallationRepos: async () => [],
		});
		return githubService.attachCommits(ctx, {
			timeEntryId,
			commits: [{ projectGithubRepoId: repoId, sha: SHA }],
		});
	};

	/** The work entry with the commit attached, as the engine files it. */
	const syncedEntry = async () => {
		const entry = await addEntry({
			date: YESTERDAY,
			projectId,
			durationSeconds: 4 * 60 * 60,
		});
		setCommitSourceForTests(mainCommit());
		await runAutomations();
		const attached = at(await commitsAttachedTo(entry.id), 0);
		return { entry, attached };
	};

	test("is not attached again by the next pass", async () => {
		const { attached } = await syncedEntry();

		await githubService.detachCommit(ctx, attached.id);
		await runAutomations();

		expect(await attachedRows(SHA)).toEqual([]);
	});

	test("stays off every entry, not only the one it left", async () => {
		const { attached } = await syncedEntry();
		await githubService.detachCommit(ctx, attached.id);
		await addEntry({
			date: YESTERDAY,
			projectId: otherProjectId,
			durationSeconds: 60 * 60,
		});

		await runAutomations();

		expect(await attachedRows(SHA)).toEqual([]);
	});

	test("does not make a day with only that commit a worked day", async () => {
		setCommitSourceForTests(mainCommit());
		await runAutomations();
		const fill = present(at(await entriesOn(YESTERDAY), 0), "the fill block");
		const attached = at(await commitsAttachedTo(fill.id), 0);
		await githubService.detachCommit(ctx, attached.id);
		await db.delete(timeEntry);

		await runAutomations();

		expect(await entriesOn(YESTERDAY)).toEqual([]);
	});

	test("records the person and the commit's day, not the entry", async () => {
		const { attached } = await syncedEntry();

		await githubService.detachCommit(ctx, attached.id);

		const rows = await db.query.commitDetachTombstone.findMany();
		expect(rows.map((row) => [row.userId, row.sha, row.date])).toEqual([
			[USER_ID, SHA, YESTERDAY],
		]);
	});

	test("moved by hand to another entry, stays off the first", async () => {
		const { entry, attached } = await syncedEntry();
		await githubService.detachCommit(ctx, attached.id);
		expect(await db.query.commitDetachTombstone.findMany()).toHaveLength(1);
		const other = await addEntry({
			date: YESTERDAY,
			projectId: otherProjectId,
			durationSeconds: 60 * 60,
		});

		await attachNow(other.id);
		await runAutomations();

		expect((await attachedRows(SHA)).map((row) => row.timeEntryId)).toEqual([
			other.id,
		]);
		expect(await commitsAttachedTo(entry.id)).toEqual([]);
		// The hand attach does not take the "no" back.
		expect(await db.query.commitDetachTombstone.findMany()).toHaveLength(1);
	});

	test("attached by hand to its old entry, is not added twice", async () => {
		const { entry, attached } = await syncedEntry();
		await githubService.detachCommit(ctx, attached.id);
		expect(await db.query.commitDetachTombstone.findMany()).toHaveLength(1);

		await attachNow(entry.id);
		await runAutomations();

		expect((await attachedRows(SHA)).map((row) => row.timeEntryId)).toEqual([
			entry.id,
		]);
	});

	test("already attached by hand to one entry, is not copied to another", async () => {
		const other = await addEntry({
			date: YESTERDAY,
			projectId: otherProjectId,
			durationSeconds: 60 * 60,
		});
		await attachNow(other.id);
		await addEntry({
			date: YESTERDAY,
			projectId,
			durationSeconds: 4 * 60 * 60,
		});
		setCommitSourceForTests(mainCommit());

		await runAutomations();

		expect((await attachedRows(SHA)).map((row) => row.timeEntryId)).toEqual([
			other.id,
		]);
	});

	test("is not put back by a pass that read before the detach", async () => {
		// The commit is on an entry of another day, so the pass does not count
		// it as held on its own day, and it reads no tombstone for it.
		const earlier = await addEntry({
			date: "2026-08-10",
			projectId,
			durationSeconds: 60 * 60,
		});
		const [attached] = await attachNow(earlier.id);
		await addEntry({
			date: YESTERDAY,
			projectId,
			durationSeconds: 4 * 60 * 60,
		});
		setCommitSourceForTests(mainCommit());
		// The detach commits while the pass runs: after the pass read the
		// tombstones, before it inserts. The task lookup sits between the two.
		const lookup = tasksService.findBySystemKey;
		let detached = false;
		const spy = spyOn(tasksService, "findBySystemKey").mockImplementation(
			async (...args) => {
				if (!detached) {
					detached = true;
					await githubService.detachCommit(
						ctx,
						present(attached, "the hand attach").id,
					);
				}
				return lookup(...args);
			},
		);
		try {
			await runAutomations();
		} finally {
			spy.mockRestore();
		}

		expect(detached).toBe(true);
		expect(await attachedRows(SHA)).toEqual([]);
	});

	test("held by hand on another project, files no empty rest-of-day block", async () => {
		const other = await addEntry({
			date: YESTERDAY,
			projectId: otherProjectId,
			durationSeconds: 60 * 60,
		});
		await attachNow(other.id);
		setCommitSourceForTests(mainCommit());

		await runAutomations();

		expect((await entriesOn(YESTERDAY)).map((entry) => entry.id)).toEqual([
			other.id,
		]);
	});

	test("does not touch the same commit of another person", async () => {
		const { attached } = await syncedEntry();
		await githubService.detachCommit(ctx, attached.id);
		await integrationSettingsService.update(otherCtx, {
			githubSyncCommitsAsWorkTime: true,
		});
		await db
			.update(integrationSettings)
			.set({
				githubSyncCommitsAsWorkTimeSince: new Date("2026-08-01T00:00:00.000Z"),
			})
			.where(eq(integrationSettings.userId, OTHER_USER_ID));

		await timeEntriesService.runAutomationsForUser(otherCtx, {
			now: new Date(`${TODAY}T12:00:00.000Z`),
		});
		// The caller's own pass after the colleague's still keeps it off.
		await runAutomations();

		const rows = await attachedRows(SHA);
		expect(rows).toHaveLength(1);
		const entry = present(
			await db.query.timeEntry.findFirst({
				where: eq(timeEntry.id, at(rows, 0).timeEntryId),
			}),
			"the colleague's entry",
		);
		expect(entry.userId).toBe(OTHER_USER_ID);
	});

	test("is dropped once its day leaves the window", async () => {
		await db.insert(commitDetachTombstone).values([
			{
				organizationId: ORG_ID,
				userId: USER_ID,
				sha: "sha-old",
				date: "2026-07-01",
			},
			{
				organizationId: ORG_ID,
				userId: USER_ID,
				sha: "sha-recent",
				date: YESTERDAY,
			},
		]);
		setCommitSourceForTests(commitsFor([]));

		await runAutomations();

		const left = await db.query.commitDetachTombstone.findMany();
		expect(left.map((row) => row.sha)).toEqual(["sha-recent"]);
	});
});

// The tombstone rules, read from both sides: what a delete writes, what a
// create retracts, and which paths of the engine read the day-level row.
describe("the day-level no", () => {
	const dayRows = () =>
		db.query.commitFillTombstone.findMany({
			where: eq(commitFillTombstone.organizationId, ORG_ID),
		});

	test("deleting the fill keeps a late push for another project from filing a new one", async () => {
		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));
		await runAutomations();
		const fill = present(
			(await entriesOn(YESTERDAY)).find((r) => r.fillsDay),
			"fill",
		);
		await timeEntriesService.remove(ctx, fill.id);

		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "other" }]));
		await runAutomations();

		expect(await entriesOn(YESTERDAY)).toHaveLength(0);
		expect((await dayRows()).map((r) => r.projectId).sort()).toEqual(
			[null, projectId].sort(),
		);
	});

	test("Assemble my day holds back the rest of the day after the fill was deleted", async () => {
		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));
		await runAutomations();
		const fill = present(
			(await entriesOn(YESTERDAY)).find((r) => r.fillsDay),
			"fill",
		);
		await timeEntriesService.remove(ctx, fill.id);

		const held = await dayAssemblyService.suggest(ctx, { date: YESTERDAY });
		expect(held.suggestions.some((s) => s.kind === "fill")).toBe(false);
		expect(held.dismissedCount).toBe(2);

		const shown = await dayAssemblyService.suggest(ctx, {
			date: YESTERDAY,
			includeDismissed: true,
		});
		expect(shown.suggestions.find((s) => s.kind === "fill")?.dismissed).toBe(
			true,
		);
	});

	test("a project-less entry that is not a fill leaves the no in place", async () => {
		await db
			.insert(commitFillTombstone)
			.values({ organizationId: ORG_ID, userId: USER_ID, date: YESTERDAY });
		const hand = await timeEntriesService.create(ctx, {
			taskId: devTaskId,
			description: "Planning",
			date: YESTERDAY,
			durationSeconds: 60 * 60,
			overtime: false,
			fillsDay: false,
		});
		await timeEntriesService.remove(ctx, hand.id);
		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));

		await runAutomations();

		expect(await entriesOn(YESTERDAY)).toHaveLength(0);
	});

	test("a fill made on a project retracts the day-level no", async () => {
		await db
			.insert(commitFillTombstone)
			.values({ organizationId: ORG_ID, userId: USER_ID, date: YESTERDAY });

		await timeEntriesService.create(ctx, {
			taskId: devTaskId,
			projectId,
			date: YESTERDAY,
			fillsDay: true,
			overtime: false,
		});

		expect(await dayRows()).toHaveLength(0);
	});

	test("the day-level no stops a carve out of a fill", async () => {
		await addEntry({
			date: YESTERDAY,
			projectId,
			fillsDay: true,
			durationSeconds: 8 * 60 * 60,
			description: "Rest of day",
		});
		await db
			.insert(commitFillTombstone)
			.values({ organizationId: ORG_ID, userId: USER_ID, date: YESTERDAY });
		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "other" }]));

		await runAutomations();

		const rows = await entriesOn(YESTERDAY);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.durationSeconds).toBe(8 * 60 * 60);
	});
});

describe("a fill moved to another project", () => {
	test("is not carved again for the project it left", async () => {
		setCommitSourceForTests(
			commitsFor([{ day: YESTERDAY, project: "main", count: 2 }]),
		);
		await runAutomations();
		const fill = present(
			(await entriesOn(YESTERDAY)).find((r) => r.fillsDay),
			"fill",
		);
		expect(fill.durationSeconds).toBe(8 * 60 * 60);

		await timeEntriesService.file(ctx, {
			timeEntryId: fill.id,
			projectId: otherProjectId,
		});
		await runAutomations();

		const rows = await entriesOn(YESTERDAY);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.projectId).toBe(otherProjectId);
		expect(rows[0]?.durationSeconds).toBe(8 * 60 * 60);
		expect(await commitsAttachedTo(fill.id)).toHaveLength(2);
	});
});

// The late-evidence rule is per piece of evidence: a project is carved only for
// the commits that are not on the fill yet.
describe("late evidence when the fill already holds some of it", () => {
	const shaOf = (project: "main" | "other", index: number) =>
		`sha-${YESTERDAY}-${project}${index === 0 ? "" : `-${String(index)}`}`;

	const putOnFill = (timeEntryId: string, sha: string, repo: string) =>
		db.insert(timeEntryGithubCommit).values({
			timeEntryId,
			projectGithubRepoId: repo,
			sha,
			message: "Work",
			authorLogin: "tester",
			committedAt: new Date(`${YESTERDAY}T12:00:00.000Z`),
			url: `https://example.com/${sha}`,
		});

	// An old engine hung another project's commit on the fill.
	test("a fill that holds one commit of a project still gives it the new ones", async () => {
		const fill = await addEntry({
			date: YESTERDAY,
			projectId,
			fillsDay: true,
			durationSeconds: 8 * 60 * 60,
			description: "Rest of day",
		});
		await putOnFill(fill.id, shaOf("other", 0), otherRepoId);
		setCommitSourceForTests(
			commitsFor([{ day: YESTERDAY, project: "other", count: 3 }]),
		);

		await runAutomations();

		const rows = await entriesOn(YESTERDAY);
		expect(rows).toHaveLength(2);
		const carved = present(
			rows.find((r) => r.id !== fill.id),
			"carved entry",
		);
		expect(carved.projectId).toBe(otherProjectId);
		// The fill weighs 1 (its one held commit), the newcomer 2. 32 quarter
		// hours split 10.67 : 21.33; the larger remainder rounds up, so the fill
		// takes 11 units and the carved entry 21 (5h15).
		expect(carved.durationSeconds).toBe(18900);
		expect(
			present(
				rows.find((r) => r.id === fill.id),
				"fill",
			).durationSeconds,
		).toBe(9900);
		// The description comes from the two new commits only.
		expect(carved.description).toContain("Work on other 1");
		expect(carved.description).toContain("Work on other 2");
		expect(carved.description).not.toContain("Work on other 0");
		expect(rows.reduce((sum, r) => sum + r.durationSeconds, 0)).toBe(
			8 * 60 * 60,
		);
		expect(
			(await commitsAttachedTo(carved.id)).map((c) => c.sha).sort(),
		).toEqual([shaOf("other", 1), shaOf("other", 2)]);
		expect((await commitsAttachedTo(fill.id)).map((c) => c.sha)).toEqual([
			shaOf("other", 0),
		]);

		await runAutomations();
		expect(await entriesOn(YESTERDAY)).toHaveLength(2);
		expect(await commitsAttachedTo(carved.id)).toHaveLength(2);
	});

	// The engine filed project P, the person moved the fill to Q, and a third P
	// commit arrives.
	test("a fill moved away still gives its old project the new commit", async () => {
		setCommitSourceForTests(
			commitsFor([{ day: YESTERDAY, project: "main", count: 2 }]),
		);
		await runAutomations();
		const fill = present(
			(await entriesOn(YESTERDAY)).find((r) => r.fillsDay),
			"fill",
		);
		await timeEntriesService.file(ctx, {
			timeEntryId: fill.id,
			projectId: otherProjectId,
		});

		setCommitSourceForTests(
			commitsFor([{ day: YESTERDAY, project: "main", count: 3 }]),
		);
		await runAutomations();

		const rows = await entriesOn(YESTERDAY);
		expect(rows).toHaveLength(2);
		const carved = present(
			rows.find((r) => r.id !== fill.id),
			"carved entry",
		);
		expect(carved.projectId).toBe(projectId);
		// The fill holds two commits, the newcomer one. 32 quarter hours split
		// 21.33 : 10.67; the newcomer has the larger remainder and takes 11 units
		// (2h45).
		expect(carved.durationSeconds).toBe(9900);
		expect(
			present(
				rows.find((r) => r.id === fill.id),
				"fill",
			).durationSeconds,
		).toBe(18900);
		expect(carved.description).toContain("Work on main 2");
		expect(carved.description).not.toContain("Work on main 0");
		expect((await commitsAttachedTo(carved.id)).map((c) => c.sha)).toEqual([
			shaOf("main", 2),
		]);
		expect((await commitsAttachedTo(fill.id)).map((c) => c.sha).sort()).toEqual(
			[shaOf("main", 0), shaOf("main", 1)],
		);
	});

	const prEvent = (kind: "opened" | "merged"): ScannedPullRequestActivity => ({
		eventId: `PR_1:${kind}`,
		kind,
		reviewState: null,
		number: 1,
		title: "Change 1",
		pullRequestUrl: "https://github.com/profico/repo-0/pull/1",
		url: "https://github.com/profico/repo-0/pull/1",
		occurredAt: new Date(`${YESTERDAY}T12:00:00.000Z`),
		projectGithubRepoId: repoId,
		projectId,
		repoFullName: "profico/repo-0",
	});

	const pullRequestsFor = (kinds: ("opened" | "merged")[]) =>
		setPullRequestSourceForTests({
			listUserPullRequestActivityForDay: async () => [],
			listUserPullRequestActivityByDay: async () => [
				{ dayKey: YESTERDAY, activity: kinds.map(prEvent) },
			],
		});

	const eventsOn = async (timeEntryId: string) =>
		(
			await db.query.timeEntryGithubPrActivity.findMany({
				where: eq(timeEntryGithubPrActivity.timeEntryId, timeEntryId),
			})
		)
			.map((row) => row.eventId)
			.sort();

	test("a new event of a pull request the fill holds one event of still attaches", async () => {
		setCommitSourceForTests(commitsFor([]));
		try {
			pullRequestsFor(["opened"]);
			await runAutomations();
			const fill = present(
				(await entriesOn(YESTERDAY)).find((r) => r.fillsDay),
				"fill",
			);
			expect(await eventsOn(fill.id)).toEqual(["PR_1:opened"]);
			const hand = await timeEntriesService.create(ctx, {
				taskId: devTaskId,
				projectId,
				description: "Planning",
				date: YESTERDAY,
				durationSeconds: 60 * 60,
				overtime: false,
				fillsDay: false,
			});

			pullRequestsFor(["opened", "merged"]);
			await runAutomations();

			expect(await eventsOn(hand.id)).toEqual(["PR_1:merged"]);
			expect(await eventsOn(fill.id)).toEqual(["PR_1:opened"]);
		} finally {
			setPullRequestSourceForTests(null);
		}
	});

	// Run 1 filed the fill on P with `opened`. The person moved it to Q, so P has
	// no entry. The fill holds the pull request, so the carve gives P nothing for
	// it, and `merged` goes to the fill rather than to no entry at all.
	test("a new event of a held pull request goes to a fill moved to another project", async () => {
		setCommitSourceForTests(commitsFor([]));
		try {
			pullRequestsFor(["opened"]);
			await runAutomations();
			const fill = present(
				(await entriesOn(YESTERDAY)).find((r) => r.fillsDay),
				"fill",
			);
			await timeEntriesService.file(ctx, {
				timeEntryId: fill.id,
				projectId: otherProjectId,
			});

			pullRequestsFor(["opened", "merged"]);
			await runAutomations();
			await runAutomations();

			expect(await entriesOn(YESTERDAY)).toHaveLength(1);
			expect(await eventsOn(fill.id)).toEqual(["PR_1:merged", "PR_1:opened"]);
		} finally {
			setPullRequestSourceForTests(null);
		}
	});

	// A new commit of P carves P an entry. The pull request is still on the fill,
	// so `merged` goes to the fill in this probe too, not to the carved entry.
	test("a new event of a held pull request stays on the fill when a commit carves an entry", async () => {
		setCommitSourceForTests(commitsFor([]));
		try {
			pullRequestsFor(["opened"]);
			await runAutomations();
			const fill = present(
				(await entriesOn(YESTERDAY)).find((r) => r.fillsDay),
				"fill",
			);
			await timeEntriesService.file(ctx, {
				timeEntryId: fill.id,
				projectId: otherProjectId,
			});

			setCommitSourceForTests(
				commitsFor([{ day: YESTERDAY, project: "main", count: 1 }]),
			);
			pullRequestsFor(["opened", "merged"]);
			await runAutomations();

			const rows = await entriesOn(YESTERDAY);
			expect(rows).toHaveLength(2);
			const carved = present(
				rows.find((r) => r.id !== fill.id),
				"carved entry",
			);
			expect(carved.projectId).toBe(projectId);
			expect(await eventsOn(carved.id)).toEqual([]);
			expect((await commitsAttachedTo(carved.id)).map((c) => c.sha)).toEqual([
				shaOf("main", 0),
			]);
			expect(await eventsOn(fill.id)).toEqual(["PR_1:merged", "PR_1:opened"]);
		} finally {
			setPullRequestSourceForTests(null);
		}
	});

	// The target is decided on each sweep. Run 1 files the fill on P with
	// `opened`. The person moves the fill to Q. Run 2 sees a new commit of P and
	// carves P an entry with the commit only, because the fill holds the pull
	// request. Run 3 finds P with an entry, so `merged` goes to that entry.
	test("a later event goes to the entry the project has by then", async () => {
		setCommitSourceForTests(commitsFor([]));
		try {
			pullRequestsFor(["opened"]);
			await runAutomations();
			const fill = present(
				(await entriesOn(YESTERDAY)).find((r) => r.fillsDay),
				"fill",
			);
			await timeEntriesService.file(ctx, {
				timeEntryId: fill.id,
				projectId: otherProjectId,
			});

			setCommitSourceForTests(
				commitsFor([{ day: YESTERDAY, project: "main", count: 1 }]),
			);
			await runAutomations();
			const carved = present(
				(await entriesOn(YESTERDAY)).find((r) => r.id !== fill.id),
				"carved entry",
			);
			expect(carved.projectId).toBe(projectId);
			expect(await eventsOn(carved.id)).toEqual([]);

			pullRequestsFor(["opened", "merged"]);
			await runAutomations();

			expect(await eventsOn(carved.id)).toEqual(["PR_1:merged"]);
			expect(await eventsOn(fill.id)).toEqual(["PR_1:opened"]);
		} finally {
			setPullRequestSourceForTests(null);
		}
	});

	// A project-less entry on the day means there is no carve. A new event of a
	// held pull request goes to that entry and not to the fill.
	test("a new event of a held pull request goes to a project-less entry, not the fill", async () => {
		setCommitSourceForTests(commitsFor([]));
		try {
			pullRequestsFor(["opened"]);
			await runAutomations();
			const fill = present(
				(await entriesOn(YESTERDAY)).find((r) => r.fillsDay),
				"fill",
			);
			await timeEntriesService.file(ctx, {
				timeEntryId: fill.id,
				projectId: otherProjectId,
			});
			const general = await timeEntriesService.create(ctx, {
				taskId: devTaskId,
				description: "Planning",
				date: YESTERDAY,
				durationSeconds: 60 * 60,
				overtime: false,
				fillsDay: false,
			});

			pullRequestsFor(["opened", "merged"]);
			await runAutomations();

			expect(await eventsOn(general.id)).toEqual(["PR_1:merged"]);
			expect(await eventsOn(fill.id)).toEqual(["PR_1:opened"]);
		} finally {
			setPullRequestSourceForTests(null);
		}
	});

	// The fill weighs a pull request once, however many events of it it holds.
	test("a fill that holds two events of one pull request weighs it once", async () => {
		setCommitSourceForTests(commitsFor([]));
		try {
			pullRequestsFor(["opened", "merged"]);
			await runAutomations();
			const fill = present(
				(await entriesOn(YESTERDAY)).find((r) => r.fillsDay),
				"fill",
			);
			expect(await eventsOn(fill.id)).toEqual(["PR_1:merged", "PR_1:opened"]);

			setCommitSourceForTests(
				commitsFor([{ day: YESTERDAY, project: "other", count: 1 }]),
			);
			await runAutomations();

			const rows = await entriesOn(YESTERDAY);
			expect(rows).toHaveLength(2);
			// The fill weighs 1 (one pull request), the newcomer 1: 4h each. Two
			// event keys counted beside the pull request key would weigh the fill
			// 3 against 1: 6h and 2h.
			expect(rows.map((r) => r.durationSeconds).sort()).toEqual([
				4 * 60 * 60,
				4 * 60 * 60,
			]);
		} finally {
			setPullRequestSourceForTests(null);
		}
	});
});

describe("editing or filing an entry retracts the commit engine's no", () => {
	const dayRows = () =>
		db.query.commitFillTombstone.findMany({
			where: eq(commitFillTombstone.organizationId, ORG_ID),
		});

	const deleteTheEnginesFill = async () => {
		setCommitSourceForTests(commitsFor([{ day: YESTERDAY, project: "main" }]));
		await runAutomations();
		const fill = present(
			(await entriesOn(YESTERDAY)).find((r) => r.fillsDay),
			"fill",
		);
		await timeEntriesService.remove(ctx, fill.id);
		expect((await dayRows()).map((r) => r.projectId).sort()).toEqual(
			[null, projectId].sort(),
		);
	};

	test("an update that turns an entry into a fill clears the day-level no", async () => {
		await deleteTheEnginesFill();
		const dev = await timeEntriesService.create(ctx, {
			taskId: devTaskId,
			projectId,
			description: "Planning",
			date: YESTERDAY,
			durationSeconds: 60 * 60,
			overtime: false,
			fillsDay: false,
		});
		expect(await dayRows()).toHaveLength(1);

		await timeEntriesService.update(ctx, {
			timeEntryId: dev.id,
			taskId: devTaskId,
			projectId,
			description: "",
			date: YESTERDAY,
			overtime: false,
			fillsDay: true,
		});

		expect(await dayRows()).toHaveLength(0);
	});

	test("an update that makes Development on a project clears that project's no", async () => {
		await deleteTheEnginesFill();
		const hand = await timeEntriesService.create(ctx, {
			taskId: devTaskId,
			description: "Planning",
			date: YESTERDAY,
			durationSeconds: 60 * 60,
			overtime: false,
			fillsDay: false,
		});

		await timeEntriesService.update(ctx, {
			timeEntryId: hand.id,
			taskId: devTaskId,
			projectId: otherProjectId,
			description: "Planning",
			date: YESTERDAY,
			durationSeconds: 60 * 60,
			overtime: false,
			fillsDay: false,
		});

		// The deleted project is another one: nothing of its no is retracted.
		expect((await dayRows()).map((r) => r.projectId).sort()).toEqual(
			[null, projectId].sort(),
		);

		await timeEntriesService.update(ctx, {
			timeEntryId: hand.id,
			taskId: devTaskId,
			projectId,
			description: "Planning",
			date: YESTERDAY,
			durationSeconds: 60 * 60,
			overtime: false,
			fillsDay: false,
		});

		expect((await dayRows()).map((r) => r.projectId)).toEqual([null]);
	});

	test("filing a fill to a project clears that project's no, so commits attach", async () => {
		await deleteTheEnginesFill();
		const byHand = await timeEntriesService.create(ctx, {
			taskId: devTaskId,
			date: YESTERDAY,
			overtime: false,
			fillsDay: true,
		});
		expect((await dayRows()).map((r) => r.projectId)).toEqual([projectId]);

		await timeEntriesService.file(ctx, {
			timeEntryId: byHand.id,
			projectId,
		});
		expect(await dayRows()).toHaveLength(0);

		await runAutomations();
		expect(await commitsAttachedTo(byHand.id)).toHaveLength(1);
	});

	test("filing a fill clears the day-level no", async () => {
		const byHand = await timeEntriesService.create(ctx, {
			taskId: devTaskId,
			date: YESTERDAY,
			overtime: false,
			fillsDay: true,
		});
		await db.insert(commitFillTombstone).values({
			organizationId: ORG_ID,
			userId: ctx.userId,
			date: YESTERDAY,
			projectId: null,
		});
		expect(await dayRows()).toHaveLength(1);

		await timeEntriesService.file(ctx, {
			timeEntryId: byHand.id,
			projectId,
		});

		expect(await dayRows()).toHaveLength(0);
	});

	test("filing a plain entry that is not Development clears nothing", async () => {
		await deleteTheEnginesFill();
		const other = await db
			.insert(task)
			.values({
				scope: "organization" as const,
				organizationId: ORG_ID,
				name: "Design",
				isAbsence: false,
			})
			.returning({ id: task.id });
		const designId = present(other[0], "design task").id;
		const hand = await timeEntriesService.create(ctx, {
			taskId: designId,
			description: "Mockups",
			date: YESTERDAY,
			durationSeconds: 60 * 60,
			overtime: false,
			fillsDay: false,
		});

		await timeEntriesService.file(ctx, {
			timeEntryId: hand.id,
			projectId,
		});

		expect(await dayRows()).toHaveLength(2);
	});
});

describe("copying a day retracts the commit engine's no", () => {
	const COPY_TO = "2026-08-10";

	const tombstonesOn = async (date: string) =>
		(
			await db.query.commitFillTombstone.findMany({
				where: and(
					eq(commitFillTombstone.organizationId, ORG_ID),
					eq(commitFillTombstone.date, date),
				),
			})
		).map((row) => row.projectId);

	const tombstoneBoth = () =>
		db.insert(commitFillTombstone).values([
			{ organizationId: ORG_ID, userId: USER_ID, date: COPY_TO },
			{
				organizationId: ORG_ID,
				userId: USER_ID,
				date: COPY_TO,
				projectId,
			},
		]);

	test("a copied fill on a project clears the day-level and the project's no", async () => {
		await addEntry({
			date: YESTERDAY,
			projectId,
			fillsDay: true,
			durationSeconds: 8 * 60 * 60,
			description: "Rest of day",
		});
		await tombstoneBoth();

		await timeEntriesService.copyDay(ctx, {
			fromDate: YESTERDAY,
			toDate: COPY_TO,
		});

		expect((await entriesOn(COPY_TO)).some((r) => r.fillsDay)).toBe(true);
		expect(await tombstonesOn(COPY_TO)).toEqual([]);
	});

	test("a copied entry of another task clears nothing", async () => {
		const meeting = present(
			await db.query.task.findFirst({ where: eq(task.systemKey, "meeting") }),
			"Meeting task",
		);
		await db.insert(timeEntry).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId: meeting.id,
			projectId,
			date: YESTERDAY,
			durationSeconds: 60 * 60,
			description: "Sync",
			fillsDay: false,
		});
		await tombstoneBoth();

		await timeEntriesService.copyDay(ctx, {
			fromDate: YESTERDAY,
			toDate: COPY_TO,
		});

		expect(await entriesOn(COPY_TO)).toHaveLength(1);
		const left = await tombstonesOn(COPY_TO);
		expect(left).toHaveLength(2);
		expect(left).toContain(null);
		expect(left).toContain(projectId);
	});

	test("a copied Development entry clears its project's no only", async () => {
		await addEntry({
			date: YESTERDAY,
			projectId,
			durationSeconds: 60 * 60,
			description: "Planning",
		});
		await tombstoneBoth();

		await timeEntriesService.copyDay(ctx, {
			fromDate: YESTERDAY,
			toDate: COPY_TO,
		});

		expect(await tombstonesOn(COPY_TO)).toEqual([null]);
	});
});

describe("the dismissed count and what includeDismissed adds back", () => {
	// A project-less fill and a project's Development entry were both
	// deleted. Two rows come back with the toggle, so the count is two.
	test("counts the work row and the fill row separately", async () => {
		setCommitSourceForTests(
			commitsFor([{ day: YESTERDAY, project: "other", count: 2 }]),
		);
		await db.insert(commitFillTombstone).values([
			{
				organizationId: ORG_ID,
				userId: USER_ID,
				date: YESTERDAY,
				projectId: otherProjectId,
			},
			{ organizationId: ORG_ID, userId: USER_ID, date: YESTERDAY },
		]);

		const held = await dayAssemblyService.suggest(ctx, { date: YESTERDAY });
		const shown = await dayAssemblyService.suggest(ctx, {
			date: YESTERDAY,
			includeDismissed: true,
		});

		expect(held.suggestions.filter((s) => s.dismissed)).toHaveLength(0);
		expect(shown.suggestions.filter((s) => s.dismissed)).toHaveLength(2);
		expect(held.dismissedCount).toBe(2);
		expect(shown.dismissedCount).toBe(2);
	});
});
