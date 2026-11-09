// The audit log: what changed in an organization, by whom, and through which
// door. Issue #112. See `docs/domains/audit-log.md`.
//
// `recordAudit(ctx, entry)` writes one row, in the caller's transaction when
// there is one, and returns. It never throws: the audit row follows a decision
// that is already made, and it must not undo it.
//
// The entry is a value, not a builder like the one in `emitEvent`. Every
// organization has an audit log, so every entry is written. The actor's name is
// a subquery in the insert, not a second round trip.
//
// Not recorded:
//
// - A person's own time and preferences. These do not change the organization.
//   Time is recorded only when somebody changes the time of another person
//   (the PM absence writes).
// - The automation engines (see `events.ts`): a sweep recalculates and does not
//   decide.
// - Reads. The one exception is the export of this log.
//
// `services/audit-coverage.test.ts` lists every write of every audited service
// as recorded or exempt with a reason, so a new function cannot skip both.

import {
	and,
	count,
	desc,
	eq,
	gte,
	isNull,
	lt,
	or,
	type SQL,
	sql,
} from "drizzle-orm";

import { db } from "../db";
import { auditEvent } from "../db/schema/audit";
import { member } from "../db/schema/auth";
import { memberProfile } from "../db/schema/people";
import { orgSettings } from "../db/schema/settings";
import {
	AUDIT_REDACTED,
	type AuditChanges,
	type AuditKind,
	type AuditRetentionDays,
	type AuditValue,
	auditCategoryOf,
	DEFAULT_AUDIT_RETENTION_DAYS,
} from "../lib/audit";
import type { JsonRecord } from "../lib/json";
import { loggableError } from "../lib/loggable-error";
import { addDaysToKey, dayBoundsInTz } from "../lib/time";
import {
	AUDIT_PAGE_SIZE,
	type AuditFilterInput,
	type ExportAuditEventsInput,
	type ListAuditEventsInput,
	MAX_AUDIT_EXPORT_DAYS,
	MAX_AUDIT_EXPORT_ROWS,
} from "../schema/audit";
import { ctxTimezone, requireAdmin } from "./context";
import { ctxDb } from "./db-ctx";
import type { Ctx, CtxActor } from "./types";

/** What an audited write says about itself. */
export type AuditEntry = {
	kind: AuditKind;
	/** The thing changed. `label` is its name now, kept on the row so a later
	 *  rename or delete does not change what the log says. */
	target?: { type: string; id: string; label: string | null };
	/** The person the event is about, when there is one. */
	subjectUserId?: string | null;
	changes?: AuditChanges | null;
	details?: JsonRecord | null;
};

/** The columns every row takes from the request. */
const actorColumns = (
	actorUserId: string | null,
	actor: CtxActor | undefined,
) => ({
	actorUserId,
	actorName: actorUserId
		? sql<string>`(select "name" from "user" where "id" = ${actorUserId})`
		: null,
	impersonatorUserId: actor?.impersonatorId ?? null,
	impersonatorName: actor?.impersonatorId
		? sql<string>`(select "name" from "user" where "id" = ${actor.impersonatorId})`
		: null,
	via: actor?.via ?? "system",
	apiTokenId: actor?.apiTokenId ?? null,
	ip: actor?.ip ?? null,
	userAgent: actor?.userAgent ?? null,
});

const entryColumns = (entry: AuditEntry) => ({
	kind: entry.kind,
	category: auditCategoryOf(entry.kind),
	targetType: entry.target?.type ?? null,
	targetId: entry.target?.id ?? null,
	targetLabel: entry.target?.label ?? null,
	subjectUserId: entry.subjectUserId ?? null,
	changes: entry.changes ?? null,
	details: entry.details ?? null,
});

/**
 * Write one row to the organization's audit log.
 *
 * Never throws, for the reason `emitEvent` does not. The one failure it cannot
 * swallow is a database error inside the caller's transaction, which Postgres
 * has already aborted by the time the catch runs; that is a bug in the insert
 * below, not a case to handle.
 */
export const recordAudit = async (
	ctx: Ctx,
	entry: AuditEntry,
): Promise<void> => {
	try {
		await ctxDb(ctx)
			.insert(auditEvent)
			.values({
				organizationId: ctx.organizationId,
				// A job's Ctx carries no person (`userId: ""`), and names nobody.
				...actorColumns(ctx.userId || null, ctx.actor),
				...entryColumns(entry),
			});
	} catch (error) {
		console.error("[audit] could not write an audit event", {
			kind: entry.kind,
			organizationId: ctx.organizationId,
			error: loggableError(error),
		});
	}
};

/** A security event, before it is fanned out to the person's workspaces. */
export type SecurityEvent = AuditEntry & {
	/** The person it happened to. Their workspaces receive the row. */
	subjectUserId: string;
	/** Who did it: the person themselves, an operator, or null when nobody
	 *  signed in (a failed sign-in). */
	actorUserId: string | null;
	actor?: CtxActor;
	/** Write to this workspace only, not to all of the person's. An API token
	 *  bound to one workspace is news in that one. */
	organizationId?: string | null;
};

/**
 * Write a security event to every workspace the person is a member of NOW.
 * A workspace where the person has a pending Harvest import claim is not one
 * of them: the person has not accepted it.
 *
 * One statement: the rows are selected from `member`, so a person in three
 * workspaces costs one insert, and a person in none costs nothing. Fanning out
 * at write time, rather than joining at read time, is what keeps the history
 * of somebody who has since left, and what stops a new workspace from reading
 * what happened before the person joined it.
 *
 * Takes no Ctx: most of these happen before there is one (a sign-in) or
 * outside any workspace (an API token that works in all of them). Never throws.
 */
export const recordSecurityEvent = async (
	event: SecurityEvent,
): Promise<void> => {
	try {
		const actor = actorColumns(event.actorUserId, event.actor);
		const columns = entryColumns(event);
		const scope = event.organizationId
			? and(
					eq(member.userId, event.subjectUserId),
					eq(member.organizationId, event.organizationId),
				)
			: eq(member.userId, event.subjectUserId);
		// A Harvest import's pending claim is a `member` row too, but the
		// person has not accepted that workspace, so it does not receive their
		// sign-ins. A left join: a member with no profile row still counts.
		const organizations = await db
			.select({ organizationId: member.organizationId })
			.from(member)
			.leftJoin(
				memberProfile,
				and(
					eq(memberProfile.organizationId, member.organizationId),
					eq(memberProfile.userId, member.userId),
				),
			)
			.where(and(scope, isNull(memberProfile.claimPendingSince)));
		if (organizations.length === 0) return;
		await db.insert(auditEvent).values(
			organizations.map(({ organizationId }) => ({
				organizationId,
				...actor,
				...columns,
			})),
		);
	} catch (error) {
		console.error("[audit] could not write a security event", {
			kind: event.kind,
			userId: event.subjectUserId,
			error: loggableError(error),
		});
	}
};

// ── Diffs ───────────────────────────────────────────────────────────────────

/** Field names whose value never reaches the log. Matched without case, on
 *  the whole name or its end, so `webhookSecret` and `apiKey` are caught. */
const SECRET_FIELD = /(secret|token|password|apikey|key)$/i;

/** What a diffed field may hold. A field of another shape is a caller that
 *  needs to project it first, and the compiler says so. */
export type DiffableValue =
	| string
	| number
	| boolean
	| Date
	| (string | number)[]
	| null
	| undefined;

const toAuditValue = (value: DiffableValue): AuditValue => {
	if (value === undefined || value === null) return null;
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.map(String);
	return value;
};

const sameValue = (a: AuditValue, b: AuditValue): boolean =>
	Array.isArray(a) && Array.isArray(b)
		? a.length === b.length && a.every((item, index) => item === b[index])
		: a === b;

/**
 * The fields that differ between `before` and `after`, or null when none do.
 *
 * Only the fields named in `fields` are compared, so a caller says what the
 * form edits and an `updatedAt` never shows up as a change. A secret is
 * written as `[redacted]` on both sides: the log says it changed, not what to.
 */
export const diffFields = <F extends string>(
	before: { readonly [K in F]?: DiffableValue } | null | undefined,
	after: { readonly [K in F]?: DiffableValue } | null | undefined,
	fields: readonly F[],
): AuditChanges | null => {
	const changes: AuditChanges = {};
	for (const field of fields) {
		const from = toAuditValue(before?.[field]);
		const to = toAuditValue(after?.[field]);
		if (sameValue(from, to)) continue;
		changes[field] = SECRET_FIELD.test(field)
			? {
					from: from === null ? null : AUDIT_REDACTED,
					to: to === null ? null : AUDIT_REDACTED,
				}
			: { from, to };
	}
	return Object.keys(changes).length > 0 ? changes : null;
};

// ── Reading the log ─────────────────────────────────────────────────────────

export type AuditEventView = {
	id: string;
	occurredAt: string;
	kind: string;
	category: string;
	actorUserId: string | null;
	actorName: string | null;
	impersonatorName: string | null;
	via: string;
	ip: string | null;
	userAgent: string | null;
	targetType: string | null;
	targetId: string | null;
	targetLabel: string | null;
	subjectUserId: string | null;
	changes: AuditChanges | null;
	details: JsonRecord | null;
};

export type AuditPage = {
	events: AuditEventView[];
	/** Pass back as `cursor` for the next page. Null on the last page. */
	nextCursor: string | null;
};

const toView = (row: typeof auditEvent.$inferSelect): AuditEventView => ({
	id: row.id,
	occurredAt: row.occurredAt.toISOString(),
	kind: row.kind,
	category: row.category,
	actorUserId: row.actorUserId,
	actorName: row.actorName,
	impersonatorName: row.impersonatorName,
	via: row.via,
	ip: row.ip,
	userAgent: row.userAgent,
	targetType: row.targetType,
	targetId: row.targetId,
	targetLabel: row.targetLabel,
	subjectUserId: row.subjectUserId,
	changes: row.changes,
	details: row.details,
});

/** A cursor is the last row's time and id, so two rows written in the same
 *  millisecond are neither skipped nor shown twice. */
const encodeCursor = (row: { occurredAt: Date; id: string }) =>
	`${row.occurredAt.toISOString()}|${row.id}`;

const decodeCursor = (
	cursor: string,
): { occurredAt: Date; id: string } | null => {
	const [at, id] = cursor.split("|");
	if (!at || !id) return null;
	const occurredAt = new Date(at);
	return Number.isNaN(occurredAt.getTime()) ? null : { occurredAt, id };
};

const filterWhere = async (
	ctx: Ctx,
	filter: AuditFilterInput,
): Promise<SQL[]> => {
	const where: SQL[] = [eq(auditEvent.organizationId, ctx.organizationId)];
	if (filter.category) where.push(eq(auditEvent.category, filter.category));
	if (filter.kind) where.push(eq(auditEvent.kind, filter.kind));
	if (filter.userId) {
		const either = or(
			eq(auditEvent.actorUserId, filter.userId),
			eq(auditEvent.subjectUserId, filter.userId),
		);
		if (either) where.push(either);
	}
	if (filter.from || filter.to) {
		const tz = await ctxTimezone(ctx);
		if (filter.from) {
			where.push(
				gte(auditEvent.occurredAt, dayBoundsInTz(filter.from, tz).start),
			);
		}
		if (filter.to) {
			where.push(lt(auditEvent.occurredAt, dayBoundsInTz(filter.to, tz).end));
		}
	}
	return where;
};

const CSV_COLUMNS = [
	"time",
	"category",
	"kind",
	"actor",
	"impersonated_by",
	"via",
	"target_type",
	"target",
	"changes",
	"details",
	"ip",
	"user_agent",
] as const;

/** RFC 4180, plus a leading quote on anything a spreadsheet would read as a
 *  formula: a name is typed by a person, and `=HYPERLINK(...)` is a name. */
const csvCell = (value: string | null): string => {
	if (value === null) return "";
	const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/** What an export row says about the export: the range, the row count, and
 *  each filter that was set. */
const exportDetails = (
	input: ExportAuditEventsInput,
	rows: number,
): JsonRecord => {
	const details: JsonRecord = { from: input.from, to: input.to, rows };
	if (input.category) details.category = input.category;
	if (input.kind) details.kind = input.kind;
	if (input.userId) details.userId = input.userId;
	return details;
};

export const auditService = {
	/** One page of the log, newest first. Admin only. */
	list: async (ctx: Ctx, input: ListAuditEventsInput): Promise<AuditPage> => {
		await requireAdmin(ctx);
		const where = await filterWhere(ctx, input);
		const cursor = input.cursor ? decodeCursor(input.cursor) : null;
		if (cursor) {
			const before = or(
				lt(auditEvent.occurredAt, cursor.occurredAt),
				and(
					eq(auditEvent.occurredAt, cursor.occurredAt),
					lt(auditEvent.id, cursor.id),
				),
			);
			if (before) where.push(before);
		}
		const rows = await ctxDb(ctx)
			.select()
			.from(auditEvent)
			.where(and(...where))
			.orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id))
			.limit(AUDIT_PAGE_SIZE + 1);
		const page = rows.slice(0, AUDIT_PAGE_SIZE);
		const last = page.at(-1);
		return {
			events: page.map(toView),
			nextCursor:
				rows.length > AUDIT_PAGE_SIZE && last ? encodeCursor(last) : null,
		};
	},

	/**
	 * The log as CSV, for a range of at most a year. Admin only.
	 *
	 * Records itself: a copy of the log leaving the app is the one read an
	 * administrator wants to see in it.
	 */
	exportCsv: async (
		ctx: Ctx,
		input: ExportAuditEventsInput,
	): Promise<{ csv: string; rows: number; truncated: boolean }> => {
		await requireAdmin(ctx);
		if (input.to < input.from)
			throw new Error("The range ends before it starts.");
		if (addDaysToKey(input.from, MAX_AUDIT_EXPORT_DAYS) <= input.to) {
			throw new Error("Export at most a year at a time.");
		}
		const where = await filterWhere(ctx, input);
		const rows = await ctxDb(ctx)
			.select()
			.from(auditEvent)
			.where(and(...where))
			.orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id))
			.limit(MAX_AUDIT_EXPORT_ROWS + 1);
		const truncated = rows.length > MAX_AUDIT_EXPORT_ROWS;
		const kept = rows.slice(0, MAX_AUDIT_EXPORT_ROWS);

		const lines = [CSV_COLUMNS.join(",")];
		for (const row of kept) {
			lines.push(
				[
					row.occurredAt.toISOString(),
					row.category,
					row.kind,
					row.actorName,
					row.impersonatorName,
					row.via,
					row.targetType,
					row.targetLabel,
					row.changes ? JSON.stringify(row.changes) : null,
					row.details ? JSON.stringify(row.details) : null,
					row.ip,
					row.userAgent,
				]
					.map(csvCell)
					.join(","),
			);
		}

		await recordAudit(ctx, {
			kind: "audit_log.exported",
			details: exportDetails(input, kept.length),
		});
		return { csv: `${lines.join("\r\n")}\r\n`, rows: kept.length, truncated };
	},

	/** How long this organization keeps its log. Admin only. */
	retention: async (ctx: Ctx): Promise<AuditRetentionDays> => {
		await requireAdmin(ctx);
		const row = await ctxDb(ctx).query.orgSettings.findFirst({
			where: eq(orgSettings.organizationId, ctx.organizationId),
			columns: { auditRetentionDays: true },
		});
		return asRetention(row?.auditRetentionDays);
	},

	setRetention: async (
		ctx: Ctx,
		days: AuditRetentionDays,
	): Promise<AuditRetentionDays> => {
		await requireAdmin(ctx);
		const before = await auditService.retention(ctx);
		if (before === days) return days;
		await ctxDb(ctx)
			.insert(orgSettings)
			.values({ organizationId: ctx.organizationId, auditRetentionDays: days })
			.onConflictDoUpdate({
				target: orgSettings.organizationId,
				set: { auditRetentionDays: days, updatedAt: new Date() },
			});
		await recordAudit(ctx, {
			kind: "audit_log.retention_changed",
			changes: { retentionDays: { from: before, to: days } },
		});
		return days;
	},
};

const asRetention = (days: number | undefined): AuditRetentionDays => {
	switch (days) {
		case 90:
		case 365:
		case 730:
		case 2555:
			return days;
		default:
			return DEFAULT_AUDIT_RETENTION_DAYS;
	}
};

/**
 * Delete every row older than its organization keeps. One statement: the
 * retention comes from a join, and an organization with no settings row keeps
 * the default. Returns how many rows went. `jobs/audit-sweep.ts` calls it.
 */
export const sweepAuditLog = async ({
	now = new Date(),
}: { now?: Date } = {}): Promise<number> => {
	// A data-modifying CTE, so the database counts the rows. A `returning`
	// list would load every deleted id into memory.
	// The raw template gets an ISO string, not a Date. The postgres-js
	// driver cannot serialize a Date inside a raw sql template. PGLite can,
	// so the tests do not show it.
	const deleted = db.$with("deleted").as(
		db
			.delete(auditEvent)
			.where(
				sql`${auditEvent.occurredAt} < ${now.toISOString()}::timestamptz - make_interval(days => coalesce(
				(select ${orgSettings.auditRetentionDays} from ${orgSettings}
					where ${orgSettings.organizationId} = ${auditEvent.organizationId}),
				${DEFAULT_AUDIT_RETENTION_DAYS}
			))`,
			)
			.returning({ one: sql<number>`1`.as("one") }),
	);
	const [row] = await db.with(deleted).select({ total: count() }).from(deleted);
	return row?.total ?? 0;
};
