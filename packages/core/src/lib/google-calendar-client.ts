import { externalFetch } from "./http";

const GOOGLE_API = "https://www.googleapis.com";

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

export type GoogleUserInfo = {
	email?: string;
	name?: string;
	picture?: string;
};

// Returns null on 401/403 (token revoked or missing scope) so callers can
// degrade to "connected but can't read" instead of throwing.
export const getGoogleUserInfo = async (
	token: string,
): Promise<GoogleUserInfo | null> => {
	const response = await externalFetch(`${GOOGLE_API}/oauth2/v3/userinfo`, {
		headers: authHeaders(token),
	});
	if (response.status === 401 || response.status === 403) return null;
	if (!response.ok) {
		throw new Error(`Google API error ${response.status}: /oauth2/v3/userinfo`);
	}
	// SAFETY: 401/403 returned null and every other non-2xx threw above, so this
	// is Google's documented userinfo body. Only `email` is read from it, and the
	// caller treats a missing one as an unusable connection.
	return (await response.json()) as GoogleUserInfo;
};

type GoogleEventDateTime = {
	dateTime?: string; // RFC3339 instant — present on timed events
	date?: string; // yyyy-MM-dd — present on all-day events
	timeZone?: string;
};

export type GoogleCalendarEvent = {
	id: string;
	status?: string; // "confirmed" | "tentative" | "cancelled"
	summary?: string;
	htmlLink?: string;
	hangoutLink?: string;
	location?: string;
	// "default" | "outOfOffice" | "focusTime" | "workingLocation" | "birthday"
	eventType?: string;
	start?: GoogleEventDateTime;
	end?: GoogleEventDateTime;
	attendees?: {
		email?: string;
		/** True on the row describing the calendar owner — the only one whose
		 *  answer says anything about whether THIS person attended. */
		self?: boolean;
		// "accepted" | "declined" | "tentative" | "needsAction"
		responseStatus?: string;
	}[];
	conferenceData?: {
		entryPoints?: {
			entryPointType?: string; // "video" | "phone" | "more" | ...
			uri?: string;
			label?: string;
		}[];
	};
};

/** Blocks Google returns as events but which are not meetings anybody attended.
 *  `workingLocation` and `birthday` are all-day and already excluded by the
 *  dateTime check; these two are timed, so nothing else stops them. */
const NON_MEETING_EVENT_TYPES = new Set(["outOfOffice", "focusTime"]);

/**
 * Is this event worth importing as a Meeting entry?
 *
 * Pure, and exported, because it is the whole of the policy: everything the
 * engine writes passed through here.
 *
 * Cancelled and all-day events were the only exclusions. Two categories got
 * through that nobody worked:
 *
 *   - a meeting the person DECLINED — still on their calendar, still returned
 *     by the API, and turned into logged time they then had to find and delete
 *     before the month would close;
 *   - timed "Out of office" and "Focus time" blocks, which are Google's way of
 *     saying "this person is not in a meeting" and which are frequently the
 *     largest blocks on the day.
 *
 * `attendees` and `eventType` were both already in the payload. Neither was read.
 */
export const isImportableEvent = (event: GoogleCalendarEvent): boolean => {
	if (event.status === "cancelled") return false;
	// All-day events carry `date`, not `dateTime` — no clock time to import.
	if (!event.start?.dateTime || !event.end?.dateTime) return false;
	if (event.eventType && NON_MEETING_EVENT_TYPES.has(event.eventType)) {
		return false;
	}
	// Only the owner's own row counts. An event with no attendees at all is a
	// solo block the person put on their own calendar, which is real time.
	const self = event.attendees?.find((a) => a.self);
	if (self?.responseStatus === "declined") return false;
	return true;
};

// Lists every timed/all-day event in [timeMin, timeMax). Follows nextPageToken
// so the result is COMPLETE for the window — the meeting-sync engine treats a
// synced meeting that's absent from this list as cancelled/moved and deletes
// its block, so a truncated page would wrongly delete real meetings. Cancelled
// events are simply omitted (showDeleted defaults to false), which is exactly
// the "absent" signal the engine keys on. MAX_PAGES caps a pathological loop.
const MAX_PAGES = 20;
export const listCalendarEvents = async (
	token: string,
	options: { timeMin: Date; timeMax: Date },
): Promise<GoogleCalendarEvent[]> => {
	const items: GoogleCalendarEvent[] = [];
	let pageToken: string | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const params = new URLSearchParams({
			timeMin: options.timeMin.toISOString(),
			timeMax: options.timeMax.toISOString(),
			singleEvents: "true", // expand recurring events into individual instances
			orderBy: "startTime", // only allowed alongside singleEvents=true
			maxResults: "250",
		});
		if (pageToken) params.set("pageToken", pageToken);
		const response = await externalFetch(
			`${GOOGLE_API}/calendar/v3/calendars/primary/events?${params}`,
			{ headers: authHeaders(token) },
		);
		if (!response.ok) {
			throw new Error(
				`Google Calendar API error ${response.status}: list events`,
			);
		}
		// SAFETY: guarded by the `!response.ok` throw above. Both fields are declared
		// optional precisely because the last page carries no `nextPageToken` and an
		// empty calendar carries no `items`.
		const body = (await response.json()) as {
			items?: GoogleCalendarEvent[];
			nextPageToken?: string;
		};
		if (body.items) items.push(...body.items);
		if (!body.nextPageToken) return items;
		pageToken = body.nextPageToken;
	}
	// Reaching the cap means the list is TRUNCATED, and delete-by-absence reads
	// absence as cancellation — so the meetings on the pages never fetched would
	// have their entries deleted. It takes >5000 events in a window of a few
	// days, which is why this is a log line and not a mechanism; without it the
	// truncation is completely silent.
	console.warn("[google-calendar] event list truncated at the page cap", {
		pages: MAX_PAGES,
		collected: items.length,
		timeMin: options.timeMin.toISOString(),
		timeMax: options.timeMax.toISOString(),
	});
	return items;
};

/** What Google says about one event when asked for it by id.
 *  - `found`: it exists and is still a meeting the person attends (the same
 *    `isImportableEvent` test the list applies), wherever it now sits.
 *  - `absent`: deleted, cancelled, declined, or turned into something that is
 *    not a meeting — the entry describing it should go.
 *  - `unreadable`: Google could not be asked (revoked token, outage). Nothing
 *    can be concluded, so nothing should be deleted on the strength of it. */
export type CalendarEventLookup =
	| { status: "found"; event: GoogleCalendarEvent }
	| { status: "absent" }
	| { status: "unreadable" };

// Fetches one event by id. The meeting-sync engine calls this for a synced
// entry whose event is missing from the range list, BEFORE deleting it: the
// list can come back empty or truncated, and "not in the list" is not the same
// fact as "gone". A recurring instance id (`<series>_<start>`) is accepted here
// exactly as the list hands it out.
//
// Google answers a deleted event with 200 and `status: "cancelled"` for a while
// and 404/410 after that; both are `absent`. Everything else that is not a
// definite answer is `unreadable` rather than thrown — this is one lookup per
// stale row inside a pass that must not fail on one bad response.
export const getCalendarEvent = async (
	token: string,
	eventId: string,
): Promise<CalendarEventLookup> => {
	const response = await externalFetch(
		`${GOOGLE_API}/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
		{ headers: authHeaders(token) },
	);
	if (response.status === 404 || response.status === 410) {
		return { status: "absent" };
	}
	if (!response.ok) return { status: "unreadable" };
	// SAFETY: guarded by the `!response.ok` return above, so this is Google's
	// documented event resource — the same shape the list endpoint's `items`
	// carry, and `isImportableEvent` reads only optional fields from it.
	const event = (await response.json()) as GoogleCalendarEvent;
	return isImportableEvent(event)
		? { status: "found", event }
		: { status: "absent" };
};

// Creates an all-day event on the primary calendar and returns its id.
// `startDate` maps to Google's inclusive `start.date`; `endDate` maps to
// `end.date`, which Google treats as EXCLUSIVE — callers pass the day after the
// last covered day (see googleCalendarService.insertTimeOffEvent). Returns null
// on 401/403 so a revoked/insufficient token degrades instead of throwing.
export const insertAllDayEvent = async (
	token: string,
	input: { summary: string; startDate: string; endDate: string },
): Promise<string | null> => {
	const response = await externalFetch(
		`${GOOGLE_API}/calendar/v3/calendars/primary/events`,
		{
			method: "POST",
			headers: { ...authHeaders(token), "Content-Type": "application/json" },
			body: JSON.stringify({
				summary: input.summary,
				start: { date: input.startDate },
				end: { date: input.endDate },
				transparency: "transparent", // shows as "free", it's an all-day marker
			}),
		},
	);
	if (response.status === 401 || response.status === 403) return null;
	if (!response.ok) {
		throw new Error(
			`Google Calendar API error ${response.status}: insert event`,
		);
	}
	// SAFETY: 401/403 returned null and every other non-2xx threw above. `id` is
	// optional here rather than asserted present — the caller maps a missing one
	// to null, so a surprising body costs the id, not the request.
	const body = (await response.json()) as { id?: string };
	return body.id ?? null;
};

// Best join link for a meeting, in priority order:
//  1. hangoutLink            — Google Meet, the common case
//  2. conferenceData video   — Meet/Zoom/Teams via a calendar add-on
//  3. first URL in location  — Zoom/Teams links are often just pasted here
export const extractMeetingUrl = (
	event: GoogleCalendarEvent,
): string | null => {
	if (event.hangoutLink) return event.hangoutLink;
	const video = event.conferenceData?.entryPoints?.find(
		(entry) => entry.entryPointType === "video" && entry.uri,
	);
	if (video?.uri) return video.uri;
	if (event.location) {
		const match = event.location.match(/https?:\/\/\S+/);
		if (match) return match[0];
	}
	return null;
};
