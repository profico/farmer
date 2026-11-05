// The server half of the Harvest import (docs/domains/harvest-import.md).
//
// The browser parses the export and builds the plan (`lib/harvest/plan.ts`),
// because the time report is 45 MB and a server function should not hold it.
// This service only WRITES, and it trusts nothing it receives: every row names
// its person, project and task by source key, and the key resolves through
// `import_mapping`, which only `start` writes and only after it has checked
// each local id against the organization. So a chunk cannot put an entry on a
// project of another org, however it is built.
//
// A run is: `start` (the reference rows), `importDays` in chunks, optionally
// `removeDays`, then `finish` (the automation lock and the hour fund). `undo`
// takes back the latest run.

import { generateId } from "better-auth";
import {
	and,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lte,
	ne,
	notInArray,
	or,
	sql,
} from "drizzle-orm";

import { db } from "../db";
import {
	account,
	invitation,
	member,
	organization,
	user,
} from "../db/schema/auth";
import {
	client,
	project,
	projectMember,
	task,
	timeEntry,
} from "../db/schema/domain";
import {
	importMapping,
	importPendingPerson,
	importRun,
} from "../db/schema/import";
import { memberProfile, memberTypeHistory } from "../db/schema/people";
import type {
	HarvestFinishResult,
	HarvestImportDaysResult,
	HarvestMappingKind,
	HarvestSnapshot,
} from "../lib/harvest/contract";
import { DAY_DIGEST_LENGTH } from "../lib/harvest/keys";
import { placeholderEmail } from "../lib/import-placeholder";
import { findSingleOrg, isSingleOrgMode } from "../lib/single-org";
import { groupForTaskName } from "../lib/task-taxonomy";
import { addDaysToKey } from "../lib/time";
import type {
	HarvestClientPlan,
	HarvestEmailsInput,
	HarvestFinishInput,
	HarvestImportDaysInput,
	HarvestPersonPlan,
	HarvestProjectPlan,
	HarvestRemoveDaysInput,
	HarvestRunIdInput,
	HarvestSnapshotInput,
	HarvestStartInput,
	HarvestTaskPlan,
} from "../schema/harvest-import";
import { recordAudit } from "./audit";
import { shownEmail, shownName } from "./claim-name";
import { clientsService } from "./clients.service";
import { type DbClient, requireAdmin } from "./context";
import { emitEvent } from "./events";
import { hourFundService } from "./hour-fund.service";
import { orgSettingsService } from "./org-settings.service";
import type { Ctx } from "./types";

// PGLite (the tests) fails a statement with a few thousand bind parameters,
// and a production chunk is 5000 rows. 500 is the size the rest of the code
// base settled on.
const BATCH = 500;

const inBatches = <T>(items: readonly T[], size = BATCH): T[][] => {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(items.slice(i, i + size));
	}
	return out;
};

// An archived day is a date; `archivedAt` is a timestamp. Noon UTC lands on
// the same calendar day in every timezone an org can plausibly be in, and the
// utilization report reads the day back in the org timezone.
const dayToTimestamp = (day: string) => new Date(`${day}T12:00:00Z`);

const normEmail = (email: string) => email.trim().toLowerCase();

const assertUniqueKeys = (
	kind: string,
	items: readonly { sourceKey: string }[],
) => {
	const seen = new Set<string>();
	for (const item of items) {
		if (seen.has(item.sourceKey)) {
			throw new Error(`The plan names the ${kind} "${item.sourceKey}" twice`);
		}
		seen.add(item.sourceKey);
	}
};

/** Source key to local id for one kind, from every run that was not undone
 *  (undo deletes its run's mappings). `keys` narrows the read. */
const mappingsFor = async (
	client_: DbClient,
	ctx: Ctx,
	kind: HarvestMappingKind,
	keys?: readonly string[],
): Promise<Map<string, string>> => {
	const out = new Map<string, string>();
	const batches = keys ? inBatches(keys) : [undefined];
	for (const batch of batches) {
		if (batch && batch.length === 0) continue;
		const rows = await client_
			.select({
				sourceKey: importMapping.sourceKey,
				localId: importMapping.localId,
			})
			.from(importMapping)
			.where(
				and(
					eq(importMapping.organizationId, ctx.organizationId),
					eq(importMapping.kind, kind),
					batch ? inArray(importMapping.sourceKey, batch) : undefined,
				),
			);
		for (const r of rows) out.set(r.sourceKey, r.localId);
	}
	return out;
};

/** Resolves every key or fails naming the first one that has no mapping —
 *  a chunk that names something `start` never created. */
const resolveAll = async (
	tx: DbClient,
	ctx: Ctx,
	kind: HarvestMappingKind,
	keys: Iterable<string>,
): Promise<Map<string, string>> => {
	const wanted = [...new Set(keys)];
	const found = await mappingsFor(tx, ctx, kind, wanted);
	for (const key of wanted) {
		if (!found.has(key)) {
			throw new Error(
				`The import does not know the ${kind} "${key}". Start the import again.`,
			);
		}
	}
	return found;
};

const loadRun = async (ctx: Ctx, runId: string) => {
	const run = await db.query.importRun.findFirst({
		where: and(
			eq(importRun.id, runId),
			eq(importRun.organizationId, ctx.organizationId),
		),
	});
	if (!run) throw new Error("Import run not found");
	return run;
};

const loadStartedRun = async (ctx: Ctx, runId: string) => {
	const run = await loadRun(ctx, runId);
	if (run.status !== "started") {
		throw new Error(`This import is ${run.status} and takes no more data`);
	}
	return run;
};

/** The addresses in `emails` that belong to a user who is not a member of
 *  this org. Lower case.
 *
 *  Only the one organization of a single-org instance gets an answer. Every
 *  other caller administers one workspace among many, and the `user` table
 *  holds the other workspaces' people too: answering for 500 addresses a call
 *  says which of them have an account on the deployment. Such a caller gets
 *  nothing here; the snapshot's `members` covers its own people, and `start`
 *  still refuses a guessed or typed address that another user holds. */
const takenEmailsFor = async (
	ctx: Ctx,
	emails: readonly string[],
): Promise<string[]> => {
	const singleOrg = await findSingleOrg();
	if (singleOrg?.id !== ctx.organizationId) return [];
	const wanted = [...new Set(emails.map(normEmail))];
	const out: string[] = [];
	for (const batch of inBatches(wanted)) {
		const rows = await db
			.select({ email: sql<string>`lower(${user.email})` })
			.from(user)
			.where(
				and(
					inArray(sql`lower(${user.email})`, batch),
					sql`not exists (select 1 from ${member} where ${member.userId} = ${user.id} and ${member.organizationId} = ${ctx.organizationId})`,
				),
			);
		for (const r of rows) out.push(r.email);
	}
	return out;
};

/** The users among `ids` who have signed in at least once (an `account`
 *  row). A separate query, not a correlated `exists` in a select field:
 *  drizzle writes a column there without its table name, so `user.id`
 *  inside the subquery would bind to `account.id`. */
const usersWithAccount = async (
	client_: DbClient,
	ids: readonly string[],
): Promise<Set<string>> => {
	const out = new Set<string>();
	for (const batch of inBatches([...new Set(ids)])) {
		const rows = await client_
			.selectDistinct({ userId: account.userId })
			.from(account)
			.where(inArray(account.userId, batch));
		for (const r of rows) out.add(r.userId);
	}
	return out;
};

/** Whether `userId` accepted the claim that `start` set in `org`. Multi-org
 *  `start` writes `claimName` with the claim and nothing clears it. A person
 *  who declined has no `member` row, and is not an accepted claim. */
const acceptedClaim = async (
	tx: DbClient,
	org: string,
	userId: string,
): Promise<boolean> => {
	const [row] = await tx
		.select({ id: memberProfile.id })
		.from(memberProfile)
		.innerJoin(
			member,
			and(
				eq(member.organizationId, memberProfile.organizationId),
				eq(member.userId, memberProfile.userId),
			),
		)
		.where(
			and(
				eq(memberProfile.organizationId, org),
				eq(memberProfile.userId, userId),
				isNotNull(memberProfile.claimName),
				isNull(memberProfile.claimPendingSince),
			),
		)
		.limit(1);
	return row !== undefined;
};

/** Whether `userId` has a row in an organization other than `org`. A foreign
 *  key from each of these tables to `user` cascades, so deleting the user row
 *  would delete that other organization's data. Invitations are read by
 *  address: they hold no user id. */
const heldElsewhere = async (
	tx: DbClient,
	org: string,
	userId: string,
): Promise<boolean> => {
	const [row] = await tx
		.select({
			held: sql<boolean>`(
				exists (select 1 from ${member} where ${member.userId} = ${userId} and ${member.organizationId} <> ${org})
				or exists (select 1 from ${memberProfile} where ${memberProfile.userId} = ${userId} and ${memberProfile.organizationId} <> ${org})
				or exists (select 1 from ${timeEntry} where ${timeEntry.userId} = ${userId} and ${timeEntry.organizationId} <> ${org})
				or exists (select 1 from ${projectMember} where ${projectMember.userId} = ${userId} and ${projectMember.organizationId} <> ${org})
				or exists (select 1 from ${importMapping} where ${importMapping.kind} = 'person' and ${importMapping.localId} = ${userId} and ${importMapping.organizationId} <> ${org})
				or exists (select 1 from ${invitation} where lower(${invitation.email}) = (select lower(${user.email}) from ${user} where ${user.id} = ${userId}) and ${invitation.organizationId} <> ${org})
			)`,
		})
		.from(user)
		.where(eq(user.id, userId));
	return row?.held === true;
};

/**
 * The people an earlier run of this org invited and who have not joined yet:
 * a person mapping to a user with no membership here, and a pending
 * invitation of this org to that user's address. Only a run from before the
 * claim change wrote such an invitation: `start` now attaches the user with a
 * pending claim. Until they accept, that older person is a mapped person
 * with no `member` row. A second run matches them, as it
 * matches a member, rather than calling them gone. Only people this org's own
 * import mapped are read, so this says nothing about any other address.
 */
const invitedPeople = async (client_: DbClient, org: string) =>
	client_
		.selectDistinctOn([user.id], {
			userId: user.id,
			name: shownName(org),
			email: user.email,
			role: invitation.role,
			archivedAt: memberProfile.archivedAt,
			startDate: memberProfile.startDate,
		})
		.from(importMapping)
		.innerJoin(user, eq(user.id, importMapping.localId))
		.innerJoin(
			invitation,
			and(
				eq(invitation.organizationId, org),
				eq(invitation.status, "pending"),
				sql`lower(${invitation.email}) = lower(${user.email})`,
			),
		)
		.leftJoin(
			memberProfile,
			and(
				eq(memberProfile.organizationId, org),
				eq(memberProfile.userId, user.id),
			),
		)
		.where(
			and(
				eq(importMapping.organizationId, org),
				eq(importMapping.kind, "person"),
				sql`not exists (select 1 from ${member} where ${member.organizationId} = ${org} and ${member.userId} = ${user.id})`,
			),
		);

type ExistingDay = {
	ids: string[];
	keys: Set<string>;
	edited: boolean;
};

/** The imported rows of the given person-days, grouped `userId|date`. */
const importedRowsFor = async (
	tx: DbClient,
	ctx: Ctx,
	days: readonly { userId: string; date: string }[],
): Promise<Map<string, ExistingDay>> => {
	const out = new Map<string, ExistingDay>();
	if (days.length === 0) return out;
	const wanted = new Set(days.map((d) => `${d.userId}|${d.date}`));
	const userIds = [...new Set(days.map((d) => d.userId))];
	const dates = days.map((d) => d.date).sort();
	const from = dates[0];
	const to = dates[dates.length - 1];
	if (from === undefined || to === undefined) return out;

	for (const batch of inBatches(userIds)) {
		const rows = await tx
			.select({
				id: timeEntry.id,
				userId: timeEntry.userId,
				date: timeEntry.date,
				importKey: timeEntry.importKey,
				edited: sql<boolean>`${timeEntry.updatedAt} > ${timeEntry.createdAt}`,
			})
			.from(timeEntry)
			.where(
				and(
					eq(timeEntry.organizationId, ctx.organizationId),
					isNotNull(timeEntry.importKey),
					inArray(timeEntry.userId, batch),
					gte(timeEntry.date, from),
					lte(timeEntry.date, to),
				),
			);
		for (const r of rows) {
			const dayKey = `${r.userId}|${r.date}`;
			if (!wanted.has(dayKey) || r.importKey == null) continue;
			let day = out.get(dayKey);
			if (!day) {
				day = { ids: [], keys: new Set(), edited: false };
				out.set(dayKey, day);
			}
			day.ids.push(r.id);
			day.keys.add(r.importKey);
			if (r.edited) day.edited = true;
		}
	}
	return out;
};

type StartCounts = {
	clients: number;
	tasks: number;
	people: number;
	/** Existing users invited rather than added: see `start`. */
	invited: number;
	projects: number;
};

/** What `start` did for a run, read back from its mappings — the answer a
 *  repeated `start` gives, since the first one's answer was lost. A person the
 *  run mapped as created and holds an `invitation` mapping for is one it invited. */
const startResult = async (
	runId: string,
	org: string,
): Promise<{ created: StartCounts; invited: string[] }> => {
	const rows = await db
		.select({
			kind: importMapping.kind,
			count: sql<number>`count(*)`.mapWith(Number),
		})
		.from(importMapping)
		.where(and(eq(importMapping.runId, runId), eq(importMapping.created, true)))
		.groupBy(importMapping.kind);
	const of = (kind: HarvestMappingKind) =>
		rows.find((r) => r.kind === kind)?.count ?? 0;
	// From the invitations the run recorded, not from a missing `member` row:
	// a person who accepted between two calls has one now, and would be counted
	// as created. `created` is left out of the filter on purpose, so an
	// invitation the org sent before the run counts as well.
	const invited = await db
		.select({ email: invitation.email })
		.from(importMapping)
		.innerJoin(invitation, eq(invitation.id, importMapping.localId))
		.where(
			and(
				eq(importMapping.runId, runId),
				eq(importMapping.kind, "invitation"),
				eq(importMapping.organizationId, org),
			),
		);
	return {
		created: {
			clients: of("client"),
			tasks: of("task"),
			people: Math.max(0, of("person") - invited.length),
			invited: invited.length,
			projects: of("project"),
		},
		invited: invited.map((r) => r.email),
	};
};

const sameKeys = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
	a.size === b.size && [...a].every((k) => b.has(k));

const deleteEntries = async (tx: DbClient, ids: readonly string[]) => {
	for (const batch of inBatches(ids)) {
		await tx.delete(timeEntry).where(inArray(timeEntry.id, batch));
	}
};

/** A user `start` makes a member at once (single-org mode). */
type DirectMember = { userId: string; name: string; role: string };

type PersonMatchPlan = Extract<HarvestPersonPlan, { action: "match" }>;
type PersonCreatePlan = Extract<HarvestPersonPlan, { action: "create" }>;

/** What the steps of the `start` transaction share. Every write goes
 *  through `tx`. */
type StartTx = {
	tx: DbClient;
	ctx: Ctx;
	org: string;
	runId: string;
	multiOrg: boolean;
	counts: StartCounts;
	directMembers: DirectMember[];
};

const remember = async (
	st: StartTx,
	kind: HarvestMappingKind,
	sourceKey: string,
	localId: string,
	created: boolean,
) => {
	// An earlier run's mapping wins: it records who created the row,
	// and that run's undo is the one that may remove it.
	await st.tx
		.insert(importMapping)
		.values({
			organizationId: st.org,
			runId: st.runId,
			kind,
			sourceKey,
			localId,
			created,
		})
		.onConflictDoNothing();
};

// A `create` for a key an earlier run already mapped means the
// browser planned against an old snapshot. Refuse rather than make a
// second copy of the row.
const assertNotMapped = (
	kind: HarvestMappingKind,
	known: ReadonlyMap<string, string>,
	item: { action: string; sourceKey: string },
) => {
	if (item.action === "create" && known.has(item.sourceKey)) {
		throw new Error(
			`The ${kind} "${item.sourceKey}" was imported before. Reload the files and try again.`,
		);
	}
};

const startClients = async (
	st: StartTx,
	clients: readonly HarvestClientPlan[],
	orgRow: { name: string } | undefined,
): Promise<Map<string, string>> => {
	const { tx, ctx, org } = st;
	const knownClients = await mappingsFor(tx, ctx, "client");
	const clientIds = new Map(knownClients);
	const matchClientIds = clients.flatMap((c) =>
		c.action === "match" ? [c.localId] : [],
	);
	const orgClientIds = new Set<string>();
	for (const batch of inBatches(matchClientIds)) {
		const rows = await tx
			.select({ id: client.id })
			.from(client)
			.where(and(eq(client.organizationId, org), inArray(client.id, batch)));
		for (const r of rows) orgClientIds.add(r.id);
	}
	let internalId: string | null = null;
	for (const c of clients) {
		assertNotMapped("client", knownClients, c);
		if (c.action === "match") {
			if (!orgClientIds.has(c.localId)) {
				throw new Error(`Client "${c.sourceKey}" matches no client here`);
			}
			clientIds.set(c.sourceKey, c.localId);
			await remember(st, "client", c.sourceKey, c.localId, false);
		} else if (c.action === "internal") {
			internalId ??= await clientsService.ensureInternal(ctx, orgRow?.name, tx);
			clientIds.set(c.sourceKey, internalId);
			await remember(st, "client", c.sourceKey, internalId, false);
		} else {
			const [row] = await tx
				.insert(client)
				.values({
					organizationId: org,
					name: c.name,
					archivedAt: c.archived ? new Date() : null,
				})
				.returning({ id: client.id });
			if (!row) throw new Error(`Failed to create client "${c.name}"`);
			clientIds.set(c.sourceKey, row.id);
			await remember(st, "client", c.sourceKey, row.id, true);
			st.counts.clients++;
		}
	}
	return clientIds;
};

/** Refuses a created task that takes the name of a live task of the org. */
const assertNoTaskNameClash = async (
	st: StartTx,
	tasks: readonly HarvestTaskPlan[],
) => {
	const createNames = tasks.flatMap((t) =>
		t.action === "create" && !t.archived ? [t.name] : [],
	);
	for (const batch of inBatches(createNames)) {
		const clash = await st.tx
			.select({ name: task.name })
			.from(task)
			.where(
				and(
					eq(task.organizationId, st.org),
					eq(task.scope, "organization"),
					isNull(task.archivedAt),
					inArray(task.name, batch),
				),
			)
			.limit(1);
		if (clash[0]) {
			throw new Error(
				`A task named "${clash[0].name}" exists already. Match it instead.`,
			);
		}
	}
};

const startTasks = async (st: StartTx, tasks: readonly HarvestTaskPlan[]) => {
	const { tx, ctx, org } = st;
	const knownTasks = await mappingsFor(tx, ctx, "task");
	const usableTasks = new Set<string>();
	const matchTaskIds = tasks.flatMap((t) =>
		t.action === "match" ? [t.localId] : [],
	);
	for (const batch of inBatches(matchTaskIds)) {
		const rows = await tx
			.select({ id: task.id })
			.from(task)
			.where(
				and(
					inArray(task.id, batch),
					or(eq(task.organizationId, org), eq(task.scope, "site")),
				),
			);
		for (const r of rows) usableTasks.add(r.id);
	}
	await assertNoTaskNameClash(st, tasks);
	for (const t of tasks) {
		assertNotMapped("task", knownTasks, t);
		if (t.action === "match") {
			if (!usableTasks.has(t.localId)) {
				throw new Error(`Task "${t.sourceKey}" matches no task here`);
			}
			await remember(st, "task", t.sourceKey, t.localId, false);
		} else {
			const [row] = await tx
				.insert(task)
				.values({
					scope: "organization",
					organizationId: org,
					name: t.name,
					group: groupForTaskName(t.name) ?? "general",
					archivedAt: t.archived ? new Date() : null,
				})
				.returning({ id: task.id });
			if (!row) throw new Error(`Failed to create task "${t.name}"`);
			await remember(st, "task", t.sourceKey, row.id, true);
			st.counts.tasks++;
		}
	}
};

/** The users a `match` may name: the org's members among `people`, and the
 *  people an earlier run invited who have not joined yet. */
const matchablePeople = async (
	st: StartTx,
	people: readonly HarvestPersonPlan[],
): Promise<Set<string>> => {
	const matchUserIds = people.flatMap((p) =>
		p.action === "match" ? [p.localId] : [],
	);
	const memberIds = new Set<string>();
	for (const batch of inBatches(matchUserIds)) {
		const rows = await st.tx
			.select({ userId: member.userId })
			.from(member)
			.where(
				and(eq(member.organizationId, st.org), inArray(member.userId, batch)),
			);
		for (const r of rows) memberIds.add(r.userId);
	}
	for (const r of await invitedPeople(st.tx, st.org)) memberIds.add(r.userId);
	return memberIds;
};

const startMatchedPerson = async (
	st: StartTx,
	p: PersonMatchPlan,
	memberIds: ReadonlySet<string>,
) => {
	if (!memberIds.has(p.localId)) {
		throw new Error(
			`Person "${p.sourceKey}" matches no member or invited person here`,
		);
	}
	if (p.startDate) {
		await st.tx
			.insert(memberProfile)
			.values({
				organizationId: st.org,
				userId: p.localId,
				startDate: p.startDate,
			})
			.onConflictDoUpdate({
				target: [memberProfile.organizationId, memberProfile.userId],
				set: {
					startDate: sql`coalesce(${memberProfile.startDate}, excluded.start_date)`,
				},
			});
	}
	await remember(st, "person", p.sourceKey, p.localId, false);
};

/** With several organizations, the user for an address that has no account.
 *  Never a row that holds the address: an unverified row for it would refuse
 *  the owner's first OAuth sign-in (issue #162), and the flag that says
 *  "verified" comes from the browser. The row is a placeholder, and the
 *  owner claims the history later (`import-claims.service.ts`). A placeholder
 *  this org made earlier is reused, so a second import (or a person who
 *  declined) does not make a second one. */
const resolvePlaceholder = async (
	st: StartTx,
	p: PersonCreatePlan,
	email: string,
): Promise<string> => {
	const { tx, org } = st;
	const [pending] = await tx
		.select({ userId: importPendingPerson.userId })
		.from(importPendingPerson)
		.where(
			and(
				eq(importPendingPerson.organizationId, org),
				eq(importPendingPerson.email, email),
			),
		)
		.limit(1);
	if (pending) {
		const [membership] = await tx
			.select({ id: member.id })
			.from(member)
			.where(
				and(eq(member.organizationId, org), eq(member.userId, pending.userId)),
			)
			.limit(1);
		if (membership) {
			throw new Error(
				`${email} is a member already. Match the person instead.`,
			);
		}
		await tx
			.update(importPendingPerson)
			.set({ declinedAt: null, updatedAt: new Date() })
			.where(eq(importPendingPerson.userId, pending.userId));
		return pending.userId;
	}
	const userId = generateId();
	await tx
		.insert(user)
		.values({ id: userId, name: p.name, email: placeholderEmail(userId) });
	await tx
		.insert(importPendingPerson)
		.values({ userId, organizationId: org, email });
	return userId;
};

/** The user a created person maps to: a user that holds the address, or a
 *  new one. */
const resolveImportUser = async (
	st: StartTx,
	p: PersonCreatePlan,
	email: string,
): Promise<string> => {
	const { tx, org } = st;
	const [found] = await tx
		.select({ id: user.id })
		.from(user)
		.where(sql`lower(${user.email}) = ${email}`)
		.limit(1);
	if (!found) {
		if (st.multiOrg) return resolvePlaceholder(st, p, email);
		// Single-org mode: the instance owner controls every user and invites
		// the people who sign in, so the address is safe to hold.
		const userId = generateId();
		await tx.insert(user).values({
			id: userId,
			name: p.name,
			email,
			emailVerified: p.emailConfirmed,
		});
		return userId;
	}
	const membership = await tx
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, org), eq(member.userId, found.id)))
		.limit(1);
	if (membership[0]) {
		throw new Error(`${email} is a member already. Match the person instead.`);
	}
	// Single-org mode only. With several organizations no answer may
	// depend on `found`, or an admin could probe which addresses
	// have an account.
	if (!st.multiOrg && !p.emailListed) {
		throw new Error(
			`The ${p.emailConfirmed ? "typed" : "guessed"} address ${email} belongs to another user. Change it.`,
		);
	}
	// The admin typed the address, which is not the person's consent.
	// With several organizations the membership waits for a claim
	// (`claimPendingSince` below). Single-org mode attaches directly.
	// Undo tells an attached user from a made one by the row's age.
	return found.id;
};

const writeProfileAndType = async (
	st: StartTx,
	p: PersonCreatePlan,
	userId: string,
) => {
	const { tx, org } = st;
	const archivedAt = p.archivedOn ? dayToTimestamp(p.archivedOn) : null;
	// With several organizations, a made or found user alike must
	// accept before they use the org (`import-claims.service.ts`). An
	// admin cannot make a stranger a member by importing an address.
	const claimPendingSince = st.multiOrg ? new Date() : null;
	await tx
		.insert(memberProfile)
		.values({
			organizationId: org,
			userId,
			startDate: p.startDate,
			archivedAt,
			claimPendingSince,
			claimName: claimPendingSince ? p.name : null,
		})
		.onConflictDoUpdate({
			target: [memberProfile.organizationId, memberProfile.userId],
			// A profile that survived a decline or a removal gets a new
			// claim too, or the new member row joins without consent.
			set: {
				startDate: p.startDate,
				archivedAt,
				updatedAt: new Date(),
				// Single-org mode keeps the stored claim fields.
				claimPendingSince:
					claimPendingSince ?? sql`${memberProfile.claimPendingSince}`,
				claimName: claimPendingSince ? p.name : sql`${memberProfile.claimName}`,
			},
		});
	const hasType = await tx
		.select({ id: memberTypeHistory.id })
		.from(memberTypeHistory)
		.where(
			and(
				eq(memberTypeHistory.organizationId, org),
				eq(memberTypeHistory.userId, userId),
			),
		)
		.limit(1);
	if (!hasType[0]) {
		await tx.insert(memberTypeHistory).values({
			organizationId: org,
			userId,
			type: p.type,
			effectiveFrom: p.startDate,
		});
	}
};

const startCreatedPerson = async (
	st: StartTx,
	p: PersonCreatePlan,
): Promise<string> => {
	const email = normEmail(p.email);
	const userId = await resolveImportUser(st, p, email);
	await st.tx.insert(member).values({
		id: generateId(),
		organizationId: st.org,
		userId,
		role: p.role,
		createdAt: new Date(),
	});
	if (!st.multiOrg)
		st.directMembers.push({ userId, name: p.name, role: p.role });
	await writeProfileAndType(st, p, userId);
	await remember(st, "person", p.sourceKey, userId, true);
	st.counts.people++;
	return userId;
};

const startPeople = async (
	st: StartTx,
	people: readonly HarvestPersonPlan[],
): Promise<{
	personIds: Map<string, string>;
	knownPeople: Map<string, string>;
}> => {
	const knownPeople = await mappingsFor(st.tx, st.ctx, "person");
	const personIds = new Map(knownPeople);
	const memberIds = await matchablePeople(st, people);
	for (const p of people) {
		// After every person it can point at: see `startAliases`.
		if (p.action === "alias") continue;
		assertNotMapped("person", knownPeople, p);
		if (p.action === "match") {
			personIds.set(p.sourceKey, p.localId);
			await startMatchedPerson(st, p, memberIds);
		} else {
			personIds.set(p.sourceKey, await startCreatedPerson(st, p));
		}
	}
	return { personIds, knownPeople };
};

// A second spelling of a person: map it to that person's user. Not
// `created`, so undo removes only the mapping, with the run.
const startAliases = async (
	st: StartTx,
	people: readonly HarvestPersonPlan[],
	personIds: Map<string, string>,
	knownPeople: ReadonlyMap<string, string>,
) => {
	for (const p of people) {
		if (p.action !== "alias") continue;
		const localId = personIds.get(p.of);
		if (!localId) {
			throw new Error(
				`Person "${p.sourceKey}" is the same as "${p.of}", which the plan does not have`,
			);
		}
		const known = knownPeople.get(p.sourceKey);
		if (known !== undefined && known !== localId) {
			throw new Error(
				`"${p.sourceKey}" and "${p.of}" were imported before as different people`,
			);
		}
		personIds.set(p.sourceKey, localId);
		await remember(st, "person", p.sourceKey, localId, false);
	}
};

const startProjects = async (
	st: StartTx,
	projects: readonly HarvestProjectPlan[],
	clientIds: ReadonlyMap<string, string>,
): Promise<Map<string, string>> => {
	const { tx, ctx, org } = st;
	const knownProjects = await mappingsFor(tx, ctx, "project");
	const projectIds = new Map(knownProjects);
	const matchProjectIds = projects.flatMap((p) =>
		p.action === "match" ? [p.localId] : [],
	);
	const orgProjectIds = new Set<string>();
	for (const batch of inBatches(matchProjectIds)) {
		const rows = await tx
			.select({ id: project.id })
			.from(project)
			.where(and(eq(project.organizationId, org), inArray(project.id, batch)));
		for (const r of rows) orgProjectIds.add(r.id);
	}
	for (const p of projects) {
		assertNotMapped("project", knownProjects, p);
		if (p.action === "match") {
			if (!orgProjectIds.has(p.localId)) {
				throw new Error(`Project "${p.sourceKey}" matches no project here`);
			}
			// The import is the source of truth for the active set (the
			// projects worked on in the month before the cutoff), so a match
			// sets the status the way a create does.
			await tx
				.update(project)
				.set({
					status: p.archived ? "archived" : "active",
					updatedAt: new Date(),
				})
				.where(eq(project.id, p.localId));
			projectIds.set(p.sourceKey, p.localId);
			await remember(st, "project", p.sourceKey, p.localId, false);
			continue;
		}
		const clientId = clientIds.get(p.clientSourceKey);
		if (!clientId) {
			throw new Error(
				`Project "${p.name}" names the client "${p.clientSourceKey}", which the plan does not have`,
			);
		}
		const [row] = await tx
			.insert(project)
			.values({
				organizationId: org,
				clientId,
				name: p.name,
				code: p.code,
				type: p.type,
				status: p.archived ? "archived" : "active",
				// The only budget anything computes against, and only on a
				// fixed-scope project (see `createProjectInput`).
				budgetSeconds: p.type === "fixed_scope" ? p.budgetSeconds : null,
			})
			.returning({ id: project.id });
		if (!row) throw new Error(`Failed to create project "${p.name}"`);
		projectIds.set(p.sourceKey, row.id);
		await remember(st, "project", p.sourceKey, row.id, true);
		st.counts.projects++;
	}
	return projectIds;
};

const lookupKey = (
	map: ReadonlyMap<string, string>,
	kind: string,
	key: string,
) => {
	const id = map.get(key);
	if (!id) throw new Error(`The plan names an unknown ${kind} "${key}"`);
	return id;
};

const startAssignments = async (
	st: StartTx,
	projectMembers: HarvestStartInput["projectMembers"],
	projectIds: ReadonlyMap<string, string>,
	personIds: ReadonlyMap<string, string>,
) => {
	const memberRows = projectMembers.map((pm) => ({
		organizationId: st.org,
		projectId: lookupKey(projectIds, "project", pm.projectSourceKey),
		userId: lookupKey(personIds, "person", pm.personSourceKey),
		active: pm.active,
	}));
	for (const batch of inBatches(memberRows)) {
		await st.tx.insert(projectMember).values(batch).onConflictDoNothing();
	}
};

/** The rows a run created, by kind, and the invitations it relied on. */
type RunMappings = {
	userIds: string[];
	projectIds: string[];
	taskIds: string[];
	clientIds: string[];
	/** Every invitation the run relied on: they tell who it invited. */
	runInvitationIds: string[];
	/** Only the invitations the run wrote: the run's to cancel. */
	ownInvitationIds: string[];
};

const loadRunMappings = async (
	tx: DbClient,
	runId: string,
): Promise<RunMappings> => {
	const mappings = await tx
		.select({
			kind: importMapping.kind,
			localId: importMapping.localId,
			created: importMapping.created,
		})
		.from(importMapping)
		.where(eq(importMapping.runId, runId));
	const created = mappings.filter((m) => m.created);
	const of = (kind: HarvestMappingKind) =>
		created.filter((m) => m.kind === kind).map((m) => m.localId);
	return {
		userIds: of("person"),
		projectIds: of("project"),
		taskIds: of("task"),
		clientIds: of("client"),
		runInvitationIds: mappings
			.filter((m) => m.kind === "invitation")
			.map((m) => m.localId),
		ownInvitationIds: of("invitation"),
	};
};

/** The time a run started, as a subquery. */
const runCreatedAt = (runId: string) =>
	sql`(select ${importRun.createdAt} from ${importRun} where ${importRun.id} = ${runId})`;

// Made by this run, or only attached to it? Both rows took `now()`
// from the one transaction in `start`, so an attached user is the
// one whose row is older than the run. Compared in SQL: the user's
// column has no time zone, and Postgres converts it the same way it
// stored `now()` into it.
const findMadeUsers = async (
	tx: DbClient,
	runId: string,
	userIds: readonly string[],
): Promise<Set<string>> => {
	const madeUsers = new Set<string>();
	const signedIn = await usersWithAccount(tx, userIds);
	for (const batch of inBatches(userIds)) {
		const rows = await tx
			.select({ id: user.id, name: user.name })
			.from(user)
			.where(
				and(
					inArray(user.id, batch),
					sql`${user.createdAt} >= ${runCreatedAt(runId)}`,
				),
			);
		for (const r of rows) {
			if (signedIn.has(r.id)) {
				throw new Error(
					`${r.name} has signed in since the import. Archive them instead.`,
				);
			}
			madeUsers.add(r.id);
		}
	}
	return madeUsers;
};

/** Refuses while an entry made here, not by this run, uses a created row. */
const assertCreatedRowsUnused = async (
	tx: DbClient,
	org: string,
	runId: string,
	ids: RunMappings,
) => {
	const { projectIds, taskIds, userIds } = ids;
	const refs = [
		projectIds.length > 0 ? inArray(timeEntry.projectId, projectIds) : null,
		taskIds.length > 0 ? inArray(timeEntry.taskId, taskIds) : null,
		userIds.length > 0 ? inArray(timeEntry.userId, userIds) : null,
	].filter((c) => c != null);
	if (refs.length === 0) return;
	const used = await tx
		.select({ date: timeEntry.date })
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, org),
				or(isNull(timeEntry.importRunId), ne(timeEntry.importRunId, runId)),
				or(...refs),
			),
		)
		.limit(1);
	if (used[0]) {
		throw new Error(
			`An entry made here on ${used[0].date} uses a row this import created`,
		);
	}
};

const deleteCreatedRows = async (tx: DbClient, ids: RunMappings) => {
	for (const batch of inBatches(ids.projectIds)) {
		await tx.delete(project).where(inArray(project.id, batch));
	}
	for (const batch of inBatches(ids.clientIds)) {
		await tx.delete(client).where(inArray(client.id, batch));
	}
	for (const batch of inBatches(ids.taskIds)) {
		await tx.delete(task).where(inArray(task.id, batch));
	}
};

/**
 * An invited user: cancel the invitation the run sent, unless the
 * person has joined. Then they are a member who chose to join, and
 * their membership, profile and assignments are theirs now; only
 * the run's entries and mappings go. The run's invitations are the
 * ones `start` recorded, by id: a pending one the People page sent
 * the same address later is not the run's to cancel. A run from
 * before those were recorded has none, and falls back to the
 * address and the time of the run.
 *
 * "joined" tells the caller to keep the person's rows.
 */
const cancelRunInvitation = async (
	tx: DbClient,
	org: string,
	runId: string,
	userId: string,
	ids: RunMappings,
): Promise<"joined" | "done"> => {
	const { runInvitationIds, ownInvitationIds } = ids;
	const [person] = await tx
		.select({ email: user.email })
		.from(user)
		.where(eq(user.id, userId));
	if (!person) return "done";
	const byAddress = and(
		eq(invitation.organizationId, org),
		sql`lower(${invitation.email}) = lower(${person.email})`,
	);
	const legacy = runInvitationIds.length === 0;
	const invitedByRun = legacy
		? and(byAddress, sql`${invitation.createdAt} >= ${runCreatedAt(runId)}`)
		: and(byAddress, inArray(invitation.id, runInvitationIds));
	const [invited] = await tx
		.select({ id: invitation.id })
		.from(invitation)
		.where(invitedByRun)
		.limit(1);
	if (!invited) return "done";
	// `start` refuses a person who is a member already, so for an
	// invited person a `member` row can only come from a later
	// acceptance: of this invitation, a reused one, or one the
	// People page sent.
	const [joined] = await tx
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, org), eq(member.userId, userId)))
		.limit(1);
	if (joined) return "joined";
	const sentByRun = legacy
		? invitedByRun
		: ownInvitationIds.length > 0
			? and(byAddress, inArray(invitation.id, ownInvitationIds))
			: null;
	if (sentByRun) {
		await tx
			.update(invitation)
			.set({ status: "canceled" })
			.where(and(sentByRun, eq(invitation.status, "pending")));
	}
	return "done";
};

// An attached user keeps their account; only this org's rows go.
const removeOrgRowsFor = async (tx: DbClient, org: string, userId: string) => {
	await tx
		.delete(projectMember)
		.where(
			and(
				eq(projectMember.organizationId, org),
				eq(projectMember.userId, userId),
			),
		);
	await tx
		.delete(memberTypeHistory)
		.where(
			and(
				eq(memberTypeHistory.organizationId, org),
				eq(memberTypeHistory.userId, userId),
			),
		);
	await tx
		.delete(memberProfile)
		.where(
			and(
				eq(memberProfile.organizationId, org),
				eq(memberProfile.userId, userId),
			),
		);
	await tx
		.delete(member)
		.where(and(eq(member.organizationId, org), eq(member.userId, userId)));
};

export const harvestImportService = {
	/** What the org holds, for the browser to plan against. */
	snapshot: async (
		ctx: Ctx,
		input: HarvestSnapshotInput,
	): Promise<HarvestSnapshot> => {
		await requireAdmin(ctx);
		const org = ctx.organizationId;

		const clients = await db
			.select({
				id: client.id,
				name: client.name,
				isInternal: client.isInternal,
				archivedAt: client.archivedAt,
			})
			.from(client)
			.where(eq(client.organizationId, org));

		const projects = await db
			.select({
				id: project.id,
				clientId: project.clientId,
				name: project.name,
				code: project.code,
				type: project.type,
				status: project.status,
			})
			.from(project)
			.where(eq(project.organizationId, org));

		const tasks = await db
			.select({
				id: task.id,
				name: task.name,
				scope: task.scope,
				systemKey: task.systemKey,
				isAbsence: task.isAbsence,
				archivedAt: task.archivedAt,
			})
			.from(task)
			.where(or(eq(task.organizationId, org), eq(task.scope, "site")));

		const members = await db
			.select({
				userId: member.userId,
				name: shownName(org),
				email: shownEmail(),
				role: member.role,
				archivedAt: memberProfile.archivedAt,
				startDate: memberProfile.startDate,
				claimPendingSince: memberProfile.claimPendingSince,
			})
			.from(member)
			.innerJoin(user, eq(user.id, member.userId))
			.leftJoin(
				memberProfile,
				and(
					eq(memberProfile.organizationId, org),
					eq(memberProfile.userId, member.userId),
				),
			)
			.where(eq(member.organizationId, org));
		const invited = await invitedPeople(db, org);
		const signedIn = await usersWithAccount(db, [
			...members.map((m) => m.userId),
			...invited.map((m) => m.userId),
		]);

		const mappings = await db
			.select({
				kind: importMapping.kind,
				sourceKey: importMapping.sourceKey,
				localId: importMapping.localId,
			})
			.from(importMapping)
			.where(
				and(
					eq(importMapping.organizationId, org),
					notInArray(importMapping.kind, ["close", "invitation"]),
				),
			);

		const appEntries = await db
			.select({
				userId: timeEntry.userId,
				date: timeEntry.date,
				projectId: timeEntry.projectId,
				taskId: timeEntry.taskId,
				durationSeconds: timeEntry.durationSeconds,
				absence: task.isAbsence,
				automation: sql<boolean>`(${timeEntry.calendarEventId} is not null or ${timeEntry.generatedFromRuleId} is not null or ${timeEntry.fillsDay})`,
			})
			.from(timeEntry)
			.innerJoin(task, eq(task.id, timeEntry.taskId))
			.where(
				and(
					eq(timeEntry.organizationId, org),
					isNull(timeEntry.importKey),
					gte(timeEntry.date, input.from),
					lte(timeEntry.date, input.to),
				),
			);

		// The same digest as `dayDigest` in lib/harvest/keys.ts: the keys in
		// byte order, joined with ",", SHA-256, the first 16 hex characters.
		// Computed here so a 240k-row history crosses the wire as one short
		// string per person-day, not as every key.
		const digests = await db
			.select({
				userId: timeEntry.userId,
				date: timeEntry.date,
				digest: sql<string>`left(encode(sha256(convert_to(string_agg(${timeEntry.importKey}, ',' order by ${timeEntry.importKey} collate "C"), 'UTF8')), 'hex'), ${sql.raw(String(DAY_DIGEST_LENGTH))})`,
				edited: sql<boolean>`bool_or(${timeEntry.updatedAt} > ${timeEntry.createdAt})`,
			})
			.from(timeEntry)
			.where(
				and(
					eq(timeEntry.organizationId, org),
					isNotNull(timeEntry.importKey),
					gte(timeEntry.date, input.from),
					lte(timeEntry.date, input.to),
				),
			)
			.groupBy(timeEntry.userId, timeEntry.date);

		const byUser = new Map<string, [string, string, 0 | 1][]>();
		for (const d of digests) {
			let days = byUser.get(d.userId);
			if (!days) {
				days = [];
				byUser.set(d.userId, days);
			}
			days.push([d.date, d.digest, d.edited ? 1 : 0]);
		}

		const internal = clients.find((c) => c.isInternal);

		return {
			internalClientId: internal?.id ?? null,
			clients: clients.map((c) => ({
				id: c.id,
				name: c.name,
				isInternal: c.isInternal,
				archived: c.archivedAt != null,
			})),
			projects: projects.map((p) => ({
				id: p.id,
				clientId: p.clientId,
				name: p.name,
				code: p.code,
				type: p.type,
				archived: p.status === "archived",
			})),
			tasks: tasks.map((t) => ({
				id: t.id,
				name: t.name,
				scope: t.scope === "site" ? "site" : "organization",
				systemKey: t.systemKey,
				isAbsence: t.isAbsence,
				archived: t.archivedAt != null,
			})),
			members: [
				...members.map((m) => ({
					userId: m.userId,
					name: m.name,
					email: m.email,
					role: m.role,
					archived: m.archivedAt != null,
					// Not for a pending claim: an import attaches an existing user
					// with one, and "has signed in" would say that the address
					// had an account before the import.
					hasAccount: signedIn.has(m.userId) && m.claimPendingSince == null,
					startDate: m.startDate,
					invited: false,
				})),
				...invited.map((m) => ({
					userId: m.userId,
					name: m.name,
					email: m.email,
					role: m.role ?? "member",
					archived: m.archivedAt != null,
					hasAccount: signedIn.has(m.userId),
					startDate: m.startDate,
					invited: true,
				})),
			],
			takenEmails: await takenEmailsFor(ctx, input.emails),
			mappings,
			appEntries,
			importedDays: [...byUser].map(([userId, days]) => ({ userId, days })),
		};
	},

	/** The addresses that belong to a user outside this org, for a guess the
	 *  admin typed after the snapshot was taken. Empty outside the one
	 *  organization of a single-org instance: see `takenEmailsFor`. */
	takenEmails: async (ctx: Ctx, input: HarvestEmailsInput) => {
		await requireAdmin(ctx);
		return takenEmailsFor(ctx, input.emails);
	},

	listRuns: async (ctx: Ctx) => {
		await requireAdmin(ctx);
		return db
			.select({
				id: importRun.id,
				source: importRun.source,
				status: importRun.status,
				cutoffDate: importRun.cutoffDate,
				entriesCreated: importRun.entriesCreated,
				entriesDeleted: importRun.entriesDeleted,
				createdAt: importRun.createdAt,
				finishedAt: importRun.finishedAt,
				undoneAt: importRun.undoneAt,
				createdByName: user.name,
			})
			.from(importRun)
			.leftJoin(user, eq(user.id, importRun.createdByUserId))
			.where(eq(importRun.organizationId, ctx.organizationId))
			.orderBy(desc(importRun.createdAt))
			.limit(50);
	},

	/**
	 * Opens a run and writes the reference rows: clients, tasks, people,
	 * projects, and the assignments between them. One transaction, so a plan
	 * that fails half way leaves nothing behind.
	 *
	 * A `match` is checked against the org before its mapping is written; that
	 * check is what makes every later source key safe to resolve. A person is
	 * never changed by a match, except an empty start date.
	 *
	 * Safe to repeat: the run id comes from the browser, so a second call with
	 * the same id gets the run the first one made. Without that, a `start`
	 * that committed but lost its answer sent "Retry" into `assertNotMapped`,
	 * and the first run stayed `started` for ever, in the way of every undo.
	 */
	start: async (
		ctx: Ctx,
		input: HarvestStartInput,
	): Promise<{ runId: string; created: StartCounts; invited: string[] }> => {
		await requireAdmin(ctx);
		const org = ctx.organizationId;

		const earlier = await db.query.importRun.findFirst({
			where: and(
				eq(importRun.id, input.runId),
				eq(importRun.organizationId, org),
			),
			columns: { id: true, status: true },
		});
		if (earlier) {
			if (earlier.status !== "started") {
				throw new Error(
					`This import is ${earlier.status}. Reload the files to import again.`,
				);
			}
			return { runId: earlier.id, ...(await startResult(earlier.id, org)) };
		}

		assertUniqueKeys("client", input.clients);
		assertUniqueKeys("task", input.tasks);
		assertUniqueKeys("project", input.projects);
		assertUniqueKeys("person", input.people);
		const createdEmails = new Set<string>();
		for (const p of input.people) {
			if (p.action !== "create") continue;
			const email = normEmail(p.email);
			if (createdEmails.has(email)) {
				throw new Error(`Two people in the plan use ${email}`);
			}
			createdEmails.add(email);
		}

		const orgRow = await db.query.organization.findFirst({
			where: eq(organization.id, org),
			columns: { name: true, slug: true },
		});
		// With several organizations, each person gets a pending claim.
		const multiOrg = !isSingleOrgMode();
		// The people the run makes members at once (single-org mode). A
		// pending claim is not here: `importClaimsService.accept` records it.
		const directMembers: DirectMember[] = [];

		const result = await db.transaction(async (tx) => {
			// A conflict is a first call with this id that committed while this
			// one was on its way; the next retry finds it above.
			const [run] = await tx
				.insert(importRun)
				.values({
					id: input.runId,
					organizationId: org,
					source: input.source,
					createdByUserId: ctx.userId,
					cutoffDate: input.cutoffDate,
				})
				.onConflictDoNothing()
				.returning({ id: importRun.id });
			if (!run) {
				throw new Error("This import has started already. Retry to continue.");
			}
			const st: StartTx = {
				tx,
				ctx,
				org,
				runId: run.id,
				multiOrg,
				counts: { clients: 0, tasks: 0, people: 0, invited: 0, projects: 0 },
				directMembers,
			};
			const clientIds = await startClients(st, input.clients, orgRow);
			await startTasks(st, input.tasks);
			const { personIds, knownPeople } = await startPeople(st, input.people);
			await startAliases(st, input.people, personIds, knownPeople);
			const projectIds = await startProjects(st, input.projects, clientIds);
			await startAssignments(st, input.projectMembers, projectIds, personIds);
			return { runId: st.runId, created: st.counts, invited: [] };
		});

		// After the commit: this transaction is a raw `db.transaction`, and a
		// second connection held inside it is the deadlock `ctxDb` warns about.
		// A direct add is a way in, so each person gets `member.joined`, with
		// the admin as the actor. `import.finished` holds only counts. This
		// goes through `recordAudit` and not `memberJoined`, because the run
		// sends one webhook, not one for each person.
		for (const m of directMembers) {
			await recordAudit(ctx, {
				kind: "member.joined",
				subjectUserId: m.userId,
				target: { type: "member", id: m.userId, label: m.name },
				details: { role: m.role, importRunId: result.runId },
			});
		}
		return result;
	},

	/**
	 * Writes one chunk of whole person-days:
	 *
	 * - a day with no imported rows yet: insert them;
	 * - the same key set as before: nothing;
	 * - a different set: replace the day's imported rows — unless a person
	 *   edited one of them here, in which case the day stays and is reported.
	 *
	 * Rows a person or an engine made here (no import key) are never touched.
	 * Safe to retry: a chunk that already went in is all "the same".
	 */
	importDays: async (
		ctx: Ctx,
		input: HarvestImportDaysInput,
	): Promise<HarvestImportDaysResult> => {
		await requireAdmin(ctx);
		await loadStartedRun(ctx, input.runId);
		const org = ctx.organizationId;

		return db.transaction(async (tx) => {
			const people = await resolveAll(
				tx,
				ctx,
				"person",
				input.days.map((d) => d.personSourceKey),
			);
			const projects = await resolveAll(
				tx,
				ctx,
				"project",
				input.days.flatMap((d) =>
					d.rows.flatMap((r) =>
						r.projectSourceKey == null ? [] : [r.projectSourceKey],
					),
				),
			);
			const tasks = await resolveAll(
				tx,
				ctx,
				"task",
				input.days.flatMap((d) => d.rows.map((r) => r.taskSourceKey)),
			);
			const absenceTasks = new Set<string>();
			for (const batch of inBatches([...new Set(tasks.values())])) {
				const rows = await tx
					.select({ id: task.id })
					.from(task)
					.where(and(inArray(task.id, batch), eq(task.isAbsence, true)));
				for (const r of rows) absenceTasks.add(r.id);
			}

			// Grouped by the LOCAL person-day: two source names that the admin
			// matched to one member share that member's day.
			type Incoming = {
				userId: string;
				date: string;
				personSourceKey: string;
				rows: (typeof timeEntry.$inferInsert)[];
			};
			const incoming = new Map<string, Incoming>();
			for (const day of input.days) {
				const userId = people.get(day.personSourceKey);
				if (!userId) throw new Error("Unresolved person");
				const dayKey = `${userId}|${day.date}`;
				let group = incoming.get(dayKey);
				if (!group) {
					group = {
						userId,
						date: day.date,
						personSourceKey: day.personSourceKey,
						rows: [],
					};
					incoming.set(dayKey, group);
				}
				for (const r of day.rows) {
					const taskId = tasks.get(r.taskSourceKey);
					if (!taskId) throw new Error("Unresolved task");
					const projectId =
						r.projectSourceKey == null
							? null
							: (projects.get(r.projectSourceKey) ?? null);
					const absence = absenceTasks.has(taskId);
					// The same rule as `assertAbsenceHasNoProject` (guards.ts): an
					// absence entry has no project, and worked time here always has
					// one, because the import never writes unfiled time.
					if (absence !== (projectId == null)) {
						throw new Error(
							absence
								? `Absence on ${day.date} names a project`
								: `Work on ${day.date} names no project`,
						);
					}
					group.rows.push({
						organizationId: org,
						userId,
						date: day.date,
						projectId,
						taskId,
						description: r.description,
						durationSeconds: r.durationSeconds,
						overtime: r.overtime,
						fillsDay: false,
						syncLocked: true,
						importRunId: input.runId,
						importKey: r.key,
					});
				}
			}

			const existing = await importedRowsFor(tx, ctx, [...incoming.values()]);

			const result: HarvestImportDaysResult = {
				inserted: 0,
				deleted: 0,
				unchangedDays: 0,
				keptDays: [],
			};
			const toDelete: string[] = [];
			const toInsert: (typeof timeEntry.$inferInsert)[] = [];
			for (const [dayKey, group] of incoming) {
				const before = existing.get(dayKey);
				if (!before) {
					toInsert.push(...group.rows);
					continue;
				}
				const keys = new Set(group.rows.flatMap((r) => r.importKey ?? []));
				if (sameKeys(before.keys, keys)) {
					result.unchangedDays++;
				} else if (before.edited) {
					result.keptDays.push({
						personSourceKey: group.personSourceKey,
						date: group.date,
					});
				} else {
					toDelete.push(...before.ids);
					toInsert.push(...group.rows);
				}
			}

			await deleteEntries(tx, toDelete);
			result.deleted = toDelete.length;
			for (const batch of inBatches(toInsert)) {
				const rows = await tx
					.insert(timeEntry)
					.values(batch)
					.onConflictDoNothing()
					.returning({ id: timeEntry.id });
				result.inserted += rows.length;
			}

			await tx
				.update(importRun)
				.set({
					entriesCreated: sql`${importRun.entriesCreated} + ${result.inserted}`,
					entriesDeleted: sql`${importRun.entriesDeleted} + ${result.deleted}`,
					updatedAt: new Date(),
				})
				.where(eq(importRun.id, input.runId));
			return result;
		});
	},

	/**
	 * Deletes the imported rows of person-days that are no longer in Harvest
	 * The browser only sends these after the admin says the
	 * file is a full export. A day a person edited here stays.
	 */
	removeDays: async (ctx: Ctx, input: HarvestRemoveDaysInput) => {
		await requireAdmin(ctx);
		await loadStartedRun(ctx, input.runId);

		return db.transaction(async (tx) => {
			const people = await resolveAll(
				tx,
				ctx,
				"person",
				input.days.map((d) => d.personSourceKey),
			);
			const days = input.days.map((d) => ({
				userId: people.get(d.personSourceKey) ?? "",
				date: d.date,
				personSourceKey: d.personSourceKey,
			}));
			const existing = await importedRowsFor(tx, ctx, days);
			const toDelete: string[] = [];
			const keptDays: { personSourceKey: string; date: string }[] = [];
			for (const d of days) {
				const before = existing.get(`${d.userId}|${d.date}`);
				if (!before) continue;
				if (before.edited) {
					keptDays.push({ personSourceKey: d.personSourceKey, date: d.date });
				} else {
					toDelete.push(...before.ids);
				}
			}
			await deleteEntries(tx, toDelete);
			await tx
				.update(importRun)
				.set({
					entriesDeleted: sql`${importRun.entriesDeleted} + ${toDelete.length}`,
					updatedAt: new Date(),
				})
				.where(eq(importRun.id, input.runId));
			return { deleted: toDelete.length, keptDays };
		});
	},

	/**
	 * Closes the run:
	 *
	 * 1. `automationLockedThrough` moves up to the day before the cutoff, so no
	 *    engine writes into the imported history. It never moves back.
	 * 2. The hour fund is prefilled for every year with history, because
	 *    Expected needs it.
	 *
	 * Safe to retry.
	 */
	finish: async (
		ctx: Ctx,
		input: HarvestFinishInput,
	): Promise<HarvestFinishResult> => {
		await requireAdmin(ctx);
		const run = await loadStartedRun(ctx, input.runId);
		const org = ctx.organizationId;

		const lockThrough = addDaysToKey(run.cutoffDate, -1);
		const settings = await orgSettingsService.get(ctx);
		const locked =
			settings.automationLockedThrough != null &&
			settings.automationLockedThrough >= lockThrough
				? settings.automationLockedThrough
				: lockThrough;
		if (locked !== settings.automationLockedThrough) {
			await orgSettingsService.update(ctx, { automationLockedThrough: locked });
		}

		// Every year with imported history gets its hour fund prefilled, because
		// Expected (the compliance report, the reminders) needs it and nobody has
		// been through those years by hand.
		const years = await db
			.selectDistinct({
				year: sql<string>`substring(${timeEntry.date} from 1 for 4)`,
			})
			.from(timeEntry)
			.where(
				and(eq(timeEntry.organizationId, org), isNotNull(timeEntry.importKey)),
			);
		for (const y of years) {
			await hourFundService.prefillYear(ctx, Number(y.year));
		}

		const result: HarvestFinishResult = { automationLockedThrough: locked };

		await db
			.update(importRun)
			.set({
				status: "finished",
				finishedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(importRun.id, input.runId));

		// The counts come from `importMapping`, which is the record of what this
		// run CREATED — see the header of `services/events.ts`. The audit row
		// needs them whether or not an endpoint listens, so they are read once.
		const created = await db
			.select({
				kind: importMapping.kind,
				count: sql<number>`count(*)::int`,
			})
			.from(importMapping)
			.where(
				and(
					eq(importMapping.runId, input.runId),
					eq(importMapping.created, true),
				),
			)
			.groupBy(importMapping.kind);
		const countOf = (kind: string) =>
			created.find((row) => row.kind === kind)?.count ?? 0;
		const [entries] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(timeEntry)
			.where(
				and(
					eq(timeEntry.organizationId, org),
					eq(timeEntry.importRunId, input.runId),
				),
			);
		const counts = {
			clients: countOf("client"),
			projects: countOf("project"),
			people: countOf("person"),
			timeEntries: entries?.count ?? 0,
		};

		// One event for the run, not one per row. An import writes tens of
		// thousands of entries at once, and a receiver wants to know it happened
		// and then re-read, not to be handed the whole history as a stream.
		await emitEvent(ctx, "import.finished", async () => ({
			import: { id: input.runId, ...counts },
		}));
		await recordAudit(ctx, {
			kind: "import.finished",
			target: { type: "import", id: input.runId, label: null },
			details: { ...counts, automationLockedThrough: locked },
		});
		return result;
	},

	/**
	 * Takes back the latest run: its entries, then the rows it created, in
	 * reverse order. Refuses while anything made here depends on them — an
	 * entry on a created project or task or by a created person — or when a
	 * created user has signed in.
	 *
	 * Not undone: days that this run REPLACED keep the new rows (the old ones
	 * are gone), and assignments on rows the run only matched stay. The
	 * automation lock stays where it is.
	 */
	undo: async (ctx: Ctx, input: HarvestRunIdInput) => {
		await requireAdmin(ctx);
		const org = ctx.organizationId;
		const run = await loadRun(ctx, input.runId);
		if (run.status === "undone") throw new Error("This import is undone");
		const latest = await db
			.select({ id: importRun.id })
			.from(importRun)
			.where(
				and(eq(importRun.organizationId, org), ne(importRun.status, "undone")),
			)
			.orderBy(desc(importRun.createdAt))
			.limit(1);
		if (latest[0]?.id !== run.id) {
			throw new Error("Only the latest import can be undone");
		}

		const undone = await db.transaction(async (tx) => {
			const ids = await loadRunMappings(tx, run.id);
			const madeUsers = await findMadeUsers(tx, run.id, ids.userIds);
			await assertCreatedRowsUnused(tx, org, run.id, ids);
			const deleted = await tx
				.delete(timeEntry)
				.where(eq(timeEntry.importRunId, run.id))
				.returning({ id: timeEntry.id });
			await deleteCreatedRows(tx, ids);
			for (const userId of ids.userIds) {
				// A made user that another organization holds rows for keeps the
				// user row: the foreign keys cascade and would delete that data.
				if (madeUsers.has(userId) && !(await heldElsewhere(tx, org, userId))) {
					await tx.delete(user).where(eq(user.id, userId));
					continue;
				}
				// An attached user who accepted the claim joined by choice. Their
				// membership, profile and assignments are theirs now; only the
				// run's entries and mappings go.
				if (await acceptedClaim(tx, org, userId)) continue;
				const outcome = await cancelRunInvitation(tx, org, run.id, userId, ids);
				if (outcome === "joined") continue;
				await removeOrgRowsFor(tx, org, userId);
			}
			await tx.delete(importMapping).where(eq(importMapping.runId, run.id));
			await tx
				.update(importRun)
				.set({ status: "undone", undoneAt: new Date(), updatedAt: new Date() })
				.where(eq(importRun.id, run.id));

			return {
				entriesDeleted: deleted.length,
				projectsDeleted: ids.projectIds.length,
				clientsDeleted: ids.clientIds.length,
				tasksDeleted: ids.taskIds.length,
				peopleRemoved: ids.userIds.length,
			};
		});
		// After the commit: this transaction is a raw `db.transaction`, and a
		// second connection held inside it is the deadlock `ctxDb` warns about.
		await recordAudit(ctx, {
			kind: "import.undone",
			target: { type: "import", id: run.id, label: null },
			details: { ...undone },
		});
		return undone;
	},
};
