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
	const response = await fetch(`${GOOGLE_API}/oauth2/v3/userinfo`, {
		headers: authHeaders(token),
	});
	if (response.status === 401 || response.status === 403) return null;
	if (!response.ok) {
		throw new Error(`Google API error ${response.status}: /oauth2/v3/userinfo`);
	}
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
	start?: GoogleEventDateTime;
	end?: GoogleEventDateTime;
	conferenceData?: {
		entryPoints?: {
			entryPointType?: string; // "video" | "phone" | "more" | ...
			uri?: string;
			label?: string;
		}[];
	};
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
		const response = await fetch(
			`${GOOGLE_API}/calendar/v3/calendars/primary/events?${params}`,
			{ headers: authHeaders(token) },
		);
		if (!response.ok) {
			throw new Error(
				`Google Calendar API error ${response.status}: list events`,
			);
		}
		const body = (await response.json()) as {
			items?: GoogleCalendarEvent[];
			nextPageToken?: string;
		};
		if (body.items) items.push(...body.items);
		if (!body.nextPageToken) return items;
		pageToken = body.nextPageToken;
	}
	return items;
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
	const response = await fetch(
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
	const body = (await response.json()) as { id?: string };
	return body.id ?? null;
};

// Deletes an event from the primary calendar. Treats 404/410 as success (the
// event is already gone). Returns false on 401/403 so callers can degrade.
export const deleteCalendarEvent = async (
	token: string,
	eventId: string,
): Promise<boolean> => {
	const response = await fetch(
		`${GOOGLE_API}/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
		{ method: "DELETE", headers: authHeaders(token) },
	);
	if (response.status === 401 || response.status === 403) return false;
	if (response.status === 404 || response.status === 410) return true;
	if (!response.ok) {
		throw new Error(
			`Google Calendar API error ${response.status}: delete event`,
		);
	}
	return true;
};

// Best join link for a meeting, in priority order:
//  1. hangoutLink            — Google Meet, the common case
//  2. conferenceData video   — Meet/Zoom/Teams via a calendar add-on
//  3. first URL in location  — Zoom/Teams links are often just pasted here
export const extractMeetingUrl = (event: GoogleCalendarEvent): string | null => {
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
