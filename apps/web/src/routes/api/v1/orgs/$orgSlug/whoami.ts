import { type ApiWhoami, toApiCapabilities } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/whoami` — the person inside one organization.
 *
 * Composed the way the assistant's `whoami` tool composes it, plus the three
 * things the CLI needs that a model does not: the organization's slug and name
 * for the header line, and `today` in the org's timezone. The CLI resolves
 * `yesterday` and `friday` against that date rather than the laptop's clock,
 * because a timesheet day is the organization's day.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/whoami")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiWhoami> => {
					const {
						ctxAccess,
						ctxTimezone,
						ctxWeekStartsOn,
						membersService,
						orgContextService,
						projectsService,
						workingHoursService,
					} = await import("@farmer/core/services");
					const { dayKeyInTz } = await import("@farmer/core/lib/time");

					const [
						access,
						people,
						workingHours,
						timezone,
						weekStartsOn,
						org,
						projects,
					] = await Promise.all([
						ctxAccess(ctx),
						membersService.list(ctx),
						workingHoursService.list(ctx),
						ctxTimezone(ctx),
						ctxWeekStartsOn(ctx),
						orgContextService.organizationOf(ctx),
						projectsService.listMine(ctx),
					]);
					const me = people.find((person) => person.userId === ctx.userId);

					return {
						userId: ctx.userId,
						name: me?.name ?? null,
						email: me?.email ?? null,
						organization: org,
						orgRole: me?.orgRole ?? null,
						isAdmin: access.isAdmin,
						capabilities: toApiCapabilities(access),
						timezone,
						today: dayKeyInTz(new Date(), timezone),
						weekStartsOn,
						// Enabled days only, as the tool answers. A day with no times is
						// not a schedule the CLI can print, so it is left out rather than
						// sent as nulls a binary does not expect.
						workingDays: workingHours.flatMap((day) =>
							day.enabled && day.startTime && day.endTime
								? [
										{
											dayOfWeek: day.dayOfWeek,
											startTime: day.startTime,
											endTime: day.endTime,
										},
									]
								: [],
						),
						// Held-as rather than the assignment row, the same role
						// `projects` answers: a Team Lead on a project holds it as a PM.
						projects: projects.map((project) => ({
							id: project.id,
							name: project.name,
							role: project.myRole,
						})),
					};
				},
			}),
		},
	},
});
