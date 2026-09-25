import Holidays, { type HolidaysTypes } from "date-holidays";
import { and, eq } from "drizzle-orm";

import { disabledHoliday } from "../db/schema/schedule";
import { orgCountry } from "../lib/org-country";
import { ctxMemo } from "./context";
import { ctxDb } from "./db-ctx";
import type { Ctx } from "./types";

// Only "days off" types — excludes 'observance'/'optional'/'school' which
// aren't actual non-working days.
const HOLIDAY_TYPES: HolidaysTypes.HolidayType[] = ["public", "bank"];

// One `Holidays` instance per country, built on first use and kept.
//
// Constructing one parses the library's whole rule set for that country, and
// `holidaySetForRange` is called from inside the reminder jobs' per-member loop
// — so an org of 200 people rebuilt the same Croatian calendar 200 times per
// tick. Reuse is safe: `getHolidays(year)` is a pure read against those rules,
// verified to return identical results for a year whether or not other years
// were queried in between, and the instance carries no per-call state.
//
// Keyed by country because that is the only input: the org's opt-outs are
// applied by the callers below, against a set read fresh from the database
// every time, so nothing org-specific or mutable is cached here. The set of
// countries is small and fixed, so this never needs eviction.
const holidaysByCountry = new Map<string, Holidays>();

const holidaysForCountry = (country: string): Holidays => {
	const cached = holidaysByCountry.get(country);
	if (cached) return cached;
	const created = new Holidays(country, { types: HOLIDAY_TYPES });
	holidaysByCountry.set(country, created);
	return created;
};

// The country list is static reference data — the same few hundred rows for the
// life of the process — and building it means constructing a throwaway
// `Holidays` just to read its table.
let cachedCountries: { code: string; name: string }[] | null = null;

export type PublicHoliday = { date: string; name: string };
export type HolidayWithStatus = PublicHoliday & { disabled: boolean };

// (country, year) -> the year's holidays.
//
// `new Holidays(country)` parses a rule set and `getHolidays(year)` evaluates
// it, which was fine when this ran once per report and is not fine now that
// `recomputeDayFill` consults the calendar on every entry write. The answer
// depends on nothing but the country and the year, so it is cached across
// requests.
//
// The cache holds at most `HOLIDAY_YEAR_CACHE_LIMIT` entries and drops the
// least recently used one past that. The year comes from the caller — the
// Settings → Holidays server function takes any integer — so "countries x
// years actually asked for" was a set a script could grow until the process
// ran out of memory. The limit sits far above what the orgs on one instance ask
// for (a few countries, a few years each), so a real calendar is not evicted by
// ordinary use; a sweep of years only costs the next reader one re-evaluation.
//
// Deliberately does NOT cache the org's opted-out names — those are a database
// row an admin can toggle, and caching them would make the toggle take a
// restart to apply.
//
// Layered on `holidaysForCountry` above rather than replacing it: that one
// avoids re-parsing a country's rule set, this one avoids re-evaluating a year
// against it. A write asks for a single day, so the second is what makes the
// per-write lookup free.
export const HOLIDAY_YEAR_CACHE_LIMIT = 1024;

const yearCache = new Map<string, PublicHoliday[]>();

const holidaysForYear = (country: string, year: number): PublicHoliday[] => {
	const key = `${country}:${String(year)}`;
	const cached = yearCache.get(key);
	if (cached) {
		// Delete first so a hit moves to the back of the eviction order.
		yearCache.delete(key);
		yearCache.set(key, cached);
		return cached;
	}
	const computed = holidaysForCountry(country)
		.getHolidays(year)
		.map((h) => ({ date: h.date.slice(0, 10), name: h.name }));
	// Map iteration is insertion order, so the first key is the least recently
	// used.
	while (yearCache.size >= HOLIDAY_YEAR_CACHE_LIMIT) {
		const oldest = yearCache.keys().next();
		if (oldest.done) break;
		yearCache.delete(oldest.value);
	}
	yearCache.set(key, computed);
	return computed;
};

/** The org's calendar inputs: which country's holidays apply, and which ones
 *  this org has opted out of.
 *
 *  Memoized on the Ctx like the timezone and the access picture, because the
 *  fill-block recompute now asks for it on every write and a report asks for it
 *  once per range. Read through `ctxDb`, so it stays on the transaction when
 *  one is open — `recomputeDayFill` runs inside `withCtxTx`, and an ambient read
 *  there deadlocks the pool (see ./db-ctx). */
const calendarInputs = (
	ctx: Ctx,
): Promise<{ country: string; disabled: Set<string> }> => {
	const memo = ctxMemo(ctx);
	memo.holidayCalendar ??= (async () => {
		const client = ctxDb(ctx);
		const [country, rows] = await Promise.all([
			orgCountry(ctx.organizationId, client),
			client
				.select({ name: disabledHoliday.name })
				.from(disabledHoliday)
				.where(eq(disabledHoliday.organizationId, ctx.organizationId)),
		]);
		return { country, disabled: new Set(rows.map((r) => r.name)) };
	})();
	// SAFETY: the line above assigned this exact promise to the memo slot, which is
	// typed loosely because the Ctx memo holds several unrelated things. This reads
	// back what it just wrote.
	return memo.holidayCalendar as Promise<{
		country: string;
		disabled: Set<string>;
	}>;
};

export const holidaysService = {
	listSupportedCountries: (): { code: string; name: string }[] => {
		if (cachedCountries) return [...cachedCountries];
		// Force English names — getCountries() defaults to each country's own
		// language (e.g. "Hrvatska"), which isn't findable in an English UI.
		const countries = new Holidays().getCountries("en");
		cachedCountries = Object.entries(countries)
			.map(([code, name]) => ({ code, name }))
			.sort((a, b) => a.name.localeCompare(b.name));
		// A copy, so the contract is unchanged from when this built a fresh array
		// every call and a caller sorting or splicing the result harmed nobody.
		return [...cachedCountries];
	},

	// Enabled (non-disabled) holidays for the year.
	listForYear: async (ctx: Ctx, year: number): Promise<PublicHoliday[]> => {
		const { country, disabled } = await calendarInputs(ctx);
		return holidaysForYear(country, year).filter((h) => !disabled.has(h.name));
	},

	// Every holiday for the year with its disabled status, for the settings UI.
	listForYearWithStatus: async (
		ctx: Ctx,
		year: number,
	): Promise<HolidayWithStatus[]> => {
		const { country, disabled } = await calendarInputs(ctx);
		return holidaysForYear(country, year).map((h) => ({
			...h,
			disabled: disabled.has(h.name),
		}));
	},

	// Toggle a holiday on/off for the org. Row present = disabled.
	setHolidayDisabled: async (
		ctx: Ctx,
		input: { name: string; disabled: boolean },
	): Promise<void> => {
		const client = ctxDb(ctx);
		if (input.disabled) {
			await client
				.insert(disabledHoliday)
				.values({ organizationId: ctx.organizationId, name: input.name })
				.onConflictDoNothing();
		} else {
			await client
				.delete(disabledHoliday)
				.where(
					and(
						eq(disabledHoliday.organizationId, ctx.organizationId),
						eq(disabledHoliday.name, input.name),
					),
				);
		}
		// The Ctx memo would otherwise answer this same request from the picture
		// as it was before the toggle.
		ctxMemo(ctx).holidayCalendar = undefined;
	},

	// Handles ranges spanning a year boundary (e.g. a week straddling Dec/Jan).
	// Excludes holidays the org has disabled, so weekend/holiday shading and the
	// day's working-hours target both treat a disabled holiday as an ordinary
	// working day.
	//
	// The returned Map satisfies `HolidayLookup` (lib/working-day), which is what
	// `targetSecondsFor` takes — no conversion at the call sites.
	holidaySetForRange: async (
		ctx: Ctx,
		from: string,
		to: string,
	): Promise<Map<string, string>> => {
		const { country, disabled } = await calendarInputs(ctx);
		const fromYear = Number(from.slice(0, 4));
		const toYear = Number(to.slice(0, 4));

		const byDate = new Map<string, string>();
		for (let year = fromYear; year <= toYear; year++) {
			for (const h of holidaysForYear(country, year)) {
				if (disabled.has(h.name)) continue;
				if (h.date >= from && h.date <= to) byDate.set(h.date, h.name);
			}
		}
		return byDate;
	},
};
