import { and, eq, or } from "drizzle-orm";
import { db } from "../db";
import { member, organization } from "../db/schema/auth";
import { recurringBlockRule } from "../db/schema/domain";
import { integrationSettings } from "../db/schema/settings";
import { withTimeout } from "../lib/http";
import { timeEntriesService } from "../services/time-entries.service";
import type { Ctx } from "../services/types";
import type { SchedulerLogger } from "./scheduler";

// The automation sweep: every engine that writes time entries nobody typed —
// recurring blocks, Google Calendar meetings, GitHub commit work-time blocks —
// runs from here, on a timer.
//
// They used to run inside `timeEntriesService.listRange`, i.e. on page load, so
// a day only got its entries if somebody happened to look at it, and looking at
// the wrong screen (paging back through the Month view) made them write months
// into the past. This host is a single long-lived Bun process — see
// jobs/scheduler.ts — so a scheduled job was always available and there was
// never a reason to hang this off a read.
//
// The move also fixes the thing the read path could not: a day is now synced
// while it IS today, whether or not the person opened the app. Friday's commits
// become Friday's fill block even if they don't log in until Monday.
//
// Idempotent by construction, so overlapping or missed ticks are harmless: the
// meeting engine reconciles against tombstones and `onConflictDoUpdate`, the
// commit engine guards on the one-fill-block-per-day index, the materializer
// checks what the day already holds. Best-effort per user: one revoked token is
// logged and skipped, never aborts the sweep.

export type AutomationSyncSummary = {
	/** (org, user) pairs with at least one automation switched on. */
	eligible: number;
	/** Pairs whose engines all completed. */
	synced: number;
	/** Pairs where at least one engine threw. */
	failed: number;
};

type Target = { organizationId: string; userId: string; timezone: string };

/**
 * Every (org, user) with something to do this tick.
 *
 * Two queries rather than one outer join across unrelated tables: a person can
 * qualify through their integration switches, through having an active
 * recurring block rule, or both, and the union is three lines of JS against a
 * few hundred rows.
 *
 * Both are joined through `member`, so an ex-member's leftover settings row or
 * recurring rule cannot keep writing entries into an org they have left.
 */
const collectTargets = async (): Promise<Target[]> => {
	const [integrationRows, ruleRows] = await Promise.all([
		db
			.select({
				organizationId: integrationSettings.organizationId,
				userId: integrationSettings.userId,
				timezone: organization.timezone,
			})
			.from(integrationSettings)
			.innerJoin(
				member,
				and(
					eq(member.organizationId, integrationSettings.organizationId),
					eq(member.userId, integrationSettings.userId),
				),
			)
			.innerJoin(
				organization,
				eq(organization.id, integrationSettings.organizationId),
			)
			.where(
				or(
					eq(integrationSettings.googleAutoSyncMeetings, true),
					eq(integrationSettings.githubSyncCommitsAsWorkTime, true),
				),
			),
		db
			.selectDistinct({
				organizationId: recurringBlockRule.organizationId,
				userId: recurringBlockRule.userId,
				timezone: organization.timezone,
			})
			.from(recurringBlockRule)
			.innerJoin(
				member,
				and(
					eq(member.organizationId, recurringBlockRule.organizationId),
					eq(member.userId, recurringBlockRule.userId),
				),
			)
			.innerJoin(
				organization,
				eq(organization.id, recurringBlockRule.organizationId),
			)
			.where(eq(recurringBlockRule.active, true)),
	]);

	// A user may hold several qualifying rows (both switches on, or several
	// rules); the pass below is per person, not per row.
	const byKey = new Map<string, Target>();
	for (const row of [...integrationRows, ...ruleRows]) {
		const key = `${row.organizationId}:${row.userId}`;
		if (byKey.has(key)) continue;
		byKey.set(key, {
			organizationId: row.organizationId,
			userId: row.userId,
			// The day boundary is the ORG's midnight, not the server's and not the
			// member's: one org, one answer to "what day is it", so two people in
			// the same workspace never disagree about which day an entry lands on.
			timezone: row.timezone ?? "UTC",
		});
	}
	return [...byKey.values()];
};

/**
 * How many people are swept at once.
 *
 * The sweep was strictly serial, which is two external API round-trips per
 * person in sequence: fine at twenty people and an overrun of the twenty-minute
 * tick at a few hundred, at which point the scheduler starts logging "previous
 * run still in progress" and the effective interval becomes however long a full
 * pass takes. Deliberately small — the ceiling here is somebody else's rate
 * limit, not this machine's CPU.
 */
const SWEEP_CONCURRENCY = Number(process.env.AUTOMATION_SYNC_CONCURRENCY ?? 4);

/**
 * How long one person's pass may take before the sweep abandons it.
 *
 * The backstop behind the fetch deadline in lib/http: that one covers the
 * outbound request, this covers everything else that could wedge (a connection
 * pool wait, a pathological query) and guarantees the sweep's own runtime is
 * bounded by targets x this, whatever happens underneath. Abandoned work keeps
 * running and is harmless — every engine is idempotent.
 */
const PER_USER_TIMEOUT_MS = Number(
	process.env.AUTOMATION_SYNC_USER_TIMEOUT_MS ?? 120_000,
);

/** One tick: run every enabled automation for everyone who has one. */
export const runAutomationSyncOnce = async (
	logger: Pick<SchedulerLogger, "error"> = {
		error: (message) => {
			console.error(message);
		},
	},
): Promise<AutomationSyncSummary> => {
	const now = new Date();
	const targets = await collectTargets();

	let synced = 0;
	let failed = 0;

	const runOne = async (target: Target) => {
		const ctx: Ctx = {
			organizationId: target.organizationId,
			userId: target.userId,
		};
		try {
			const result = await withTimeout(
				timeEntriesService.runAutomationsForUser(ctx, {
					now,
					tz: target.timezone,
				}),
				PER_USER_TIMEOUT_MS,
				() =>
					new Error(
						`automation pass exceeded ${String(PER_USER_TIMEOUT_MS)}ms`,
					),
			);
			if (result.failed.length > 0) failed++;
			else synced++;
		} catch (error) {
			// runAutomationsForUser already contains each engine; reaching here means
			// something outside them broke for this person, or the pass timed out.
			failed++;
			logger.error(
				`[automation-sync] pass failed for ${target.organizationId}/${target.userId}: ${String(error)}`,
			);
		}
	};

	// A fixed pool of workers pulling from one cursor, rather than chunked
	// batches: a batch runs at the speed of its slowest member and leaves the rest
	// of the pool idle, which is the whole problem when one person's calendar is
	// slow and everyone else's is not.
	let cursor = 0;
	const workers = Array.from(
		{ length: Math.max(1, Math.min(SWEEP_CONCURRENCY, targets.length)) },
		async () => {
			while (cursor < targets.length) {
				const target = targets[cursor++];
				if (target) await runOne(target);
			}
		},
	);
	await Promise.all(workers);

	return { eligible: targets.length, synced, failed };
};

/**
 * The same pass for one person, on demand — the "Sync now" button, and flipping
 * a sync switch on.
 *
 * It exists because the sweep runs on an interval: somebody who has just
 * connected their calendar or flipped a switch should not have to wait out a
 * tick to see whether it worked. Same window, same engines, same order; the
 * only difference is who asked.
 *
 * Requests for a pass already in flight JOIN it rather than starting a second
 * one. Both callers are reachable from a button any member can hold down, and
 * the cost of a pass is somebody else's API quota — so the guard is about not
 * multiplying that, and as a bonus makes a double-click do the obviously right
 * thing instead of racing itself.
 */
const inFlight = new Map<string, Promise<AutomationRunResult>>();

type AutomationRunResult = Awaited<
	ReturnType<typeof timeEntriesService.runAutomationsForUser>
>;

export const runAutomationSyncForCtx = (
	ctx: Ctx,
): Promise<AutomationRunResult> => {
	const key = `${ctx.organizationId}:${ctx.userId}`;
	const existing = inFlight.get(key);
	if (existing) return existing;

	const pass = timeEntriesService
		.runAutomationsForUser(ctx)
		.finally(() => inFlight.delete(key));
	inFlight.set(key, pass);
	return pass;
};
