import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { member, user } from "../db/schema/auth";
import { monthlyClose, monthlyCloseRow } from "../db/schema/close";
import { project } from "../db/schema/domain";
import {
	notOnInvoiceEntry,
	notOnInvoiceStatusOption,
} from "../db/schema/settings";
import type {
	CreateStatusOptionInput,
	NotOnInvoiceReportInput,
	SetNotOnInvoiceStatusInput,
	UpdateStatusOptionInput,
} from "../schema/not-on-invoice";
import { requireAdmin } from "./context";
import { membersService } from "./members.service";
import type { Ctx } from "./types";

// The fixed status set (PRD 6.7). Deliberately a managed list rather than free
// text: it makes the report a trend instrument over time (bench hours per month,
// time-to-billable per person) instead of a one-off email.
export const DEFAULT_STATUS_OPTIONS = [
	"Bench",
	"Internal work",
	"Onboarding",
	"Leave",
	"Ramping onto project",
] as const;

export const notOnInvoiceService = {
	/** Seeded lazily on first read so a new org gets the defaults without a
	 *  migration, and an org that has edited the list is never overwritten. */
	listStatusOptions: async (ctx: Ctx) => {
		const existing = await db.query.notOnInvoiceStatusOption.findMany({
			where: and(
				eq(notOnInvoiceStatusOption.organizationId, ctx.organizationId),
				isNull(notOnInvoiceStatusOption.archivedAt),
			),
			orderBy: [
				asc(notOnInvoiceStatusOption.sortOrder),
				asc(notOnInvoiceStatusOption.label),
			],
		});
		if (existing.length > 0) return existing;

		const anyEver = await db.query.notOnInvoiceStatusOption.findFirst({
			where: eq(notOnInvoiceStatusOption.organizationId, ctx.organizationId),
			columns: { id: true },
		});
		// The org archived every option on purpose — respect that.
		if (anyEver) return [];

		await db
			.insert(notOnInvoiceStatusOption)
			.values(
				DEFAULT_STATUS_OPTIONS.map((label, index) => ({
					organizationId: ctx.organizationId,
					label,
					sortOrder: index,
				})),
			)
			.onConflictDoNothing();

		return db.query.notOnInvoiceStatusOption.findMany({
			where: and(
				eq(notOnInvoiceStatusOption.organizationId, ctx.organizationId),
				isNull(notOnInvoiceStatusOption.archivedAt),
			),
			orderBy: asc(notOnInvoiceStatusOption.sortOrder),
		});
	},

	createStatusOption: async (ctx: Ctx, input: CreateStatusOptionInput) => {
		await requireAdmin(ctx);
		const [created] = await db
			.insert(notOnInvoiceStatusOption)
			.values({
				organizationId: ctx.organizationId,
				label: input.label,
				sortOrder: input.sortOrder ?? 100,
			})
			.returning();
		return created;
	},

	updateStatusOption: async (ctx: Ctx, input: UpdateStatusOptionInput) => {
		await requireAdmin(ctx);
		const [updated] = await db
			.update(notOnInvoiceStatusOption)
			.set({
				...(input.label !== undefined ? { label: input.label } : {}),
				...(input.sortOrder !== undefined
					? { sortOrder: input.sortOrder }
					: {}),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(notOnInvoiceStatusOption.id, input.statusOptionId),
					eq(notOnInvoiceStatusOption.organizationId, ctx.organizationId),
				),
			)
			.returning();
		if (!updated) throw new Error("Status not found");
		return updated;
	},

	archiveStatusOption: async (ctx: Ctx, statusOptionId: string) => {
		await requireAdmin(ctx);
		await db
			.update(notOnInvoiceStatusOption)
			.set({ archivedAt: new Date(), updatedAt: new Date() })
			.where(
				and(
					eq(notOnInvoiceStatusOption.id, statusOptionId),
					eq(notOnInvoiceStatusOption.organizationId, ctx.organizationId),
				),
			);
	},

	/**
	 * "Not on the invoice" (PRD 6.7) — the monthly note to the CEO, currently
	 * written by hand. The system drafts the list; the Admin adds the judgment.
	 *
	 * Runs per month AFTER closes are finalized: every Billable person with zero
	 * Final hours on any non-Internal project. Strictly zero — someone with 16h
	 * Final does not appear. Contractors and Overhead are excluded.
	 */
	report: async (ctx: Ctx, input: NotOnInvoiceReportInput) => {
		await requireAdmin(ctx);

		const [
			people,
			types,
			billedRows,
			annotations,
			statusOptions,
			finalizedCount,
			archived,
		] = await Promise.all([
				db
					.select({ userId: member.userId, name: user.name, email: user.email })
					.from(member)
					.innerJoin(user, eq(member.userId, user.id))
					.where(eq(member.organizationId, ctx.organizationId)),
				membersService.typesForMonth(ctx, input.year, input.month),
				// Final hours on non-Internal projects, per person.
				db
					.select({
						userId: monthlyCloseRow.userId,
						total: sql<string>`coalesce(sum(${monthlyCloseRow.finalSeconds}), 0)`,
					})
					.from(monthlyCloseRow)
					.innerJoin(monthlyClose, eq(monthlyCloseRow.closeId, monthlyClose.id))
					.innerJoin(project, eq(monthlyClose.projectId, project.id))
					.where(
						and(
							eq(monthlyClose.organizationId, ctx.organizationId),
							eq(monthlyClose.year, input.year),
							eq(monthlyClose.month, input.month),
							eq(monthlyClose.status, "finalized"),
							// Hours on Internal projects never count as invoiced anywhere.
							sql`${project.type} <> 'internal'`,
						),
					)
					.groupBy(monthlyCloseRow.userId),
				db.query.notOnInvoiceEntry.findMany({
					where: and(
						eq(notOnInvoiceEntry.organizationId, ctx.organizationId),
						eq(notOnInvoiceEntry.year, input.year),
						eq(notOnInvoiceEntry.month, input.month),
					),
				}),
				notOnInvoiceService.listStatusOptions(ctx),
				db
					.select({ count: sql<string>`count(*)` })
					.from(monthlyClose)
					.where(
						and(
							eq(monthlyClose.organizationId, ctx.organizationId),
							eq(monthlyClose.year, input.year),
							eq(monthlyClose.month, input.month),
							eq(monthlyClose.status, "finalized"),
						),
					),
				membersService.archivedUserIds(ctx),
			]);

		const billedByUser = new Map(
			billedRows.map((r) => [r.userId, Number(r.total)]),
		);
		const annotationByUser = new Map(annotations.map((a) => [a.userId, a]));

		const rows = people
			.filter((p) => (types.get(p.userId)?.type ?? "billable") === "billable")
			// Someone who left mid-month isn't bench — they're gone, and asking the
			// COO to explain their zero every month would be noise, not a signal.
			.filter((p) => !archived.has(p.userId))
			.filter((p) => (billedByUser.get(p.userId) ?? 0) === 0)
			.map((p) => {
				const annotation = annotationByUser.get(p.userId);
				return {
					userId: p.userId,
					name: p.name,
					email: p.email,
					statusOptionId: annotation?.statusOptionId ?? null,
					statusLabel:
						statusOptions.find((o) => o.id === annotation?.statusOptionId)
							?.label ?? null,
					comment: annotation?.comment ?? null,
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name));

		return {
			// The report is only meaningful once closes are finalized; surfaced so
			// the UI can say "no months finalized yet" rather than implying that
			// everybody was on the invoice.
			finalizedCloseCount: Number(finalizedCount[0]?.count ?? 0),
			statusOptions,
			rows,
		};
	},

	setStatus: async (ctx: Ctx, input: SetNotOnInvoiceStatusInput) => {
		await requireAdmin(ctx);

		if (input.statusOptionId) {
			const owned = await db.query.notOnInvoiceStatusOption.findFirst({
				where: and(
					eq(notOnInvoiceStatusOption.id, input.statusOptionId),
					eq(notOnInvoiceStatusOption.organizationId, ctx.organizationId),
				),
				columns: { id: true },
			});
			if (!owned) throw new Error("Status not found");
		}

		await db
			.insert(notOnInvoiceEntry)
			.values({
				organizationId: ctx.organizationId,
				year: input.year,
				month: input.month,
				userId: input.userId,
				statusOptionId: input.statusOptionId,
				comment: input.comment ?? null,
			})
			.onConflictDoUpdate({
				target: [
					notOnInvoiceEntry.organizationId,
					notOnInvoiceEntry.year,
					notOnInvoiceEntry.month,
					notOnInvoiceEntry.userId,
				],
				set: {
					statusOptionId: input.statusOptionId,
					...(input.comment !== undefined ? { comment: input.comment } : {}),
					updatedAt: new Date(),
				},
			});
	},
};
