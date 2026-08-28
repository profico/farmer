import { and, eq } from "drizzle-orm";

import { auth } from "../auth";
import { db } from "../db";
import { account } from "../db/schema/auth";
import {
	extractMeetingUrl,
	getGoogleUserInfo,
	insertAllDayEvent,
	isImportableEvent,
	listCalendarEvents,
} from "../lib/google-calendar-client";
import { addDaysToKey, dayBoundsInTz } from "../lib/time";
import type { ListCalendarEventsInput } from "../schema/google-calendar";
import { ctxTimezone } from "./context";
import type { Ctx } from "./types";

// Google access tokens live ~1h; getAccessToken transparently refreshes them
// using the stored refresh token (obtained via accessType:"offline" +
// prompt:"consent" in the auth config).
const getAccessToken = async (ctx: Ctx): Promise<string | null> => {
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

	// Writes an all-day vacation marker to the requester's primary calendar and
	// returns the created event id (null if the token is missing/insufficient).
	// `endDate` is the inclusive last day off; Google's end.date is exclusive so
	// we advance it by one day.
	insertTimeOffEvent: async (
		ctx: Ctx,
		input: { startDate: string; endDate: string; label: string | null },
	): Promise<string | null> => {
		const token = await getAccessToken(ctx);
		if (!token) return null;
		return insertAllDayEvent(token, {
			summary: input.label?.trim() || "Time off",
			startDate: input.startDate,
			endDate: addDaysToKey(input.endDate, 1),
		});
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
	return events.filter(isImportableEvent).map((event) => ({
		id: event.id,
		title: event.summary?.trim() || "(no title)",
		// oxlint-disable-next-line typescript/no-non-null-assertion -- guaranteed present by the filter above
		start: event.start!.dateTime!,
		// oxlint-disable-next-line typescript/no-non-null-assertion -- guaranteed present by the filter above
		end: event.end!.dateTime!,
		meetingUrl: extractMeetingUrl(event),
		htmlLink: event.htmlLink ?? null,
	}));
};
