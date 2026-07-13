import { and, count, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { projectMember } from "../db/schema/domain";
import { timeOffRequest } from "../db/schema/schedule";
import { orgTimezone } from "../lib/org-time";
import {
	countWorkingDays,
	dayKeyInTz,
	formatDayKeyRange,
} from "../lib/time";
import type {
	CreateTimeOffRequestInput,
	DecideTimeOffRequestInput,
} from "../schema/time-off";
import { googleCalendarService } from "./google-calendar.service";
import { holidaysService } from "./holidays.service";
import { integrationSettingsService } from "./integration-settings.service";
import { notificationsService } from "./notifications.service";
import { timeOffPolicyService } from "./time-off-policy.service";
import type { Ctx } from "./types";
import { workingHoursService } from "./working-hours.service";

export type TimeOffBalance = {
	year: number;
	allowanceDays: number;
	carryoverDays: number;
	carryoverExpiry: string; // yyyy-MM-dd
	usedDays: number;
	pendingDays: number;
	remainingDays: number;
};

// The set of enabled weekday indices (0=Sun..6=Sat) for a member.
const enabledWeekdaysFor = async (ctx: Ctx): Promise<Set<number>> => {
	const days = await workingHoursService.list(ctx);
	return new Set(days.filter((d) => d.enabled).map((d) => d.dayOfWeek));
};

// Working days of vacation a member used in a given calendar year, clipped to
// that year, honoring their enabled weekdays and the org's enabled holidays.
const usedVacationDaysForYear = async (
	ctx: Ctx,
	userId: string,
	year: number,
	status: "approved" | "pending",
	enabledWeekdays: Set<number>,
): Promise<number> => {
	const yearStart = `${year}-01-01`;
	const yearEnd = `${year}-12-31`;
	const requests = await db.query.timeOffRequest.findMany({
		where: and(
			eq(timeOffRequest.organizationId, ctx.organizationId),
			eq(timeOffRequest.userId, userId),
			eq(timeOffRequest.type, "vacation"),
			eq(timeOffRequest.status, status),
			lte(timeOffRequest.startDate, yearEnd),
			gte(timeOffRequest.endDate, yearStart),
		),
	});
	let total = 0;
	for (const r of requests) {
		const from = r.startDate < yearStart ? yearStart : r.startDate;
		const to = r.endDate > yearEnd ? yearEnd : r.endDate;
		const holidays = await holidaysService.holidaySetForRange(ctx, from, to);
		total += countWorkingDays(
			from,
			to,
			enabledWeekdays,
			new Set(holidays.keys()),
		);
	}
	return total;
};

// Pure carryover-first remaining-days arithmetic, split out so it can be unit
// tested without a database. Carried days are consumed before the base
// allowance; if the carryover has expired, whatever carryover wasn't already
// consumed is forfeited (but consumed carryover still doesn't eat the base).
export const computeVacationRemaining = (args: {
	allowanceDays: number;
	carryoverDays: number;
	consumed: number; // used + pending
	expired: boolean;
}): { carryoverConsumed: number; baseConsumed: number; remainingDays: number } => {
	const carryoverConsumed = Math.min(args.consumed, args.carryoverDays);
	const baseConsumed = args.consumed - carryoverConsumed;
	const remainingDays = args.expired
		? args.allowanceDays - baseConsumed
		: args.allowanceDays -
			baseConsumed +
			(args.carryoverDays - carryoverConsumed);
	return { carryoverConsumed, baseConsumed, remainingDays };
};

// Whether the member has any non-denied vacation request overlapping a year —
// used to decide if carryover from that year is real (vs. a phantom full
// allowance for a member the system never tracked that year).
const hadTimeOffInYear = async (
	ctx: Ctx,
	userId: string,
	year: number,
): Promise<boolean> => {
	const [row] = await db
		.select({ id: timeOffRequest.id })
		.from(timeOffRequest)
		.where(
			and(
				eq(timeOffRequest.organizationId, ctx.organizationId),
				eq(timeOffRequest.userId, userId),
				eq(timeOffRequest.type, "vacation"),
				lte(timeOffRequest.startDate, `${year}-12-31`),
				gte(timeOffRequest.endDate, `${year}-01-01`),
			),
		)
		.limit(1);
	return Boolean(row);
};

export type EligibleReviewer = { userId: string; name: string; email: string };

const orgAdminUserIds = async (ctx: Ctx): Promise<Set<string>> => {
	const rows = await db
		.select({ userId: member.userId, role: member.role })
		.from(member)
		.where(eq(member.organizationId, ctx.organizationId));
	return new Set(
		rows.filter((r) => r.role === "owner" || r.role === "admin").map((r) => r.userId),
	);
};

const isOrgAdmin = async (ctx: Ctx, userId: string): Promise<boolean> =>
	(await orgAdminUserIds(ctx)).has(userId);

// Project ids the given user is a member of.
const projectIdsForUser = async (
	ctx: Ctx,
	userId: string,
): Promise<string[]> => {
	const rows = await db
		.select({ projectId: projectMember.projectId })
		.from(projectMember)
		.where(
			and(
				eq(projectMember.organizationId, ctx.organizationId),
				eq(projectMember.userId, userId),
			),
		);
	return rows.map((r) => r.projectId);
};

export const timeOffService = {
	listMine: (ctx: Ctx) => {
		return db.query.timeOffRequest.findMany({
			where: and(
				eq(timeOffRequest.organizationId, ctx.organizationId),
				eq(timeOffRequest.userId, ctx.userId),
			),
			orderBy: desc(timeOffRequest.createdAt),
		});
	},

	// Authoritative vacation balance for a member+year, computed on the fly (no
	// denormalization). Carryover from the prior year is consumed first, so only
	// unused carryover is forfeited at its expiry date.
	getBalance: async (
		ctx: Ctx,
		opts: { userId?: string; year: number },
	): Promise<TimeOffBalance> => {
		const userId = opts.userId ?? ctx.userId;
		const { year } = opts;
		const targetCtx: Ctx = { organizationId: ctx.organizationId, userId };

		const [policy, allowanceDays, enabledWeekdays, tz] = await Promise.all([
			timeOffPolicyService.getPolicy(ctx),
			timeOffPolicyService.getMemberAllowanceDays(ctx, userId),
			enabledWeekdaysFor(targetCtx),
			orgTimezone(ctx.organizationId),
		]);

		const [used, pending, prevApproved, prevYearHadRecords] = await Promise.all([
			usedVacationDaysForYear(ctx, userId, year, "approved", enabledWeekdays),
			usedVacationDaysForYear(ctx, userId, year, "pending", enabledWeekdays),
			usedVacationDaysForYear(
				ctx,
				userId,
				year - 1,
				"approved",
				enabledWeekdays,
			),
			hadTimeOffInYear(ctx, userId, year - 1),
		]);

		// Carryover = the prior year's unused allowance. No allowance history is
		// kept, so the current effective allowance stands in for last year's. But
		// only grant carryover when the member actually has prior-year records —
		// otherwise a brand-new member would appear to carry a full unused
		// allowance from a year the system never tracked.
		const prevYearUnused = Math.max(0, allowanceDays - prevApproved);
		const carryoverDays =
			policy.carryoverEnabled && prevYearHadRecords
				? policy.carryoverMaxDays === null
					? prevYearUnused
					: Math.min(prevYearUnused, policy.carryoverMaxDays)
				: 0;

		const consumed = used + pending; // pending reserves balance
		const carryoverExpiry = `${year}-${String(policy.carryoverExpiryMonth).padStart(2, "0")}-${String(policy.carryoverExpiryDay).padStart(2, "0")}`;
		const expired = dayKeyInTz(new Date(), tz) > carryoverExpiry;

		const { remainingDays } = computeVacationRemaining({
			allowanceDays,
			carryoverDays,
			consumed,
			expired,
		});

		return {
			year,
			allowanceDays,
			carryoverDays,
			carryoverExpiry,
			usedDays: used,
			pendingDays: pending,
			remainingDays,
		};
	},

	// Users who may review a requester's time off: approvers on any project the
	// requester belongs to, plus owners/admins. The requester is excluded — you
	// can't review your own request.
	listEligibleReviewers: async (
		ctx: Ctx,
		opts?: { requesterUserId?: string },
	): Promise<EligibleReviewer[]> => {
		const requesterUserId = opts?.requesterUserId ?? ctx.userId;
		const requesterProjects = await projectIdsForUser(ctx, requesterUserId);

		const [approverRows, adminIds] = await Promise.all([
			requesterProjects.length
				? db
						.selectDistinct({
							userId: projectMember.userId,
							name: user.name,
							email: user.email,
						})
						.from(projectMember)
						.innerJoin(user, eq(projectMember.userId, user.id))
						.where(
							and(
								eq(projectMember.organizationId, ctx.organizationId),
								eq(projectMember.isVacationApprover, true),
								inArray(projectMember.projectId, requesterProjects),
							),
						)
				: Promise.resolve([] as EligibleReviewer[]),
			orgAdminUserIds(ctx),
		]);

		// Fetch admin user details.
		const adminRows = adminIds.size
			? await db
					.select({
						userId: member.userId,
						name: user.name,
						email: user.email,
					})
					.from(member)
					.innerJoin(user, eq(member.userId, user.id))
					.where(
						and(
							eq(member.organizationId, ctx.organizationId),
							inArray(member.userId, [...adminIds]),
						),
					)
			: [];

		const byId = new Map<string, EligibleReviewer>();
		for (const r of [...approverRows, ...adminRows]) {
			if (r.userId === requesterUserId) continue;
			byId.set(r.userId, r);
		}
		return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
	},

	// Whether the current user may approve/deny a specific request.
	canDecide: async (
		ctx: Ctx,
		request: { userId: string },
	): Promise<boolean> => {
		if (await isOrgAdmin(ctx, ctx.userId)) return true;
		// An approver can't decide their own request.
		if (request.userId === ctx.userId) return false;
		const requesterProjects = await projectIdsForUser(ctx, request.userId);
		if (requesterProjects.length === 0) return false;
		const [row] = await db
			.select({ id: projectMember.id })
			.from(projectMember)
			.where(
				and(
					eq(projectMember.organizationId, ctx.organizationId),
					eq(projectMember.userId, ctx.userId),
					eq(projectMember.isVacationApprover, true),
					inArray(projectMember.projectId, requesterProjects),
				),
			)
			.limit(1);
		return Boolean(row);
	},

	// Whether the current user can act on any time-off requests (gates the
	// approvals surface): owner/admin, or an approver on any project.
	isApprover: async (ctx: Ctx): Promise<boolean> => {
		if (await isOrgAdmin(ctx, ctx.userId)) return true;
		const [row] = await db
			.select({ id: projectMember.id })
			.from(projectMember)
			.where(
				and(
					eq(projectMember.organizationId, ctx.organizationId),
					eq(projectMember.userId, ctx.userId),
					eq(projectMember.isVacationApprover, true),
				),
			)
			.limit(1);
		return Boolean(row);
	},

	create: async (ctx: Ctx, input: CreateTimeOffRequestInput) => {
		// If a reviewer was chosen, it must be an eligible one.
		if (input.reviewerUserId) {
			const eligible = await timeOffService.listEligibleReviewers(ctx);
			if (!eligible.some((r) => r.userId === input.reviewerUserId)) {
				throw new Error("Chosen reviewer can't review your time off");
			}
		}

		// Reject overlap with the member's own existing pending/approved requests,
		// regardless of type.
		const overlaps = await db.query.timeOffRequest.findMany({
			where: and(
				eq(timeOffRequest.organizationId, ctx.organizationId),
				eq(timeOffRequest.userId, ctx.userId),
				lte(timeOffRequest.startDate, input.endDate),
				gte(timeOffRequest.endDate, input.startDate),
			),
		});
		if (overlaps.some((r) => r.status !== "denied")) {
			throw new Error(
				"This range overlaps an existing time off request of yours",
			);
		}

		// Vacation is the only type that draws down the allowance.
		if (input.type === "vacation") {
			const year = Number(input.startDate.slice(0, 4));
			const [balance, enabledWeekdays, holidays] = await Promise.all([
				timeOffService.getBalance(ctx, { year }),
				enabledWeekdaysFor(ctx),
				holidaysService.holidaySetForRange(
					ctx,
					input.startDate,
					input.endDate,
				),
			]);
			const requestedDays = countWorkingDays(
				input.startDate,
				input.endDate,
				enabledWeekdays,
				new Set(holidays.keys()),
			);
			if (requestedDays > balance.remainingDays) {
				throw new Error(
					`This request is ${requestedDays} working day(s) but only ${balance.remainingDays} remain in your balance`,
				);
			}
		}

		const [created] = await db
			.insert(timeOffRequest)
			.values({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				startDate: input.startDate,
				endDate: input.endDate,
				type: input.type,
				label: input.label,
				reviewerUserId: input.reviewerUserId ?? null,
				status: "pending",
			})
			.returning();
		if (!created) throw new Error("Failed to create time off request");
		return created;
	},

	// Only a still-pending request can be cancelled — a decided one shouldn't
	// silently disappear.
	cancel: async (ctx: Ctx, requestId: string) => {
		const existing = await db.query.timeOffRequest.findFirst({
			where: and(
				eq(timeOffRequest.id, requestId),
				eq(timeOffRequest.organizationId, ctx.organizationId),
				eq(timeOffRequest.userId, ctx.userId),
			),
		});
		if (!existing) throw new Error("Time off request not found");
		if (existing.status !== "pending") {
			throw new Error("Only pending requests can be cancelled");
		}

		await db.delete(timeOffRequest).where(eq(timeOffRequest.id, requestId));
	},

	// The requests the caller may review, optionally filtered by status, joined
	// with the requester's basic info. Owners/admins see the whole org; a
	// project approver sees only requests from members of a project they approve.
	listAllForOrg: async (
		ctx: Ctx,
		filter?: { status?: "pending" | "approved" | "denied" },
	) => {
		const statusFilter = filter?.status
			? eq(timeOffRequest.status, filter.status)
			: undefined;

		if (!(await isOrgAdmin(ctx, ctx.userId))) {
			// Approver scope: requesters who are members of a project this user
			// approves. Excludes the approver's own requests (can't self-review).
			const approverProjects = await db
				.select({ projectId: projectMember.projectId })
				.from(projectMember)
				.where(
					and(
						eq(projectMember.organizationId, ctx.organizationId),
						eq(projectMember.userId, ctx.userId),
						eq(projectMember.isVacationApprover, true),
					),
				);
			const projectIds = approverProjects.map((p) => p.projectId);
			if (projectIds.length === 0) return [];
			const requesterRows = await db
				.selectDistinct({ userId: projectMember.userId })
				.from(projectMember)
				.where(
					and(
						eq(projectMember.organizationId, ctx.organizationId),
						inArray(projectMember.projectId, projectIds),
					),
				);
			const requesterIds = requesterRows
				.map((r) => r.userId)
				.filter((id) => id !== ctx.userId);
			if (requesterIds.length === 0) return [];
			return db.query.timeOffRequest.findMany({
				where: and(
					eq(timeOffRequest.organizationId, ctx.organizationId),
					inArray(timeOffRequest.userId, requesterIds),
					statusFilter,
				),
				with: { user: true, reviewer: true },
				orderBy: desc(timeOffRequest.createdAt),
			});
		}

		return db.query.timeOffRequest.findMany({
			where: and(
				eq(timeOffRequest.organizationId, ctx.organizationId),
				statusFilter,
			),
			with: { user: true, reviewer: true },
			orderBy: desc(timeOffRequest.createdAt),
		});
	},

	// Pending requests the caller may act on (drives the badge). Owners/admins
	// get the org-wide count; approvers get their scoped count.
	countPending: async (ctx: Ctx): Promise<number> => {
		if (!(await isOrgAdmin(ctx, ctx.userId))) {
			const scoped = await timeOffService.listAllForOrg(ctx, {
				status: "pending",
			});
			return scoped.length;
		}
		const [row] = await db
			.select({ value: count() })
			.from(timeOffRequest)
			.where(
				and(
					eq(timeOffRequest.organizationId, ctx.organizationId),
					eq(timeOffRequest.status, "pending"),
				),
			);
		return row?.value ?? 0;
	},

	// Only a still-pending request can be decided — re-deciding an
	// already-decided one is rejected rather than silently overwritten.
	decide: async (ctx: Ctx, input: DecideTimeOffRequestInput) => {
		const existing = await db.query.timeOffRequest.findFirst({
			where: and(
				eq(timeOffRequest.id, input.requestId),
				eq(timeOffRequest.organizationId, ctx.organizationId),
			),
		});
		if (!existing) throw new Error("Time off request not found");
		if (existing.status !== "pending") {
			throw new Error("Time off request has already been decided");
		}
		if (!(await timeOffService.canDecide(ctx, existing))) {
			throw new Error("You are not allowed to decide this request");
		}

		const [updated] = await db
			.update(timeOffRequest)
			.set({
				status: input.decision,
				decidedByUserId: ctx.userId,
				decidedAt: new Date(),
				decisionNote: input.note ?? null,
			})
			.where(eq(timeOffRequest.id, input.requestId))
			.returning();

		// On approval, mirror the time off onto the requester's Google Calendar as
		// an all-day vacation marker — gated on THEIR sync preference (not the
		// deciding admin's) and best-effort: a calendar failure must never block an
		// approval, so it's wrapped and only persists the event id on success.
		if (updated && input.decision === "approved") {
			const requesterCtx: Ctx = {
				organizationId: ctx.organizationId,
				userId: existing.userId,
			};
			try {
				const settings = await integrationSettingsService.get(requesterCtx);
				if (settings.googleSyncTimeOff) {
					const eventId = await googleCalendarService.insertTimeOffEvent(
						requesterCtx,
						{
							startDate: existing.startDate,
							endDate: existing.endDate,
							label: existing.label,
						},
					);
					if (eventId) {
						await db
							.update(timeOffRequest)
							.set({ googleCalendarEventId: eventId })
							.where(eq(timeOffRequest.id, input.requestId));
					}
				}
			} catch (error) {
				console.error("[time-off] Google Calendar write-back failed", error);
			}
		}

		// Push the decision to the requester's devices — gated on THEIR
		// preference (not the deciding admin's) and best-effort: a dead push
		// endpoint must never fail an approval. notifyUser already no-ops when
		// push is unconfigured or the user has no subscriptions.
		if (updated) {
			try {
				const settings = await notificationsService.settingsFor(
					ctx.organizationId,
					existing.userId,
				);
				if (settings.timeOffDecisions) {
					const org = await db.query.organization.findFirst({
						where: eq(organization.id, ctx.organizationId),
					});
					const decided =
						input.decision === "approved" ? "approved" : "denied";
					const range = formatDayKeyRange(
						existing.startDate,
						existing.endDate,
					);
					await notificationsService.notifyUser(existing.userId, {
						title: `Time off ${decided}`,
						body: `Your ${existing.type} request (${range}) was ${decided}.`,
						url: org ? `/${org.slug}/settings/time-off` : "/",
						tag: `time-off-${existing.id}`,
					});
				}
			} catch (error) {
				console.error("[time-off] decision notification failed", error);
			}
		}

		return updated;
	},
};
