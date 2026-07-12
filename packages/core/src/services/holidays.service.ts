import Holidays, { type HolidaysTypes } from "date-holidays";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { disabledHoliday } from "../db/schema/schedule";
import { orgCountry } from "../lib/org-country";
import type { Ctx } from "./types";

// Only "days off" types — excludes 'observance'/'optional'/'school' which
// aren't actual non-working days.
const HOLIDAY_TYPES: HolidaysTypes.HolidayType[] = ["public", "bank"];

const holidaysForCountry = (country: string) =>
	new Holidays(country, { types: HOLIDAY_TYPES });

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
		// Force English names — getCountries() defaults to each country's own
		// language (e.g. "Hrvatska"), which isn't findable in an English UI.
		const countries = new Holidays().getCountries("en");
		return Object.entries(countries)
			.map(([code, name]) => ({ code, name }))
			.sort((a, b) => a.name.localeCompare(b.name));
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
