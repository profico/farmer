import {
	and,
	asc,
	eq,
	gte,
	inArray,
	isNull,
	lte,
	notExists,
	or,
	sql,
} from "drizzle-orm";
import postgres from "postgres";

import { db } from "../db";
import {
	project,
	recurringBlockRule,
	recurringBlockRuleSkip,
	timeEntry,
} from "../db/schema/domain";
import {
	timeEntryGithubCommit,
	timeEntryGithubPrActivity,
} from "../db/schema/github";
import { automationWriteWindow } from "../lib/automation-window";
import {
	datesBetween,
	dayKeyInTz,
	parseDuration,
	QUARTER_HOUR_SECONDS,
	weekdayInTz,
} from "../lib/time";
import { MAX_DAY_SECONDS, spokenForSeconds } from "../lib/working-day";
import {
	type CreateRecurringBlockRuleInput,
	DEFAULT_BREAK_BLOCK,
	type UpdateRecurringBlockRuleInput,
} from "../schema/recurring-block-rules";
import { ctxAccess, ctxTimezone } from "./context";
import { recomputeDayFill } from "./day-fill";
import {
	assertDescribed,
	assertProjectInOrg,
	assertTaskAvailable,
} from "./guards";
import { orgSettingsService } from "./org-settings.service";
import { tasksService } from "./tasks.service";
import type { Ctx } from "./types";

// A recurring rule is now "N hours of task T on these weekdays", with no clock:
// under the duration-only entry model there is no time of day to place it at.
// Everything else about the rule — effective dating, per-date skips, idempotent
// materialization — is unchanged.
const parseRuleDuration = (input: string): number => {
	const seconds = parseDuration(input);
	if (seconds === null) throw new Error("Could not understand that duration");
	if (seconds <= 0) throw new Error("Duration must be greater than zero");
	if (seconds % QUARTER_HOUR_SECONDS !== 0) {
		throw new Error("Duration must be in 15-minute steps");
	}
	// The schema refuses this too; asked again here because this is where the
	// seconds are made, and the database check would answer with a raw error.
	if (seconds > MAX_DAY_SECONDS) {
		throw new Error("A recurring block cannot exceed 24 hours");
	}
	return seconds;
};

/**
 * Bring this person's blocks up to date right now, over the standard automation
 * window.
 *
 * The worker materializes on a timer, which is right for the steady state and
 * wrong for the moment somebody creates a rule: waiting out a tick to see
 * today's break appear reads as a broken switch. So the mutations below call
 * this — a user action explicitly asking for these blocks, not a page load
 * quietly doing it. Cheap and purely local: no network, no external API.
 *
 * Best-effort. Failing to materialize must never fail the rule that was just
 * saved; the next tick picks it up.
 */
const materializeNow = async (ctx: Ctx) => {
	try {
		const tz = await ctxTimezone(ctx);
		const { automationLockedThrough } = await orgSettingsService.get(ctx);
		const window = automationWriteWindow(dayKeyInTz(new Date(), tz), {
			lockedThrough: automationLockedThrough,
		});
		if (!window) return;
		await recurringBlockRulesService.materializeRange(
			ctx,
			window.from,
			window.to,
		);
	} catch (error) {
		console.error("[recurring-blocks] immediate materialize failed", error);
	}
};

/** The assignment gate a rule has to pass before it may name a project.
 *
 *  A rule is a time-entry factory: `materializeRange` inserts rows straight
 *  into `timeEntry`, so whatever a rule may name, its author may write. The
 *  taxonomy gate (`assertTaskAvailable`) was the only check here, and it asks a
 *  different question — is this task usable on this project — which a project
 *  the author has nothing to do with answers "yes" to just as readily. So the
 *  rule path wrote entries onto projects `timeEntriesService.create` would have
 *  refused, one `assertCanTrackOn` short of the same rule.
 *
 *  Null project is deliberately fine and is the common case: a Break belongs to
 *  nobody's project, and unfiled time is a legitimate state. */
const assertMayScheduleOn = async (ctx: Ctx, projectId: string | null) => {
	if (!projectId) return;
	await assertProjectInOrg(ctx, projectId);
	const access = await ctxAccess(ctx);
	access.assertCanTrackOn(projectId);
};

/**
 * Which of these rules may still write, asked again on every pass.
 *
 * `create` and `update` check a rule once, when it is saved, and a rule then
 * outlives everything that made it valid: the person is taken off the project,
 * the project is archived, the task is archived or un-picked. None of those
 * touch the rule, so the materializer went on writing real hours onto a project
 * the person could no longer log to by hand. Same answer as
 * `filingRulesService.resolve`, for the same reason: a rule is a
 * standing write, and it is re-checked rather than trusted.
 *
 * A rule that fails is skipped, not deleted and not reported. Its day simply
 * gets no block — the same day it would have had with no rule — and the rule
 * comes back to life by itself if the assignment or the project does.
 *
 * Checked per distinct (project, task) pair, since the answer cannot differ
 * within one, and Access is only resolved when a rule names a project: a break
 * rule has nothing to be assigned to.
 */
const rulesStillWritable = async (
	ctx: Ctx,
	rules: { id: string; taskId: string; projectId: string | null }[],
): Promise<Set<string>> => {
	const projectIds = [
		...new Set(rules.flatMap((r) => (r.projectId ? [r.projectId] : []))),
	];
	// Archived projects are dormant: every picker excludes them, and a rule must
	// not keep writing to one behind the person's back. The org predicate is the
	// tenancy half of `assertProjectInOrg`, in the WHERE.
	const liveProjectIds = new Set(
		projectIds.length > 0
			? (
					await db
						.select({ id: project.id })
						.from(project)
						.where(
							and(
								eq(project.organizationId, ctx.organizationId),
								eq(project.status, "active"),
								inArray(project.id, projectIds),
							),
						)
				).map((p) => p.id)
			: [],
	);
	const access = projectIds.length > 0 ? await ctxAccess(ctx) : null;

	const verdicts = new Map<string, boolean>();
	const mayWrite = async (rule: {
		taskId: string;
		projectId: string | null;
	}): Promise<boolean> => {
		if (rule.projectId) {
			if (!liveProjectIds.has(rule.projectId)) return false;
			if (!access?.canTrackOn(rule.projectId)) return false;
		}
		try {
			// Also what catches an archived task: the guard refuses one outright.
			await assertTaskAvailable(ctx, rule.taskId, rule.projectId ?? undefined);
		} catch (error) {
			// The guard says no by throwing. A database failure is not a "no" and
			// must fail the pass rather than quietly skip every rule.
			if (error instanceof postgres.PostgresError) throw error;
			return false;
		}
		return true;
	};

	const usable = new Set<string>();
	for (const rule of rules) {
		const key = `${rule.projectId ?? ""}|${rule.taskId}`;
		let allowed = verdicts.get(key);
		if (allowed === undefined) {
			allowed = await mayWrite(rule);
			verdicts.set(key, allowed);
		}
		if (allowed) usable.add(rule.id);
	}
	return usable;
};

export const recurringBlockRulesService = {
	list: (ctx: Ctx) =>
		db.query.recurringBlockRule.findMany({
			where: and(
				eq(recurringBlockRule.organizationId, ctx.organizationId),
				eq(recurringBlockRule.userId, ctx.userId),
			),
			with: { task: true, project: true },
			orderBy: asc(recurringBlockRule.createdAt),
		}),

	create: async (ctx: Ctx, input: CreateRecurringBlockRuleInput) => {
		// Same gates as a hand-made entry, in the same order — the rule can only
		// produce entries the user could have created themselves, which takes
		// both the assignment check and the taxonomy one.
		await assertMayScheduleOn(ctx, input.projectId ?? null);
		const taskRow = await assertTaskAvailable(
			ctx,
			input.taskId,
			input.projectId,
		);
		assertDescribed(taskRow, input.description);
		const durationSeconds = parseRuleDuration(input.duration);

		const [created] = await db
			.insert(recurringBlockRule)
			.values({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				taskId: input.taskId,
				projectId: input.projectId,
				description: input.description ?? "",
				daysOfWeek: input.daysOfWeek,
				durationSeconds,
				effectiveFrom: input.effectiveFrom,
				effectiveUntil: input.effectiveUntil,
			})
			.returning();
		if (!created) throw new Error("Failed to create recurring block rule");
		await materializeNow(ctx);
		return created;
	},

	/** Turn the proposed daily break (`DEFAULT_BREAK_BLOCK`) into a real rule.
	 *
	 *  A separate entry point rather than the generic `create` because the caller
	 *  is a switch, not a form: it names no task, no days and no duration, so the
	 *  Break task is resolved by system key here rather than by an id the client
	 *  had to send. The same rule is writable through `create` — the "No project"
	 *  task list offers Break like any other built-in — this is just the one-click
	 *  path to the shape everybody wants.
	 *
	 *  Idempotent. The page only shows the switch when no break rule exists, but a
	 *  double click or a second tab must not leave someone with two breaks a day —
	 *  so an existing rule is resumed instead of duplicated. */
	enableBreak: async (ctx: Ctx) => {
		const breakTask = await tasksService.findBySystemKey(ctx, "break");
		if (!breakTask) throw new Error("The Break task is missing");

		const existing = await db.query.recurringBlockRule.findFirst({
			where: and(
				eq(recurringBlockRule.organizationId, ctx.organizationId),
				eq(recurringBlockRule.userId, ctx.userId),
				eq(recurringBlockRule.taskId, breakTask.id),
			),
		});
		if (existing) {
			if (existing.active) return existing;
			const now = new Date();
			const [resumed] = await db
				.update(recurringBlockRule)
				.set({ active: true, activeSince: now, updatedAt: now })
				.where(eq(recurringBlockRule.id, existing.id))
				.returning();
			await materializeNow(ctx);
			return resumed ?? existing;
		}

		// No project, like every break the day assembler proposes: a break is time
		// off the clock, not work anyone can attribute to a client.
		const [created] = await db
			.insert(recurringBlockRule)
			.values({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				taskId: breakTask.id,
				description: DEFAULT_BREAK_BLOCK.description,
				daysOfWeek: [...DEFAULT_BREAK_BLOCK.daysOfWeek],
				durationSeconds: DEFAULT_BREAK_BLOCK.durationSeconds,
			})
			.returning();
		if (!created) throw new Error("Failed to create the break block");
		await materializeNow(ctx);
		return created;
	},

	update: async (ctx: Ctx, input: UpdateRecurringBlockRuleInput) => {
		const existing = await db.query.recurringBlockRule.findFirst({
			where: and(
				eq(recurringBlockRule.id, input.ruleId),
				eq(recurringBlockRule.organizationId, ctx.organizationId),
				eq(recurringBlockRule.userId, ctx.userId),
			),
		});
		if (!existing) throw new Error("Recurring block rule not found");

		const retargeted =
			input.taskId !== undefined || input.projectId !== undefined;
		if (retargeted || input.description !== undefined) {
			const nextProjectId =
				(input.projectId !== undefined
					? input.projectId
					: existing.projectId) ?? null;
			// Re-checked on update, not just on create: repointing an existing rule
			// at another project is the same write by a slower route.
			if (retargeted) await assertMayScheduleOn(ctx, nextProjectId);
			const taskRow = await assertTaskAvailable(
				ctx,
				input.taskId ?? existing.taskId,
				nextProjectId ?? undefined,
			);
			// The note rule follows the task, so a task change and a note change
			// are both occasions to re-ask it. Asked against the MERGED rule —
			// `update` is partial and either half may be absent — and this is the
			// only place update asks. A second check below used to re-ask it keyed
			// on "does the rule name a project", left over from when that was the
			// rule; once every task sat on every project it was wrong both ways,
			// and it made a Break block on a project unsaveable with the empty note
			// its own label calls optional.
			assertDescribed(taskRow, input.description ?? existing.description);
		}

		const patch: Partial<typeof recurringBlockRule.$inferInsert> = {
			updatedAt: new Date(),
		};
		if (input.taskId !== undefined) patch.taskId = input.taskId;
		if (input.projectId !== undefined) patch.projectId = input.projectId;
		if (input.description !== undefined) patch.description = input.description;
		if (input.daysOfWeek !== undefined) patch.daysOfWeek = input.daysOfWeek;
		if (input.duration !== undefined) {
			patch.durationSeconds = parseRuleDuration(input.duration);
		}
		if (input.effectiveFrom !== undefined) {
			patch.effectiveFrom = input.effectiveFrom;
		}
		if (input.effectiveUntil !== undefined) {
			patch.effectiveUntil = input.effectiveUntil;
		}
		if (input.active !== undefined) {
			patch.active = input.active;
			// Resuming is switching on: the floor moves to today rather than
			// refilling every day the rule spent paused.
			if (input.active && !existing.active) patch.activeSince = new Date();
		}

		const [updated] = await db
			.update(recurringBlockRule)
			.set(patch)
			.where(eq(recurringBlockRule.id, input.ruleId))
			.returning();
		// Only on the resume: an edit to shape or duration doesn't retroactively
		// rewrite blocks already on the calendar, and materializeRange skips any
		// day that already holds this rule's block.
		if (input.active && !existing.active) await materializeNow(ctx);
		return updated;
	},

	remove: async (ctx: Ctx, ruleId: string) => {
		await db
			.delete(recurringBlockRule)
			.where(
				and(
					eq(recurringBlockRule.id, ruleId),
					eq(recurringBlockRule.organizationId, ctx.organizationId),
					eq(recurringBlockRule.userId, ctx.userId),
				),
			);
	},

	// Idempotently ensures a real time_entry row exists for every (rule, date)
	// pair in [from, to] that the rule applies to and hasn't been skipped.
	materializeRange: async (ctx: Ctx, from: string, to: string) => {
		const rules = await db.query.recurringBlockRule.findMany({
			where: and(
				eq(recurringBlockRule.organizationId, ctx.organizationId),
				eq(recurringBlockRule.userId, ctx.userId),
				eq(recurringBlockRule.active, true),
				or(
					isNull(recurringBlockRule.effectiveFrom),
					lte(recurringBlockRule.effectiveFrom, to),
				),
				or(
					isNull(recurringBlockRule.effectiveUntil),
					gte(recurringBlockRule.effectiveUntil, from),
				),
			),
		});
		if (rules.length === 0) return;
		const writable = await rulesStillWritable(ctx, rules);

		const skips = await db.query.recurringBlockRuleSkip.findMany({
			where: inArray(
				recurringBlockRuleSkip.ruleId,
				rules.map((r) => r.id),
			),
		});
		const skipSet = new Set(skips.map((s) => `${s.ruleId}:${s.date}`));

		const tz = await ctxTimezone(ctx);
		const dates = datesBetween(from, to);
		const weekdayByDate = new Map(dates.map((d) => [d, weekdayInTz(d, tz)]));

		// What the day already holds, so a rule cannot put a second copy of its own
		// block on it. `onConflictDoNothing` below only recognises an entry THIS
		// rule generated — so a break that arrived any other way (the day assembler
		// carving one, "copy from previous day" bringing one forward, or someone
		// logging one by hand) was invisible to it, and the rule added a second
		// break to a day that plainly already had one. The day assembler has always
		// made this check before proposing its break; the materializer never did.
		const existing = await db.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
				gte(timeEntry.date, from),
				lte(timeEntry.date, to),
			),
			columns: {
				date: true,
				taskId: true,
				projectId: true,
				durationSeconds: true,
				fillsDay: true,
			},
			with: { task: { columns: { isAbsence: true } } },
		});

		// What each day already holds, by the same count `assertDayHasRoom` uses
		// for a hand-made write: everything but the fill block, which is sized
		// from the rest and shrinks around a new block. A rule never takes a day
		// past `MAX_DAY_SECONDS`; the day simply gets no block, as it would on a
		// day off. That service imports this one, so the count is shared through
		// `spokenForSeconds` rather than by calling it.
		const spokenFor = new Map<string, number>();
		for (const date of new Set(existing.map((e) => e.date))) {
			spokenFor.set(
				date,
				spokenForSeconds(existing.filter((e) => e.date === date)),
			);
		}

		// A day off takes no block. A rule is "on these weekdays", and a weekday
		// somebody spends on vacation or sick leave is not a day they take a break
		// or put an hour into a retainer — yet every day of a week off came back
		// with 8h of vacation plus the daily break.
		//
		// Any absence counts, not only a full day of it: the materializer has no
		// way to tell which half of a half day was worked.
		//
		// A block this pass wrote before the absence was booked (absence booked for
		// today, or for a past day still inside the window) is taken back. No skip
		// row is written for it, because the person did not delete it: cancel the
		// day off and the next pass writes the block again. A block that holds
		// GitHub evidence stays, since its attachments would cascade with it.
		const daysOff = [
			...new Set(existing.filter((e) => e.task.isAbsence).map((e) => e.date)),
		];
		const takenBack =
			daysOff.length === 0
				? []
				: await db
						.delete(timeEntry)
						.where(
							and(
								eq(timeEntry.organizationId, ctx.organizationId),
								eq(timeEntry.userId, ctx.userId),
								inArray(
									timeEntry.generatedFromRuleId,
									rules.map((r) => r.id),
								),
								inArray(timeEntry.date, daysOff),
								notExists(
									db
										.select({ one: sql`1` })
										.from(timeEntryGithubCommit)
										.where(eq(timeEntryGithubCommit.timeEntryId, timeEntry.id)),
								),
								notExists(
									db
										.select({ one: sql`1` })
										.from(timeEntryGithubPrActivity)
										.where(
											eq(timeEntryGithubPrActivity.timeEntryId, timeEntry.id),
										),
								),
							),
						)
						.returning({ date: timeEntry.date });
		const isDayOff = new Set(daysOff);
		// Two keys, because "is this block already here?" has two answers depending
		// on whether the rule names a project.
		//
		// A rule WITH a project is project-specific: two rules for the same task on
		// different projects are different blocks and a day may legitimately hold
		// both, so it only recognises its own project's entry.
		//
		// A rule with NO project — every break rule, since a break is time off the
		// clock that nobody can attribute to a client — matches on the task alone.
		// It has to: this key used to be project-qualified in both directions, so a
		// break someone had already logged against a project was invisible to the
		// break rule, and the rule filed a second, project-less one next to it. That
		// is not two blocks, it is one break counted twice, and it is what the
		// materializer's own guard was added to prevent.
		const taskKey = (e: { date: string; taskId: string }) =>
			`${e.date}|${e.taskId}`;
		const projectKey = (e: {
			date: string;
			taskId: string;
			projectId: string | null;
		}) => `${taskKey(e)}|${e.projectId ?? ""}`;
		const dayHasTask = new Set(existing.map(taskKey));
		const dayHasTaskOnProject = new Set(existing.map(projectKey));
		const dayAlreadyHas = (
			rule: {
				taskId: string;
				projectId: string | null;
			},
			date: string,
		) =>
			rule.projectId
				? dayHasTaskOnProject.has(projectKey({ ...rule, date }))
				: dayHasTask.has(taskKey({ ...rule, date }));

		const rows: (typeof timeEntry.$inferInsert)[] = [];
		for (const rule of rules) {
			if (!writable.has(rule.id)) continue;
			// A rule never writes to a day before it was switched on. Without this
			// floor, turning the daily break on wrote one onto every past day the
			// time page was scrolled back to — silently editing months of
			// already-filed timesheets, including closed ones.
			//
			// `effectiveFrom` narrows further but cannot widen: it is how you say
			// "start next month", not a way back into the past. Nothing offers
			// backfill, because nobody asked for their history to be rewritten.
			const activeSince = dayKeyInTz(rule.activeSince, tz);
			const startsOn =
				rule.effectiveFrom && rule.effectiveFrom > activeSince
					? rule.effectiveFrom
					: activeSince;
			for (const date of dates) {
				if (date < startsOn) continue;
				if (rule.effectiveUntil && date > rule.effectiveUntil) continue;
				if (!rule.daysOfWeek.includes(weekdayByDate.get(date) ?? -1)) continue;
				if (skipSet.has(`${rule.id}:${date}`)) continue;
				if (isDayOff.has(date)) continue;
				if (dayAlreadyHas(rule, date)) continue;
				const dayHolds = spokenFor.get(date) ?? 0;
				if (dayHolds + rule.durationSeconds > MAX_DAY_SECONDS) continue;
				spokenFor.set(date, dayHolds + rule.durationSeconds);

				// Claimed as this batch goes, so two rules for the same block on the
				// same weekday produce one entry rather than racing each other. Both
				// sets, so the claim is visible to whichever question the next rule asks.
				dayHasTask.add(taskKey({ date, taskId: rule.taskId }));
				dayHasTaskOnProject.add(
					projectKey({ date, taskId: rule.taskId, projectId: rule.projectId }),
				);
				rows.push({
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					projectId: rule.projectId,
					taskId: rule.taskId,
					description: rule.description,
					date,
					durationSeconds: rule.durationSeconds,
					generatedFromRuleId: rule.id,
					generatedForDate: date,
				});
			}
		}
		const inserted =
			rows.length === 0
				? []
				: await db
						.insert(timeEntry)
						.values(rows)
						.onConflictDoNothing({
							target: [
								timeEntry.generatedFromRuleId,
								timeEntry.generatedForDate,
							],
							where: sql`${timeEntry.generatedFromRuleId} is not null`,
						})
						.returning({ date: timeEntry.date });

		// A block that just landed on a day claims part of that day, so the day's
		// fill block — which by definition is "whatever is left" — is now too long.
		// Every hand-written path recomputes; this one did not, so turning the
		// daily break on for a day already covered by a rest-of-day block left the
		// day at 8h30 against an 8h target.
		//
		// It used to self-correct, but only by accident and only sometimes: the
		// read path rewrote fill blocks for whatever range you happened to open.
		// That is now bounded to the automation window, and reports read the ledger
		// directly rather than through `listRange` — so a day nobody reopened
		// simply stayed over-allocated.
		//
		// Best-effort and outside the insert: failing to resize a fill block must
		// not cost the person the blocks that were just materialized.
		// A block taken back from a day off frees the same time, so that day is
		// recomputed too.
		const touched = [
			...new Set([...takenBack, ...inserted].map((row) => row.date)),
		];
		for (const date of touched) {
			try {
				await recomputeDayFill(ctx, date, tz);
			} catch (error) {
				console.error("[recurring-blocks] fill recompute failed", {
					date,
					error,
				});
			}
		}
	},
};
