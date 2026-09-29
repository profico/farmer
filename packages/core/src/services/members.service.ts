import {
	and,
	asc,
	count,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	ne,
	or,
} from "drizzle-orm";

import { db } from "../db";
import { account, invitation, member, user } from "../db/schema/auth";
import {
	invitationEmail,
	type invitationEmailStatus,
	memberProfile,
	memberTypeHistory,
	teamLeadPerson,
} from "../db/schema/people";
import { dayKeyInTz, endOfMonthKey } from "../lib/time";
import type {
	InviteMemberInput,
	SetMemberTypeInput,
	MemberTypeValue,
} from "../schema/members";
import { diffFields, recordAudit } from "./audit";
import { ctxDb, ctxTimezone, requireAdmin } from "./context";
import { emitEvent, memberWebhookPayload } from "./events";
import { assertUserInOrg } from "./guards";
import { teamLeadsService } from "./team-leads.service";
import type { Ctx } from "./types";

export type InvitationEmailStatus =
	(typeof invitationEmailStatus.enumValues)[number];

export type InvitationEmailState = {
	status: InvitationEmailStatus;
	/** The provider's message, when the send failed. */
	error: string | null;
};

/** How long a send may read as in flight. Both mail transports give up well
 *  inside it (see `lib/email.ts`), so a "sending" older than this is a process
 *  that stopped mid-send and will never report how it went. */
export const INVITATION_EMAIL_STALE_MS = 5 * 60_000;

export type MemberType = MemberTypeValue;

export type ResolvedMemberType = {
	type: MemberType;
	/** Hourly people have no Croatian monthly hour fund and therefore no
	 *  Expected value, unless one is set here, in which case the pace check
	 *  treats them like a full-time person. */
	expectedSecondsOverride: number | null;
};

/** One person, reduced to what it takes to draw them: a name and a face. */
export type DirectoryEntry = {
	userId: string;
	name: string;
	/** The Google profile photo, refreshed at every sign-in (see the
	 *  `overrideUserInfoOnSignIn` note in `auth/index.ts`). Null for anyone who
	 *  has only ever signed in with a password, i.e. every dev account. */
	image: string | null;
};

export type PersonRow = ResolvedMemberType & {
	userId: string;
	name: string;
	email: string;
	orgRole: string;
	startDate: string | null;
	/** Null = Active. Archived people keep every entry, close row and report they
	 *  already appear in, and drop out of the forward-looking ones. */
	archivedAt: Date | null;
	/** Never signed in, and nobody has confirmed the address: a person an
	 *  import made with a guessed email (docs/plans/harvest-import.md, 3.3).
	 *  Restoring them is where an admin confirms it. */
	emailUnconfirmed: boolean;
	/** People on their Team Lead list — zero for everyone who leads nobody. */
	leadsPeople: number;
};

/** A membership row as the People screen draws it: the shape better-auth's
 *  `listMembers` answered with, so the screen did not change with the source. */
export type RosterMember = {
	id: string;
	userId: string;
	role: string;
	createdAt: Date;
	user: { id: string; name: string; email: string; image: string | null };
};

const DEFAULT_TYPE: ResolvedMemberType = {
	type: "employee_billable",
	expectedSecondsOverride: null,
};

/** People the compliance report and the reminders apply to: everyone but an
 *  overhead employee. Hourly people are chased for entries even without a
 *  fund to be behind. */
export const isNaggable = (type: MemberType) => type !== "employee_overhead";

/** Why an admin of `ctx`'s org may not vouch for `userId`'s address, or null
 *  when they may (docs/plans/harvest-import.md, 3.3). An unverified address is
 *  one a Google sign-in will not link to, and confirming it hands the account
 *  to whoever signs in as that address. So only for a user who has never
 *  signed in and whom no other org holds: one org's admin cannot vouch for an
 *  identity another org shares. */
const whyEmailNotConfirmable = async (
	ctx: Ctx,
	userId: string,
): Promise<"confirmed" | "signed-in" | "elsewhere" | null> => {
	const target = await db.query.user.findFirst({
		where: eq(user.id, userId),
		columns: { emailVerified: true },
	});
	if (!target || target.emailVerified) return "confirmed";
	const [signedIn] = await db
		.select({ id: account.id })
		.from(account)
		.where(eq(account.userId, userId))
		.limit(1);
	if (signedIn) return "signed-in";
	const [elsewhere] = await db
		.select({ id: member.id })
		.from(member)
		.where(
			and(
				eq(member.userId, userId),
				ne(member.organizationId, ctx.organizationId),
			),
		)
		.limit(1);
	return elsewhere ? "elsewhere" : null;
};

const markEmailVerified = (userId: string) =>
	db
		.update(user)
		.set({ emailVerified: true, updatedAt: new Date() })
		.where(eq(user.id, userId));

/** The audit target for a person: their name now, kept on the row. */
const memberTarget = async (userId: string) => {
	const row = await db.query.user.findFirst({
		where: eq(user.id, userId),
		columns: { name: true },
	});
	return { type: "member", id: userId, label: row?.name ?? null };
};

export const membersService = {
	getRole: async (ctx: Ctx): Promise<string | null> => {
		const row = await db.query.member.findFirst({
			where: and(
				eq(member.organizationId, ctx.organizationId),
				eq(member.userId, ctx.userId),
			),
		});
		return row?.role ?? null;
	},

	/** Resolve better-auth's `memberIdOrEmail` (the removal endpoint accepts
	 *  either) to the person's user id, before the membership row disappears.
	 *  `team_lead_person` is keyed on user id, not member id, so the caller
	 *  needs this to clean up the person's lists once the removal itself has
	 *  gone through `auth.api.removeMember`. Null when neither matches — the
	 *  removal call itself is what reports that failure. */
	resolveUserId: async (
		ctx: Ctx,
		memberIdOrEmail: string,
	): Promise<string | null> => {
		const byId = await db.query.member.findFirst({
			where: and(
				eq(member.organizationId, ctx.organizationId),
				eq(member.id, memberIdOrEmail),
			),
			columns: { userId: true },
		});
		if (byId) return byId.userId;
		const byEmail = await db
			.select({ userId: member.userId })
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.where(
				and(
					eq(member.organizationId, ctx.organizationId),
					eq(user.email, memberIdOrEmail),
				),
			)
			.limit(1);
		return byEmail[0]?.userId ?? null;
	},

	/** Everyone in the org, as names and faces only.
	 *
	 *  This is what every avatar in the app resolves against, and it is one read
	 *  rather than an `image` column threaded through `PersonRow`, the close
	 *  sheet's rows, each report's rows and the project contributor list — nine
	 *  row types that would each have grown a field, and their tests with them,
	 *  to answer the same question. Every one of those rows already carries a
	 *  `userId`, so the join belongs on the client, once.
	 *
	 *  Readable by every member, unlike `list`: it is a directory, not a
	 *  personnel record. No email, no type, no role, no start date — nothing an
	 *  admin screen owns. Names are already visible to any member through
	 *  better-auth's own membership list, so this adds a photo and nothing
	 *  else. */
	directory: async (ctx: Ctx): Promise<DirectoryEntry[]> => {
		return db
			.select({
				userId: member.userId,
				name: user.name,
				image: user.image,
			})
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.where(eq(member.organizationId, ctx.organizationId))
			.orderBy(asc(user.name));
	},

	/** Every membership row, oldest first.
	 *
	 *  Not better-auth's `listMembers`: that reads the members with a limit and
	 *  then their users with none, so the adapter's default of 100 cuts the
	 *  users and it throws "User not found for member" in any org over 100
	 *  people. A Harvest import makes such an org in one go. */
	roster: async (ctx: Ctx): Promise<{ members: RosterMember[] }> => {
		const rows = await db
			.select({
				id: member.id,
				userId: member.userId,
				role: member.role,
				createdAt: member.createdAt,
				name: user.name,
				email: user.email,
				image: user.image,
			})
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.where(eq(member.organizationId, ctx.organizationId))
			.orderBy(asc(member.createdAt), asc(member.id));
		return {
			members: rows.map((r) => ({
				id: r.id,
				userId: r.userId,
				role: r.role,
				createdAt: r.createdAt,
				user: { id: r.userId, name: r.name, email: r.email, image: r.image },
			})),
		};
	},

	/** Every person in the org with their CURRENT type. For historical reporting
	 *  use `typesAsOf` instead — type changes are effective-dated precisely so a
	 *  past month reflects the type the person held then.
	 *
	 *  "Current" means the segment covering TODAY, not the open-ended one. Those
	 *  differ whenever a change is dated ahead: `setType` opens the future segment
	 *  immediately (it is the row `mth_current_uidx` allows), so joining on
	 *  `effectiveUntil is null` reported next month's type as though it already
	 *  applied — and this list is what the members screen draws. */
	list: async (ctx: Ctx): Promise<PersonRow[]> => {
		const today = dayKeyInTz(new Date(), await ctxTimezone(ctx));
		const rows = await db
			.select({
				userId: member.userId,
				name: user.name,
				email: user.email,
				emailVerified: user.emailVerified,
				orgRole: member.role,
				startDate: memberProfile.startDate,
				archivedAt: memberProfile.archivedAt,
				type: memberTypeHistory.type,
				expectedSecondsOverride: memberTypeHistory.expectedSecondsOverride,
			})
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.leftJoin(
				memberProfile,
				and(
					eq(memberProfile.organizationId, member.organizationId),
					eq(memberProfile.userId, member.userId),
				),
			)
			.leftJoin(
				memberTypeHistory,
				and(
					eq(memberTypeHistory.organizationId, member.organizationId),
					eq(memberTypeHistory.userId, member.userId),
					lte(memberTypeHistory.effectiveFrom, today),
					or(
						isNull(memberTypeHistory.effectiveUntil),
						gt(memberTypeHistory.effectiveUntil, today),
					),
				),
			)
			.where(eq(member.organizationId, ctx.organizationId))
			.orderBy(asc(user.name));

		// Only the unverified few need the account check; everyone who signed in
		// with Google is verified already.
		const unverified = rows
			.filter((r) => !r.emailVerified)
			.map((r) => r.userId);
		const signedIn = new Set(
			unverified.length === 0
				? []
				: (
						await db
							.selectDistinct({ userId: account.userId })
							.from(account)
							.where(inArray(account.userId, unverified))
					).map((a) => a.userId),
		);

		// One number per lead for the Members page; nobody else has a row.
		const leadRows = await db
			.select({ leadUserId: teamLeadPerson.leadUserId, people: count() })
			.from(teamLeadPerson)
			.where(eq(teamLeadPerson.organizationId, ctx.organizationId))
			.groupBy(teamLeadPerson.leadUserId);
		const leadsPeople = new Map(
			leadRows.map((r) => [r.leadUserId, Number(r.people)]),
		);

		return rows.map((r) => ({
			userId: r.userId,
			name: r.name,
			email: r.email,
			orgRole: r.orgRole,
			startDate: r.startDate ?? null,
			archivedAt: r.archivedAt ?? null,
			emailUnconfirmed: !r.emailVerified && !signedIn.has(r.userId),
			// A person with no history row yet is Billable — the default, and the
			// right one: delivery people are the common case.
			type: r.type ?? DEFAULT_TYPE.type,
			expectedSecondsOverride: r.expectedSecondsOverride ?? null,
			leadsPeople: leadsPeople.get(r.userId) ?? 0,
		}));
	},

	/** Resolve every person's type as it stood on `asOf` (yyyy-MM-dd). This is
	 *  what every report must use: the known real case is a contractor becoming
	 *  an employee, and a report for a past month has to reflect the type the
	 *  person held at that time, not today's. */
	typesAsOf: async (
		ctx: Ctx,
		asOf: string,
	): Promise<Map<string, ResolvedMemberType>> => {
		// `ctxDb`, not the ambient handle: callers may read this from inside a
		// transaction.
		const rows = await ctxDb(ctx)
			.select({
				userId: memberTypeHistory.userId,
				type: memberTypeHistory.type,
				expectedSecondsOverride: memberTypeHistory.expectedSecondsOverride,
			})
			.from(memberTypeHistory)
			.where(
				and(
					eq(memberTypeHistory.organizationId, ctx.organizationId),
					lte(memberTypeHistory.effectiveFrom, asOf),
					or(
						isNull(memberTypeHistory.effectiveUntil),
						gt(memberTypeHistory.effectiveUntil, asOf),
					),
				),
			)
			// `mth_no_overlap` guarantees at most one match per user, so the order
			// cannot change the answer on well-formed data. It is here for the data
			// that predates the trigger: an org that backdated a type before it
			// existed still holds overlapping rows, and without an ORDER BY the map
			// build resolves to whichever row the plan happened to emit last — so
			// Expected and the pace check answered differently for the
			// same month on the same data. Newest-segment-wins is at least a rule.
			.orderBy(asc(memberTypeHistory.effectiveFrom));

		return new Map(
			rows.map((r) => [
				r.userId,
				{
					type: r.type,
					expectedSecondsOverride: r.expectedSecondsOverride ?? null,
				},
			]),
		);
	},

	/** Same, for a calendar month. Resolved as of the LAST day of the month: a
	 *  person who converts mid-month is reported under the type they finished it
	 *  under, which matches how the month's reports are read. */
	typesForMonth: async (ctx: Ctx, year: number, month: number) =>
		membersService.typesAsOf(
			ctx,
			endOfMonthKey(`${year}-${String(month).padStart(2, "0")}-01`),
		),

	typeFor: async (
		ctx: Ctx,
		userId: string,
		asOf: string,
	): Promise<ResolvedMemberType> => {
		const all = await membersService.typesAsOf(ctx, asOf);
		return all.get(userId) ?? DEFAULT_TYPE;
	},

	/** Change a person's type from `effectiveFrom` onward, preserving history.
	 *  The new segment claims everything from that date on, so any existing
	 *  segment at or after it is replaced and one straddling it is truncated —
	 *  all in one transaction, which is what keeps both `mth_current_uidx` (at
	 *  most one open-ended row per person) and `mth_no_overlap` satisfiable.
	 *
	 *  Backdating is the case worth spelling out. It used to share a branch with
	 *  the no-op edit below, on `current.effectiveFrom >= input.effectiveFrom`,
	 *  and so answered a backdate by rewriting the current row's `effectiveFrom`
	 *  and nothing else. Moving "billable since June" back to March left the
	 *  contractor segment it came from still ending in June, so March, April and
	 *  May were covered twice and `typesAsOf` picked between them by plan order.
	 *  The months a person converted in are exactly the months somebody checks. */
	setType: async (ctx: Ctx, input: SetMemberTypeInput) => {
		await requireAdmin(ctx);
		await assertUserInOrg(ctx, input.userId);

		const { before, after } = await db.transaction(async (tx) => {
			const current = await tx.query.memberTypeHistory.findFirst({
				where: and(
					eq(memberTypeHistory.organizationId, ctx.organizationId),
					eq(memberTypeHistory.userId, input.userId),
					isNull(memberTypeHistory.effectiveUntil),
				),
			});

			// Re-stating the type from the SAME date is a no-op edit of the current
			// row, not a new historical segment — otherwise correcting a typo in the
			// override would litter the history with zero-length rows (which the
			// mth_range_valid CHECK rejects anyway). Same date only: a different one
			// is a real change of history and falls through.
			const next = {
				type: input.type,
				expectedSecondsOverride: input.expectedSecondsOverride ?? null,
			};
			if (current && current.effectiveFrom === input.effectiveFrom) {
				await tx
					.update(memberTypeHistory)
					.set({ ...next, updatedAt: new Date() })
					.where(eq(memberTypeHistory.id, current.id));
				return { before: current, after: next };
			}

			// Everything from `effectiveFrom` on is now the new type, so any segment
			// starting at or after it no longer describes anything. Deleting rather
			// than closing: a segment inside the new one is not history, it is a
			// statement that has been withdrawn.
			await tx
				.delete(memberTypeHistory)
				.where(
					and(
						eq(memberTypeHistory.organizationId, ctx.organizationId),
						eq(memberTypeHistory.userId, input.userId),
						gte(memberTypeHistory.effectiveFrom, input.effectiveFrom),
					),
				);

			// The one segment that can still straddle the new start ends there. This
			// covers the ordinary forward change (close the open row) and the
			// backdate (truncate whichever closed row the new date lands inside)
			// with the same predicate.
			await tx
				.update(memberTypeHistory)
				.set({ effectiveUntil: input.effectiveFrom, updatedAt: new Date() })
				.where(
					and(
						eq(memberTypeHistory.organizationId, ctx.organizationId),
						eq(memberTypeHistory.userId, input.userId),
						lt(memberTypeHistory.effectiveFrom, input.effectiveFrom),
						or(
							isNull(memberTypeHistory.effectiveUntil),
							gt(memberTypeHistory.effectiveUntil, input.effectiveFrom),
						),
					),
				);

			await tx.insert(memberTypeHistory).values({
				organizationId: ctx.organizationId,
				userId: input.userId,
				type: input.type,
				expectedSecondsOverride: input.expectedSecondsOverride ?? null,
				effectiveFrom: input.effectiveFrom,
			});
			return { before: current, after: next };
		});

		const changes = diffFields(before, after, [
			"type",
			"expectedSecondsOverride",
		]);
		if (changes) {
			await recordAudit(ctx, {
				kind: "member.type_changed",
				target: await memberTarget(input.userId),
				subjectUserId: input.userId,
				changes,
				details: { effectiveFrom: input.effectiveFrom },
			});
		}
	},

	/** The people who have left. Every forward-looking surface — compliance, the
	 *  Slack nudges behind it, the assignment picker — subtracts this set;
	 *  nothing historical does. */
	archivedUserIds: async (ctx: Ctx): Promise<Set<string>> => {
		const rows = await db
			.select({ userId: memberProfile.userId })
			.from(memberProfile)
			.where(
				and(
					eq(memberProfile.organizationId, ctx.organizationId),
					isNotNull(memberProfile.archivedAt),
				),
			);
		return new Set(rows.map((r) => r.userId));
	},

	/** When each archived person was archived. For the reports that must still
	 *  count a leaver in the months they worked: a set only says "archived", and
	 *  a history import makes every former employee archived from day one of
	 *  their own past. */
	archivedAtByUserId: async (ctx: Ctx): Promise<Map<string, Date>> => {
		const rows = await db
			.select({
				userId: memberProfile.userId,
				archivedAt: memberProfile.archivedAt,
			})
			.from(memberProfile)
			.where(
				and(
					eq(memberProfile.organizationId, ctx.organizationId),
					isNotNull(memberProfile.archivedAt),
				),
			);
		return new Map(
			rows.flatMap((r) => (r.archivedAt ? [[r.userId, r.archivedAt]] : [])),
		);
	},

	/** Archive or restore a person. Never a delete: their entries, close rows and
	 *  finalized months have to survive them leaving. */
	setArchived: async (ctx: Ctx, userId: string, archived: boolean) => {
		await requireAdmin(ctx);
		await assertUserInOrg(ctx, userId);
		// Archiving yourself would drop you out of the very lists you administer
		// while leaving you logged in — a state with no way back through the UI.
		if (archived && userId === ctx.userId) {
			throw new Error("You cannot archive yourself");
		}
		const target = await memberTarget(userId);
		const archivedAt = archived ? new Date() : null;
		await db
			.insert(memberProfile)
			.values({ organizationId: ctx.organizationId, userId, archivedAt })
			.onConflictDoUpdate({
				target: [memberProfile.organizationId, memberProfile.userId],
				set: { archivedAt, updatedAt: new Date() },
			});
		if (archived) {
			// An archived person is gone from every forward-looking surface; a
			// stale Team Lead list row is exactly the kind of thing that survives
			// an archive and comes back to life when the same person is restored
			// or a new person is invited into their old email.
			await teamLeadsService.removeFromAllLists(ctx, userId);
			await emitEvent(ctx, "member.archived", () =>
				memberWebhookPayload(ctx, userId),
			);
			await recordAudit(ctx, {
				kind: "member.archived",
				target,
				subjectUserId: userId,
			});
			return { emailConfirmed: false };
		}
		await recordAudit(ctx, {
			kind: "member.restored",
			target,
			subjectUserId: userId,
		});

		// Restoring a person who has never signed in is where an admin confirms
		// an address an import guessed. Silent when that is not allowed: the
		// restore itself is what was asked for.
		if (await whyEmailNotConfirmable(ctx, userId)) {
			return { emailConfirmed: false };
		}
		await markEmailVerified(userId);
		return { emailConfirmed: true };
	},

	/** Confirm the address of an ACTIVE person who has never signed in. The
	 *  same act as Restore on an archived one, for the person Restore never
	 *  reaches: an import made them active with an unconfirmed address, and
	 *  archiving them only to restore them was the one way to fix it. */
	confirmEmail: async (ctx: Ctx, userId: string) => {
		await requireAdmin(ctx);
		await assertUserInOrg(ctx, userId);
		const profile = await db.query.memberProfile.findFirst({
			where: and(
				eq(memberProfile.organizationId, ctx.organizationId),
				eq(memberProfile.userId, userId),
			),
			columns: { archivedAt: true },
		});
		if (profile?.archivedAt) {
			throw new Error("Restore this person instead: that confirms the address");
		}
		switch (await whyEmailNotConfirmable(ctx, userId)) {
			case "confirmed":
				throw new Error("This address is confirmed already");
			case "signed-in":
				throw new Error(
					"This person has signed in, so nothing is left to confirm",
				);
			case "elsewhere":
				throw new Error(
					"This person is in another organization too, so only they can confirm the address, by signing in",
				);
			case null:
				await markEmailVerified(userId);
				await recordAudit(ctx, {
					kind: "member.email_confirmed",
					target: await memberTarget(userId),
					subjectUserId: userId,
				});
				return { emailConfirmed: true };
		}
	},

	setStartDate: async (ctx: Ctx, userId: string, startDate: string | null) => {
		await requireAdmin(ctx);
		await assertUserInOrg(ctx, userId);
		const before = await db.query.memberProfile.findFirst({
			where: and(
				eq(memberProfile.organizationId, ctx.organizationId),
				eq(memberProfile.userId, userId),
			),
			columns: { startDate: true },
		});
		await db
			.insert(memberProfile)
			.values({ organizationId: ctx.organizationId, userId, startDate })
			.onConflictDoUpdate({
				target: [memberProfile.organizationId, memberProfile.userId],
				set: { startDate, updatedAt: new Date() },
			});
		const changes = diffFields(before, { startDate }, ["startDate"]);
		if (changes) {
			await recordAudit(ctx, {
				kind: "member.start_date_changed",
				target: await memberTarget(userId),
				subjectUserId: userId,
				changes,
			});
		}
	},

	/** Type history for one person, newest first — the audit trail behind
	 *  "why does last March say contractor?". */
	/**
	 * Record where an invitation's email stands. Called from better-auth's
	 * `sendInvitationEmail` hook, which has no Ctx — hence the explicit org, the
	 * same shape as `slackService.linkMember`. Never throws: the invitation
	 * already exists when this runs, and a status row that failed to write must
	 * not turn a real invitation into an error. Upserts, because sending an
	 * invitation again reuses its id.
	 */
	recordInvitationEmail: async (
		organizationId: string,
		invitationId: string,
		status: InvitationEmailStatus,
		error: string | null = null,
	): Promise<void> => {
		try {
			await db
				.insert(invitationEmail)
				.values({ invitationId, organizationId, status, error })
				.onConflictDoUpdate({
					target: invitationEmail.invitationId,
					set: { status, error, updatedAt: new Date() },
				});
		} catch (writeError) {
			console.error("[members] could not record invitation email", {
				invitationId,
				status,
				error: writeError,
			});
		}
	},

	/**
	 * The address and role of one of this org's pending invitations, for a
	 * resend. better-auth resends by address, not by id, so the id the list
	 * holds is turned back into what created the invitation. Null for an id that
	 * is not a pending invitation of this org — which is also what keeps another
	 * org's invitation out of reach.
	 */
	pendingInvitation: async (
		ctx: Ctx,
		invitationId: string,
	): Promise<{ email: string; role: InviteMemberInput["role"] } | null> => {
		await requireAdmin(ctx);
		const row = await db.query.invitation.findFirst({
			where: and(
				eq(invitation.id, invitationId),
				eq(invitation.organizationId, ctx.organizationId),
				eq(invitation.status, "pending"),
			),
			columns: { email: true, role: true },
		});
		if (!row) return null;
		// Narrowed to the roles an invitation can be made with here, because a
		// resend is a second `createInvitation` and better-auth types its role.
		// The column is plain text; anything but "admin" resends as a member,
		// which is also what an invitation with no role was made as.
		return {
			email: row.email,
			role: row.role === "admin" ? "admin" : "member",
		};
	},

	/**
	 * Delivery state per invitation id, for the pending-invitations list. A
	 * "sending" older than `INVITATION_EMAIL_STALE_MS` reads as failed — left as
	 * it is, the list would poll for it forever. `now` is a seam for tests.
	 */
	invitationEmails: async (
		ctx: Ctx,
		{ now = new Date() }: { now?: Date } = {},
	): Promise<Map<string, InvitationEmailState>> => {
		await requireAdmin(ctx);
		const rows = await db
			.select({
				invitationId: invitationEmail.invitationId,
				status: invitationEmail.status,
				error: invitationEmail.error,
				updatedAt: invitationEmail.updatedAt,
			})
			.from(invitationEmail)
			.where(eq(invitationEmail.organizationId, ctx.organizationId));
		return new Map(
			rows.map((r): [string, InvitationEmailState] => [
				r.invitationId,
				r.status === "sending" &&
				now.getTime() - r.updatedAt.getTime() > INVITATION_EMAIL_STALE_MS
					? { status: "failed", error: "The send did not finish." }
					: { status: r.status, error: r.error },
			]),
		);
	},

	typeHistory: async (ctx: Ctx, userId: string) => {
		await requireAdmin(ctx);
		return db.query.memberTypeHistory.findMany({
			where: and(
				eq(memberTypeHistory.organizationId, ctx.organizationId),
				eq(memberTypeHistory.userId, userId),
			),
			orderBy: asc(memberTypeHistory.effectiveFrom),
		});
	},
};
