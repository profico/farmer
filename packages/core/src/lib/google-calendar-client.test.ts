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

import { describe, expect, test } from "bun:test";

import {
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
