import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { account, organization } from "../db/schema/auth";
import { integrationSettings } from "../db/schema/settings";
import { orgTimezone } from "../lib/org-time";
import { addDaysToKey, dayKeyInTz } from "../lib/time";
import { timeEntriesService } from "../services/time-entries.service";
import type { Ctx } from "../services/types";

// How far the background window reaches around "today" (computed in each user's
// org timezone). A little into the past catches meetings that were rescheduled
// after they first synced; the forward reach pre-populates upcoming days so a
// meeting is already a block before the user ever opens the time page.
const PAST_DAYS = 1;
const FUTURE_DAYS = 14;

// The reconcile window for one user around a day-key already resolved in their
// org timezone. Single source of truth for the window policy so the background
// scheduler and the manual "Sync now" button import/expire the exact same set
// of meetings.
export const meetingSyncWindow = (todayKey: string) => ({
	from: addDaysToKey(todayKey, -PAST_DAYS),
	to: addDaysToKey(todayKey, FUTURE_DAYS),
});

// Sync one (org, user)'s meetings on demand: resolve the org timezone, pin
// "today" in it, and reconcile the standard window. Backs the manual sync
// server fn. The batch job below inlines the same window using a timezone it
// already fetched in its join, to avoid a per-user timezone query.
export const syncMeetingsForCtx = async (ctx: Ctx): Promise<void> => {
	const tz = await orgTimezone(ctx.organizationId);
	const todayKey = dayKeyInTz(new Date(), tz);
	await timeEntriesService.syncMeetingsForUser(ctx, meetingSyncWindow(todayKey));
};

export type MeetingSyncSummary = {
	eligible: number;
	synced: number;
	failed: number;
};

// Enumerate every (org, user) that has meeting auto-sync enabled AND a linked
// Google account, then run the same idempotent import the time page runs on
// read — but on a timer, so meetings materialize without anyone logging in.
// Best-effort per user: one revoked token or calendar outage is logged and
// skipped, never aborts the batch. Safe to run repeatedly (onConflictDoNothing
// + tombstones in the sync engine), so overlapping/duplicate runs can't create
// duplicate or resurrected entries.
export const runMeetingSyncOnce = async (): Promise<MeetingSyncSummary> => {
	const now = new Date();

	const rows = await db
		.select({
			organizationId: integrationSettings.organizationId,
			userId: integrationSettings.userId,
			timezone: organization.timezone,
		})
		.from(integrationSettings)
		.innerJoin(
			account,
			and(
				eq(account.userId, integrationSettings.userId),
				eq(account.providerId, "google-calendar"),
			),
		)
		.innerJoin(
			organization,
			eq(organization.id, integrationSettings.organizationId),
		)
		.where(eq(integrationSettings.googleAutoSyncMeetings, true));

	// A user could in principle hold more than one linked Google account row; the
	// join would then yield the same (org, user) twice. Collapse to one sync per
	// pair — getAccessToken picks a single account anyway.
	const seen = new Set<string>();
	const targets = rows.filter((row) => {
		const key = `${row.organizationId}:${row.userId}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	let synced = 0;
	let failed = 0;

	for (const target of targets) {
		const tz = target.timezone ?? "UTC";
		const todayKey = dayKeyInTz(now, tz);
		const range = meetingSyncWindow(todayKey);
		try {
			await timeEntriesService.syncMeetingsForUser(
				{ organizationId: target.organizationId, userId: target.userId },
				range,
			);
			synced++;
		} catch (error) {
			failed++;
			console.error("[meeting-sync] user sync failed", {
				organizationId: target.organizationId,
				userId: target.userId,
				error,
			});
		}
	}

	return { eligible: targets.length, synced, failed };
};
