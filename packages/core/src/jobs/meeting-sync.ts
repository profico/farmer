import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { account, organization } from "../db/schema/auth";
import { integrationSettings } from "../db/schema/settings";
import { meetingSyncWindow } from "../lib/meeting-window";
import { orgTimezone } from "../lib/org-time";
import { dayKeyInTz } from "../lib/time";
import { timeEntriesService } from "../services/time-entries.service";
import type { Ctx } from "../services/types";

// The window policy lives in lib/meeting-window so the service layer's
// write-on-read sync can honour the same one — see the note there.
export { meetingSyncWindow } from "../lib/meeting-window";

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
