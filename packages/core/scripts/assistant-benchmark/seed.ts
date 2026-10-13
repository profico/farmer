// A synthetic organization for the assistant benchmark.
//
// The data is made of the run date, not of fixed dates. The assistant reads the
// real clock, so a question such as "last week" must have an answer for any day
// the benchmark runs. One seeded random generator drives every choice, so the
// same run date builds the same organization.
//
// Real company data is not used. A benchmark sends the rows to many inference
// providers that the organization did not choose.

import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "../../src/db";
import { member, organization, user } from "../../src/db/schema/auth";
import {
	client,
	project,
	projectMember,
	timeEntry,
} from "../../src/db/schema/domain";
import {
	projectGithubRepo,
	timeEntryGithubCommit,
} from "../../src/db/schema/github";
import { memberTypeHistory } from "../../src/db/schema/people";
import { orgSettings } from "../../src/db/schema/settings";
import { ensureOrgTasks, ensureSiteTasks } from "../../src/db/seed-tasks";
import {
	addDaysToKey,
	dayKeyInTz,
	endOfMonthKey,
	startOfMonthKey,
	startOfWeekKey,
} from "../../src/lib/time";
import {
	type DateRange,
	ledgerByUser,
	ledgerTotal,
} from "../../src/services/ledger";
import type { Ctx } from "../../src/services/types";

export const ORG_ID = "bench-lab-org";
const TIMEZONE = "Europe/Zagreb";
/** How many days before today the data starts. It covers a whole last month. */
const HISTORY_DAYS = 270;

/** Positions in the list of 40 people. */
const READER = 0;
const WRITER = 1;
const ON_LEAVE = 20;
const OVERTIME_TOP = 25;
const OVERTIME_SECOND = 26;
const PEOPLE_COUNT = 40;

const FIRST_NAMES = [
	"Ana",
	"Boris",
	"Clara",
	"Dario",
	"Elena",
	"Filip",
	"Greta",
	"Hugo",
	"Ines",
	"Jakov",
	"Katja",
	"Luka",
	"Maja",
	"Nikola",
	"Olga",
	"Petar",
	"Rina",
	"Sven",
	"Tina",
	"Vito",
	"Zara",
	"Emil",
	"Nora",
	"Dino",
];
const LAST_NAMES = [
	"Babic",
	"Cvitan",
	"Dukic",
	"Erceg",
	"Fabris",
	"Grgic",
	"Horvat",
	"Ivanic",
	"Jelic",
	"Kovac",
	"Lovric",
	"Matic",
	"Novak",
	"Oreb",
	"Pavic",
	"Rukavina",
	"Saric",
	"Tomic",
	"Vlahov",
	"Zoric",
];

const PROJECTS = [
	{ name: "Atlas Platform", code: "ATLAS", client: "Northwind" },
	{ name: "Beacon Mobile", code: "BEACON", client: "Northwind" },
	{ name: "Cobalt Portal", code: "COBALT", client: "Vertex Group" },
	{ name: "Delta Analytics", code: "DELTA", client: "Vertex Group" },
	{ name: "Ember Storefront", code: "EMBER", client: "Kestrel Retail" },
	{ name: "Falcon API", code: "FALCON", client: "Kestrel Retail" },
	{ name: "Granite Design System", code: "GRANITE", client: "Bench Lab" },
	{ name: "Harbour Internal Tools", code: "HARBOUR", client: "Bench Lab" },
];
const ATLAS = 0;
const DELTA = 3;
const FALCON = 5;

const NOTES = [
	"Fixed the pagination cursor on the orders list",
	"Reviewed the migration plan with the client",
	"Wrote integration tests for the payment webhook",
	"Refactored the invoice PDF renderer",
	"Traced and fixed the N+1 on the dashboard query",
	"Paired on the session refresh bug",
	"Drafted the API contract for the export endpoint",
	"Cleaned up the deploy pipeline caching",
];

/** The repository that a question names, and one that it does not name. */
export const TARGET_REPO = "profico/farmer";
const DECOY_REPO = "profico/other";

/** mulberry32: small, fast, and the same sequence on every machine. */
const makeRandom = (start: number) => {
	let seed = start;
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = seed;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

/** 0 = Sunday, as in `Date#getUTCDay`. A day key has no zone. */
const weekdayOf = (dayKey: string): number =>
	new Date(`${dayKey}T00:00:00Z`).getUTCDay();
const isWeekday = (dayKey: string): boolean => {
	const weekday = weekdayOf(dayKey);
	return weekday !== 0 && weekday !== 6;
};

const daysBetween = (from: string, to: string): string[] => {
	const days: string[] = [];
	for (let day = from; day <= to; day = addDaysToKey(day, 1)) days.push(day);
	return days;
};

type EntryRow = typeof timeEntry.$inferInsert;
type CommitRow = typeof timeEntryGithubCommit.$inferInsert;

/** What a question is graded against. All values come from the ledger. */
export type Truth = {
	readerLastWeekHours: number;
	readerLastMonthHours: number;
	/** The whole company, last month. The wrong answer to "my hours". */
	companyLastMonthHours: number;
	deltaLastMonthHours: number;
	overtimeTopName: string;
	overtimeTopHours: number;
	onLeaveName: string;
	onLeaveDays: number;
};

export type Seeded = {
	reader: Ctx;
	writer: Ctx;
	today: string;
	yesterday: string;
	nextMonday: string;
	lastWeek: DateRange;
	lastMonth: DateRange;
	people: number;
	entries: number;
	ids: {
		atlasProjectId: string;
		developmentTaskId: string;
		vacationTaskId: string;
		/** The writer's one entry of yesterday. */
		writerYesterdayEntryId: string;
		/** The target repository's commit attachments on yesterday. */
		targetAttachmentIds: string[];
	};
	truth: Truth;
	/** Put the two caller users back as seeded. Call before each run. */
	reset: () => Promise<void>;
};

const hoursOf = (seconds: number): number => seconds / 3600;

export const seedOrganization = async (): Promise<Seeded> => {
	const random = makeRandom(20261007);
	const today = dayKeyInTz(new Date(), TIMEZONE);
	const yesterday = addDaysToKey(today, -1);
	const firstDay = addDaysToKey(today, -HISTORY_DAYS);
	const thisWeek = startOfWeekKey(today, 1);
	const lastWeek: DateRange = {
		from: addDaysToKey(thisWeek, -7),
		to: addDaysToKey(thisWeek, -1),
	};
	const lastMonthStart = startOfMonthKey(
		addDaysToKey(startOfMonthKey(today), -1),
	);
	const lastMonth: DateRange = {
		from: lastMonthStart,
		to: endOfMonthKey(lastMonthStart),
	};
	const nextMonday = addDaysToKey(thisWeek, 7);

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Bench Lab",
		slug: "bench-lab",
		createdAt: new Date("2024-01-01"),
		timezone: TIMEZONE,
		country: "HR",
		weekStartsOn: 1,
	});
	await db.insert(orgSettings).values({ organizationId: ORG_ID });
	await ensureSiteTasks();
	await ensureOrgTasks(ORG_ID);

	const people = Array.from({ length: PEOPLE_COUNT }, (_, index) => ({
		id: `bench-u-${String(index).padStart(2, "0")}`,
		name: `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[(index + Math.floor(index / FIRST_NAMES.length) * 3) % LAST_NAMES.length]}`,
	}));
	// A name with two owners gives a question two right answers.
	if (new Set(people.map((person) => person.name)).size !== people.length) {
		throw new Error("The seeded names are not unique.");
	}
	const person = (index: number) => {
		const found = people[index];
		if (!found) throw new Error(`No seeded person at ${index}.`);
		return found;
	};

	await db.insert(user).values(
		people.map((p) => ({
			id: p.id,
			name: p.name,
			email: `${p.id}@bench.lab`,
			emailVerified: true,
			createdAt: new Date("2024-01-01"),
			updatedAt: new Date("2024-01-01"),
		})),
	);
	await db.insert(member).values(
		people.map((p, index) => ({
			id: `bench-m-${index}`,
			organizationId: ORG_ID,
			userId: p.id,
			// The reader is the owner, so the reports answer and do not refuse.
			role: index === READER ? "owner" : "member",
			createdAt: new Date("2024-01-01"),
		})),
	);
	await db.insert(memberTypeHistory).values(
		people.map((p) => ({
			organizationId: ORG_ID,
			userId: p.id,
			type: "employee_billable" as const,
			effectiveFrom: "2024-01-01",
		})),
	);

	const clientNames = [...new Set(PROJECTS.map((p) => p.client))];
	const clients = await db
		.insert(client)
		.values(
			clientNames.map((name) => ({
				organizationId: ORG_ID,
				name,
				isInternal: name === "Bench Lab",
			})),
		)
		.returning();
	const clientId = new Map(clients.map((c) => [c.name, c.id]));
	const projects = await db
		.insert(project)
		.values(
			PROJECTS.map((p) => ({
				organizationId: ORG_ID,
				clientId: clientId.get(p.client) ?? "",
				name: p.name,
				code: p.code,
				type: "product_team" as const,
			})),
		)
		.returning();
	const projectAt = (index: number) => {
		const found = projects[index];
		if (!found) throw new Error(`No seeded project at ${index}.`);
		return found;
	};

	// The reader is PM on every project. The writer is on two projects, and
	// neither is Delta, so a write question never changes the Delta total.
	// Everyone else is on three projects.
	const assigned = (index: number): number[] => {
		if (index === READER) return projects.map((_, i) => i);
		if (index === WRITER) return [ATLAS, FALCON];
		return [0, 1, 2].map((k) => (index + k) % projects.length);
	};
	await db.insert(projectMember).values(
		people.flatMap((p, index) =>
			assigned(index).map((projectIndex) => ({
				organizationId: ORG_ID,
				projectId: projectAt(projectIndex).id,
				userId: p.id,
				role: index === READER ? ("pm" as const) : ("member" as const),
				active: true,
			})),
		),
	);

	const tasks = await db.query.task.findMany({
		where: (t, { or, eq: equals, isNull }) =>
			or(equals(t.organizationId, ORG_ID), isNull(t.organizationId)),
	});
	const vacation = tasks.find((t) => t.systemKey === "vacation");
	const development = tasks.find((t) => t.name === "Development");
	const worked = tasks.filter((t) => !t.isAbsence && t.systemKey === null);
	if (!vacation || !development || worked.length === 0) {
		throw new Error("The seeded tasks are not what the benchmark expects.");
	}

	const rows: EntryRow[] = [];
	const addRow = (row: Omit<EntryRow, "id" | "organizationId">) => {
		rows.push({ ...row, id: randomUUID(), organizationId: ORG_ID });
	};

	const leaveFrom = addDaysToKey(today, -50);
	const leaveTo = addDaysToKey(today, -30);
	const weekdays = daysBetween(firstDay, yesterday).filter(isWeekday);
	for (const [index, p] of people.entries()) {
		// The writer has only the entries of the GitHub flow, below.
		if (index === WRITER) continue;
		const mine = assigned(index);
		for (const date of weekdays) {
			if (index === ON_LEAVE && date >= leaveFrom && date <= leaveTo) {
				addRow({
					userId: p.id,
					date,
					taskId: vacation.id,
					description: "",
					durationSeconds: 8 * 3600,
				});
				continue;
			}
			// A day off, with no entry.
			if (random() < 0.12) continue;
			const count = 1 + Math.floor(random() * 3);
			for (let n = 0; n < count; n += 1) {
				const projectIndex = mine[(n + index) % mine.length] ?? ATLAS;
				const picked = worked[Math.floor(random() * worked.length)];
				if (!picked) continue;
				addRow({
					userId: p.id,
					date,
					projectId: projectAt(projectIndex).id,
					taskId: picked.id,
					description: NOTES[Math.floor(random() * NOTES.length)] ?? "work",
					// 1 to 3 hours, in quarter hours: the assistant must not need
					// to round.
					durationSeconds: (4 + Math.floor(random() * 9)) * 900,
					overtime: false,
				});
			}
		}
	}

	// Overtime has one clear winner. The last 50 days hold twelve flagged
	// entries of four hours for the first person, and three for the second.
	const recent = weekdays.filter((date) => date >= addDaysToKey(today, -49));
	const flag = (index: number, count: number) => {
		for (let n = 0; n < count; n += 1) {
			addRow({
				userId: person(index).id,
				date: recent[n * 3] ?? recent[0] ?? yesterday,
				projectId: projectAt(ATLAS).id,
				taskId: development.id,
				description: "Release night work",
				durationSeconds: 4 * 3600,
				overtime: true,
			});
		}
	};
	flag(OVERTIME_TOP, 12);
	flag(OVERTIME_SECOND, 3);

	// The writer's GitHub flow: one entry yesterday with commits from two
	// repositories, and one entry the day before with commits that a question
	// about yesterday must not touch.
	const atlas = projectAt(ATLAS);
	const writerId = person(WRITER).id;
	const repoRows = await db
		.insert(projectGithubRepo)
		.values(
			[TARGET_REPO, DECOY_REPO].map((fullName, index) => ({
				organizationId: ORG_ID,
				projectId: atlas.id,
				githubRepoId: 1000 + index,
				installationId: 1,
				owner: fullName.split("/")[0] ?? "",
				name: fullName.split("/")[1] ?? "",
				fullName,
			})),
		)
		.returning();
	const targetRepo = repoRows.find((r) => r.fullName === TARGET_REPO);
	const decoyRepo = repoRows.find((r) => r.fullName === DECOY_REPO);
	if (!targetRepo || !decoyRepo)
		throw new Error("The repositories are missing.");

	const writerYesterday = randomUUID();
	const writerEarlier = randomUUID();
	const dayBefore = addDaysToKey(today, -2);
	const writerEntries: EntryRow[] = [
		{
			id: writerYesterday,
			organizationId: ORG_ID,
			userId: writerId,
			date: yesterday,
			projectId: atlas.id,
			taskId: development.id,
			description: "Planning session",
			durationSeconds: 3600,
		},
		{
			id: writerEarlier,
			organizationId: ORG_ID,
			userId: writerId,
			date: dayBefore,
			projectId: atlas.id,
			taskId: development.id,
			description: "Review work",
			durationSeconds: 3600,
		},
	];
	const commit = (
		timeEntryId: string,
		repoId: string,
		sha: string,
		hour: number,
		day: string,
	): CommitRow => ({
		id: randomUUID(),
		timeEntryId,
		projectGithubRepoId: repoId,
		sha,
		message: `Commit ${sha.slice(0, 7)}\n\nA long body.`,
		committedAt: new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`),
		url: `https://github.com/${TARGET_REPO}/commit/${sha}`,
	});
	const writerCommits: CommitRow[] = [
		...[9, 10, 11].map((hour) =>
			commit(
				writerYesterday,
				targetRepo.id,
				`a1${hour}`.padEnd(40, "0"),
				hour,
				yesterday,
			),
		),
		commit(writerYesterday, decoyRepo.id, "b10".padEnd(40, "0"), 12, yesterday),
		...[9, 10].map((hour) =>
			commit(
				writerEarlier,
				targetRepo.id,
				`c1${hour}`.padEnd(40, "0"),
				hour,
				dayBefore,
			),
		),
	];
	const targetAttachmentIds = writerCommits
		.filter(
			(row) =>
				row.timeEntryId === writerYesterday &&
				row.projectGithubRepoId === targetRepo.id,
		)
		.map((row) => row.id ?? "");

	for (let at = 0; at < rows.length; at += 500) {
		await db.insert(timeEntry).values(rows.slice(at, at + 500));
	}
	await db.insert(timeEntry).values(writerEntries);
	await db.insert(timeEntryGithubCommit).values(writerCommits);

	// The ground truth, from the ledger and not from this file's arithmetic.
	const readerCtx: Ctx = { organizationId: ORG_ID, userId: person(READER).id };
	const writerCtx: Ctx = { organizationId: ORG_ID, userId: writerId };
	const delta = projectAt(DELTA);
	const overtime = await ledgerByUser(
		readerCtx,
		{ from: addDaysToKey(today, -60), to: today },
		"worked",
		{ overtimeOnly: true },
	);
	const ranked = [...overtime.entries()].sort((a, b) => b[1] - a[1]);
	if (ranked[0]?.[0] !== person(OVERTIME_TOP).id) {
		throw new Error("The overtime winner is not the one that was seeded.");
	}
	const onLeaveSeconds = await ledgerTotal(
		readerCtx,
		{ from: addDaysToKey(today, -60), to: today },
		"absence",
		{ userId: person(ON_LEAVE).id },
	);
	const truth: Truth = {
		readerLastWeekHours: hoursOf(
			await ledgerTotal(readerCtx, lastWeek, "worked", {
				userId: readerCtx.userId,
			}),
		),
		readerLastMonthHours: hoursOf(
			await ledgerTotal(readerCtx, lastMonth, "worked", {
				userId: readerCtx.userId,
			}),
		),
		companyLastMonthHours: hoursOf(
			await ledgerTotal(readerCtx, lastMonth, "worked"),
		),
		deltaLastMonthHours: hoursOf(
			await ledgerTotal(readerCtx, lastMonth, "worked", {
				projectId: delta.id,
			}),
		),
		overtimeTopName: person(OVERTIME_TOP).name,
		overtimeTopHours: hoursOf(ranked[0]?.[1] ?? 0),
		onLeaveName: person(ON_LEAVE).name,
		onLeaveDays: onLeaveSeconds / (8 * 3600),
	};

	// The two callers as seeded, so a run can put them back. A write question
	// changes entries, and a read question can write a fill block. Neither
	// may change the next run.
	const readerRows = rows.filter((row) => row.userId === readerCtx.userId);
	const reset = async () => {
		const users = [readerCtx.userId, writerCtx.userId];
		await db
			.delete(timeEntry)
			.where(
				and(
					eq(timeEntry.organizationId, ORG_ID),
					inArray(timeEntry.userId, users),
				),
			);
		for (let at = 0; at < readerRows.length; at += 500) {
			await db.insert(timeEntry).values(readerRows.slice(at, at + 500));
		}
		await db.insert(timeEntry).values(writerEntries);
		await db.insert(timeEntryGithubCommit).values(writerCommits);
	};

	return {
		reader: readerCtx,
		writer: writerCtx,
		today,
		yesterday,
		nextMonday,
		lastWeek,
		lastMonth,
		people: people.length,
		entries: rows.length + writerEntries.length,
		ids: {
			atlasProjectId: atlas.id,
			developmentTaskId: development.id,
			vacationTaskId: vacation.id,
			writerYesterdayEntryId: writerYesterday,
			targetAttachmentIds,
		},
		truth,
		reset,
	};
};
