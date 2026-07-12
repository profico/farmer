import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { memberSchedule, memberWorkingHoursDay } from "../db/schema/schedule";
import { parseDuration } from "../lib/time";
import type {
	SetWeeklyTargetInput,
	UpsertWorkingHoursDayInput,
} from "../schema/working-hours";
import type { Ctx } from "./types";

const DEFAULT_WEEKLY_TARGET_SECONDS = 144000; // 40h

export type WorkingHoursDay = {
	dayOfWeek: number;
	enabled: boolean;
	startTime: string | null;
	endTime: string | null;
};

// A day without a stored row gets a synthesized Mon-Fri 9-5 default rather
// than requiring a backfill.
const defaultDayRow = (dayOfWeek: number): WorkingHoursDay => {
	const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
	return {
		dayOfWeek,
		enabled: isWeekday,
		startTime: isWeekday ? "09:00" : null,
		endTime: isWeekday ? "17:00" : null,
	};
};

const timeToMinutes = (time: string): number => {
	const [hours, minutes] = time.split(":").map(Number);
	return (hours ?? 0) * 60 + (minutes ?? 0);
};

// Expected working seconds for a day row — 0 if disabled or times are unset.
export const dayDurationSeconds = (day: WorkingHoursDay): number => {
	if (!day.enabled || !day.startTime || !day.endTime) return 0;
	return Math.max(
		0,
		(timeToMinutes(day.endTime) - timeToMinutes(day.startTime)) * 60,
	);
};

export const workingHoursService = {
	// Always returns all 7 days (0=Sun..6=Sat) for the requesting user.
	list: async (ctx: Ctx): Promise<WorkingHoursDay[]> => {
		const rows = await db.query.memberWorkingHoursDay.findMany({
			where: and(
				eq(memberWorkingHoursDay.organizationId, ctx.organizationId),
				eq(memberWorkingHoursDay.userId, ctx.userId),
			),
		});
		const byDay = new Map(rows.map((r) => [r.dayOfWeek, r]));

		return Array.from({ length: 7 }, (_, dayOfWeek) => {
			const existing = byDay.get(dayOfWeek);
			return existing
				? {
						dayOfWeek: existing.dayOfWeek,
						enabled: existing.enabled,
						startTime: existing.startTime,
						endTime: existing.endTime,
					}
				: defaultDayRow(dayOfWeek);
		});
	},

	// Org-wide: every member's full 7-day schedule (defaults synthesized the
	// same way as `list`), keyed by userId — used by the utilization report.
	listForOrg: async (
		ctx: Ctx,
		userIds: string[],
	): Promise<Map<string, WorkingHoursDay[]>> => {
		const rows = await db.query.memberWorkingHoursDay.findMany({
			where: eq(memberWorkingHoursDay.organizationId, ctx.organizationId),
		});
		const byUser = new Map<string, Map<number, WorkingHoursDay>>();
		for (const r of rows) {
			if (!byUser.has(r.userId)) byUser.set(r.userId, new Map());
			byUser.get(r.userId)?.set(r.dayOfWeek, r);
		}

		const result = new Map<string, WorkingHoursDay[]>();
		for (const userId of userIds) {
			const byDay = byUser.get(userId);
			result.set(
				userId,
				Array.from(
					{ length: 7 },
					(_, dayOfWeek) => byDay?.get(dayOfWeek) ?? defaultDayRow(dayOfWeek),
				),
			);
		}
		return result;
	},

	upsertDay: async (ctx: Ctx, input: UpsertWorkingHoursDayInput) => {
		const [row] = await db
			.insert(memberWorkingHoursDay)
			.values({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				dayOfWeek: input.dayOfWeek,
				enabled: input.enabled,
				startTime: input.startTime ?? null,
				endTime: input.endTime ?? null,
			})
			.onConflictDoUpdate({
				target: [
					memberWorkingHoursDay.organizationId,
					memberWorkingHoursDay.userId,
					memberWorkingHoursDay.dayOfWeek,
				],
				set: {
					enabled: input.enabled,
					startTime: input.startTime ?? null,
					endTime: input.endTime ?? null,
					updatedAt: new Date(),
				},
			})
			.returning();
		if (!row) throw new Error("Failed to save working hours");
		return row;
	},

	getWeeklyTarget: async (ctx: Ctx): Promise<number> => {
		const row = await db.query.memberSchedule.findFirst({
			where: and(
				eq(memberSchedule.organizationId, ctx.organizationId),
				eq(memberSchedule.userId, ctx.userId),
			),
		});
		return row?.weeklyTargetSeconds ?? DEFAULT_WEEKLY_TARGET_SECONDS;
	},

	setWeeklyTarget: async (ctx: Ctx, input: SetWeeklyTargetInput) => {
		const weeklyTargetSeconds = parseDuration(input.weeklyTarget);
		if (weeklyTargetSeconds === null) {
			throw new Error("Could not understand that duration");
		}
		if (weeklyTargetSeconds <= 0) {
			throw new Error("Weekly target must be greater than zero");
		}

		const [row] = await db
			.insert(memberSchedule)
			.values({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				weeklyTargetSeconds,
			})
			.onConflictDoUpdate({
				target: [memberSchedule.organizationId, memberSchedule.userId],
				set: { weeklyTargetSeconds, updatedAt: new Date() },
			})
			.returning();
		if (!row) throw new Error("Failed to save weekly target");
		return row;
	},
};
