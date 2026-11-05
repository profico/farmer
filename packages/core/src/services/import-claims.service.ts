// A Harvest import's pending claims, from the side of the PERSON they name.
//
// In multi-org mode the import makes a `member` row for a person whose address
// had no account yet — usually a former employee — under a placeholder `user`
// (see "A placeholder person" below), or under the existing user that holds
// the address. Nobody had asked either person. The import marks such a membership
// with `memberProfile.claimPendingSince` instead: the organization sees the
// person as before (People, reports, the archived former employees), and the
// person cannot open the organization until they accept here.
//
// Every refusal of a pending claim comes from one fact, read in three places:
// `accessService.resolve` (the web middleware, the REST and CLI API, MCP),
// `membersService.getRole` (the workspace guard) and the lists that offer a
// workspace (`orgContextService.organizationsFor`, the session hook in
// `auth/index.ts`). Reminders read it in `deliveryBlocks` (notify.ts).
//
// Not org-scoped in the usual sense: the caller is acting on their own
// membership, so `ctx.userId` is always the signed-in person and
// `ctx.organizationId` the organization whose claim they answer. No `Access`
// is resolved, because `resolve` refuses exactly these callers.

import {
	and,
	asc,
	eq,
	getTableName,
	inArray,
	isNotNull,
	isNull,
	or,
	sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { mayClaimInvitation } from "../auth/registration";
import { type DbClient, db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import {
	projectMember,
	recurringBlockRule,
	timeEntry,
} from "../db/schema/domain";
import { importMapping, importPendingPerson } from "../db/schema/import";
import {
	memberProfile,
	memberTypeHistory,
	teamLeadPerson,
} from "../db/schema/people";
import { memberWorkingHoursDay } from "../db/schema/schedule";
import { UserFacingError } from "../lib/user-facing-error";
import { MAX_DAY_SECONDS } from "../lib/working-day";
import { recordAudit } from "./audit";
import { ctxTimezone, withCtxTx } from "./context";
import { recomputeDayFill } from "./day-fill";
import { ctxDb } from "./db-ctx";
import { memberJoined } from "./member-joined";
import { teamLeadsService } from "./team-leads.service";
import type { Ctx } from "./types";

/** The caller has no pending claim in the organization they named. The same
 *  answer for "no such organization", so this is not a way to probe which
 *  organizations exist. */
export class NoPendingClaimError extends UserFacingError {
	constructor() {
		super("There is no imported history waiting for you in this workspace");
		this.name = "NoPendingClaimError";
	}
}

export type PendingClaim = {
	organizationId: string;
	name: string;
	slug: string;
	logo: string | null;
	/** When the import made the membership. */
	since: Date;
};

/** The caller's membership in `ctx.organizationId`, while its claim is still
 *  pending; throws `NoPendingClaimError` otherwise. `client` is the
 *  transaction, so the answer holds for the write that follows it. */
const pendingMembership = async (
	client: DbClient,
	ctx: Ctx,
): Promise<{ role: string; name: string }> => {
	const [row] = await client
		// The org reads this name in the decline audit row: the import's name.
		.select({
			role: member.role,
			name: sql<string>`coalesce(${memberProfile.claimName}, ${user.name})`,
		})
		.from(memberProfile)
		.innerJoin(
			member,
			and(
				eq(member.organizationId, memberProfile.organizationId),
				eq(member.userId, memberProfile.userId),
			),
		)
		.innerJoin(user, eq(user.id, memberProfile.userId))
		.where(
			and(
				eq(memberProfile.organizationId, ctx.organizationId),
				eq(memberProfile.userId, ctx.userId),
				isNotNull(memberProfile.claimPendingSince),
			),
		)
		.limit(1)
		.for("update");
	if (!row) throw new NoPendingClaimError();
	return row;
};

const clearClaim = (client: DbClient, organizationId: string, userId: string) =>
	client
		.update(memberProfile)
		// `claimName` stays: undo reads it to tell a person who accepted from
		// one a single-org import attached. Nothing shows it once the claim is
		// accepted.
		.set({ claimPendingSince: null, updatedAt: new Date() })
		.where(
			and(
				eq(memberProfile.organizationId, organizationId),
				eq(memberProfile.userId, userId),
			),
		);

/** The role and the import's name for a placeholder's membership. */
const placeholderMembership = async (
	client: DbClient,
	organizationId: string,
	userId: string,
): Promise<{ role: string; name: string; claimName: string | null }> => {
	const [row] = await client
		.select({
			role: member.role,
			name: sql<string>`coalesce(${memberProfile.claimName}, ${user.name})`,
			claimName: memberProfile.claimName,
		})
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.leftJoin(
			memberProfile,
			and(
				eq(memberProfile.organizationId, member.organizationId),
				eq(memberProfile.userId, member.userId),
			),
		)
		.where(
			and(eq(member.organizationId, organizationId), eq(member.userId, userId)),
		);
	if (!row) throw new NoPendingClaimError();
	return row;
};

// ── A placeholder person ─────────────────────────────────────────────────────
// An import made a placeholder `user` for an address with no account, and kept
// the address in `import_pending_person` (`lib/import-placeholder.ts`). The
// person who verifiably owns the address claims it: every row the import and the
// org wrote for the placeholder moves to the caller's own user. The list below
// is every table with a foreign key to `user`, decided one by one. A row in
// a table not moved is deleted with the placeholder (the keys cascade).
//
// Moved (the org writes these for a person who has not signed in):
//   member, member_profile, member_type_history, project_member, time_entry,
//   team_lead_person (both columns), member_working_hours_day,
//   recurring_block_rule.
// Not moved, because only a signed-in person writes them, and the placeholder
// has no session, account or credential: running_timer, timer_settings,
// member_slack_identity (matched by address, which a placeholder never has),
// slack_reminder_log, integration_settings, the five tombstone tables (written
// by that person's own sync), filing_rule, hidden_task, push_subscription,
// notification_settings, assistant_conversation, api_token, session, account,
// oauth tokens and the device codes.
// Not moved, because the placeholder is never the actor: installed_by,
// connected_by, linked_by, created_by and updated_by columns.

/** What a moved table does when the caller has a row of their own already:
 *  `none` moves every row, `any` moves nothing while the caller has a row
 *  in the org, and a column list skips the rows that share those values. */
type Clash = "none" | "any" | readonly AnyPgColumn[];

type Move = {
	user: AnyPgColumn;
	org: AnyPgColumn;
	clash: Clash;
};

const MOVES: readonly Move[] = [
	{ user: member.userId, org: member.organizationId, clash: "any" },
	{
		user: memberProfile.userId,
		org: memberProfile.organizationId,
		clash: "any",
	},
	{
		user: projectMember.userId,
		org: projectMember.organizationId,
		clash: [projectMember.projectId],
	},
	{ user: timeEntry.userId, org: timeEntry.organizationId, clash: "none" },
	{
		user: teamLeadPerson.leadUserId,
		org: teamLeadPerson.organizationId,
		clash: [teamLeadPerson.personUserId],
	},
	{
		user: teamLeadPerson.personUserId,
		org: teamLeadPerson.organizationId,
		clash: [teamLeadPerson.leadUserId],
	},
	{
		user: memberWorkingHoursDay.userId,
		org: memberWorkingHoursDay.organizationId,
		clash: [memberWorkingHoursDay.dayOfWeek],
	},
	{
		user: recurringBlockRule.userId,
		org: recurringBlockRule.organizationId,
		clash: "none",
	},
];

const moveRows = (
	tx: DbClient,
	m: Move,
	org: string,
	from: string,
	to: string,
) => {
	const table = sql.identifier(getTableName(m.user.table));
	const u = sql.identifier(m.user.name);
	const o = sql.identifier(m.org.name);
	const same =
		m.clash === "none" || m.clash === "any"
			? sql``
			: sql.join(
					m.clash.map((c) => {
						const k = sql.identifier(c.name);
						return sql` and x.${k} = ${table}.${k}`;
					}),
				);
	const clash =
		m.clash === "none"
			? sql``
			: sql`and not exists (select 1 from ${table} x where x.${u} = ${to} and x.${o} = ${org}${same})`;
	return tx.execute(
		sql`update ${table} set ${u} = ${to} where ${u} = ${from} and ${o} = ${org} ${clash}`,
	);
};

/** The person type is effective-dated, and the imported months must keep the
 *  type they had. The caller's own rows stand for the days they cover. A row
 *  of the placeholder that starts before the caller's first row is cut to end
 *  there, so the imported months before it keep the imported type. Then every
 *  row that overlaps nothing the caller holds moves. Dates are yyyy-MM-dd
 *  text, so a string comparison orders them. */
const moveTypeHistory = async (
	tx: DbClient,
	org: string,
	from: string,
	to: string,
) => {
	const t = memberTypeHistory;
	const table = sql.identifier(getTableName(t));
	const u = sql.identifier(t.userId.name);
	const o = sql.identifier(t.organizationId.name);
	const start = sql.identifier(t.effectiveFrom.name);
	const end = sql.identifier(t.effectiveUntil.name);
	const first = sql`(select min(x.${start}) from ${table} x where x.${u} = ${to} and x.${o} = ${org})`;
	await tx.execute(
		sql`update ${table} set ${end} = ${first} where ${u} = ${from} and ${o} = ${org} and ${start} < ${first} and (${end} is null or ${end} > ${first})`,
	);
	await tx.execute(
		sql`update ${table} set ${u} = ${to} where ${u} = ${from} and ${o} = ${org} and not exists (select 1 from ${table} x where x.${u} = ${to} and x.${o} = ${org} and x.${start} < coalesce(${table}.${end}, '9999-12-31') and coalesce(x.${end}, '9999-12-31') > ${table}.${start})`,
	);
};

/** The days that hold more than 24 hours once the placeholder's entries join
 *  the caller's. Counted before the move, for the audit row. */
const daysOverCap = async (
	tx: DbClient,
	org: string,
	from: string,
	to: string,
): Promise<number> => {
	const rows = await tx
		.select({ date: timeEntry.date })
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, org),
				inArray(timeEntry.userId, [from, to]),
			),
		)
		.groupBy(timeEntry.date)
		.having(
			// The same predicate as `spokenForSeconds`: a fill block is what is
			// left of the day, so it never counts towards the cap.
			sql`sum(${timeEntry.durationSeconds}) filter (where not ${timeEntry.fillsDay}) > ${MAX_DAY_SECONDS} and bool_or(${timeEntry.userId} = ${from})`,
		);
	return rows.length;
};

/** The dates where the caller has a fill block and the placeholder has
 *  entries. The merge adds time to those days, so the fill block shrinks. */
const mergedFillDates = async (
	tx: DbClient,
	org: string,
	from: string,
	to: string,
): Promise<string[]> => {
	const rows = await tx
		.selectDistinct({ date: timeEntry.date })
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, org),
				eq(timeEntry.userId, to),
				eq(timeEntry.fillsDay, true),
				inArray(
					timeEntry.date,
					tx
						.select({ date: sql<string>`te2.date` })
						.from(sql`time_entry te2`)
						.where(sql`te2.organization_id = ${org} and te2.user_id = ${from}`),
				),
			),
		);
	return rows.map((r) => r.date);
};

type PlaceholderClaim = { userId: string; email: string };

/** The placeholder in `ctx.organizationId` that the caller verifiably owns:
 *  the address matches and the provider vouched for it. Null otherwise, so
 *  an unverified sign-in claims nothing. */
const ownedPlaceholder = async (
	client: DbClient,
	ctx: Ctx,
): Promise<PlaceholderClaim | null> => {
	const [me] = await client
		.select({ email: user.email, emailVerified: user.emailVerified })
		.from(user)
		.where(eq(user.id, ctx.userId));
	if (!me || !mayClaimInvitation(me.emailVerified)) return null;
	const [row] = await client
		.select({
			userId: importPendingPerson.userId,
			email: importPendingPerson.email,
		})
		.from(importPendingPerson)
		.innerJoin(
			member,
			and(
				eq(member.organizationId, importPendingPerson.organizationId),
				eq(member.userId, importPendingPerson.userId),
			),
		)
		.where(
			and(
				eq(importPendingPerson.organizationId, ctx.organizationId),
				eq(importPendingPerson.email, me.email.toLowerCase()),
				eq(importPendingPerson.confirmed, true),
				isNull(importPendingPerson.declinedAt),
			),
		)
		.limit(1)
		.for("update");
	return row ?? null;
};

type Adopted = {
	role: string;
	name: string;
	joined: boolean;
	daysOverCap: number;
};

/** Moves the placeholder's rows to the caller and deletes the placeholder.
 *  `joined` is false when the caller was a member already: then the rows
 *  merge, nothing is announced, and a day may hold more than 24 hours. The
 *  entries are the org's record of what happened, so they are not refused. */
const adoptPlaceholder = async (
	tx: DbClient,
	ctx: Ctx,
	placeholder: PlaceholderClaim,
): Promise<Adopted> => {
	const org = ctx.organizationId;
	const row = await placeholderMembership(tx, org, placeholder.userId);
	const [mine] = await tx
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, org), eq(member.userId, ctx.userId)));
	const overCap = await daysOverCap(tx, org, placeholder.userId, ctx.userId);
	const fillDates = await mergedFillDates(
		tx,
		org,
		placeholder.userId,
		ctx.userId,
	);
	// A lead link between the caller and the placeholder would become a
	// caller-to-caller row, which the self-lead check refuses.
	await tx
		.delete(teamLeadPerson)
		.where(
			and(
				eq(teamLeadPerson.organizationId, org),
				or(
					and(
						eq(teamLeadPerson.leadUserId, ctx.userId),
						eq(teamLeadPerson.personUserId, placeholder.userId),
					),
					and(
						eq(teamLeadPerson.leadUserId, placeholder.userId),
						eq(teamLeadPerson.personUserId, ctx.userId),
					),
				),
			),
		);
	for (const m of MOVES) {
		await moveRows(tx, m, org, placeholder.userId, ctx.userId);
	}
	await moveTypeHistory(tx, org, placeholder.userId, ctx.userId);
	// `ctx` carries `tx` here (`withCtxTx` in `accept`), so the recompute
	// runs inside this transaction.
	if (fillDates.length > 0) {
		const tz = await ctxTimezone(ctx);
		for (const date of fillDates) await recomputeDayFill(ctx, date, tz);
	}
	// A profile the caller holds already (a member, or a leftover of a
	// decline) stays. It takes the earlier start date and, for undo, the
	// claim name: undo reads `claimName` to tell an accepted import from an
	// attached member.
	await tx
		.update(memberProfile)
		.set({
			startDate: sql`least(${memberProfile.startDate}, (select p.start_date from member_profile p where p.organization_id = ${org} and p.user_id = ${placeholder.userId}))`,
			claimName: sql`coalesce(${memberProfile.claimName}, ${row.claimName})`,
		})
		.where(
			and(
				eq(memberProfile.organizationId, org),
				eq(memberProfile.userId, ctx.userId),
			),
		);
	await clearClaim(tx, org, ctx.userId);
	await tx
		.update(importMapping)
		.set({ localId: ctx.userId })
		.where(
			and(
				eq(importMapping.organizationId, org),
				eq(importMapping.kind, "person"),
				eq(importMapping.localId, placeholder.userId),
			),
		);
	await tx.delete(user).where(eq(user.id, placeholder.userId));
	return {
		role: mine?.role ?? row.role,
		name: row.name,
		joined: !mine,
		daysOverCap: overCap,
	};
};

/** The placeholder persons whose address the caller owns and has verified. */
const pendingPlaceholders = async (userId: string): Promise<PendingClaim[]> => {
	const [me] = await db
		.select({ email: user.email, emailVerified: user.emailVerified })
		.from(user)
		.where(eq(user.id, userId));
	if (!me || !mayClaimInvitation(me.emailVerified)) return [];
	const rows = await db
		.select({
			organizationId: organization.id,
			name: organization.name,
			slug: organization.slug,
			logo: organization.logo,
			since: memberProfile.claimPendingSince,
		})
		.from(importPendingPerson)
		.innerJoin(
			member,
			and(
				eq(member.organizationId, importPendingPerson.organizationId),
				eq(member.userId, importPendingPerson.userId),
			),
		)
		.innerJoin(
			memberProfile,
			and(
				eq(memberProfile.organizationId, importPendingPerson.organizationId),
				eq(memberProfile.userId, importPendingPerson.userId),
			),
		)
		.innerJoin(
			organization,
			eq(organization.id, importPendingPerson.organizationId),
		)
		.where(
			and(
				eq(importPendingPerson.email, me.email.toLowerCase()),
				eq(importPendingPerson.confirmed, true),
				isNull(importPendingPerson.declinedAt),
				isNotNull(memberProfile.claimPendingSince),
			),
		);
	return rows.flatMap(({ since, ...rest }) =>
		since ? [{ ...rest, since }] : [],
	);
};

/** The memberships under the caller's own user that wait for an answer. */
const pendingOwn = async (userId: string): Promise<PendingClaim[]> => {
	const rows = await db
		.select({
			organizationId: organization.id,
			name: organization.name,
			slug: organization.slug,
			logo: organization.logo,
			since: memberProfile.claimPendingSince,
		})
		.from(memberProfile)
		.innerJoin(
			member,
			and(
				eq(member.organizationId, memberProfile.organizationId),
				eq(member.userId, memberProfile.userId),
			),
		)
		.innerJoin(organization, eq(organization.id, memberProfile.organizationId))
		.where(
			and(
				eq(memberProfile.userId, userId),
				isNotNull(memberProfile.claimPendingSince),
			),
		)
		.orderBy(asc(memberProfile.claimPendingSince));
	// The `where` above keeps only rows with a date; the column type does
	// not know that, so the rows are narrowed rather than asserted.
	return rows.flatMap(({ since, ...rest }) =>
		since ? [{ ...rest, since }] : [],
	);
};

/** Ends a claim as an accept: the caller's own pending membership, or the
 *  placeholder they own. `joined` is false when the caller was a member
 *  already. */
const acceptClaim = async (tx: DbClient, ctx: Ctx): Promise<Adopted> => {
	const placeholder = await ownedPlaceholder(tx, ctx);
	if (placeholder) return adoptPlaceholder(tx, ctx, placeholder);
	const pending = await pendingMembership(tx, ctx);
	await clearClaim(tx, ctx.organizationId, ctx.userId);
	return { ...pending, joined: true, daysOverCap: 0 };
};

/** Ends a claim as a decline. The `member` row goes and the history stays,
 *  under the caller's own user or under the placeholder (which then keeps
 *  `declinedAt`, so the offer does not return). `personId` is the user whose
 *  team lead lists to clear. */
const declineClaim = async (
	tx: DbClient,
	ctx: Ctx,
): Promise<{ role: string; name: string; personId: string }> => {
	const placeholder = await ownedPlaceholder(tx, ctx);
	const personId = placeholder?.userId ?? ctx.userId;
	const pending = placeholder
		? await placeholderMembership(tx, ctx.organizationId, personId)
		: await pendingMembership(tx, ctx);
	await tx
		.delete(member)
		.where(
			and(
				eq(member.organizationId, ctx.organizationId),
				eq(member.userId, personId),
			),
		);
	await clearClaim(tx, ctx.organizationId, personId);
	if (placeholder) {
		await tx
			.update(importPendingPerson)
			.set({ declinedAt: new Date(), updatedAt: new Date() })
			.where(eq(importPendingPerson.userId, personId));
	}
	return { ...pending, personId };
};

export const importClaimsService = {
	/** The organizations that imported the caller's history and wait for an
	 *  answer, oldest first. What `/no-access` offers. Besides a pending
	 *  membership under the caller's own user, it lists a placeholder person
	 *  whose address the caller owns and has verified. */
	pendingFor: async (userId: string): Promise<PendingClaim[]> => {
		const [own, placeholders] = await Promise.all([
			pendingOwn(userId),
			pendingPlaceholders(userId),
		]);
		const seen = new Set(own.map((c) => c.organizationId));
		return [
			...own,
			...placeholders.filter((c) => !seen.has(c.organizationId)),
		].sort((a, b) => a.since.getTime() - b.since.getTime());
	},

	/** Join: the membership the import made becomes the caller's own. Runs
	 *  what joining runs on every other path (`memberJoined`: `member.joined`
	 *  in the audit log, the Slack match and `member.added`), after the write
	 *  has committed. Returns the slug to enter. A caller who was a member
	 *  already joins nothing, so nothing is announced. */
	accept: async (ctx: Ctx): Promise<{ slug: string }> => {
		const { role, name, joined, daysOverCap } = await withCtxTx(ctx, (txCtx) =>
			acceptClaim(ctxDb(txCtx), txCtx),
		);
		if (joined) {
			await memberJoined(
				ctx,
				{ organizationId: ctx.organizationId, userId: ctx.userId, role },
				name,
			);
		} else {
			await recordAudit(ctx, {
				kind: "member.claim_merged",
				subjectUserId: ctx.userId,
				target: { type: "member", id: ctx.userId, label: name },
				// The moved entries are kept whole, so a day may pass the 24-hour
				// cap; the count says how many did.
				details: { role, daysOverCap },
			});
		}
		const org = await db.query.organization.findFirst({
			where: eq(organization.id, ctx.organizationId),
			columns: { slug: true },
		});
		if (!org) throw new NoPendingClaimError();
		return { slug: org.slug };
	},

	/** Decline: the caller leaves the organization. Only the `member` row
	 *  goes. The profile, the time entries and the assignments stay, because
	 *  they are the organization's history of the person and not the person's
	 *  account. The team lead lists go too, as they do when an admin removes
	 *  somebody (`removeMember` in `apps/web/src/server/members.ts`), so a
	 *  later invitation does not bring an old list back in silence. The
	 *  audit log records the decline as `member.claim_declined`. */
	decline: async (ctx: Ctx): Promise<void> => {
		const { role, name, personId } = await db.transaction((tx) =>
			declineClaim(tx, ctx),
		);
		// After the commit: this transaction is a raw `db.transaction`, and a
		// second connection held inside it is the deadlock `ctxDb` warns about.
		await recordAudit(ctx, {
			kind: "member.claim_declined",
			subjectUserId: personId,
			target: { type: "member", id: personId, label: name },
			details: { role },
		});
		await teamLeadsService.removeFromAllLists(ctx, personId);
	},
};
