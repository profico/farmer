import type { ApiHome } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/home` — the week chart of the home page: what the
 * caller logged on each day of this week, the public holidays, and the mark of
 * each working day.
 *
 * The marks come from `weekDayMarks`, the function the web page runs in the
 * browser, so the two cannot disagree. The figures of the week and the month
 * are on `GET …/tracking`, and the entries are on `GET …/time-entries`.
 *
 * The day totals come from `listRange` in its read-only variant. It computes
 * the fill blocks of the week in memory, as the web page sees them, and it
 * writes nothing. The mobile app calls this route on every refresh, and a
 * read-only API token can reach it.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/home")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiHome> => {
					const [
						{
							complianceService,
							ctxTimezone,
							ctxWeekStartsOn,
							holidaysService,
							timeEntriesService,
						},
						{ addDaysToKey, dayKeyInTz, startOfWeekKey },
						{ weekDayMarks },
					] = await Promise.all([
						import("@farmer/core/services"),
						import("@farmer/core/lib/time"),
						import("@farmer/core/lib/day-marks"),
					]);
					const [timezone, weekStartsOn] = await Promise.all([
						ctxTimezone(ctx),
						ctxWeekStartsOn(ctx),
					]);
					const today = dayKeyInTz(new Date(), timezone);
					const from = startOfWeekKey(today, weekStartsOn);
					const to = addDaysToKey(from, 6);
					const dates = Array.from({ length: 7 }, (_, day) =>
						addDaysToKey(from, day),
					);

					const [entries, holidays, targets] = await Promise.all([
						timeEntriesService.listRange(ctx, { from, to }, { persist: false }),
						holidaysService.holidaySetForRange(ctx, from, to),
						complianceService.myTargets(ctx),
					]);
					const secondsByDay = new Map<string, number>();
					for (const entry of entries) {
						secondsByDay.set(
							entry.date,
							(secondsByDay.get(entry.date) ?? 0) + entry.durationSeconds,
						);
					}
					const marks = weekDayMarks({
						dates,
						secondsByDay,
						holidays,
						today,
						daySeconds: targets.daySeconds,
					});

					return {
						today,
						from,
						to,
						daySeconds: targets.daySeconds,
						days: dates.map((date) => ({
							date,
							seconds: secondsByDay.get(date) ?? 0,
							holiday: holidays.get(date) ?? null,
							mark: marks.get(date) ?? null,
						})),
					};
				},
			}),
		},
	},
});
