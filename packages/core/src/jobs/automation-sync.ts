import { and, eq, isNull, or } from "drizzle-orm";

import { db } from "../db";
import { member, organization } from "../db/schema/auth";
import { recurringBlockRule } from "../db/schema/domain";
import { memberProfile } from "../db/schema/people";
import { integrationSettings } from "../db/schema/settings";
import { withTimeout } from "../lib/http";
import { loggableErrorLine } from "../lib/loggable-error";
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
 *
 * And both leave out archived people (`memberProfile.archivedAt`). Archiving is
 * how somebody leaves while their history stays — they keep the `member` row, so
 * the join above does not catch them, and their daily break went on filing
 * itself onto every working day after they had gone. Same rule as reminders
 * (`deliveryBlocks` in services/notify.ts): an archived person drops out of
 * everything forward-looking. A missing profile row is an active person, hence
 * the left join.
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
			.leftJoin(
				memberProfile,
				and(
					eq(memberProfile.organizationId, integrationSettings.organizationId),
					eq(memberProfile.userId, integrationSettings.userId),
				),
			)
			.where(
				and(
					isNull(memberProfile.archivedAt),
					or(
						eq(integrationSettings.googleAutoSyncMeetings, true),
						eq(integrationSettings.githubSyncCommitsAsWorkTime, true),
					),
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
			.leftJoin(
				memberProfile,
				and(
					eq(memberProfile.organizationId, recurringBlockRule.organizationId),
					eq(memberProfile.userId, recurringBlockRule.userId),
				),
			)
			.where(
				and(
					eq(recurringBlockRule.active, true),
					isNull(memberProfile.archivedAt),
				),
			),
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
const DEFAULT_PER_USER_TIMEOUT_MS = Number(
	process.env.AUTOMATION_SYNC_USER_TIMEOUT_MS ?? 120_000,
);
let perUserTimeoutMs = DEFAULT_PER_USER_TIMEOUT_MS;

/** Test-only: shorten the per-person deadline. Pass null to restore. */
export const setAutomationPassTimeoutForTests = (ms: number | null): void => {
	perUserTimeoutMs = ms ?? DEFAULT_PER_USER_TIMEOUT_MS;
};

type AutomationRunResult = Awaited<
	ReturnType<typeof timeEntriesService.runAutomationsForUser>
>;

/**
 * One pass per person at a time, whoever asked for it.
 *
 * Two callers start a pass: the sweep, and "Sync now" (plus flipping a sync
 * switch on). Each used to have its own story — the button deduplicated
 * against itself, the sweep against nothing — so a person who pressed the
 * button while the sweep was on them got two passes over the same days at
 * once, racing each other's reads for the fill block and paying the API quota
 * twice. Now a second request JOINS the pass in flight, from either side.
 *
 * The guard is keyed on the PASS, not on the deadline around it. Each caller
 * waits under its own deadline, and a deadline that fires ends that caller's
 * wait, not the pass: the work goes on, and the person stays in flight until
 * it settles. It used to be keyed on the deadlined promise and cleared when
 * the deadline fired, so the next tick or a press of the button started a
 * second pass beside the first one still running — the same two passes over
 * the same days this guard exists to prevent.
 *
 * A pass that never settles would then lock the person out until the process
 * restarts. So a pass older than `ABANDON_AFTER_DEADLINES` deadlines is
 * treated as wedged and dropped from the guard, and the next request starts a
 * fresh one. A pass that slow is waiting on nothing that will come back.
 */
type Flight = { work: Promise<AutomationRunResult>; startedAt: number };
const inFlight = new Map<string, Flight>();

/** How many deadlines a pass may run for before the guard gives up on it. */
const ABANDON_AFTER_DEADLINES = 4;

const runExclusive = (
	ctx: Ctx,
	opts: { now?: Date; tz?: string } = {},
): Promise<AutomationRunResult> => {
	const key = `${ctx.organizationId}:${ctx.userId}`;
	const timeoutMs = perUserTimeoutMs;
	const now = Date.now();

	let flight = inFlight.get(key);
	if (flight && now - flight.startedAt > timeoutMs * ABANDON_AFTER_DEADLINES) {
		inFlight.delete(key);
		flight = undefined;
	}
	if (!flight) {
		const started: Flight = {
			work: timeEntriesService.runAutomationsForUser(ctx, opts).finally(() => {
				if (inFlight.get(key) === started) inFlight.delete(key);
			}),
			startedAt: now,
		};
		inFlight.set(key, started);
		flight = started;
	}

	return withTimeout(
		flight.work,
		timeoutMs,
		() => new Error(`automation pass exceeded ${String(timeoutMs)}ms`),
	);
};

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
			const result = await runExclusive(ctx, { now, tz: target.timezone });
			if (result.failed.length > 0) failed++;
			else synced++;
		} catch (error) {
			// runAutomationsForUser already contains each engine; reaching here means
			// something outside them broke for this person, or the pass timed out.
			failed++;
			logger.error(
				`[automation-sync] pass failed for ${target.organizationId}/${target.userId}: ${loggableErrorLine(error)}`,
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
 * one — including the sweep's pass for the same person. Both callers are
 * reachable from a button any member can hold down, and the cost of a pass is
 * somebody else's API quota, so the guard is about not multiplying that. It
 * runs under the sweep's deadline too; see `runExclusive`.
 */
export const runAutomationSyncForCtx = (
	ctx: Ctx,
): Promise<AutomationRunResult> => runExclusive(ctx);
