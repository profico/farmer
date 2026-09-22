// What counts as a meeting worth importing.
//
// The engine dropped cancelled and all-day events and imported everything else,
// which meant two categories of "not a meeting" became logged time the person
// had to hunt down and delete before their month would close:
//
//   - meetings they DECLINED, which stay on the calendar and stay in the API
//     response;
//   - timed "Out of office" and "Focus time" blocks, i.e. Google's way of saying
//     this person is explicitly NOT in a meeting — and often the largest block
//     on the day.
//
// `attendees[].self.responseStatus` and `eventType` were both already in the
// payload. Neither was read.

import { afterEach, describe, expect, test } from "bun:test";

import {
	extractMeetingUrl,
	getCalendarEvent,
	type GoogleCalendarEvent,
	isImportableEvent,
} from "./google-calendar-client";

const timed = (
	over: Partial<GoogleCalendarEvent> = {},
): GoogleCalendarEvent => ({
	id: "e1",
	status: "confirmed",
	summary: "Standup",
	start: { dateTime: "2026-08-10T09:00:00Z" },
	end: { dateTime: "2026-08-10T09:30:00Z" },
	...over,
});

describe("isImportableEvent", () => {
	test("imports an ordinary timed meeting", () => {
		expect(isImportableEvent(timed())).toBe(true);
	});

	test("skips a cancelled event", () => {
		expect(isImportableEvent(timed({ status: "cancelled" }))).toBe(false);
	});

	test("skips an all-day event", () => {
		expect(
			isImportableEvent(
				timed({ start: { date: "2026-08-10" }, end: { date: "2026-08-11" } }),
			),
		).toBe(false);
	});

	test("skips a meeting the calendar owner declined", () => {
		expect(
			isImportableEvent(
				timed({
					attendees: [
						{ email: "me@example.com", self: true, responseStatus: "declined" },
						{ email: "them@example.com", responseStatus: "accepted" },
					],
				}),
			),
		).toBe(false);
	});

	test("imports a meeting someone ELSE declined", () => {
		expect(
			isImportableEvent(
				timed({
					attendees: [
						{ email: "me@example.com", self: true, responseStatus: "accepted" },
						{ email: "them@example.com", responseStatus: "declined" },
					],
				}),
			),
		).toBe(true);
	});

	test("imports a meeting not yet responded to", () => {
		for (const responseStatus of ["accepted", "tentative", "needsAction"]) {
			expect(
				isImportableEvent(
					timed({ attendees: [{ self: true, responseStatus }] }),
				),
			).toBe(true);
		}
	});

	test("imports a solo block with no attendees at all", () => {
		// Time the person blocked out for themselves is real time.
		expect(isImportableEvent(timed({ attendees: [] }))).toBe(true);
		expect(isImportableEvent(timed({ attendees: undefined }))).toBe(true);
	});

	test("skips timed Out of office and Focus time blocks", () => {
		expect(isImportableEvent(timed({ eventType: "outOfOffice" }))).toBe(false);
		expect(isImportableEvent(timed({ eventType: "focusTime" }))).toBe(false);
	});

	test("imports an event whose eventType is default or absent", () => {
		expect(isImportableEvent(timed({ eventType: "default" }))).toBe(true);
		expect(isImportableEvent(timed({ eventType: undefined }))).toBe(true);
	});

	test("an unknown eventType is imported rather than dropped", () => {
		// Google adds these over time; a new one is far more likely to be a real
		// meeting than not, and dropping time is the worse failure.
		expect(isImportableEvent(timed({ eventType: "somethingNew" }))).toBe(true);
	});
});

// One event asked for by id, as the meeting engine does before it deletes an
// entry whose event is missing from the list. Every non-answer is `unreadable`
// rather than a throw: this runs once per stale row inside a pass that has
// already done its useful work.
describe("getCalendarEvent", () => {
	const realFetch = globalThis.fetch;
	const answering = (status: number, body?: GoogleCalendarEvent) => {
		globalThis.fetch = Object.assign(
			async () =>
				new Response(body === undefined ? null : JSON.stringify(body), {
					status,
					headers: { "Content-Type": "application/json" },
				}),
			{ preconnect: realFetch.preconnect },
		);
	};
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	test("a live meeting is found", async () => {
		answering(200, timed());
		const lookup = await getCalendarEvent("token", "e1");
		expect(lookup.status).toBe("found");
	});

	test("a cancelled event is absent, as Google reports it for a while after deletion", async () => {
		answering(200, timed({ status: "cancelled" }));
		expect((await getCalendarEvent("token", "e1")).status).toBe("absent");
	});

	test("a declined meeting is absent: the list would not carry it either", async () => {
		answering(
			200,
			timed({ attendees: [{ self: true, responseStatus: "declined" }] }),
		);
		expect((await getCalendarEvent("token", "e1")).status).toBe("absent");
	});

	test("404 and 410 are absent", async () => {
		answering(404);
		expect((await getCalendarEvent("token", "e1")).status).toBe("absent");
		answering(410);
		expect((await getCalendarEvent("token", "e1")).status).toBe("absent");
	});

	test("a revoked token or an outage is unreadable, not a throw", async () => {
		answering(401);
		expect((await getCalendarEvent("token", "e1")).status).toBe("unreadable");
		answering(503);
		expect((await getCalendarEvent("token", "e1")).status).toBe("unreadable");
	});
});

// The join link lands in an `href`. A conference add-on writes the entry point,
// so a `javascript:` URI there ran in the session of whoever clicked it.
describe("extractMeetingUrl", () => {
	const video = (uri: string) =>
		timed({
			conferenceData: { entryPoints: [{ entryPointType: "video", uri }] },
		});

	test("returns an https join link", () => {
		expect(extractMeetingUrl(video("https://zoom.us/j/1"))).toBe(
			"https://zoom.us/j/1",
		);
	});

	test("never returns a link that is not http or https", () => {
		for (const uri of [
			"javascript:alert(1)",
			"data:text/html,<script>alert(1)</script>",
			"file:///etc/passwd",
			"not a url",
		]) {
			expect(extractMeetingUrl(video(uri))).toBeNull();
			expect(extractMeetingUrl(timed({ hangoutLink: uri }))).toBeNull();
		}
	});

	test("skips a bad entry point for a good one", () => {
		const event = timed({
			conferenceData: {
				entryPoints: [
					{ entryPointType: "video", uri: "javascript:alert(1)" },
					{ entryPointType: "video", uri: "https://meet.example.com/x" },
				],
			},
		});
		expect(extractMeetingUrl(event)).toBe("https://meet.example.com/x");
	});
});
