import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { member } from "../db/schema/auth";
import { project, projectMember, timeEntry } from "../db/schema/domain";
import { timeOffRequest } from "../db/schema/schedule";
import { orgTimezone } from "../lib/org-time";
import { dayBoundsInTz, datesBetween, weekdayInTz } from "../lib/time";
import type { UtilizationRangeInput } from "../schema/reports";
import { holidaysService } from "./holidays.service";
import type { Ctx } from "./types";
import { dayDurationSeconds, workingHoursService } from "./working-hours.service";

export type MemberUtilization = {
	userId: string;
	name: string;
	expectedSeconds: number;
	loggedSeconds: number;
	utilizationPct: number | null;
};

export type ProjectBudgetAndMargin = {
	projectId: string;
	name: string;
	currency: string;
	budgetSeconds: number | null;
	budgetAmount: number | null;
	actualSeconds: number;
	billableSeconds: number;
	revenue: number;
	cost: number;
	margin: number;
	marginPct: number | null;
	budgetSecondsPct: number | null;
	budgetAmountPct: number | null;
};

export const reportsService = {
	utilization: async (
		ctx: Ctx,
		range: UtilizationRangeInput,
	): Promise<MemberUtilization[]> => {
		const tz = await orgTimezone(ctx.organizationId);

		const members = await db.query.member.findMany({
			where: eq(member.organizationId, ctx.organizationId),
			with: { user: true },
		});
		const userIds = members.map((m) => m.userId);
		if (userIds.length === 0) return [];

		const [holidaySet, workingHoursByUser, approvedTimeOff, loggedRows] =
			await Promise.all([
				holidaysService.holidaySetForRange(ctx, range.from, range.to),
				workingHoursService.listForOrg(ctx, userIds),
				db.query.timeOffRequest.findMany({
					where: and(
						eq(timeOffRequest.organizationId, ctx.organizationId),
						eq(timeOffRequest.status, "approved"),
						lte(timeOffRequest.startDate, range.to),
						gte(timeOffRequest.endDate, range.from),
					),
				}),
				db
					.select({
						userId: timeEntry.userId,
						total: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
					})
					.from(timeEntry)
					.where(
						and(
							eq(timeEntry.organizationId, ctx.organizationId),
							gte(timeEntry.startedAt, dayBoundsInTz(range.from, tz).start),
							lt(timeEntry.startedAt, dayBoundsInTz(range.to, tz).end),
							eq(timeEntry.fillsDay, false),
						),
					)
					.groupBy(timeEntry.userId),
			]);

		const loggedByUser = new Map(loggedRows.map((r) => [r.userId, Number(r.total)]));
		const dates = datesBetween(range.from, range.to);
		const timeOffByUser = new Map<string, typeof approvedTimeOff>();
		for (const request of approvedTimeOff) {
			const list = timeOffByUser.get(request.userId) ?? [];
			list.push(request);
			timeOffByUser.set(request.userId, list);
		}

		return members
			.map((m) => {
				const days = workingHoursByUser.get(m.userId) ?? [];
				const timeOff = timeOffByUser.get(m.userId) ?? [];
				const expectedSeconds = dates.reduce((sum, date) => {
					if (holidaySet.has(date)) return sum;
					if (timeOff.some((r) => date >= r.startDate && date <= r.endDate)) {
						return sum;
					}
					const day = days[weekdayInTz(date, tz)];
					return sum + (day ? dayDurationSeconds(day) : 0);
				}, 0);
				const loggedSeconds = loggedByUser.get(m.userId) ?? 0;

				return {
					userId: m.userId,
					name: m.user.name,
					expectedSeconds,
					loggedSeconds,
					utilizationPct:
						expectedSeconds > 0
							? Math.round((loggedSeconds / expectedSeconds) * 100)
							: null,
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name));
	},

	// All-time (not period-bound) per active project — budgets are running
	// caps against total project life, not a single reporting window.
	budgetsAndMargin: async (ctx: Ctx): Promise<ProjectBudgetAndMargin[]> => {
		const rows = await db
			.select({
				projectId: project.id,
				name: project.name,
				currency: project.currency,
				budgetSeconds: project.budgetSeconds,
				budgetAmount: project.budgetAmount,
				actualSeconds: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
				billableSeconds: sql<string>`coalesce(sum(case when ${timeEntry.billable} then ${timeEntry.durationSeconds} else 0 end), 0)`,
				// Cost rate has no project-level default (unlike billableRate) — a
				// member without a projectMember.costRate override contributes 0
				// cost, so margin reads as "at least this much" until rates are set.
				revenue: sql<string>`coalesce(sum(case when ${timeEntry.billable} then ${timeEntry.durationSeconds} * coalesce(${projectMember.billableRate}, ${project.billableRate}, 0) / 3600.0 else 0 end), 0)`,
				cost: sql<string>`coalesce(sum(${timeEntry.durationSeconds} * coalesce(${projectMember.costRate}, 0) / 3600.0), 0)`,
			})
			.from(project)
			.leftJoin(timeEntry, eq(timeEntry.projectId, project.id))
			.leftJoin(
				projectMember,
				and(
					eq(projectMember.projectId, project.id),
					eq(projectMember.userId, timeEntry.userId),
				),
			)
			.where(
				and(
					eq(project.organizationId, ctx.organizationId),
					eq(project.status, "active"),
				),
			)
			.groupBy(project.id);

		return rows
			.map((r) => {
				const actualSeconds = Number(r.actualSeconds);
				const billableSeconds = Number(r.billableSeconds);
				const revenue = Number(r.revenue);
				const cost = Number(r.cost);
				const margin = revenue - cost;
				const budgetAmount = r.budgetAmount ? Number(r.budgetAmount) : null;

				return {
					projectId: r.projectId,
					name: r.name,
					currency: r.currency,
					budgetSeconds: r.budgetSeconds,
					budgetAmount,
					actualSeconds,
					billableSeconds,
					revenue,
					cost,
					margin,
					marginPct: revenue > 0 ? Math.round((margin / revenue) * 100) : null,
					budgetSecondsPct: r.budgetSeconds
						? Math.round((actualSeconds / r.budgetSeconds) * 100)
						: null,
					budgetAmountPct: budgetAmount
						? Math.round((revenue / budgetAmount) * 100)
						: null,
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name));
	},
};
