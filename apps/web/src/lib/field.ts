import { dayKeyInTz, timeKeyInTz } from "@farmer/core/lib/time";
import { useEffect, useState } from "react";

// The widescreen field — the crop rows on the ground behind the app frame.
// This module is the clock; `components/field.tsx` draws it with
// `lib/wheat-field.ts`, and the `field` section of `styles.css` sets its tint,
// height and width gate.
//
// There is no switch. The field is on for everyone with a screen wide enough to
// show it, which is what lets the whole thing server-render: nothing here reads
// localStorage, so there is no per-device answer the server cannot know, and no
// frame where the field is absent and then appears.

export type FieldSeason = "winter" | "spring" | "summer" | "autumn";
export type FieldDaylight = "dawn" | "day" | "dusk" | "night";

/** Northern hemisphere. See the season comment in `styles.css`: the org country
 *  is not consulted, because reading it costs a query and this ornament reads
 *  nothing. */
const seasonOf = (month: number): FieldSeason => {
	if (month <= 2 || month === 12) return "winter";
	if (month <= 5) return "spring";
	if (month <= 8) return "summer";
	return "autumn";
};

/** A fixed clock rather than a real sunrise, which would need a latitude the
 *  app has no reason to hold. */
const daylightOf = (hour: number): FieldDaylight => {
	if (hour < 5) return "night";
	if (hour < 8) return "dawn";
	if (hour < 17) return "day";
	if (hour < 21) return "dusk";
	return "night";
};

export type FieldPhase = { season: FieldSeason; daylight: FieldDaylight };

/** Both read in the ORG timezone, not the reader's own: the whole app already
 *  states the day and the week in that zone, so a field that turned to dusk an
 *  hour before the timesheet agreed would be the one thing on screen telling a
 *  different time. */
export const fieldPhase = (instant: Date, timezone: string): FieldPhase => ({
	season: seasonOf(Number(dayKeyInTz(instant, timezone).slice(5, 7))),
	daylight: daylightOf(Number(timeKeyInTz(instant, timezone).slice(0, 2))),
});

/** Ten minutes. Both values change on an hour boundary at the finest, so this
 *  is four times more often than it can matter and still nothing to speak of. */
const TICK_MS = 10 * 60 * 1000;

export function useFieldPhase(timezone: string): FieldPhase {
	const [phase, setPhase] = useState(() => fieldPhase(new Date(), timezone));
	useEffect(() => {
		const id = setInterval(
			() => setPhase(fieldPhase(new Date(), timezone)),
			TICK_MS,
		);
		return () => clearInterval(id);
	}, [timezone]);
	return phase;
}
