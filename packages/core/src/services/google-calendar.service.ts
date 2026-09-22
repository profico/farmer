import { and, eq } from "drizzle-orm";

import { auth } from "../auth";
import { db } from "../db";
import { account } from "../db/schema/auth";
import { mapBounded } from "../lib/concurrency";
import {
	extractMeetingUrl,
	getCalendarEvent,
	getGoogleUserInfo,
	type GoogleCalendarEvent,
	isImportableEvent,
	listCalendarEvents,
} from "../lib/google-calendar-client";
import { dayBoundsInTz } from "../lib/time";
import type { ListCalendarEventsInput } from "../schema/google-calendar";
import { ctxTimezone } from "./context";
import type { Ctx } from "./types";

// Google access tokens live ~1h; getAccessToken transparently refreshes them
// using the stored refresh token (obtained via accessType:"offline" +
// prompt:"consent" in the auth config).
const getAccessToken = async (ctx: Ctx): Promise<string | null> => {
	// Same as githubService's helper: no linked account is an ordinary answer,
	// and better-auth throws "Account not found" for it, so ask the table first
	// and keep the error log for real failures.
	const linked = await db.query.account.findFirst({
		where: and(
			eq(account.userId, ctx.userId),
			eq(account.providerId, "google-calendar"),
		),
		columns: { id: true },
	});
	if (!linked) return null;
	try {
		const result = await auth.api.getAccessToken({
			body: { providerId: "google-calendar", userId: ctx.userId },
		});
		return result.accessToken ?? null;
	} catch (error) {
		console.error("[google-calendar] getAccessToken failed", {
			userId: ctx.userId,
			error,
		});
		return null;
	}
};

/** What Google says about one event the engine asked about by id. `absent` is
 *  a definite no — cancelled, declined, 404 or 410; `unreadable` is no answer
 *  at all, which the engine must not act on. */
export type CalendarEventLookup =
	| { status: "found"; event: CalendarEventOption }
	| { status: "absent" }
	| { status: "unreadable" };

// Against one person's own calendar, so the ceiling is about being a good
// citizen of Google's per-user quota rather than about speed.
const EVENT_LOOKUP_CONCURRENCY = 4;

export type CalendarEventOption = {
	id: string;
	title: string;
	start: string; // RFC3339 instant — UI converts to the org tz for HH:mm
	end: string; // RFC3339 instant
	meetingUrl: string | null;
	htmlLink: string | null;
};

export const googleCalendarService = {
	connectionStatus: async (
		ctx: Ctx,
	): Promise<{
		connected: boolean;
		email: string | null;
		/** Google answered neither yes nor no. See the note below `getAccessToken`
		 *  in githubService.connectionStatus — same hazard, same page. */
		unreachable: boolean;
	}> => {
		// Mirror githubService.connectionStatus: read the account table directly
		// rather than auth.api.accountInfo, which needs a stored account cookie
		// (unset here) and otherwise always throws ACCOUNT_NOT_FOUND.
		const linkedAccount = await db.query.account.findFirst({
			where: and(
				eq(account.userId, ctx.userId),
				// "google-calendar", not "google": the base "google" provider is now
				// Sign in with Google (identity only). A login row must never read as
				// a live calendar connection.
				eq(account.providerId, "google-calendar"),
			),
		});
		if (!linkedAccount) {
			return { connected: false, email: null, unreachable: false };
		}

		const token = await getAccessToken(ctx);
		if (!token) return { connected: true, email: null, unreachable: false };

		// The linked account is a local fact; the email is a nicety fetched from
		// Google. `getGoogleUserInfo` throws on any status that isn't 401/403, and
		// `externalFetch` throws on its own deadline too — so this took the whole
		// Integrations page down on a slow network, not just a Google outage.
		try {
			const info = await getGoogleUserInfo(token);
			return {
				connected: true,
				email: info?.email ?? null,
				unreachable: false,
			};
		} catch (error) {
			console.error("[google-calendar] could not resolve the account email", {
				userId: ctx.userId,
				error,
			});
			return { connected: true, email: null, unreachable: true };
		}
	},

	listEventsForDay: async (
		ctx: Ctx,
		input: ListCalendarEventsInput,
	): Promise<CalendarEventOption[]> => {
		const token = await getAccessToken(ctx);
		if (!token) throw new Error("Google Calendar not connected");

		const tz = await ctxTimezone(ctx);
		const { start, end } = dayBoundsInTz(input.date, tz);
		return fetchTimedEvents(token, start, end);
	},

	// Range variant used by the meeting-sync engine to reconcile every timed
	// event across a window in one pass. Returns `null` (not `[]`) when Google
	// isn't connected/readable, so the engine can tell "no meetings in range"
	// (empty array → delete stale synced blocks) apart from "couldn't read"
	// (null → touch nothing). An unconnected user still never breaks the page.
	listEventsForRange: async (
		ctx: Ctx,
		input: { from: string; to: string },
	): Promise<CalendarEventOption[] | null> => {
		const token = await getAccessToken(ctx);
		if (!token) return null;

		const tz = await ctxTimezone(ctx);
		const start = dayBoundsInTz(input.from, tz).start;
		const end = dayBoundsInTz(input.to, tz).end;
		return fetchTimedEvents(token, start, end);
	},

	// Events by id, for the meeting-sync engine to confirm a synced entry's
	// event is really gone before it deletes the entry. The shape the engine
	// reads is the same as the list's, so a `found` event that is still inside
	// the window can be written through the same path the list feeds.
	//
	// Plural, and one token for the batch, because of the case that matters:
	// a throttled or empty list leaves EVERY synced row in the window stale, so
	// the engine asks about all of them on the same tick. One call per id meant
	// one account read and one better-auth token refresh per id as well, all in
	// series, twenty minutes later again.
	//
	// Every failure is `unreadable`, including a thrown fetch (timeout, network):
	// these lookups sit inside a pass that has already done its useful work, and
	// a throw here would report the whole engine as failed.
	lookupEvents: async (
		ctx: Ctx,
		eventIds: string[],
	): Promise<Map<string, CalendarEventLookup>> => {
		if (eventIds.length === 0) return new Map();
		const token = await getAccessToken(ctx);
		if (!token) {
			return new Map(eventIds.map((id) => [id, { status: "unreadable" }]));
		}
		const looked = await mapBounded(
			eventIds,
			EVENT_LOOKUP_CONCURRENCY,
			async (eventId): Promise<readonly [string, CalendarEventLookup]> => {
				try {
					const lookup = await getCalendarEvent(token, eventId);
					if (lookup.status !== "found") return [eventId, lookup] as const;
					return [
						eventId,
						{ status: "found", event: toOption(lookup.event) },
					] as const;
				} catch (error) {
					console.error("[google-calendar] event lookup failed", {
						userId: ctx.userId,
						eventId,
						error,
					});
					return [eventId, { status: "unreadable" }] as const;
				}
			},
		);
		return new Map(looked);
	},
};

// Shared filter+shape for calendar reads: keep only what `isImportableEvent`
// calls a meeting the person actually attended, and normalize to
// CalendarEventOption. The predicate lives in lib/google-calendar-client next to
// the payload type it reads, so it can be exercised without a database.
const fetchTimedEvents = async (
	token: string,
	timeMin: Date,
	timeMax: Date,
): Promise<CalendarEventOption[]> => {
	const events = await listCalendarEvents(token, { timeMin, timeMax });
	return events.filter(isImportableEvent).map(toOption);
};

/** Normalize one event that has passed `isImportableEvent`. */
const toOption = (event: GoogleCalendarEvent): CalendarEventOption => ({
	id: event.id,
	title: event.summary?.trim() || "(no title)",
	// oxlint-disable-next-line typescript/no-non-null-assertion -- every caller filtered on isImportableEvent, which requires both instants
	start: event.start!.dateTime!,
	// oxlint-disable-next-line typescript/no-non-null-assertion -- every caller filtered on isImportableEvent, which requires both instants
	end: event.end!.dateTime!,
	meetingUrl: extractMeetingUrl(event),
	htmlLink: event.htmlLink ?? null,
});
