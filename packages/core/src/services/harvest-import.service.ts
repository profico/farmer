// The server half of the Harvest import (docs/plans/harvest-import.md).
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
// `removeDays`, then `finish` (the automation lock, the hour fund and the
// history closes). `undo` takes back the latest run.

import { generateId } from "better-auth";
import {
	and,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	lte,
	ne,
	or,
	sql,
} from "drizzle-orm";

import { db } from "../db";
import { account, member, organization, user } from "../db/schema/auth";
import { monthlyClose, monthlyCloseRow } from "../db/schema/close";
import {
	client,
	project,
	projectMember,
	projectTask,
	task,
	timeEntry,
} from "../db/schema/domain";
import { importMapping, importRun } from "../db/schema/import";
import { memberProfile, memberTypeHistory } from "../db/schema/people";
import { memberSchedule } from "../db/schema/schedule";
import type {
	HarvestFinishResult,
	HarvestImportDaysResult,
	HarvestMappingKind,
	HarvestSnapshot,
} from "../lib/harvest/contract";
import { DAY_DIGEST_LENGTH } from "../lib/harvest/keys";
import { addDaysToKey, endOfMonthKey } from "../lib/time";
import type {
	HarvestEmailsInput,
	HarvestFinishInput,
	HarvestImportDaysInput,
	HarvestRemoveDaysInput,
	HarvestRunIdInput,
	HarvestSnapshotInput,
	HarvestStartInput,
} from "../schema/harvest-import";
import { clientsService } from "./clients.service";
import { absenceDaysByUserPerMonth, expectedSecondsFor } from "./close.service";
import { type DbClient, requireAdmin } from "./context";
import { hourFundService } from "./hour-fund.service";
import { membersService, type ResolvedMemberType } from "./members.service";
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

const DEFAULT_MEMBER_TYPE: ResolvedMemberType = {
	type: "billable",
	expectedSecondsOverride: null,
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
 *  this org. Lower case. */
const takenEmailsFor = async (
	ctx: Ctx,
	emails: readonly string[],
): Promise<string[]> => {
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

const sameKeys = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
	a.size === b.size && [...a].every((k) => b.has(k));

const deleteEntries = async (tx: DbClient, ids: readonly string[]) => {
	for (const batch of inBatches(ids)) {
		await tx.delete(timeEntry).where(inArray(timeEntry.id, batch));
	}
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
				name: user.name,
				email: user.email,
				role: member.role,
				archivedAt: memberProfile.archivedAt,
				startDate: memberProfile.startDate,
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
		const signedIn = await usersWithAccount(
			db,
			members.map((m) => m.userId),
		);

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
					ne(importMapping.kind, "close"),
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
			members: members.map((m) => ({
				userId: m.userId,
				name: m.name,
				email: m.email,
				role: m.role,
				archived: m.archivedAt != null,
				hasAccount: signedIn.has(m.userId),
				startDate: m.startDate,
			})),
			takenEmails: await takenEmailsFor(ctx, input.emails),
			mappings,
			appEntries,
			importedDays: [...byUser].map(([userId, days]) => ({ userId, days })),
		};
	},

	/** The addresses that belong to a user outside this org, for a guess the
	 *  admin typed after the snapshot was taken. */
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
				closesCreated: importRun.closesCreated,
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
	 */
	start: async (ctx: Ctx, input: HarvestStartInput) => {
		await requireAdmin(ctx);
		const org = ctx.organizationId;

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
			columns: { name: true },
		});

		return db.transaction(async (tx) => {
			const [run] = await tx
				.insert(importRun)
				.values({
					organizationId: org,
					source: input.source,
					createdByUserId: ctx.userId,
					cutoffDate: input.cutoffDate,
				})
				.returning({ id: importRun.id });
			if (!run) throw new Error("Failed to open the import run");
			const runId = run.id;

			const counts = { clients: 0, tasks: 0, people: 0, projects: 0 };

			const remember = async (
				kind: HarvestMappingKind,
				sourceKey: string,
				localId: string,
				created: boolean,
			) => {
				// An earlier run's mapping wins: it records who created the row,
				// and that run's undo is the one that may remove it.
				await tx
					.insert(importMapping)
					.values({
						organizationId: org,
						runId,
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

			// ── Clients ──────────────────────────────────────────────────────
			const knownClients = await mappingsFor(tx, ctx, "client");
			const clientIds = new Map(knownClients);
			const matchClientIds = input.clients.flatMap((c) =>
				c.action === "match" ? [c.localId] : [],
			);
			const orgClientIds = new Set<string>();
			for (const batch of inBatches(matchClientIds)) {
				const rows = await tx
					.select({ id: client.id })
					.from(client)
					.where(
						and(eq(client.organizationId, org), inArray(client.id, batch)),
					);
				for (const r of rows) orgClientIds.add(r.id);
			}
			let internalId: string | null = null;
			for (const c of input.clients) {
				assertNotMapped("client", knownClients, c);
				if (c.action === "match") {
					if (!orgClientIds.has(c.localId)) {
						throw new Error(`Client "${c.sourceKey}" matches no client here`);
					}
					clientIds.set(c.sourceKey, c.localId);
					await remember("client", c.sourceKey, c.localId, false);
				} else if (c.action === "internal") {
					internalId ??= await clientsService.ensureInternal(
						ctx,
						orgRow?.name,
						tx,
					);
					clientIds.set(c.sourceKey, internalId);
					await remember("client", c.sourceKey, internalId, false);
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
					await remember("client", c.sourceKey, row.id, true);
					counts.clients++;
				}
			}

			// ── Tasks ────────────────────────────────────────────────────────
			const knownTasks = await mappingsFor(tx, ctx, "task");
			const taskIds = new Map(knownTasks);
			const usableTasks = new Map<string, { isAbsence: boolean }>();
			const matchTaskIds = input.tasks.flatMap((t) =>
				t.action === "match" ? [t.localId] : [],
			);
			for (const batch of inBatches(matchTaskIds)) {
				const rows = await tx
					.select({ id: task.id, isAbsence: task.isAbsence })
					.from(task)
					.where(
						and(
							inArray(task.id, batch),
							or(eq(task.organizationId, org), eq(task.scope, "site")),
						),
					);
				for (const r of rows) usableTasks.set(r.id, { isAbsence: r.isAbsence });
			}
			const createNames = input.tasks.flatMap((t) =>
				t.action === "create" && !t.archived ? [t.name] : [],
			);
			for (const batch of inBatches(createNames)) {
				const clash = await tx
					.select({ name: task.name })
					.from(task)
					.where(
						and(
							eq(task.organizationId, org),
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
			for (const t of input.tasks) {
				assertNotMapped("task", knownTasks, t);
				if (t.action === "match") {
					if (!usableTasks.has(t.localId)) {
						throw new Error(`Task "${t.sourceKey}" matches no task here`);
					}
					taskIds.set(t.sourceKey, t.localId);
					await remember("task", t.sourceKey, t.localId, false);
				} else {
					const [row] = await tx
						.insert(task)
						.values({
							scope: "organization",
							organizationId: org,
							name: t.name,
							archivedAt: t.archived ? new Date() : null,
						})
						.returning({ id: task.id });
					if (!row) throw new Error(`Failed to create task "${t.name}"`);
					taskIds.set(t.sourceKey, row.id);
					usableTasks.set(row.id, { isAbsence: false });
					await remember("task", t.sourceKey, row.id, true);
					counts.tasks++;
				}
			}

			// ── People ───────────────────────────────────────────────────────
			const knownPeople = await mappingsFor(tx, ctx, "person");
			const personIds = new Map(knownPeople);
			const matchUserIds = input.people.flatMap((p) =>
				p.action === "match" ? [p.localId] : [],
			);
			const memberIds = new Set<string>();
			for (const batch of inBatches(matchUserIds)) {
				const rows = await tx
					.select({ userId: member.userId })
					.from(member)
					.where(
						and(eq(member.organizationId, org), inArray(member.userId, batch)),
					);
				for (const r of rows) memberIds.add(r.userId);
			}
			for (const p of input.people) {
				// After every person it can point at: see the loop below.
				if (p.action === "alias") continue;
				assertNotMapped("person", knownPeople, p);
				if (p.action === "match") {
					if (!memberIds.has(p.localId)) {
						throw new Error(`Person "${p.sourceKey}" matches no member here`);
					}
					if (p.startDate) {
						await tx
							.insert(memberProfile)
							.values({
								organizationId: org,
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
					personIds.set(p.sourceKey, p.localId);
					await remember("person", p.sourceKey, p.localId, false);
					continue;
				}

				const email = normEmail(p.email);
				const existing = await tx
					.select({ id: user.id })
					.from(user)
					.where(sql`lower(${user.email}) = ${email}`)
					.limit(1);
				let userId: string;
				const found = existing[0];
				if (found) {
					const membership = await tx
						.select({ id: member.id })
						.from(member)
						.where(
							and(eq(member.organizationId, org), eq(member.userId, found.id)),
						)
						.limit(1);
					if (membership[0]) {
						throw new Error(
							`${email} is a member already. Match the person instead.`,
						);
					}
					// A guessed address that happens to be somebody's real one must
					// not hand that person an old account (plan section 3.3).
					if (!p.emailListed) {
						throw new Error(
							`The guessed address ${email} belongs to another user. Change it.`,
						);
					}
					// A listed address of a user with no membership here: attach
					// that user rather than make a second one. Undo tells the two
					// apart by the user row's age.
					userId = found.id;
				} else {
					userId = generateId();
					await tx.insert(user).values({
						id: userId,
						name: p.name,
						email,
						emailVerified: p.emailListed,
					});
				}

				await tx.insert(member).values({
					id: generateId(),
					organizationId: org,
					userId,
					role: p.role,
					createdAt: new Date(),
				});
				const archivedAt = p.archivedOn ? dayToTimestamp(p.archivedOn) : null;
				await tx
					.insert(memberProfile)
					.values({
						organizationId: org,
						userId,
						startDate: p.startDate,
						archivedAt,
					})
					.onConflictDoUpdate({
						target: [memberProfile.organizationId, memberProfile.userId],
						set: { startDate: p.startDate, archivedAt, updatedAt: new Date() },
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
				await tx
					.insert(memberSchedule)
					.values({
						organizationId: org,
						userId,
						weeklyTargetSeconds: p.weeklyTargetSeconds,
					})
					.onConflictDoNothing();
				personIds.set(p.sourceKey, userId);
				await remember("person", p.sourceKey, userId, true);
				counts.people++;
			}
			// A second spelling of a person: map it to that person's user. Not
			// `created`, so undo removes only the mapping, with the run.
			for (const p of input.people) {
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
				await remember("person", p.sourceKey, localId, false);
			}

			// ── Projects ─────────────────────────────────────────────────────
			const knownProjects = await mappingsFor(tx, ctx, "project");
			const projectIds = new Map(knownProjects);
			const matchProjectIds = input.projects.flatMap((p) =>
				p.action === "match" ? [p.localId] : [],
			);
			const orgProjectIds = new Set<string>();
			for (const batch of inBatches(matchProjectIds)) {
				const rows = await tx
					.select({ id: project.id })
					.from(project)
					.where(
						and(eq(project.organizationId, org), inArray(project.id, batch)),
					);
				for (const r of rows) orgProjectIds.add(r.id);
			}
			for (const p of input.projects) {
				assertNotMapped("project", knownProjects, p);
				if (p.action === "match") {
					if (!orgProjectIds.has(p.localId)) {
						throw new Error(`Project "${p.sourceKey}" matches no project here`);
					}
					projectIds.set(p.sourceKey, p.localId);
					await remember("project", p.sourceKey, p.localId, false);
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
				await remember("project", p.sourceKey, row.id, true);
				counts.projects++;
			}

			// ── Assignments ──────────────────────────────────────────────────
			const lookup = (
				map: ReadonlyMap<string, string>,
				kind: string,
				key: string,
			) => {
				const id = map.get(key);
				if (!id) throw new Error(`The plan names an unknown ${kind} "${key}"`);
				return id;
			};
			const memberRows = input.projectMembers.map((pm) => ({
				organizationId: org,
				projectId: lookup(projectIds, "project", pm.projectSourceKey),
				userId: lookup(personIds, "person", pm.personSourceKey),
				active: pm.active,
			}));
			for (const batch of inBatches(memberRows)) {
				await tx.insert(projectMember).values(batch).onConflictDoNothing();
			}

			// A task mapped by an earlier run was checked by that run; only the
			// absence rule needs its facts, so read the ones not already known.
			const taskRows = input.projectTasks.map((pt) => ({
				organizationId: org,
				projectId: lookup(projectIds, "project", pt.projectSourceKey),
				taskId: lookup(taskIds, "task", pt.taskSourceKey),
			}));
			const unknownTaskIds = [
				...new Set(
					taskRows.map((r) => r.taskId).filter((id) => !usableTasks.has(id)),
				),
			];
			for (const batch of inBatches(unknownTaskIds)) {
				const rows = await tx
					.select({ id: task.id, isAbsence: task.isAbsence })
					.from(task)
					.where(inArray(task.id, batch));
				for (const r of rows) usableTasks.set(r.id, { isAbsence: r.isAbsence });
			}
			if (taskRows.some((r) => usableTasks.get(r.taskId)?.isAbsence)) {
				throw new Error("An absence task cannot be put on a project");
			}
			for (const batch of inBatches(taskRows)) {
				await tx.insert(projectTask).values(batch).onConflictDoNothing();
			}

			return { runId, created: counts };
		});
	},

	/**
	 * Writes one chunk of whole person-days (plan section 5.3):
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
	 * (plan section 5.3). The browser only sends these after the admin says the
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
	 * Closes the run (plan section 6):
	 *
	 * 1. `automationLockedThrough` moves up to the day before the cutoff, so no
	 *    engine writes into the imported history. It never moves back.
	 * 2. The hour fund is prefilled for every year with history, because
	 *    Expected needs it.
	 * 3. Each billable project-month with imported rows, through
	 *    `historyThrough`, gets a finalized close. Final is Harvest's billable
	 *    hours; Reported and Overtime are the imported totals; Expected is what
	 *    `finalize` would compute. A month that has a close made here is left
	 *    alone. A close an earlier run made is written again, but only while
	 *    nobody has changed it since.
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

		const result: HarvestFinishResult = {
			closesCreated: 0,
			closesUpdated: 0,
			closesSkipped: 0,
			automationLockedThrough: locked,
		};

		if (input.historyThrough != null) {
			const lastDay = endOfMonthKey(`${input.historyThrough}-01`);
			const month = sql<string>`substring(${timeEntry.date} from 1 for 7)`;
			const totals = await db
				.select({
					projectId: sql<string>`${timeEntry.projectId}`,
					projectType: project.type,
					userId: timeEntry.userId,
					month,
					reported: sql<string>`sum(${timeEntry.durationSeconds})`,
					overtime: sql<string>`coalesce(sum(case when ${timeEntry.overtime} then ${timeEntry.durationSeconds} else 0 end), 0)`,
				})
				.from(timeEntry)
				.innerJoin(project, eq(project.id, timeEntry.projectId))
				.where(
					and(
						eq(timeEntry.organizationId, org),
						isNotNull(timeEntry.importKey),
						ne(project.type, "internal"),
						lte(timeEntry.date, lastDay),
					),
				)
				.groupBy(timeEntry.projectId, project.type, timeEntry.userId, month);

			// project|month → the rows of that close.
			type Group = {
				projectId: string;
				projectType: string;
				year: number;
				month: number;
				key: string;
				rows: { userId: string; reported: number; overtime: number }[];
			};
			const groups = new Map<string, Group>();
			for (const t of totals) {
				const key = `${t.projectId}:${t.month}`;
				let g = groups.get(key);
				if (!g) {
					g = {
						projectId: t.projectId,
						projectType: t.projectType,
						year: Number(t.month.slice(0, 4)),
						month: Number(t.month.slice(5, 7)),
						key,
						rows: [],
					};
					groups.set(key, g);
				}
				g.rows.push({
					userId: t.userId,
					reported: Number(t.reported),
					overtime: Number(t.overtime),
				});
			}

			if (groups.size > 0) {
				const monthKeys = [
					...new Set([...groups.values()].map((g) => g.key.slice(-7))),
				].sort();
				const years = [...new Set(monthKeys.map((m) => Number(m.slice(0, 4))))];
				for (const year of years) {
					await hourFundService.prefillYear(ctx, year);
				}
				const months = monthKeys.map((m) => ({
					year: Number(m.slice(0, 4)),
					month: Number(m.slice(5, 7)),
				}));
				const funds = await hourFundService.getMany(ctx, months);
				const firstMonth = monthKeys[0] ?? input.historyThrough;
				const absence = await absenceDaysByUserPerMonth(
					ctx,
					`${firstMonth}-01`,
					lastDay,
				);
				const typesByMonth = new Map<string, Map<string, ResolvedMemberType>>();
				for (const m of months) {
					typesByMonth.set(
						`${m.year}-${String(m.month).padStart(2, "0")}`,
						await membersService.typesForMonth(ctx, m.year, m.month),
					);
				}

				const projectBySource = await mappingsFor(db, ctx, "project");
				const personBySource = await mappingsFor(db, ctx, "person");
				const billable = new Map<string, number>();
				for (const b of input.billable) {
					const projectId = projectBySource.get(b.projectSourceKey);
					const userId = personBySource.get(b.personSourceKey);
					if (!projectId || !userId) continue;
					const key = `${projectId}:${b.month}|${userId}`;
					billable.set(key, (billable.get(key) ?? 0) + b.seconds);
				}

				await db.transaction(async (tx) => {
					const closeMappings = await tx
						.select({
							sourceKey: importMapping.sourceKey,
							localId: importMapping.localId,
							updatedAt: importMapping.updatedAt,
						})
						.from(importMapping)
						.where(
							and(
								eq(importMapping.organizationId, org),
								eq(importMapping.kind, "close"),
							),
						);
					const importedClose = new Map(
						closeMappings.map((m) => [m.sourceKey, m]),
					);
					const projectIds = [
						...new Set([...groups.values()].map((g) => g.projectId)),
					];
					const existingCloses = new Map<
						string,
						{ id: string; updatedAt: Date }
					>();
					for (const batch of inBatches(projectIds)) {
						const rows = await tx
							.select({
								id: monthlyClose.id,
								projectId: monthlyClose.projectId,
								year: monthlyClose.year,
								month: monthlyClose.month,
								updatedAt: monthlyClose.updatedAt,
							})
							.from(monthlyClose)
							.where(
								and(
									eq(monthlyClose.organizationId, org),
									inArray(monthlyClose.projectId, batch),
								),
							);
						for (const r of rows) {
							existingCloses.set(
								`${r.projectId}:${r.year}-${String(r.month).padStart(2, "0")}`,
								{ id: r.id, updatedAt: r.updatedAt },
							);
						}
					}

					for (const g of groups.values()) {
						const monthKey = g.key.slice(-7);
						const types = typesByMonth.get(monthKey);
						const fund = funds.get(monthKey) ?? null;
						const absenceDays = absence.get(monthKey);
						const rows = g.rows.map((r) => ({
							organizationId: org,
							userId: r.userId,
							finalSeconds: billable.get(`${g.key}|${r.userId}`) ?? 0,
							reportedAtFinalizeSeconds: r.reported,
							overtimeAtFinalizeSeconds: r.overtime,
							expectedAtFinalizeSeconds:
								g.projectType === "product_team"
									? expectedSecondsFor(
											types?.get(r.userId) ?? DEFAULT_MEMBER_TYPE,
											fund,
											absenceDays?.get(r.userId) ?? 0,
										)
									: null,
						}));
						const now = new Date();

						const close = existingCloses.get(g.key);
						if (!close) {
							const [created] = await tx
								.insert(monthlyClose)
								.values({
									organizationId: org,
									projectId: g.projectId,
									year: g.year,
									month: g.month,
									status: "finalized",
									finalizedAt: now,
									finalizedByUserId: ctx.userId,
									createdAt: now,
									updatedAt: now,
								})
								.returning({ id: monthlyClose.id });
							if (!created) throw new Error("Failed to create a close");
							// Every stamp is the same JS `now`, not the database's:
							// the "changed since" test below compares them.
							await tx.insert(monthlyCloseRow).values(
								rows.map((r) => ({
									...r,
									closeId: created.id,
									createdAt: now,
									updatedAt: now,
								})),
							);
							// A mapping left over from a close that is gone (its
							// project was deleted and made again) points at nothing.
							await tx
								.insert(importMapping)
								.values({
									organizationId: org,
									runId: input.runId,
									kind: "close",
									sourceKey: g.key,
									localId: created.id,
									created: true,
									createdAt: now,
									updatedAt: now,
								})
								.onConflictDoUpdate({
									target: [
										importMapping.organizationId,
										importMapping.kind,
										importMapping.sourceKey,
									],
									set: {
										runId: input.runId,
										localId: created.id,
										created: true,
										updatedAt: now,
									},
								});
							result.closesCreated++;
							continue;
						}

						const mapping = importedClose.get(g.key);
						if (!mapping || mapping.localId !== close.id) {
							result.closesSkipped++;
							continue;
						}
						// "Nobody changed it since": the close and every row are no
						// newer than the import's own last write.
						const touched = await tx
							.select({ id: monthlyCloseRow.id })
							.from(monthlyCloseRow)
							.where(
								and(
									eq(monthlyCloseRow.closeId, close.id),
									// Not a raw `sql` template: that sends the Date
									// unmapped, and postgres-js writes it with toString(),
									// which Postgres cannot read (PGLite can).
									gt(monthlyCloseRow.updatedAt, mapping.updatedAt),
								),
							)
							.limit(1);
						if (close.updatedAt > mapping.updatedAt || touched[0]) {
							result.closesSkipped++;
							continue;
						}
						await tx
							.delete(monthlyCloseRow)
							.where(eq(monthlyCloseRow.closeId, close.id));
						await tx.insert(monthlyCloseRow).values(
							rows.map((r) => ({
								...r,
								closeId: close.id,
								createdAt: now,
								updatedAt: now,
							})),
						);
						await tx
							.update(monthlyClose)
							.set({ updatedAt: now })
							.where(eq(monthlyClose.id, close.id));
						await tx
							.update(importMapping)
							.set({ updatedAt: now })
							.where(
								and(
									eq(importMapping.organizationId, org),
									eq(importMapping.kind, "close"),
									eq(importMapping.sourceKey, g.key),
								),
							);
						result.closesUpdated++;
					}
				});
			}
		}

		await db
			.update(importRun)
			.set({
				status: "finished",
				closesCreated: result.closesCreated,
				finishedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(importRun.id, input.runId));
		return result;
	},

	/**
	 * Takes back the latest run: its entries, its closes, then the rows it
	 * created, in reverse order. Refuses while anything made here depends on
	 * them — an entry on a created project or task or by a created person, a
	 * close made here on a created project — or when a created user has
	 * signed in.
	 *
	 * Not undone: days that this run REPLACED keep the new rows (the old ones
	 * are gone), closes an earlier run made and this run wrote again keep the
	 * new values, and assignments on rows the run only matched stay. The
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

		return db.transaction(async (tx) => {
			const created = await tx
				.select({ kind: importMapping.kind, localId: importMapping.localId })
				.from(importMapping)
				.where(
					and(eq(importMapping.runId, run.id), eq(importMapping.created, true)),
				);
			const of = (kind: HarvestMappingKind) =>
				created.filter((m) => m.kind === kind).map((m) => m.localId);
			const userIds = of("person");
			const projectIds = of("project");
			const taskIds = of("task");
			const clientIds = of("client");
			const closeIds = of("close");

			// Made by this run, or only attached to it? Both rows took `now()`
			// from the one transaction in `start`, so an attached user is the
			// one whose row is older than the run. Compared in SQL: the user's
			// column has no time zone, and Postgres converts it the same way it
			// stored `now()` into it.
			const madeUsers = new Set<string>();
			const signedIn = await usersWithAccount(tx, userIds);
			for (const batch of inBatches(userIds)) {
				const rows = await tx
					.select({ id: user.id, name: user.name })
					.from(user)
					.where(
						and(
							inArray(user.id, batch),
							sql`${user.createdAt} >= (select ${importRun.createdAt} from ${importRun} where ${importRun.id} = ${run.id})`,
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

			const refs = [
				projectIds.length > 0 ? inArray(timeEntry.projectId, projectIds) : null,
				taskIds.length > 0 ? inArray(timeEntry.taskId, taskIds) : null,
				userIds.length > 0 ? inArray(timeEntry.userId, userIds) : null,
			].filter((c) => c != null);
			if (refs.length > 0) {
				const used = await tx
					.select({ date: timeEntry.date })
					.from(timeEntry)
					.where(
						and(
							eq(timeEntry.organizationId, org),
							or(
								isNull(timeEntry.importRunId),
								ne(timeEntry.importRunId, run.id),
							),
							or(...refs),
						),
					)
					.limit(1);
				if (used[0]) {
					throw new Error(
						`An entry made here on ${used[0].date} uses a row this import created`,
					);
				}
			}
			if (projectIds.length > 0) {
				const closed = await tx
					.select({ id: monthlyClose.id })
					.from(monthlyClose)
					.where(
						and(
							inArray(monthlyClose.projectId, projectIds),
							closeIds.length > 0
								? sql`${monthlyClose.id} not in (${sql.join(
										closeIds.map((id) => sql`${id}`),
										sql`, `,
									)})`
								: undefined,
						),
					)
					.limit(1);
				if (closed[0]) {
					throw new Error(
						"A month on a project this import created was closed here",
					);
				}
			}

			const deleted = await tx
				.delete(timeEntry)
				.where(eq(timeEntry.importRunId, run.id))
				.returning({ id: timeEntry.id });
			for (const batch of inBatches(closeIds)) {
				await tx.delete(monthlyClose).where(inArray(monthlyClose.id, batch));
			}
			for (const batch of inBatches(projectIds)) {
				await tx.delete(project).where(inArray(project.id, batch));
			}
			for (const batch of inBatches(clientIds)) {
				await tx.delete(client).where(inArray(client.id, batch));
			}
			for (const batch of inBatches(taskIds)) {
				await tx.delete(task).where(inArray(task.id, batch));
			}
			for (const userId of userIds) {
				if (madeUsers.has(userId)) {
					await tx.delete(user).where(eq(user.id, userId));
					continue;
				}
				// An attached user keeps their account; only this org's rows go.
				await tx
					.delete(projectMember)
					.where(
						and(
							eq(projectMember.organizationId, org),
							eq(projectMember.userId, userId),
						),
					);
				await tx
					.delete(memberSchedule)
					.where(
						and(
							eq(memberSchedule.organizationId, org),
							eq(memberSchedule.userId, userId),
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
					.where(
						and(eq(member.organizationId, org), eq(member.userId, userId)),
					);
			}
			await tx.delete(importMapping).where(eq(importMapping.runId, run.id));
			await tx
				.update(importRun)
				.set({ status: "undone", undoneAt: new Date(), updatedAt: new Date() })
				.where(eq(importRun.id, run.id));

			return {
				entriesDeleted: deleted.length,
				closesDeleted: closeIds.length,
				projectsDeleted: projectIds.length,
				clientsDeleted: clientIds.length,
				tasksDeleted: taskIds.length,
				peopleRemoved: userIds.length,
			};
		});
	},
};
