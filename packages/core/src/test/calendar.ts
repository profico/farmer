// An in-memory Google Calendar for the tests that drive the meeting engine and
// the day assembler through `setCalendarSourceForTests`.
//
// One helper rather than a fake per file because the port grew a third method:
// the engine now asks Google about a synced entry's events BY ID before it
// deletes the entries, so every fake has to answer `lookupEvents` as well as
// the two list calls, and answer it consistently with what it lists.

import type {
	CalendarEventLookup,
	CalendarEventOption,
} from "../services/google-calendar.service";
import type { CalendarSource } from "../services/ports";

/** Just the fields a test needs to describe an event. */
export type FakeEvent = CalendarEventOption;

/**
 * A calendar holding `events`, or one that cannot be read (`null`).
 *
 * `lookupEvents` answers from the same list: an id in it is `found`, any other
 * id is `absent` — the ordinary case, where "not in the list" and "gone" agree.
 * `lookups` overrides that per id for the cases where they do not: a list
 * that came back empty while the meeting still exists, or Google that could
 * not be asked.
 */
export const fakeCalendar = (
	events: FakeEvent[] | null,
	lookups: Record<string, CalendarEventLookup> = {},
): CalendarSource => ({
	listEventsForRange: async () => events,
	listEventsForDay: async () => events ?? [],
	lookupEvents: async (_ctx, eventIds) =>
		new Map(
			eventIds.map((eventId) => {
				const override = lookups[eventId];
				if (override) return [eventId, override];
				const event = events?.find((e) => e.id === eventId);
				return [
					eventId,
					event ? { status: "found", event } : { status: "absent" },
				];
			}),
		),
});

/** A calendar with nothing on it. */
export const emptyCalendar: CalendarSource = fakeCalendar([]);
