import Holidays, { type HolidaysTypes } from "date-holidays";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { disabledHoliday } from "../db/schema/schedule";
import { orgCountry } from "../lib/org-country";
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

// Names of holidays the org has opted out of. Keyed by the date-holidays name,
// which is stable across years for a country — one row disables it every year.
const disabledNamesFor = async (ctx: Ctx): Promise<Set<string>> => {
	const rows = await db
		.select({ name: disabledHoliday.name })
		.from(disabledHoliday)
		.where(eq(disabledHoliday.organizationId, ctx.organizationId));
	return new Set(rows.map((r) => r.name));
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
		const [country, disabled] = await Promise.all([
			orgCountry(ctx.organizationId),
			disabledNamesFor(ctx),
		]);
		return holidaysForCountry(country)
			.getHolidays(year)
			.filter((h) => !disabled.has(h.name))
			.map((h) => ({ date: h.date.slice(0, 10), name: h.name }));
	},

	// Every holiday for the year with its disabled status, for the settings UI.
	listForYearWithStatus: async (
		ctx: Ctx,
		year: number,
	): Promise<HolidayWithStatus[]> => {
		const [country, disabled] = await Promise.all([
			orgCountry(ctx.organizationId),
			disabledNamesFor(ctx),
		]);
		return holidaysForCountry(country)
			.getHolidays(year)
			.map((h) => ({
				date: h.date.slice(0, 10),
				name: h.name,
				disabled: disabled.has(h.name),
			}));
	},

	// Toggle a holiday on/off for the org. Row present = disabled.
	setHolidayDisabled: async (
		ctx: Ctx,
		input: { name: string; disabled: boolean },
	): Promise<void> => {
		if (input.disabled) {
			await db
				.insert(disabledHoliday)
				.values({ organizationId: ctx.organizationId, name: input.name })
				.onConflictDoNothing();
		} else {
			await db
				.delete(disabledHoliday)
				.where(
					and(
						eq(disabledHoliday.organizationId, ctx.organizationId),
						eq(disabledHoliday.name, input.name),
					),
				);
		}
	},

	// Handles ranges spanning a year boundary (e.g. a week straddling Dec/Jan).
	// Excludes holidays the org has disabled, so weekend/holiday shading and
	// utilization both treat a disabled holiday as an ordinary working day.
	holidaySetForRange: async (
		ctx: Ctx,
		from: string,
		to: string,
	): Promise<Map<string, string>> => {
		const [country, disabled] = await Promise.all([
			orgCountry(ctx.organizationId),
			disabledNamesFor(ctx),
		]);
		const hd = holidaysForCountry(country);
		const fromYear = Number(from.slice(0, 4));
		const toYear = Number(to.slice(0, 4));

		const byDate = new Map<string, string>();
		for (let year = fromYear; year <= toYear; year++) {
			for (const h of hd.getHolidays(year)) {
				if (disabled.has(h.name)) continue;
				const date = h.date.slice(0, 10);
				if (date >= from && date <= to) byDate.set(date, h.name);
			}
		}
		return byDate;
	},
};
