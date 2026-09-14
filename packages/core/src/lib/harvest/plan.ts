// The import plan (docs/plans/harvest-import.md, sections 4, 5 and 6). Two
// halves, because the browser re-plans on every choice the admin makes:
//
// - `parseHarvestFiles` is the slow, async half and runs ONCE per drop: it
//   detects each file, parses the rows, hashes every row's import key and
//   every person-day's digest, and aggregates the reference data.
// - `planHarvestImport` is synchronous and pure: the same parsed files,
//   snapshot and choices always give the same plan.
//
// Everything here runs in a Web Worker, so: no node/bun imports, nothing
// from `services/` or `db/`, and every value that crosses `postMessage` is a
// plain object or array.
import { HARVEST_CHUNK_MAX_ROWS } from "../../schema/harvest-import";
import type {
	HarvestClientPlan,
	HarvestImportDay,
	HarvestImportRow,
	HarvestPersonPlan,
	HarvestProjectPlan,
	HarvestStartInput,
	HarvestTaskPlan,
} from "../../schema/harvest-import";
import type { MemberTypeValue } from "../../schema/members";
import type { ProjectTypeValue } from "../../schema/projects";
import type { HarvestMappingKind, HarvestSnapshot } from "./contract";
import { iterateCsvRecords, readCsvHeader } from "./csv";
import {
	type ClientRow,
	type HarvestFileKind,
	type PeopleRow,
	type ProjectRow,
	type TaskRow,
	detectHarvestFile,
	toClientRow,
	toPeopleRow,
	toProjectRow,
	toTaskRow,
	toTimeReportRow,
} from "./detect";
import {
	DAY_DIGEST_LENGTH,
	type ImportKeyFields,
	dayDigest,
	keysForPersonDay,
	personDayKey,
} from "./keys";
import { hoursToSeconds, roundToQuarterHour } from "./number";

// --- Constants -------------------------------------------------------------

/** The first day people log in this app: September 2026. Work rows on or
 *  after it are skipped; everything before comes from Harvest. */
export const HARVEST_DEFAULT_CUTOFF = "2026-09-01";
export const HARVEST_GUESS_DOMAIN = "profico.hr";
/** A project-person pair with a row this many days before the cutoff (or
 *  later) is an active assignment. */
export const HARVEST_ACTIVE_WINDOW_DAYS = 90;
/** A project with a work row this many days before the cutoff is active,
 *  whether or not the project list names it — the list can only add to that
 *  set (and supplies codes). Everything else is created archived. */
export const HARVEST_ACTIVE_PROJECT_WINDOW_DAYS = 31;

const DAY_SECONDS = 24 * 3600;
const MAX_ROWS_PER_DAY = 500;
const MAX_DESCRIPTION = 10_000;
const MAX_CODE = 16;

/** Client names that map to the org's internal client by default. */
const INTERNAL_CLIENT_NAMES = new Set(["profico", "internal"]);

export type HarvestAbsenceKind = "vacation" | "sick" | "paid_leave";

/** Harvest's absence projects, by code. */
const ABSENCE_BY_CODE = new Map<string, HarvestAbsenceKind>([
	["PVC", "vacation"],
	["PSL", "sick"],
	["PPL", "paid_leave"],
]);

/** The canonical task name (and task source key) of each absence kind. */
const ABSENCE_TASK_KEY = {
	vacation: "vacation",
	sick: "sick leave",
	paid_leave: "paid leave",
} as const satisfies Record<HarvestAbsenceKind, string>;

const ABSENCE_BY_TASK = new Map<string, HarvestAbsenceKind>([
	["vacation", "vacation"],
	["sick leave", "sick"],
	["paid leave", "paid_leave"],
]);

/** Task aliases (plan section 4, "Tasks"): the canonical task, and whether
 *  the row carries the overtime flag (D3, option A). */
const TASK_ALIASES = new Map<string, { task: string; overtime: boolean }>([
	["daily break", { task: "break", overtime: false }],
	["framer overtime", { task: "framer", overtime: true }],
	["design overtime", { task: "design", overtime: true }],
	["development (overtime)", { task: "development", overtime: true }],
]);

/** Canonical task names that resolve by the site task's system key. */
const SYSTEM_KEY_BY_TASK = new Map<string, string>([
	["meeting", "meeting"],
	["break", "break"],
	["vacation", "vacation"],
	["sick leave", "sick"],
	["paid leave", "paid_leave"],
]);

// --- Small pure helpers ----------------------------------------------------

/** NFC, trimmed, lower case, inner whitespace collapsed to one space. */
export function normName(s: string): string {
	return s.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

const TRANSLITERATE = new Map<string, string>([
	["č", "c"],
	["ć", "c"],
	["đ", "d"],
	["š", "s"],
	["ž", "z"],
]);

function asciiFold(s: string): string {
	let out = "";
	for (const ch of s.normalize("NFC").toLowerCase()) {
		out += TRANSLITERATE.get(ch) ?? ch;
	}
	return out
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replace(/[^a-z0-9]/g, "");
}

/** The address a former employee most likely had: the first letter of the
 *  first name and the whole last name, folded to ASCII, at `profico.hr`.
 *  "Ivan Horvat" gives "ihorvat@profico.hr". */
export function guessEmail(first: string, last: string): string {
	const initial = asciiFold(first).slice(0, 1);
	return `${initial}${asciiFold(last)}@${HARVEST_GUESS_DOMAIN}`;
}

/** Deliberately loose: the server's Zod `z.email()` is the real check. This
 *  only keeps an obviously broken address out of a plan marked ready. */
function looksLikeEmail(s: string): boolean {
	return /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(date: string, days: number): string {
	const [y, m, d] = date.split("-").map(Number);
	const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + days * 86_400_000;
	return new Date(t).toISOString().slice(0, 10);
}

function projectSourceKeyOf(client: string, project: string, code: string) {
	return JSON.stringify([normName(client), normName(project), code.trim()]);
}

function pairKey(a: string, b: string): string {
	return JSON.stringify([a, b]);
}

function mappingKey(kind: HarvestMappingKind, sourceKey: string): string {
	return JSON.stringify([kind, sourceKey]);
}

// A synchronous SHA-256, used ONLY for the day digest of a person-day whose
// sent rows are a subset of its rows in the file (see `dayDigestSync`). Web
// Crypto has no synchronous digest, and the planner must stay synchronous.
const SHA256_K = [
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
	0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
	0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
	0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
	0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
	0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
	0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
	0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
	0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x: number, n: number): number {
	return (x >>> n) | (x << (32 - n));
}

function sha256HexSync(input: string): string {
	const bytes = new TextEncoder().encode(input);
	const blocks = Math.ceil((bytes.length + 9) / 64);
	const padded = new Uint8Array(blocks * 64);
	padded.set(bytes);
	padded[bytes.length] = 0x80;
	const view = new DataView(padded.buffer);
	const bitLength = bytes.length * 8;
	view.setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32));
	view.setUint32(padded.length - 4, bitLength >>> 0);

	const h = [
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
		0x1f83d9ab, 0x5be0cd19,
	];
	const w = new Array<number>(64).fill(0);
	for (let offset = 0; offset < padded.length; offset += 64) {
		for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
		for (let i = 16; i < 64; i++) {
			const a = w[i - 15] ?? 0;
			const b = w[i - 2] ?? 0;
			const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
			const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
			w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) | 0;
		}
		let a = h[0] ?? 0;
		let b = h[1] ?? 0;
		let c = h[2] ?? 0;
		let d = h[3] ?? 0;
		let e = h[4] ?? 0;
		let f = h[5] ?? 0;
		let g = h[6] ?? 0;
		let hh = h[7] ?? 0;
		for (let i = 0; i < 64; i++) {
			const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const ch = (e & f) ^ (~e & g);
			const t1 = (hh + s1 + ch + (SHA256_K[i] ?? 0) + (w[i] ?? 0)) | 0;
			const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
			const maj = (a & b) ^ (a & c) ^ (b & c);
			const t2 = (s0 + maj) | 0;
			hh = g;
			g = f;
			f = e;
			e = (d + t1) | 0;
			d = c;
			c = b;
			b = a;
			a = (t1 + t2) | 0;
		}
		const next = [a, b, c, d, e, f, g, hh];
		for (let i = 0; i < 8; i++) h[i] = ((h[i] ?? 0) + (next[i] ?? 0)) | 0;
	}
	return h.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

/** `dayDigest` from `keys.ts`, synchronously. Same input, same output. */
export function dayDigestSync(keys: readonly string[]): string {
	return sha256HexSync([...keys].sort().join(",")).slice(0, DAY_DIGEST_LENGTH);
}

// --- Parsed files ----------------------------------------------------------

export interface HarvestFileInfo {
	name: string;
	kind: HarvestFileKind;
	/** Data rows, not counting the header. */
	rows: number;
	used: boolean;
	reason: string;
}

/** One time-report row that has a date, a person, a client, a project and a
 *  task. Rows without one of those are in `ParsedHarvest.invalidRows`. */
export interface ParsedTimeRow {
	/** 1-based position among the file's data rows. */
	record: number;
	date: string;
	/** `personDayKey(date, first, last)` with the person's canonical names;
	 *  the key of `HarvestChoices.overlap.days`. */
	dayKey: string;
	personSourceKey: string;
	clientName: string;
	projectName: string;
	projectCode: string;
	taskName: string;
	notes: string;
	hoursRaw: string;
	clientSourceKey: string;
	/** Null for an absence row: an absence entry carries no project. */
	projectSourceKey: string | null;
	taskSourceKey: string;
	absence: HarvestAbsenceKind | null;
	overtime: boolean;
	/** Exact seconds, or null when Hours did not parse. */
	rawSeconds: number | null;
	/** Rounded to the quarter hour, or null when Hours did not parse. */
	seconds: number | null;
	billable: boolean;
	/** Why the row cannot be imported whatever the choices, else null. */
	problem: string | null;
	/** The import key (`keys.ts`). */
	key: string;
}

export interface ParsedDay {
	dayKey: string;
	personSourceKey: string;
	date: string;
	/** Indexes into `ParsedHarvest.rows`, in file order. */
	rows: number[];
	/** `dayDigest` of every row key of the day. */
	digest: string;
}

export interface ParsedPerson {
	sourceKey: string;
	firstName: string;
	lastName: string;
	/** The people-list row, or null for a person only in the time report. */
	listed: PeopleRow | null;
	firstDate: string | null;
	lastDate: string | null;
	/** Harvest's "Employee?" on the person's latest time-report row. */
	employeeInReport: boolean | null;
	rows: number;
}

export interface ParsedClient {
	sourceKey: string;
	name: string;
}

export interface ParsedProject {
	sourceKey: string;
	clientSourceKey: string;
	clientName: string;
	name: string;
	code: string;
	/** The project-list row, or null when the project is only in the report. */
	listed: ProjectRow | null;
	workRows: number;
	billableRows: number;
	/** Every date with a work row, ascending — what decides "active". */
	workDates: string[];
}

export interface ParsedTask {
	sourceKey: string;
	/** The display name for a created task. */
	name: string;
	/** Every Harvest task name that maps here ("Daily Break" and "Break"). */
	harvestNames: string[];
	/** The task-list row, or null when the task list does not name it. */
	listed: TaskRow | null;
	rows: number;
}

export interface HarvestAttentionRow {
	record: number;
	date: string;
	person: string;
	client: string;
	project: string;
	task: string;
	hours: string;
	reason: string;
}

export interface ParsedHarvest {
	files: HarvestFileInfo[];
	/** Rows of the time report, sorted by nothing: file order. */
	rows: ParsedTimeRow[];
	/** Sorted by date, then person source key. */
	days: ParsedDay[];
	/** Rows with no parseable date or a missing name: never imported. */
	invalidRows: HarvestAttentionRow[];
	persons: ParsedPerson[];
	clients: ParsedClient[];
	projects: ParsedProject[];
	tasks: ParsedTask[];
	/** The time report's first and last date; null with no time report. */
	range: { from: string; to: string } | null;
	/** People-list addresses and the guesses, lower case: what the snapshot
	 *  call asks the server about. */
	candidateEmails: string[];
}

/** A Harvest task after the absence and alias rules of plan section 4. */
interface CanonicalTask {
	key: string;
	absence: HarvestAbsenceKind | null;
	overtime: boolean;
}

function canonicalTask(taskName: string, projectCode: string): CanonicalTask {
	const byCode = ABSENCE_BY_CODE.get(projectCode.trim().toUpperCase());
	const name = normName(taskName);
	const absence = byCode ?? ABSENCE_BY_TASK.get(name) ?? null;
	if (absence) {
		return { key: ABSENCE_TASK_KEY[absence], absence, overtime: false };
	}
	const alias = TASK_ALIASES.get(name);
	if (alias)
		return { key: alias.task, absence: null, overtime: alias.overtime };
	return { key: name, absence: null, overtime: false };
}

function rowProblem(
	rawSeconds: number | null,
	seconds: number | null,
	notes: string,
): string | null {
	if (rawSeconds === null) return "Hours is not a number";
	if (rawSeconds < 0 || seconds === null) return "Hours is negative";
	// The rounded value decides, as the Zod input and the edit dialog do.
	if (seconds > DAY_SECONDS) return "Longer than 24 hours";
	if (notes.length > MAX_DESCRIPTION) {
		return `Notes longer than ${MAX_DESCRIPTION} characters`;
	}
	return null;
}

interface PersonAcc {
	firstName: string;
	lastName: string;
	firstDate: string | null;
	lastDate: string | null;
	employeeInReport: boolean | null;
	rows: number;
}

interface ProjectAcc {
	clientSourceKey: string;
	clientName: string;
	name: string;
	code: string;
	workRows: number;
	billableRows: number;
	workDates: Set<string>;
}

interface TaskAcc {
	name: string;
	harvestNames: Set<string>;
	rows: number;
}

interface DayAcc {
	personSourceKey: string;
	date: string;
	rows: number[];
	fields: ImportKeyFields[];
}

/** How many person-days are hashed per `Promise.all` batch. */
const HASH_BATCH_DAYS = 2000;

/**
 * Detects and parses every dropped file, and hashes the time report's import
 * keys and day digests. Run it once per drop; `planHarvestImport` re-uses
 * the result for every change of choices.
 */
export async function parseHarvestFiles(
	files: { name: string; text: string }[],
): Promise<ParsedHarvest> {
	const infos: HarvestFileInfo[] = [];
	const seenKinds = new Set<HarvestFileKind>();
	let timeReport: string | null = null;
	const people: PeopleRow[] = [];
	const projectList: ProjectRow[] = [];
	const taskList: TaskRow[] = [];
	const clientList: ClientRow[] = [];

	for (const file of files) {
		const header = readCsvHeader(file.text);
		const detected =
			header.length === 0
				? { kind: "unknown" as const, reason: "the file is empty" }
				: detectHarvestFile(header);
		const info: HarvestFileInfo = {
			name: file.name,
			kind: detected.kind,
			rows: 0,
			used: false,
			reason: detected.reason,
		};
		infos.push(info);
		if (detected.kind === "unknown") {
			info.reason = `Not used: ${detected.reason}`;
			continue;
		}
		if (seenKinds.has(detected.kind)) {
			info.reason = `Not used: an earlier file is already the ${detected.kind} export`;
			for (const _ of iterateCsvRecords(file.text)) info.rows += 1;
			continue;
		}
		seenKinds.add(detected.kind);
		info.used = true;
		info.reason = "Used";
		if (detected.kind === "time_report") {
			timeReport = file.text;
			continue;
		}
		for (const record of iterateCsvRecords(file.text)) {
			info.rows += 1;
			if (detected.kind === "people") people.push(toPeopleRow(record));
			else if (detected.kind === "projects") {
				projectList.push(toProjectRow(record));
			} else if (detected.kind === "tasks") taskList.push(toTaskRow(record));
			else clientList.push(toClientRow(record));
		}
	}

	const rows: ParsedTimeRow[] = [];
	const invalidRows: HarvestAttentionRow[] = [];
	const persons = new Map<string, PersonAcc>();
	const clients = new Map<string, string>();
	const projects = new Map<string, ProjectAcc>();
	const tasks = new Map<string, TaskAcc>();
	const days = new Map<string, DayAcc>();
	let from: string | null = null;
	let to: string | null = null;

	if (timeReport !== null) {
		const info = infos.find((i) => i.kind === "time_report" && i.used);
		let record = 0;
		for (const rec of iterateCsvRecords(timeReport)) {
			record += 1;
			const t = toTimeReportRow(rec);
			const person = `${t.firstName} ${t.lastName}`.trim();
			const personSourceKey = normName(person);
			const missing = !t.date
				? "Date is not a date"
				: personSourceKey === ""
					? "No person"
					: normName(t.client) === ""
						? "No client"
						: normName(t.project) === ""
							? "No project"
							: normName(t.task) === ""
								? "No task"
								: null;
			if (missing !== null || !t.date) {
				invalidRows.push({
					record,
					date: rec.get("Date") ?? "",
					person,
					client: t.client,
					project: t.project,
					task: t.task,
					hours: t.hoursRaw,
					reason: missing ?? "Date is not a date",
				});
				continue;
			}
			const date = t.date;
			if (from === null || date < from) from = date;
			if (to === null || date > to) to = date;

			let p = persons.get(personSourceKey);
			if (!p) {
				p = {
					firstName: t.firstName.trim(),
					lastName: t.lastName.trim(),
					firstDate: date,
					lastDate: date,
					employeeInReport: t.employee,
					rows: 0,
				};
				persons.set(personSourceKey, p);
			}
			p.rows += 1;
			if (p.firstDate === null || date < p.firstDate) p.firstDate = date;
			if (p.lastDate === null || date >= p.lastDate) {
				p.lastDate = date;
				p.employeeInReport = t.employee;
			}

			const task = canonicalTask(t.task, t.projectCode);
			const clientSourceKey = normName(t.client);
			if (!clients.has(clientSourceKey)) {
				clients.set(clientSourceKey, t.client.trim());
			}
			let projectSourceKey: string | null = null;
			if (!task.absence) {
				projectSourceKey = projectSourceKeyOf(
					t.client,
					t.project,
					t.projectCode,
				);
				let acc = projects.get(projectSourceKey);
				if (!acc) {
					acc = {
						clientSourceKey,
						clientName: t.client.trim(),
						name: t.project.trim(),
						code: t.projectCode.trim(),
						workRows: 0,
						billableRows: 0,
						workDates: new Set(),
					};
					projects.set(projectSourceKey, acc);
				}
				acc.workRows += 1;
				acc.workDates.add(date);
				if (t.billable) acc.billableRows += 1;
			}
			let taskAcc = tasks.get(task.key);
			if (!taskAcc) {
				taskAcc = { name: t.task.trim(), harvestNames: new Set(), rows: 0 };
				tasks.set(task.key, taskAcc);
			}
			taskAcc.harvestNames.add(t.task.trim());
			taskAcc.rows += 1;

			const rawSeconds = t.hours === null ? null : hoursToSeconds(t.hours);
			const seconds =
				rawSeconds === null || rawSeconds < 0
					? null
					: roundToQuarterHour(rawSeconds);
			const dayKey = personDayKey(date, p.firstName, p.lastName);
			let day = days.get(dayKey);
			if (!day) {
				day = { personSourceKey, date, rows: [], fields: [] };
				days.set(dayKey, day);
			}
			day.rows.push(rows.length);
			day.fields.push({
				date,
				firstName: t.firstName,
				lastName: t.lastName,
				client: t.client,
				project: t.project,
				projectCode: t.projectCode,
				task: t.task,
				notes: t.notes,
				hours: t.hoursRaw,
			});
			rows.push({
				record,
				date,
				dayKey,
				personSourceKey,
				clientName: t.client.trim(),
				projectName: t.project.trim(),
				projectCode: t.projectCode.trim(),
				taskName: t.task.trim(),
				notes: t.notes,
				hoursRaw: t.hoursRaw,
				clientSourceKey,
				projectSourceKey,
				taskSourceKey: task.key,
				absence: task.absence,
				overtime: task.overtime,
				rawSeconds,
				seconds,
				billable: t.billable,
				problem: rowProblem(rawSeconds, seconds, t.notes),
				key: "",
			});
		}
		if (info) info.rows = record;
	}

	// Keys and digests, one person-day at a time and a batch of days per
	// `Promise.all`, so 240k rows do not wait on 240k sequential awaits.
	const dayEntries = [...days.entries()];
	const parsedDays: ParsedDay[] = [];
	for (let start = 0; start < dayEntries.length; start += HASH_BATCH_DAYS) {
		const batch = dayEntries.slice(start, start + HASH_BATCH_DAYS);
		const hashed = await Promise.all(
			batch.map(async ([dayKey, day]) => {
				const keys = await keysForPersonDay(day.fields);
				for (let i = 0; i < keys.length; i++) {
					const row = rows[day.rows[i] ?? -1];
					if (row) row.key = keys[i] ?? "";
				}
				const digest = await dayDigest(keys);
				return {
					dayKey,
					personSourceKey: day.personSourceKey,
					date: day.date,
					rows: day.rows,
					digest,
				};
			}),
		);
		parsedDays.push(...hashed);
	}
	parsedDays.sort((a, b) =>
		a.date === b.date
			? compareStrings(a.personSourceKey, b.personSourceKey)
			: compareStrings(a.date, b.date),
	);

	// People: the people list, plus everyone only in the time report.
	const parsedPersons: ParsedPerson[] = [];
	const listedKeys = new Set<string>();
	for (const listed of people) {
		const sourceKey = normName(`${listed.firstName} ${listed.lastName}`);
		if (sourceKey === "" || listedKeys.has(sourceKey)) continue;
		listedKeys.add(sourceKey);
		const acc = persons.get(sourceKey);
		parsedPersons.push({
			sourceKey,
			firstName: listed.firstName.trim(),
			lastName: listed.lastName.trim(),
			listed,
			firstDate: acc?.firstDate ?? null,
			lastDate: acc?.lastDate ?? null,
			employeeInReport: acc?.employeeInReport ?? null,
			rows: acc?.rows ?? 0,
		});
	}
	for (const [sourceKey, acc] of persons) {
		if (listedKeys.has(sourceKey)) continue;
		parsedPersons.push({ sourceKey, listed: null, ...acc });
	}
	parsedPersons.sort((a, b) => compareStrings(a.sourceKey, b.sourceKey));

	// Projects: the time report, plus any listed project with no rows yet.
	const listedProjects = new Map<string, ProjectRow>();
	for (const listed of projectList) {
		const key = projectSourceKeyOf(listed.client, listed.name, listed.code);
		if (ABSENCE_BY_CODE.has(listed.code.trim().toUpperCase())) continue;
		if (normName(listed.client) === "" || normName(listed.name) === "") {
			continue;
		}
		listedProjects.set(key, listed);
		if (!projects.has(key)) {
			projects.set(key, {
				clientSourceKey: normName(listed.client),
				clientName: listed.client.trim(),
				name: listed.name.trim(),
				code: listed.code.trim(),
				workRows: 0,
				billableRows: 0,
				workDates: new Set(),
			});
		}
	}
	const parsedProjects: ParsedProject[] = [...projects.entries()]
		.map(([sourceKey, acc]) => ({
			sourceKey,
			...acc,
			// An array, not the Set: this crosses `postMessage` into the Worker.
			workDates: [...acc.workDates].sort(compareStrings),
			listed: listedProjects.get(sourceKey) ?? null,
		}))
		.sort((a, b) => compareStrings(a.sourceKey, b.sourceKey));

	// Clients: the time report, the client list and the project list.
	for (const listed of clientList) {
		const key = normName(listed.name);
		if (key !== "" && !clients.has(key)) clients.set(key, listed.name.trim());
	}
	for (const project of parsedProjects) {
		if (!clients.has(project.clientSourceKey)) {
			clients.set(project.clientSourceKey, project.clientName);
		}
	}
	const parsedClients: ParsedClient[] = [...clients.entries()]
		.map(([sourceKey, name]) => ({ sourceKey, name }))
		.sort((a, b) => compareStrings(a.sourceKey, b.sourceKey));

	// Tasks: every canonical task a row uses, plus every ACTIVE task-list task.
	// An inactive task nobody used is left out, and the overtime and absence
	// tasks canonicalize onto their base task and so are never created.
	const listedTasks = new Map<string, TaskRow>();
	for (const listed of taskList) {
		const canonical = canonicalTask(listed.name, "");
		const direct = normName(listed.name);
		if (direct === "") continue;
		// The base task's own row decides "archived"; an alias's row does not.
		if (canonical.key === direct) listedTasks.set(direct, listed);
		if (!tasks.has(canonical.key) && listed.active) {
			tasks.set(canonical.key, {
				name: listed.name.trim(),
				harvestNames: new Set([listed.name.trim()]),
				rows: 0,
			});
		}
	}
	const parsedTasks: ParsedTask[] = [...tasks.entries()]
		.map(([sourceKey, acc]) => {
			const listed = listedTasks.get(sourceKey) ?? null;
			return {
				sourceKey,
				// An aliased task ("framer") takes the base task's own name when a
				// row or the task list spells it.
				name: listed?.name.trim() ?? baseTaskName(sourceKey, acc),
				harvestNames: [...acc.harvestNames].sort(compareStrings),
				listed,
				rows: acc.rows,
			};
		})
		.sort((a, b) => compareStrings(a.sourceKey, b.sourceKey));

	const candidateEmails = new Set<string>();
	for (const person of parsedPersons) {
		const listed = person.listed?.email.trim().toLowerCase() ?? "";
		if (listed !== "") candidateEmails.add(listed);
		else candidateEmails.add(guessEmail(person.firstName, person.lastName));
	}

	return {
		files: infos,
		rows,
		days: parsedDays,
		invalidRows,
		persons: parsedPersons,
		clients: parsedClients,
		projects: parsedProjects,
		tasks: parsedTasks,
		range: from !== null && to !== null ? { from, to } : null,
		candidateEmails: [...candidateEmails].sort(compareStrings),
	};
}

function baseTaskName(sourceKey: string, acc: TaskAcc): string {
	for (const name of acc.harvestNames) {
		if (normName(name) === sourceKey) return name;
	}
	// Only aliased names were seen ("Framer Overtime"): title-case the key.
	return sourceKey.replace(/(^|\s)\S/g, (s) => s.toUpperCase());
}

function compareStrings(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

// --- Choices ---------------------------------------------------------------

export type HarvestClientChoice =
	| { action: "internal" }
	| { action: "create" }
	| { action: "match"; localId: string };

export interface HarvestPersonChoice {
	email?: string;
	type?: MemberTypeValue;
	role?: "admin" | "member";
}

export type HarvestOverlapDecision = "keep_app" | "keep_both";

/** What happens to a row with negative hours: Harvest's way to correct an
 *  earlier row. "subtract" takes the hours off a row of the same person,
 *  day, project and task; "leave_out" puts the row in "needs attention". */
export type HarvestNegativeDecision = "subtract" | "leave_out";

/** The answer for one group of names that differ only in accents or
 *  punctuation: the source key whose spelling the one person keeps, or
 *  "separate" for different people. */
export type HarvestDuplicateDecision = string;

/** What the admin decided on the review screen. Plain objects only: it
 *  crosses `postMessage` into the Worker. Every map is keyed by source key,
 *  except `overlap.days`, which is keyed by `ParsedTimeRow.dayKey`. */
export interface HarvestChoices {
	cutoffDate: string;
	clients: Record<string, HarvestClientChoice>;
	projectTypes: Record<string, ProjectTypeValue>;
	people: Record<string, HarvestPersonChoice>;
	overlap: {
		default: HarvestOverlapDecision;
		days: Record<string, HarvestOverlapDecision>;
	};
	/** The admin confirmed the file is a full export, so person-days that
	 *  earlier runs imported and the file no longer has are deleted. */
	confirmFullExport: boolean;
	/** Keyed by `HarvestDuplicateGroup.key`. A group with no answer blocks
	 *  the import. */
	duplicates: Record<string, HarvestDuplicateDecision>;
	/** Null until the admin answers; a file with negative rows and no answer
	 *  blocks the import. */
	negativeRows: HarvestNegativeDecision | null;
}

/** The defaults: cutoff 1 September 2026, no overrides, keep this app's entries on an
 *  overlap day, and no deletions. The two questions (duplicate names and
 *  negative rows) have no default: the admin answers them. The parsed files
 *  do not change a default today; the parameter keeps the call site stable
 *  if one ever does. */
export function defaultHarvestChoices(_parsed: ParsedHarvest): HarvestChoices {
	return {
		cutoffDate: HARVEST_DEFAULT_CUTOFF,
		clients: {},
		projectTypes: {},
		people: {},
		overlap: { default: "keep_app", days: {} },
		confirmFullExport: false,
		duplicates: {},
		negativeRows: null,
	};
}

// --- The plan --------------------------------------------------------------

export type HarvestMatchSource = "earlier_import" | "email" | "name" | "system";

export interface HarvestBlocked {
	kind: "person" | "client" | "project" | "task" | "day" | "choices";
	sourceKey: string;
	message: string;
}

export interface HarvestPersonReview {
	sourceKey: string;
	name: string;
	action: "match" | "create";
	matchedBy: HarvestMatchSource | null;
	localId: string | null;
	email: string;
	/** True for a guess only. An address from the people list, or one the
	 *  admin typed, is vouched for and is created confirmed. */
	emailGuessed: boolean;
	role: "admin" | "member" | null;
	type: MemberTypeValue | null;
	archived: boolean;
	firstDate: string | null;
	lastDate: string | null;
	rows: number;
	blocked: string | null;
	/** The other Harvest spellings merged into this person. */
	aliases: string[];
}

export interface HarvestDuplicatePerson {
	sourceKey: string;
	name: string;
	/** On the Harvest people list. */
	listed: boolean;
	rows: number;
	firstDate: string | null;
	lastDate: string | null;
}

/** People whose names differ only in accents or punctuation, and so may be
 *  one person that Harvest spelled two ways. */
export interface HarvestDuplicateGroup {
	/** The key of `HarvestChoices.duplicates`. */
	key: string;
	people: HarvestDuplicatePerson[];
	/** The answer in force, or null while the admin has not answered. */
	decision: HarvestDuplicateDecision | null;
}

export interface HarvestNegativeRow extends HarvestAttentionRow {
	/** The Hours of the row that "subtract" takes it off, or null when no
	 *  row of the same person, day, project and task has enough hours. */
	against: string | null;
}

export interface HarvestProjectReview {
	sourceKey: string;
	client: string;
	name: string;
	code: string | null;
	action: "match" | "create";
	matchedBy: HarvestMatchSource | null;
	localId: string | null;
	type: ProjectTypeValue | null;
	suggestedType: ProjectTypeValue;
	status: "active" | "archived";
	budgetSeconds: number | null;
	seconds: number;
	billableSeconds: number;
	nonBillableSeconds: number;
}

export interface HarvestClientReview {
	sourceKey: string;
	name: string;
	action: "match" | "internal" | "create";
	matchedBy: HarvestMatchSource | null;
	localId: string | null;
	archived: boolean;
	projects: number;
}

export interface HarvestTaskReview {
	sourceKey: string;
	name: string;
	harvestNames: string[];
	action: "match" | "create";
	matchedBy: HarvestMatchSource | null;
	localId: string | null;
	archived: boolean;
	rows: number;
}

export interface HarvestOverlapDay {
	dayKey: string;
	personSourceKey: string;
	person: string;
	date: string;
	/** The Harvest work rows left after dedupe. */
	harvestSeconds: number;
	/** Every work entry this app holds for the person that day. */
	appSeconds: number;
	/** Every work entry here is a calendar meeting, a recurring block or a
	 *  fill block. */
	automationOnly: boolean;
	decision: HarvestOverlapDecision;
}

export interface HarvestAbsenceConflict {
	personSourceKey: string;
	person: string;
	date: string;
	harvestTask: string;
	appTask: string;
}

export interface HarvestDayRef {
	personSourceKey: string;
	date: string;
}

export interface HarvestPlanSummary {
	/** Data rows in the time report. */
	rowsInFile: number;
	/** Rows in `days`: what this run sends. */
	rowsImported: number;
	/** Rows of days an earlier run imported and this run leaves as they are
	 *  (unchanged, or changed but edited here). */
	rowsAlreadyImported: number;
	/** Absence already booked here, or an exact work row here (5.2). */
	skippedDuplicate: number;
	/** Harvest work rows dropped by "Keep this app's entries". */
	skippedOverlap: number;
	skippedByCutoff: number;
	attentionRows: number;
	overlapDays: number;
	newDays: number;
	unchangedDays: number;
	changedDays: number;
	keptDays: number;
	removedDays: number;
	/** Over the rows the app holds from this file after the run: the rows
	 *  sent now plus the rows of days left as they are. */
	secondsPerYear: { year: string; seconds: number }[];
	/** Rounded minus exact, over the same rows. */
	roundingDeltaSeconds: number;
}

export interface HarvestPlan {
	ready: boolean;
	blocked: HarvestBlocked[];
	/** Without the run id: the runner makes one per import attempt. */
	start: Omit<HarvestStartInput, "runId">;
	/** Sorted by date, then person source key. */
	days: HarvestImportDay[];
	/** Empty unless `choices.confirmFullExport`. */
	removedDays: HarvestDayRef[];
	/** Addresses in `start` that the snapshot call did not check: the admin
	 *  typed them. Check them (`harvestEmailsInput`) and merge the answer into
	 *  `snapshot.takenEmails` before the import. */
	emailsToCheck: string[];
	review: {
		files: HarvestFileInfo[];
		summary: HarvestPlanSummary;
		people: HarvestPersonReview[];
		projects: HarvestProjectReview[];
		clients: HarvestClientReview[];
		tasks: HarvestTaskReview[];
		attention: HarvestAttentionRow[];
		/** The questions: names that may be one person, and negative rows. */
		duplicates: HarvestDuplicateGroup[];
		negativeRows: HarvestNegativeRow[];
		overlapDays: HarvestOverlapDay[];
		absenceConflicts: HarvestAbsenceConflict[];
		secondImport: {
			changedDays: HarvestDayRef[];
			keptDays: HarvestDayRef[];
			/** Listed whether or not the admin confirmed the full export. */
			removedDays: HarvestDayRef[];
		};
	};
}

type AppEntry = HarvestSnapshot["appEntries"][number];

/**
 * Builds the whole import from the parsed files, what the org already holds
 * and the admin's choices. Synchronous and pure.
 *
 * Second import (5.3), and the one digest decision: the server compares the
 * key set it RECEIVES for a day with the stored one, so the plan compares
 * the digest of the keys it SENDS. When every row of the day goes out, that
 * is the digest `parseHarvestFiles` already computed; when 5.2 dropped some
 * rows, the plan hashes the smaller set with `dayDigestSync`. So a day that
 * dedupe shrank the same way on both runs reads as unchanged, not changed.
 *
 * Unchanged days and changed days that a person edited here are left out of
 * `days` (the server would skip them anyway). A day that an earlier run
 * imported and that now sends no row at all (dedupe dropped every row) is
 * left alone too: nothing replaces its rows.
 */
export function planHarvestImport(
	parsed: ParsedHarvest,
	snapshot: HarvestSnapshot,
	choices: HarvestChoices,
): HarvestPlan {
	const blocked: HarvestBlocked[] = [];
	const cutoff = choices.cutoffDate;
	if (!DATE_RE.test(cutoff)) {
		blocked.push({
			kind: "choices",
			sourceKey: "cutoffDate",
			message: `The cutoff "${cutoff}" is not a yyyy-MM-dd date`,
		});
	}
	const negativeCount = parsed.rows.reduce(
		(n, r) => n + (r.rawSeconds !== null && r.rawSeconds < 0 ? 1 : 0),
		0,
	);
	if (negativeCount > 0 && choices.negativeRows === null) {
		blocked.push({
			kind: "choices",
			sourceKey: "negativeRows",
			message: `Decide what to do with the ${negativeCount} rows with negative hours`,
		});
	}

	const mappings = new Map<string, string>();
	const personByLocalId = new Map<string, string>();
	for (const m of snapshot.mappings) {
		mappings.set(mappingKey(m.kind, m.sourceKey), m.localId);
		if (m.kind === "person") personByLocalId.set(m.localId, m.sourceKey);
	}

	// Clients -----------------------------------------------------------------
	const clientById = new Map(snapshot.clients.map((c) => [c.id, c]));
	const clientByName = new Map<string, string>();
	for (const c of snapshot.clients) {
		const key = normName(c.name);
		if (!clientByName.has(key)) clientByName.set(key, c.id);
	}
	// Active: a work row in the window before the cutoff, or named by the
	// project list. The list adds to the set; it never archives a project that
	// was worked on last month.
	const projectActiveFrom = DATE_RE.test(cutoff)
		? addDays(cutoff, -HARVEST_ACTIVE_PROJECT_WINDOW_DAYS)
		: cutoff;
	const isActiveProject = (p: ParsedProject) =>
		p.listed !== null ||
		p.workDates.some((d) => d >= projectActiveFrom && d < cutoff);
	const activeClientKeys = new Set<string>();
	const projectsPerClient = new Map<string, number>();
	for (const p of parsed.projects) {
		if (isActiveProject(p)) activeClientKeys.add(p.clientSourceKey);
		projectsPerClient.set(
			p.clientSourceKey,
			(projectsPerClient.get(p.clientSourceKey) ?? 0) + 1,
		);
	}
	const clientPlans: HarvestClientPlan[] = [];
	const clientReview: HarvestClientReview[] = [];
	/** The local client id a project would sit under, when it is known. */
	const clientLocal = new Map<string, string | null>();
	const clientIsInternal = new Map<string, boolean>();
	for (const c of parsed.clients) {
		const review: HarvestClientReview = {
			sourceKey: c.sourceKey,
			name: c.name,
			action: "create",
			matchedBy: null,
			localId: null,
			archived: false,
			projects: projectsPerClient.get(c.sourceKey) ?? 0,
		};
		const mapped = mappings.get(mappingKey("client", c.sourceKey));
		const choice = choices.clients[c.sourceKey];
		const byName = clientByName.get(c.sourceKey);
		let plan: HarvestClientPlan;
		if (mapped !== undefined) {
			plan = { action: "match", sourceKey: c.sourceKey, localId: mapped };
			review.matchedBy = "earlier_import";
		} else if (choice?.action === "match") {
			plan = {
				action: "match",
				sourceKey: c.sourceKey,
				localId: choice.localId,
			};
			if (!clientById.has(choice.localId)) {
				blocked.push({
					kind: "client",
					sourceKey: c.sourceKey,
					message: `"${c.name}" is matched to a client that does not exist here`,
				});
			}
		} else if (
			choice?.action === "internal" ||
			(choice === undefined && INTERNAL_CLIENT_NAMES.has(c.sourceKey))
		) {
			plan = { action: "internal", sourceKey: c.sourceKey };
		} else if (choice === undefined && byName !== undefined) {
			plan = { action: "match", sourceKey: c.sourceKey, localId: byName };
			review.matchedBy = "name";
		} else {
			const archived = !activeClientKeys.has(c.sourceKey);
			plan = {
				action: "create",
				sourceKey: c.sourceKey,
				name: c.name,
				archived,
			};
		}
		clientPlans.push(plan);
		review.action = plan.action;
		if (plan.action === "match") {
			const local = clientById.get(plan.localId);
			review.localId = plan.localId;
			review.archived = local?.archived ?? false;
			clientLocal.set(c.sourceKey, plan.localId);
			clientIsInternal.set(c.sourceKey, local?.isInternal ?? false);
		} else if (plan.action === "internal") {
			review.localId = snapshot.internalClientId;
			clientLocal.set(c.sourceKey, snapshot.internalClientId);
			clientIsInternal.set(c.sourceKey, true);
		} else {
			review.archived = plan.archived;
			clientLocal.set(c.sourceKey, null);
			clientIsInternal.set(c.sourceKey, false);
		}
		if (mapped !== undefined && !clientById.has(mapped)) {
			blocked.push({
				kind: "client",
				sourceKey: c.sourceKey,
				message: `An earlier import mapped "${c.name}" to a client that no longer exists`,
			});
		}
		clientReview.push(review);
	}

	// Tasks -------------------------------------------------------------------
	const taskById = new Map(snapshot.tasks.map((t) => [t.id, t]));
	const taskBySystemKey = new Map<string, string>();
	for (const t of snapshot.tasks) {
		if (t.systemKey !== null && !taskBySystemKey.has(t.systemKey)) {
			taskBySystemKey.set(t.systemKey, t.id);
		}
	}
	const taskByName = new Map<string, string>();
	// Org tasks first, then site tasks; unarchived first within each.
	const tasksByPreference = [...snapshot.tasks].sort(
		(a, b) =>
			Number(a.scope === "site") - Number(b.scope === "site") ||
			Number(a.archived) - Number(b.archived),
	);
	for (const t of tasksByPreference) {
		const key = normName(t.name);
		if (!taskByName.has(key)) taskByName.set(key, t.id);
	}
	const taskPlans: HarvestTaskPlan[] = [];
	const taskReview: HarvestTaskReview[] = [];
	const taskLocal = new Map<string, string | null>();
	for (const t of parsed.tasks) {
		const mapped = mappings.get(mappingKey("task", t.sourceKey));
		const systemKey = SYSTEM_KEY_BY_TASK.get(t.sourceKey);
		let localId: string | null = null;
		let matchedBy: HarvestMatchSource | null = null;
		if (mapped !== undefined) {
			localId = mapped;
			matchedBy = "earlier_import";
		} else if (systemKey !== undefined) {
			localId = taskBySystemKey.get(systemKey) ?? null;
			matchedBy = localId ? "system" : null;
		}
		if (localId === null && t.sourceKey === "development") {
			localId = taskBySystemKey.get("development") ?? null;
			matchedBy = localId ? "system" : null;
		}
		if (localId === null) {
			localId = taskByName.get(t.sourceKey) ?? null;
			matchedBy = localId ? "name" : null;
		}
		const isAbsence = ABSENCE_BY_TASK.has(t.sourceKey);
		if (isAbsence && localId === null) {
			blocked.push({
				kind: "task",
				sourceKey: t.sourceKey,
				message: `The built-in absence task "${t.name}" is missing; run the migrations first`,
			});
		}
		const local = localId === null ? undefined : taskById.get(localId);
		if (localId !== null && !local) {
			blocked.push({
				kind: "task",
				sourceKey: t.sourceKey,
				message: `An earlier import mapped "${t.name}" to a task that no longer exists`,
			});
		}
		const archived =
			localId !== null
				? (local?.archived ?? false)
				: t.listed
					? !t.listed.active
					: false;
		if (localId !== null) {
			taskPlans.push({ action: "match", sourceKey: t.sourceKey, localId });
		} else {
			taskPlans.push({
				action: "create",
				sourceKey: t.sourceKey,
				name: t.name,
				archived,
			});
		}
		taskLocal.set(t.sourceKey, localId);
		taskReview.push({
			sourceKey: t.sourceKey,
			name: local?.name ?? t.name,
			harvestNames: t.harvestNames,
			action: localId !== null ? "match" : "create",
			matchedBy,
			localId,
			archived,
			rows: t.rows,
		});
	}

	// Projects ----------------------------------------------------------------
	const projectById = new Map(snapshot.projects.map((p) => [p.id, p]));
	const projectPlans: HarvestProjectPlan[] = [];
	const projectReviewByKey = new Map<string, HarvestProjectReview>();
	const projectLocal = new Map<string, string | null>();
	const projectActive = new Map<string, boolean>();
	for (const p of parsed.projects) {
		const mapped = mappings.get(mappingKey("project", p.sourceKey));
		const underClient = clientLocal.get(p.clientSourceKey) ?? null;
		const suggestedType: ProjectTypeValue = clientIsInternal.get(
			p.clientSourceKey,
		)
			? "internal"
			: p.workRows > 0 && p.billableRows === 0
				? "internal"
				: isHourBudget(p.listed)
					? "fixed_scope"
					: "product_team";
		let localId: string | null = null;
		let matchedBy: HarvestMatchSource | null = null;
		if (mapped !== undefined) {
			localId = mapped;
			matchedBy = "earlier_import";
		} else if (underClient !== null) {
			const name = normName(p.name);
			const candidates = snapshot.projects.filter(
				(sp) => sp.clientId === underClient && normName(sp.name) === name,
			);
			const best =
				candidates.find(
					(sp) => (sp.code ?? "") === p.code.slice(0, MAX_CODE),
				) ?? candidates[0];
			if (best) {
				localId = best.id;
				matchedBy = "name";
			}
		}
		const code = p.code.slice(0, MAX_CODE).trim() || null;
		const active = isActiveProject(p);
		const review: HarvestProjectReview = {
			sourceKey: p.sourceKey,
			client: p.clientName,
			name: p.name,
			code,
			action: "create",
			matchedBy,
			localId,
			type: null,
			suggestedType,
			status: active ? "active" : "archived",
			budgetSeconds: null,
			seconds: 0,
			billableSeconds: 0,
			nonBillableSeconds: 0,
		};
		if (localId !== null) {
			const local = projectById.get(localId);
			if (!local) {
				blocked.push({
					kind: "project",
					sourceKey: p.sourceKey,
					message: `An earlier import mapped "${p.clientName} :: ${p.name}" to a project that no longer exists`,
				});
			}
			// The file decides the status on a re-import too: the project set
			// that was worked on last month is the active set, however an earlier
			// run or an admin left the row.
			projectPlans.push({
				action: "match",
				sourceKey: p.sourceKey,
				localId,
				archived: !active,
			});
			review.action = "match";
			review.code = local?.code ?? code;
			review.type = isProjectType(local?.type) ? local.type : null;
			projectActive.set(p.sourceKey, active);
		} else {
			const type = choices.projectTypes[p.sourceKey] ?? suggestedType;
			const budgetSeconds =
				type === "fixed_scope" && isHourBudget(p.listed) && p.listed?.budget
					? Math.round(p.listed.budget * 3600)
					: null;
			const archived = !active;
			projectPlans.push({
				action: "create",
				sourceKey: p.sourceKey,
				clientSourceKey: p.clientSourceKey,
				name: p.name,
				code,
				type,
				archived,
				budgetSeconds:
					budgetSeconds !== null && budgetSeconds > 0 ? budgetSeconds : null,
			});
			review.type = type;
			review.budgetSeconds =
				budgetSeconds !== null && budgetSeconds > 0 ? budgetSeconds : null;
			projectActive.set(p.sourceKey, !archived);
		}
		projectLocal.set(p.sourceKey, localId);
		projectReviewByKey.set(p.sourceKey, review);
	}

	// People ------------------------------------------------------------------
	const memberById = new Map(snapshot.members.map((m) => [m.userId, m]));
	const memberByEmail = new Map(
		snapshot.members.map((m) => [m.email.trim().toLowerCase(), m]),
	);
	const memberNameCount = new Map<string, number>();
	for (const m of snapshot.members) {
		const key = normName(m.name);
		memberNameCount.set(key, (memberNameCount.get(key) ?? 0) + 1);
	}
	const memberByName = new Map(
		snapshot.members
			.filter((m) => memberNameCount.get(normName(m.name)) === 1)
			.map((m) => [normName(m.name), m]),
	);
	const taken = new Set(
		snapshot.takenEmails.map((e) => e.trim().toLowerCase()),
	);
	const listedEmails = new Set<string>();
	for (const p of parsed.persons) {
		const email = p.listed?.email.trim().toLowerCase() ?? "";
		if (email !== "") listedEmails.add(email);
	}
	const candidateEmails = new Set(parsed.candidateEmails);

	// Names that differ only in accents or punctuation ("Ive Vasiljević" and
	// "Ive Vasiljevic") are two source keys. The admin says whether they are
	// one person. A group whose every member an earlier run mapped was
	// answered then: one user is one person, two users are two.
	const personMapped = (sourceKey: string) =>
		mappings.get(mappingKey("person", sourceKey));
	const byFold = new Map<string, ParsedPerson[]>();
	for (const p of parsed.persons) {
		const fold = asciiFold(`${p.firstName} ${p.lastName}`);
		if (fold === "") continue;
		const list = byFold.get(fold);
		if (list) list.push(p);
		else byFold.set(fold, [p]);
	}
	/** A second spelling's source key, to the person it is merged into. */
	const aliasOf = new Map<string, string>();
	const aliasesOf = new Map<string, ParsedPerson[]>();
	const duplicateGroups: HarvestDuplicateGroup[] = [];
	for (const [key, members] of byFold) {
		if (members.length < 2) continue;
		const names = members.map(displayName).join(" and ");
		const localIds = new Set(
			members.flatMap((m) => personMapped(m.sourceKey) ?? []),
		);
		let decision: HarvestDuplicateDecision | null;
		if (members.every((m) => personMapped(m.sourceKey) !== undefined)) {
			if (localIds.size > 1) continue;
			decision = (members.find((m) => m.listed) ?? members[0])?.sourceKey ?? "";
		} else {
			const answer = choices.duplicates[key];
			decision =
				answer === "separate" || members.some((m) => m.sourceKey === answer)
					? (answer ?? null)
					: null;
			duplicateGroups.push({
				key,
				people: members.map((m) => ({
					sourceKey: m.sourceKey,
					name: displayName(m),
					listed: m.listed !== null,
					rows: m.rows,
					firstDate: m.firstDate,
					lastDate: m.lastDate,
				})),
				decision,
			});
			if (decision === null) {
				blocked.push({
					kind: "person",
					sourceKey: key,
					message: `Decide whether ${names} are one person or different people`,
				});
				continue;
			}
			if (decision === "separate") continue;
			if (localIds.size > 1) {
				blocked.push({
					kind: "person",
					sourceKey: key,
					message: `An earlier import made ${names} different people, so they cannot be one person now`,
				});
				continue;
			}
		}
		const aliases = members.filter((m) => m.sourceKey !== decision);
		for (const a of aliases) aliasOf.set(a.sourceKey, decision);
		aliasesOf.set(decision, aliases);
	}
	const persons = parsed.persons.flatMap((p): ParsedPerson[] => {
		if (aliasOf.has(p.sourceKey)) return [];
		const aliases = aliasesOf.get(p.sourceKey);
		return aliases ? [mergePersons(p, aliases)] : [p];
	});

	interface PersonDraft {
		person: ParsedPerson;
		review: HarvestPersonReview;
		plan: HarvestPersonPlan;
	}
	const drafts: PersonDraft[] = [];
	const personUserId = new Map<string, string | null>();
	const personActive = new Map<string, boolean>();
	const personName = new Map<string, string>();
	for (const p of persons) {
		const name = displayName(p);
		personName.set(p.sourceKey, name);
		const aliases = aliasesOf.get(p.sourceKey) ?? [];
		const spellings = [p, ...aliases];
		const listedEmail = p.listed?.email.trim().toLowerCase() || null;
		const mapped = spellings
			.map((s) => personMapped(s.sourceKey))
			.find((id) => id !== undefined);
		let member = mapped === undefined ? undefined : memberById.get(mapped);
		let matchedBy: HarvestMatchSource | null =
			mapped !== undefined ? "earlier_import" : null;
		if (mapped === undefined && listedEmail !== null) {
			member = memberByEmail.get(listedEmail);
			if (member) matchedBy = "email";
		}
		for (const s of spellings) {
			if (mapped !== undefined || member) break;
			member = memberByName.get(s.sourceKey);
			if (member) matchedBy = "name";
		}
		const review: HarvestPersonReview = {
			sourceKey: p.sourceKey,
			name,
			action: "create",
			matchedBy,
			localId: null,
			email: "",
			emailGuessed: false,
			role: null,
			type: null,
			archived: false,
			firstDate: p.firstDate,
			lastDate: p.lastDate,
			rows: p.rows,
			blocked: null,
			aliases: aliases.map(displayName),
		};
		if (mapped !== undefined || member) {
			const localId = mapped ?? member?.userId ?? "";
			if (!member) {
				review.blocked =
					"An earlier import mapped this person to a user who is no longer a member";
				blocked.push({
					kind: "person",
					sourceKey: p.sourceKey,
					message: `${name}: ${review.blocked}`,
				});
			}
			const startDate =
				member && member.startDate === null ? p.firstDate : null;
			const plan: HarvestPersonPlan = {
				action: "match",
				sourceKey: p.sourceKey,
				localId,
				startDate,
			};
			review.action = "match";
			review.localId = localId;
			review.email = member?.email ?? "";
			review.role =
				member?.role === "admin" || member?.role === "owner"
					? "admin"
					: member
						? "member"
						: null;
			review.archived = member?.archived ?? false;
			drafts.push({ person: p, review, plan });
			personUserId.set(p.sourceKey, localId);
			personActive.set(p.sourceKey, !(member?.archived ?? false));
			continue;
		}
		const choice = choices.people[p.sourceKey];
		const override = choice?.email?.trim().toLowerCase() || null;
		const email =
			override ?? listedEmail ?? guessEmail(p.firstName, p.lastName);
		const emailListed = listedEmail !== null && email === listedEmail;
		// An address the admin typed is not a guess: they vouch for it, as the
		// people list does (plan section 3.3 keeps only a GUESS unverified).
		// Leaving it unverified made the person active but unable to sign in,
		// with Restore on an archived row as the only way to confirm it.
		const emailConfirmed = emailListed || override !== null;
		const employee = p.listed
			? p.listed.employee
			: (p.employeeInReport ?? true);
		const role = choice?.role ?? (p.listed?.admin ? "admin" : "member");
		const type: MemberTypeValue =
			choice?.type ?? (employee ? "employee_billable" : "contractor_hourly");
		const archivedOn = p.listed
			? null
			: p.lastDate
				? addDays(p.lastDate, 1)
				: cutoff;
		const plan: HarvestPersonPlan = {
			action: "create",
			sourceKey: p.sourceKey,
			name,
			email,
			emailListed,
			emailConfirmed,
			role,
			type,
			startDate: p.firstDate ?? cutoff,
			archivedOn,
		};
		review.email = email;
		review.emailGuessed = !emailConfirmed;
		review.role = role;
		review.type = type;
		review.archived = archivedOn !== null;
		drafts.push({ person: p, review, plan });
		personUserId.set(p.sourceKey, null);
		personActive.set(p.sourceKey, archivedOn === null);
	}

	// A second spelling takes its person's user. It needs a plan only when
	// no earlier run mapped it: `start` then maps it to that user.
	const aliasPlans: HarvestPersonPlan[] = [];
	for (const [alias, of] of aliasOf) {
		const person = parsed.persons.find((p) => p.sourceKey === alias);
		personName.set(alias, person ? displayName(person) : alias);
		personUserId.set(alias, personUserId.get(of) ?? null);
		personActive.set(alias, personActive.get(of) ?? false);
		if (personMapped(alias) === undefined) {
			aliasPlans.push({ action: "alias", sourceKey: alias, of });
		}
	}

	// Whose person-day a row lands on. A second spelling lands on its person,
	// and two source people that resolve to one member share that member's
	// day, as the server groups them (`importDays`). So the digest the plan
	// compares covers the same rows as the one stored.
	const ownerOf = new Map<string, string>();
	const ownerByUser = new Map<string, string>();
	for (const d of drafts) {
		const sourceKey = d.person.sourceKey;
		const userId = personUserId.get(sourceKey) ?? null;
		const owner =
			userId === null ? sourceKey : (ownerByUser.get(userId) ?? sourceKey);
		if (userId !== null) ownerByUser.set(userId, owner);
		ownerOf.set(sourceKey, owner);
	}
	for (const [alias, of] of aliasOf) ownerOf.set(alias, ownerOf.get(of) ?? of);
	const ownerKey = (sourceKey: string) => ownerOf.get(sourceKey) ?? sourceKey;

	// Email collisions: every address a created person would get.
	// A people-list address belongs to its listed owner: a guess that equals
	// it blocks the guesser only, so `listedUse` counts listed addresses apart.
	const emailUse = new Map<string, number>();
	const listedUse = new Map<string, number>();
	for (const d of drafts) {
		if (d.plan.action !== "create") continue;
		const uses = d.plan.emailListed ? listedUse : emailUse;
		uses.set(d.plan.email, (uses.get(d.plan.email) ?? 0) + 1);
	}
	const emailsToCheck: string[] = [];
	for (const d of drafts) {
		if (d.plan.action !== "create") continue;
		const { email, emailListed } = d.plan;
		if (!candidateEmails.has(email)) emailsToCheck.push(email);
		const duplicate = `${email} is also the address of another imported person`;
		let reason: string | null = null;
		if (!looksLikeEmail(email)) reason = `"${email}" is not an email address`;
		else if (emailListed) {
			if ((listedUse.get(email) ?? 0) > 1) reason = duplicate;
		} else {
			const member = memberByEmail.get(email);
			if (member) reason = `${email} belongs to the member ${member.name}`;
			else if (taken.has(email))
				reason = `${email} belongs to a user outside this organization`;
			else if (listedEmails.has(email))
				reason = `${email} is a people-list address of another person`;
			else if ((emailUse.get(email) ?? 0) > 1) reason = duplicate;
		}
		if (reason !== null) {
			d.review.blocked = reason;
			blocked.push({
				kind: "person",
				sourceKey: d.person.sourceKey,
				message: `${d.review.name}: ${reason}`,
			});
		}
	}

	// Rows, dedupe and days ----------------------------------------------------
	const appByDay = new Map<string, AppEntry[]>();
	for (const e of snapshot.appEntries) {
		const key = pairKey(e.userId, e.date);
		const list = appByDay.get(key);
		if (list) list.push(e);
		else appByDay.set(key, [e]);
	}
	const importedByUser = new Map<string, Map<string, [string, 0 | 1]>>();
	for (const u of snapshot.importedDays) {
		const byDate = new Map<string, [string, 0 | 1]>();
		for (const [date, digest, edited] of u.days)
			byDate.set(date, [digest, edited]);
		importedByUser.set(u.userId, byDate);
	}
	const activeFrom = DATE_RE.test(cutoff)
		? addDays(cutoff, -HARVEST_ACTIVE_WINDOW_DAYS)
		: cutoff;

	const attention: HarvestAttentionRow[] = [...parsed.invalidRows];
	const overlapDays: HarvestOverlapDay[] = [];
	const absenceConflicts: HarvestAbsenceConflict[] = [];
	const changedDays: HarvestDayRef[] = [];
	const keptDays: HarvestDayRef[] = [];
	const days: HarvestImportDay[] = [];
	const memberPairs = new Map<
		string,
		{ project: string; person: string; last: string }
	>();
	const secondsPerYear = new Map<string, number>();
	let roundingDelta = 0;
	let skippedDuplicate = 0;
	let skippedOverlap = 0;
	let skippedByCutoff = 0;
	let rowsAlreadyImported = 0;
	let newDays = 0;
	let unchangedDays = 0;

	const groupByKey = new Map<string, DayGroup>();
	for (const day of parsed.days) {
		const owner = ownerKey(day.personSourceKey);
		const key = pairKey(owner, day.date);
		const group = groupByKey.get(key);
		if (group) group.days.push(day);
		else {
			groupByKey.set(key, {
				owner,
				date: day.date,
				dayKey: day.dayKey,
				days: [day],
			});
		}
	}
	const dayGroups = [...groupByKey.values()].sort((a, b) =>
		a.date === b.date
			? compareStrings(a.owner, b.owner)
			: compareStrings(a.date, b.date),
	);
	const negativeRows: HarvestNegativeRow[] = [];

	for (const group of dayGroups) {
		const { owner, date } = group;
		const userId = personUserId.get(owner) ?? null;
		const app =
			userId === null ? [] : (appByDay.get(pairKey(userId, date)) ?? []);
		const appAbsence = app.filter((e) => e.absence);
		const appWork = app.filter((e) => !e.absence);
		const multiset = new Map<string, number>();
		for (const e of appWork) {
			if (e.projectId === null) continue;
			const k = `${e.projectId}|${e.taskId}|${e.durationSeconds}`;
			multiset.set(k, (multiset.get(k) ?? 0) + 1);
		}
		let consumed = 0;
		const kept: ParsedTimeRow[] = [];
		const work: ParsedTimeRow[] = [];

		const source: ParsedTimeRow[] = [];
		for (const day of group.days) {
			for (const index of day.rows) {
				const row = parsed.rows[index];
				if (row) source.push(row);
			}
		}
		// Assignments come from every row, whatever the choices drop below.
		for (const row of source) {
			if (row.projectSourceKey === null) continue;
			const mk = pairKey(row.projectSourceKey, owner);
			const pair = memberPairs.get(mk);
			if (!pair)
				memberPairs.set(mk, {
					project: row.projectSourceKey,
					person: owner,
					last: row.date,
				});
			else if (row.date > pair.last) pair.last = row.date;
		}
		const netting = subtractNegativeRows(source);
		for (const n of netting.negatives) {
			negativeRows.push({
				...attentionOf(n.row, personName, "Hours is negative"),
				against: n.against?.hoursRaw ?? null,
			});
		}
		const rows = choices.negativeRows === "subtract" ? netting.rows : source;

		for (const row of rows) {
			if (row.problem !== null || row.seconds === null) {
				attention.push(
					attentionOf(row, personName, row.problem ?? "Hours is not a number"),
				);
				continue;
			}
			if (row.absence) {
				if (appAbsence.length > 0) {
					skippedDuplicate += 1;
					const harvestTaskId = taskLocal.get(row.taskSourceKey) ?? null;
					const other = appAbsence.find((e) => e.taskId !== harvestTaskId);
					if (other) {
						absenceConflicts.push({
							personSourceKey: owner,
							person: personName.get(owner) ?? owner,
							date: row.date,
							harvestTask: row.taskName,
							appTask: taskById.get(other.taskId)?.name ?? other.taskId,
						});
					}
					continue;
				}
				kept.push(row);
				continue;
			}
			if (row.date >= cutoff) {
				skippedByCutoff += 1;
				continue;
			}
			const projectId = projectLocal.get(row.projectSourceKey ?? "") ?? null;
			const taskId = taskLocal.get(row.taskSourceKey) ?? null;
			if (projectId !== null && taskId !== null) {
				const k = `${projectId}|${taskId}|${row.seconds}`;
				const n = multiset.get(k) ?? 0;
				if (n > 0) {
					multiset.set(k, n - 1);
					consumed += 1;
					skippedDuplicate += 1;
					continue;
				}
			}
			work.push(row);
		}

		// An overlap day: Harvest work rows left AND app work entries that the
		// exact match did not already account for. Counting the matched ones
		// too would make "two Harvest rows, one here" import nothing under the
		// default, when 5.2 says it imports one.
		if (work.length > 0 && appWork.length - consumed > 0) {
			const decision =
				choices.overlap.days[group.dayKey] ?? choices.overlap.default;
			overlapDays.push({
				dayKey: group.dayKey,
				personSourceKey: owner,
				person: personName.get(owner) ?? owner,
				date,
				harvestSeconds: work.reduce((n, r) => n + (r.seconds ?? 0), 0),
				appSeconds: appWork.reduce((n, e) => n + e.durationSeconds, 0),
				automationOnly: appWork.every((e) => e.automation),
				decision,
			});
			if (decision === "keep_app") skippedOverlap += work.length;
			else kept.push(...work);
		} else {
			kept.push(...work);
		}
		if (kept.length === 0) continue;
		// File order within the day, whatever the branches above did.
		kept.sort((a, b) => a.record - b.record);

		for (const row of kept) {
			const seconds = row.seconds ?? 0;
			const year = row.date.slice(0, 4);
			secondsPerYear.set(year, (secondsPerYear.get(year) ?? 0) + seconds);
			roundingDelta += seconds - (row.rawSeconds ?? 0);
			if (row.projectSourceKey === null) continue;
			const review = projectReviewByKey.get(row.projectSourceKey);
			if (review) {
				review.seconds += seconds;
				if (row.billable) review.billableSeconds += seconds;
				else review.nonBillableSeconds += seconds;
			}
		}

		const stored =
			userId === null ? undefined : importedByUser.get(userId)?.get(date);
		const ref = { personSourceKey: owner, date };
		if (stored) {
			// Every row of one file day, as the file has it: the parse's digest.
			// A negative row is never sent, so a subtracted day hashes here.
			const single = group.days.length === 1 ? group.days[0] : undefined;
			const digest =
				single && kept.length === single.rows.length
					? single.digest
					: dayDigestSync(kept.map((r) => r.key));
			if (digest === stored[0]) {
				unchangedDays += 1;
				rowsAlreadyImported += kept.length;
				continue;
			}
			if (stored[1] === 1) {
				keptDays.push(ref);
				rowsAlreadyImported += kept.length;
				continue;
			}
			changedDays.push(ref);
		} else {
			newDays += 1;
		}
		if (kept.length > MAX_ROWS_PER_DAY) {
			blocked.push({
				kind: "day",
				sourceKey: group.dayKey,
				message: `${ref.personSourceKey} has ${kept.length} rows on ${date}; a day carries at most ${MAX_ROWS_PER_DAY}`,
			});
		}
		days.push({
			personSourceKey: owner,
			date,
			rows: kept.map((r): HarvestImportRow => ({
				key: r.key,
				projectSourceKey: r.projectSourceKey,
				taskSourceKey: r.taskSourceKey,
				description: r.notes,
				durationSeconds: r.seconds ?? 0,
				overtime: r.overtime,
			})),
		});
	}

	// Removed days: imported earlier, inside the file's range, not in the file.
	const fileDays = new Set(
		parsed.days.map((d) => pairKey(ownerKey(d.personSourceKey), d.date)),
	);
	for (const [sourceKey, userId] of personUserId) {
		if (userId !== null && !personByLocalId.has(userId))
			personByLocalId.set(userId, sourceKey);
	}
	const removed: HarvestDayRef[] = [];
	if (parsed.range) {
		const { from, to } = parsed.range;
		for (const u of snapshot.importedDays) {
			const mappedKey = personByLocalId.get(u.userId);
			if (mappedKey === undefined) continue;
			const sourceKey = ownerKey(mappedKey);
			for (const [date] of u.days) {
				if (date < from || date > to) continue;
				if (!fileDays.has(pairKey(sourceKey, date)))
					removed.push({ personSourceKey: sourceKey, date });
			}
		}
	}
	removed.sort((a, b) =>
		a.date === b.date
			? compareStrings(a.personSourceKey, b.personSourceKey)
			: compareStrings(a.date, b.date),
	);

	const projectMembers = [...memberPairs.values()]
		.map((p) => ({
			projectSourceKey: p.project,
			personSourceKey: p.person,
			active:
				(projectActive.get(p.project) ?? false) &&
				(personActive.get(p.person) ?? false) &&
				p.last >= activeFrom,
		}))
		.sort((a, b) =>
			compareStrings(
				pairKey(a.projectSourceKey, a.personSourceKey),
				pairKey(b.projectSourceKey, b.personSourceKey),
			),
		);

	const rowsImported = days.reduce((n, d) => n + d.rows.length, 0);
	const summary: HarvestPlanSummary = {
		rowsInFile: parsed.rows.length + parsed.invalidRows.length,
		rowsImported,
		rowsAlreadyImported,
		skippedDuplicate,
		skippedOverlap,
		skippedByCutoff,
		attentionRows: attention.length,
		overlapDays: overlapDays.length,
		newDays,
		unchangedDays,
		changedDays: changedDays.length,
		keptDays: keptDays.length,
		removedDays: removed.length,
		secondsPerYear: [...secondsPerYear.entries()]
			.sort(([a], [b]) => compareStrings(a, b))
			.map(([year, seconds]) => ({ year, seconds })),
		roundingDeltaSeconds: roundingDelta,
	};

	return {
		ready: blocked.length === 0,
		blocked,
		start: {
			source: "harvest",
			cutoffDate: cutoff,
			clients: clientPlans,
			tasks: taskPlans,
			projects: projectPlans,
			people: [...drafts.map((d) => d.plan), ...aliasPlans],
			projectMembers,
		},
		days,
		removedDays: choices.confirmFullExport ? removed : [],
		emailsToCheck: [...new Set(emailsToCheck)].sort(compareStrings),
		review: {
			files: parsed.files,
			summary,
			people: drafts.map((d) => d.review),
			projects: [...projectReviewByKey.values()],
			clients: clientReview,
			tasks: taskReview,
			attention: attention.sort((a, b) => a.record - b.record),
			duplicates: duplicateGroups,
			negativeRows: negativeRows.sort((a, b) => a.record - b.record),
			overlapDays,
			absenceConflicts,
			secondImport: { changedDays, keptDays, removedDays: removed },
		},
	};
}

function isHourBudget(listed: ProjectRow | null): boolean {
	return listed !== null && normName(listed.budgetBy) === "hours";
}

const PROJECT_TYPES = new Set<string>([
	"product_team",
	"fixed_scope",
	"hourly",
	"maintenance",
	"internal",
]);

function isProjectType(value: string | undefined): value is ProjectTypeValue {
	return value !== undefined && PROJECT_TYPES.has(value);
}

function attentionOf(
	row: ParsedTimeRow,
	personName: ReadonlyMap<string, string>,
	reason: string,
): HarvestAttentionRow {
	return {
		record: row.record,
		date: row.date,
		person: personName.get(row.personSourceKey) ?? row.personSourceKey,
		client: row.clientName,
		project: row.projectName,
		task: row.taskName,
		hours: row.hoursRaw,
		reason,
	};
}

/** The rows of one person on one day. Usually one file day; more when two
 *  source people are one person here. */
interface DayGroup {
	owner: string;
	date: string;
	/** The first file day's key: the key of `choices.overlap.days`. */
	dayKey: string;
	days: ParsedDay[];
}

function displayName(p: { firstName: string; lastName: string }): string {
	return `${p.firstName} ${p.lastName}`.replace(/\s+/g, " ").trim();
}

/** One person from two Harvest spellings: the chosen spelling's name, the
 *  people-list row of either, and the rows and dates of both. */
function mergePersons(
	p: ParsedPerson,
	aliases: readonly ParsedPerson[],
): ParsedPerson {
	const merged: ParsedPerson = { ...p };
	for (const a of aliases) {
		merged.listed ??= a.listed;
		merged.rows += a.rows;
		if (
			a.firstDate !== null &&
			(merged.firstDate === null || a.firstDate < merged.firstDate)
		) {
			merged.firstDate = a.firstDate;
		}
		if (
			a.lastDate !== null &&
			(merged.lastDate === null || a.lastDate > merged.lastDate)
		) {
			merged.lastDate = a.lastDate;
			merged.employeeInReport = a.employeeInReport;
		}
	}
	return merged;
}

interface Netting {
	/** Each negative row, and the row it comes off (null: none has enough). */
	negatives: { row: ParsedTimeRow; against: ParsedTimeRow | null }[];
	/** The day's rows with the negative rows subtracted. */
	rows: readonly ParsedTimeRow[];
}

/**
 * Takes each negative row of one person-day off the rows with the same
 * project, task and overtime flag: a row with exactly that many hours if
 * there is one (it then goes), else the largest rows first. A negative row
 * with not enough hours to take from stays, and needs attention.
 *
 * A row that loses hours gets a new key: the hash of its own key and the
 * negative rows' keys. So its day's key set, and digest, differ from the
 * "leave out" answer, and the same file gives the same keys each time.
 */
function subtractNegativeRows(rows: readonly ParsedTimeRow[]): Netting {
	const negatives = rows.filter(
		(r) => r.rawSeconds !== null && r.rawSeconds < 0,
	);
	if (negatives.length === 0) return { negatives: [], rows };
	// A row with a problem counts too: a correction is often what fixes it
	// ("40,0" and "-40,0" on one day). What is left gets checked again below.
	const remaining = new Map<ParsedTimeRow, number>();
	for (const r of rows) {
		if (r.rawSeconds !== null && r.rawSeconds > 0) {
			remaining.set(r, r.rawSeconds);
		}
	}
	const takenBy = new Map<ParsedTimeRow, string[]>();
	const subtracted = new Set<ParsedTimeRow>();
	const result: Netting["negatives"] = [];
	for (const neg of negatives) {
		const need = -(neg.rawSeconds ?? 0);
		const candidates = [...remaining.entries()].filter(
			([r, left]) =>
				left > 0 &&
				r.projectSourceKey === neg.projectSourceKey &&
				r.taskSourceKey === neg.taskSourceKey &&
				r.overtime === neg.overtime,
		);
		const total = candidates.reduce((n, [, left]) => n + left, 0);
		if (total < need) {
			result.push({ row: neg, against: null });
			continue;
		}
		const exact = candidates.find(([, left]) => left === need);
		const order = exact ? [exact] : candidates.sort(([, a], [, b]) => b - a);
		let left = need;
		for (const [r, has] of order) {
			if (left === 0) break;
			const take = Math.min(has, left);
			remaining.set(r, has - take);
			left -= take;
			takenBy.set(r, [...(takenBy.get(r) ?? []), neg.key]);
		}
		subtracted.add(neg);
		result.push({ row: neg, against: order[0]?.[0] ?? null });
	}
	const out: ParsedTimeRow[] = [];
	for (const r of rows) {
		if (subtracted.has(r)) continue;
		if (r.rawSeconds !== null && r.rawSeconds < 0) {
			out.push({
				...r,
				problem:
					"Hours is negative, and no row of the same project and task that day has that many hours",
			});
			continue;
		}
		const keys = takenBy.get(r);
		if (!keys) {
			out.push(r);
			continue;
		}
		const rawSeconds = remaining.get(r) ?? 0;
		if (rawSeconds <= 0) continue;
		const seconds = roundToQuarterHour(rawSeconds);
		out.push({
			...r,
			rawSeconds,
			seconds,
			problem: rowProblem(rawSeconds, seconds, r.notes),
			key: `${sha256HexSync(JSON.stringify([r.key, ...keys]))}:net`,
		});
	}
	return { negatives: result, rows: out };
}

/**
 * Splits days into `importDays` chunks of at most `maxRows` rows. A day is
 * never split, because the server replaces a changed day inside one
 * transaction; a single day larger than `maxRows` gets a chunk of its own.
 */
export function chunkDays(
	days: HarvestImportDay[],
	maxRows = HARVEST_CHUNK_MAX_ROWS,
): HarvestImportDay[][] {
	const chunks: HarvestImportDay[][] = [];
	let current: HarvestImportDay[] = [];
	let rows = 0;
	for (const day of days) {
		if (current.length > 0 && rows + day.rows.length > maxRows) {
			chunks.push(current);
			current = [];
			rows = 0;
		}
		current.push(day);
		rows += day.rows.length;
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}
