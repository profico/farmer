import { describe, expect, test } from "bun:test";

import {
	HARVEST_CHUNK_MAX_ROWS,
	type HarvestImportDay,
	harvestImportDaysInput,
	harvestStartInput,
} from "../../schema/harvest-import";
import type { HarvestSnapshot } from "./contract";
import { dayDigest } from "./keys";
import {
	type HarvestChoices,
	type HarvestPlan,
	type ParsedHarvest,
	chunkDays,
	dayDigestSync,
	defaultHarvestChoices,
	guessEmail,
	normName,
	parseHarvestFiles,
	planHarvestImport,
} from "./plan";

// --- Fixtures ---------------------------------------------------------------

// The real header lines, from `~/Downloads/harvest/*.csv` (2026-09-11).
const TIME_HEADER =
	"Date,Client,Project,Project Code,Task,Notes,Hours,Billable?,Invoiced?,Approved?,First Name,Last Name,Employee Id,Roles,Teams,Employee?,Billable Rate,Billable Amount,Cost Rate,Cost Amount,Currency,External Reference URL";
const PEOPLE_HEADER =
	"First Name,Last Name,Email,Employee Id,Roles,Billable Rate,Cost Rate,Admin,Permissions,Employee,Capacity";
const PROJECTS_HEADER =
	"Client,Project,Project Code,Start Date,End Date,Project Notes,Total Hours,Billable Hours,Billable Amount,Budget By,Budget,Budget Spent,Budget Remaining,Total Costs,Team Costs,Expenses,Invoiced Amount";
const TASKS_HEADER = "Task name,Billable rate,Billable,Active?";
const CLIENTS_HEADER = "Client Name,Address";

function csvCell(value: string): string {
	return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function csv(header: string, rows: string[][]): string {
	return [header, ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
}

interface TimeRowInput {
	date?: string;
	client?: string;
	project?: string;
	code?: string;
	task?: string;
	notes?: string;
	hours?: string;
	billable?: boolean;
	first?: string;
	last?: string;
	employee?: boolean;
}

function timeRow(r: TimeRowInput): string[] {
	return [
		r.date ?? "2026-08-03",
		r.client ?? "Acme",
		r.project ?? "Website",
		r.code ?? "ACW",
		r.task ?? "Frontend",
		r.notes ?? "",
		r.hours ?? "1,0",
		r.billable === false ? "No" : "Yes",
		"No",
		"No",
		r.first ?? "Ana",
		r.last ?? "Horvat",
		"",
		"",
		"",
		r.employee === false ? "No" : "Yes",
		"0,0",
		"0,0",
		"0,0",
		"0,0",
		"United States Dollar - USD",
		"",
	];
}

function timeReport(rows: TimeRowInput[]) {
	return {
		name: "harvest_time_report.csv",
		text: csv(TIME_HEADER, rows.map(timeRow)),
	};
}

interface PersonInput {
	first: string;
	last: string;
	email: string;
	admin?: boolean;
	permissions?: string;
	employee?: boolean;
	capacity?: string;
}

function peopleList(people: PersonInput[]) {
	return {
		name: "harvest_people_list.csv",
		text: csv(
			PEOPLE_HEADER,
			people.map((p) => [
				p.first,
				p.last,
				p.email,
				"",
				"",
				"0.0",
				"",
				p.admin ? "Yes" : "No",
				p.permissions ?? (p.admin ? "Administrator" : "Member"),
				p.employee === false ? "No" : "Yes",
				p.capacity ?? "40.0",
			]),
		),
	};
}

interface ProjectInput {
	client: string;
	project: string;
	code: string;
	budgetBy?: string;
	budget?: string;
}

function projectList(projects: ProjectInput[]) {
	return {
		name: "harvest_project_list.csv",
		text: csv(
			PROJECTS_HEADER,
			projects.map((p) => [
				p.client,
				p.project,
				p.code,
				"",
				"",
				"",
				"0,0",
				"0,0",
				"0,0",
				p.budgetBy ?? "",
				p.budget ?? "",
				"",
				"",
				"0,0",
				"0,0",
				"0,0",
				"0",
			]),
		),
	};
}

function taskList(tasks: [name: string, active: boolean][]) {
	return {
		name: "harvest_task_list.csv",
		text: csv(
			TASKS_HEADER,
			tasks.map(([name, active]) => [name, "", "No", active ? "Yes" : "No"]),
		),
	};
}

function clientList(names: string[]) {
	return {
		name: "harvest_client_list.csv",
		text: csv(
			CLIENTS_HEADER,
			names.map((n) => [n, ""]),
		),
	};
}

const ID = {
	meeting: "00000000-0000-4000-8000-000000000001",
	break: "00000000-0000-4000-8000-000000000002",
	vacation: "00000000-0000-4000-8000-000000000003",
	sick: "00000000-0000-4000-8000-000000000004",
	paidLeave: "00000000-0000-4000-8000-000000000005",
	development: "00000000-0000-4000-8000-000000000006",
	frontend: "00000000-0000-4000-8000-000000000007",
	internalClient: "00000000-0000-4000-8000-000000000010",
	acme: "00000000-0000-4000-8000-000000000011",
	other: "00000000-0000-4000-8000-000000000012",
	website: "00000000-0000-4000-8000-000000000020",
	dormant: "00000000-0000-4000-8000-000000000021",
};

function snapshot(overrides: Partial<HarvestSnapshot> = {}): HarvestSnapshot {
	return {
		internalClientId: ID.internalClient,
		clients: [
			{
				id: ID.internalClient,
				name: "Internal",
				isInternal: true,
				archived: false,
			},
		],
		projects: [],
		tasks: [
			siteTask(ID.meeting, "Meeting", "meeting", false),
			siteTask(ID.break, "Break", "break", false),
			siteTask(ID.vacation, "Vacation", "vacation", true),
			siteTask(ID.sick, "Sick Leave", "sick", true),
			siteTask(ID.paidLeave, "Paid Leave", "paid_leave", true),
			{
				id: ID.development,
				name: "Development",
				scope: "organization",
				systemKey: "development",
				isAbsence: false,
				archived: false,
			},
		],
		members: [],
		takenEmails: [],
		mappings: [],
		appEntries: [],
		importedDays: [],
		...overrides,
	};
}

function siteTask(
	id: string,
	name: string,
	systemKey: string,
	isAbsence: boolean,
): HarvestSnapshot["tasks"][number] {
	return { id, name, scope: "site", systemKey, isAbsence, archived: false };
}

function member(
	userId: string,
	name: string,
	email: string,
	startDate: string | null = "2020-01-01",
): HarvestSnapshot["members"][number] {
	return {
		userId,
		name,
		email,
		role: "member",
		archived: false,
		hasAccount: true,
		startDate,
	};
}

function appEntry(
	e: Partial<HarvestSnapshot["appEntries"][number]>,
): HarvestSnapshot["appEntries"][number] {
	return {
		userId: "u-ana",
		date: "2026-08-03",
		projectId: ID.website,
		taskId: ID.frontend,
		durationSeconds: 3600,
		absence: false,
		automation: false,
		...e,
	};
}

/** Ana Horvat as an existing member, with Acme :: Website and Frontend. */
function anaSnapshot(overrides: Partial<HarvestSnapshot> = {}) {
	const base = snapshot();
	return snapshot({
		clients: [
			...base.clients,
			{ id: ID.acme, name: "ACME", isInternal: false, archived: false },
		],
		projects: [
			{
				id: ID.website,
				clientId: ID.acme,
				name: "website",
				code: "ACW",
				type: "product_team",
				archived: false,
			},
		],
		tasks: [
			...base.tasks,
			{
				id: ID.frontend,
				name: "Frontend",
				scope: "organization",
				systemKey: null,
				isAbsence: false,
				archived: false,
			},
		],
		members: [member("u-ana", "Ana Horvat", "ana@profico.hr")],
		...overrides,
	});
}

function choices(
	parsed: ParsedHarvest,
	overrides: Partial<HarvestChoices> = {},
): HarvestChoices {
	return { ...defaultHarvestChoices(parsed), ...overrides };
}

async function planFor(
	files: { name: string; text: string }[],
	snap: HarvestSnapshot = snapshot(),
	overrides: Partial<HarvestChoices> = {},
): Promise<{ parsed: ParsedHarvest; plan: HarvestPlan }> {
	const parsed = await parseHarvestFiles(files);
	return {
		parsed,
		plan: planHarvestImport(parsed, snap, choices(parsed, overrides)),
	};
}

function allRows(plan: HarvestPlan) {
	return plan.days.flatMap((d) =>
		d.rows.map((r) => ({ ...r, date: d.date, person: d.personSourceKey })),
	);
}

function present<T>(value: T | undefined | null, what: string): T {
	if (value === undefined || value === null) throw new Error(`missing ${what}`);
	return value;
}

const RUN_ID = "00000000-0000-4000-8000-0000000000ff";

/** The plan's outputs parse against the Zod inputs the server accepts. */
function expectServerAccepts(plan: HarvestPlan) {
	harvestStartInput.parse({ ...plan.start, runId: RUN_ID });
	for (const chunk of chunkDays(plan.days)) {
		harvestImportDaysInput.parse({ runId: RUN_ID, days: chunk });
	}
}

// --- Helpers ----------------------------------------------------------------

describe("normName and guessEmail", () => {
	test("normName trims, lowers and collapses whitespace", () => {
		expect(normName("  Erik   Teigen\t")).toBe("erik teigen");
		// NFC: a decomposed "š" equals the composed one.
		expect(normName("Šimic")).toBe(normName("Šimic"));
	});

	test("guessEmail folds diacritics and drops non-alphanumerics", () => {
		expect(guessEmail("Ivan", "Horvat")).toBe("ihorvat@profico.hr");
		expect(guessEmail("Đuro", "Šimić-Čorić")).toBe("dsimiccoric@profico.hr");
		expect(guessEmail("Žana", "Van Dijk")).toBe("zvandijk@profico.hr");
		expect(guessEmail("José", "Müller")).toBe("jmuller@profico.hr");
	});

	test("dayDigestSync equals the async dayDigest", async () => {
		const keys = ["b".repeat(64) + ":0", "a".repeat(64) + ":1", "c:0"];
		expect(dayDigestSync(keys)).toBe(await dayDigest(keys));
		expect(dayDigestSync([])).toBe(await dayDigest([]));
		const long = Array.from({ length: 40 }, (_, i) => `${i}`.repeat(60));
		expect(dayDigestSync(long)).toBe(await dayDigest(long));
	});
});

// --- Parsing ----------------------------------------------------------------

describe("parseHarvestFiles", () => {
	test("reports each file, its kind and whether it is used", async () => {
		const parsed = await parseHarvestFiles([
			timeReport([{}, { date: "2026-08-04" }]),
			timeReport([{}]),
			{ name: "notes.txt", text: "hello,world\n1,2" },
			{ name: "empty.csv", text: "" },
			clientList(["Acme"]),
		]);
		expect(parsed.files.map((f) => [f.kind, f.rows, f.used])).toEqual([
			["time_report", 2, true],
			["time_report", 1, false],
			["unknown", 0, false],
			["unknown", 0, false],
			["clients", 1, true],
		]);
		expect(parsed.files[1]?.reason).toContain("Not used");
		expect(parsed.range).toEqual({ from: "2026-08-03", to: "2026-08-04" });
	});

	test("candidate emails are the listed addresses and the guesses", async () => {
		const parsed = await parseHarvestFiles([
			timeReport([{}, { first: "Marko", last: "Kovač" }]),
			peopleList([{ first: "Ana", last: "Horvat", email: "Ana@Profico.hr" }]),
		]);
		expect(parsed.candidateEmails).toEqual([
			"ana@profico.hr",
			"mkovac@profico.hr",
		]);
	});

	test("identical rows of a person-day get distinct keys", async () => {
		const parsed = await parseHarvestFiles([timeReport([{}, {}])]);
		const [a, b] = parsed.rows;
		expect(a?.key.endsWith(":0")).toBe(true);
		expect(b?.key.endsWith(":1")).toBe(true);
		expect(parsed.days).toHaveLength(1);
	});
});

// --- Mapping ----------------------------------------------------------------

describe("absence mapping", () => {
	test("by project code and by task name; absence projects are not created", async () => {
		const { plan } = await planFor([
			timeReport([
				{
					client: "Profico",
					project: "Vacation",
					code: "PVC",
					task: "Vacation",
					hours: "8,0",
				},
				{
					client: "Profico",
					project: "Sick Leave",
					code: "PSL",
					task: "Other",
					date: "2026-08-04",
					hours: "8,0",
				},
				{
					client: "Profico",
					project: "Paid Leave",
					code: "PPL",
					task: "Paid leave",
					date: "2026-08-05",
					hours: "8,0",
				},
				{
					client: "Profico",
					project: "Internal",
					code: "PRINT",
					task: "Sick leave",
					date: "2026-08-06",
					hours: "4,0",
				},
			]),
		]);
		const rows = allRows(plan);
		expect(
			rows.map((r) => [r.date, r.projectSourceKey, r.taskSourceKey]),
		).toEqual([
			["2026-08-03", null, "vacation"],
			["2026-08-04", null, "sick leave"],
			["2026-08-05", null, "paid leave"],
			["2026-08-06", null, "sick leave"],
		]);
		expect(plan.start.projects).toEqual([]);
		expect(plan.start.tasks).toEqual([
			{ action: "match", sourceKey: "paid leave", localId: ID.paidLeave },
			{ action: "match", sourceKey: "sick leave", localId: ID.sick },
			{ action: "match", sourceKey: "vacation", localId: ID.vacation },
		]);
		expect(plan.ready).toBe(true);
		expectServerAccepts(plan);
	});

	test("a missing built-in absence task blocks the plan", async () => {
		const snap = snapshot();
		snap.tasks = snap.tasks.filter((t) => t.systemKey !== "paid_leave");
		const { plan } = await planFor(
			[timeReport([{ code: "PPL", task: "Paid leave" }])],
			snap,
		);
		expect(plan.ready).toBe(false);
		expect(plan.blocked.map((b) => b.kind)).toEqual(["task"]);
	});
});

describe("tasks", () => {
	test("overtime tasks set the flag and use the base task", async () => {
		const { plan } = await planFor([
			timeReport([
				{ task: "Design Overtime" },
				{ task: "Framer Overtime", date: "2026-08-04" },
				{ task: "Development (Overtime)", date: "2026-08-05" },
				{ task: "Development", date: "2026-08-06" },
			]),
			taskList([
				["Framer", true],
				["Framer Overtime", true],
				["Design", false],
			]),
		]);
		expect(allRows(plan).map((r) => [r.taskSourceKey, r.overtime])).toEqual([
			["design", true],
			["framer", true],
			["development", true],
			["development", false],
		]);
		expect(plan.start.tasks).toEqual([
			{ action: "create", sourceKey: "design", name: "Design", archived: true },
			{ action: "match", sourceKey: "development", localId: ID.development },
			{
				action: "create",
				sourceKey: "framer",
				name: "Framer",
				archived: false,
			},
		]);
	});

	test("daily break and meeting map to the site built-ins", async () => {
		const { plan } = await planFor([
			timeReport([
				{ task: "Daily Break" },
				{ task: "Meeting" },
				{ task: "Frontend" },
			]),
		]);
		expect(plan.start.tasks).toContainEqual({
			action: "match",
			sourceKey: "break",
			localId: ID.break,
		});
		expect(plan.start.tasks).toContainEqual({
			action: "match",
			sourceKey: "meeting",
			localId: ID.meeting,
		});
		expect(plan.start.tasks).toContainEqual(
			expect.objectContaining({ action: "create", sourceKey: "frontend" }),
		);
	});

	test("an unused task is created only when it is active in the task list", async () => {
		const { plan } = await planFor([
			timeReport([{ task: "Frontend" }]),
			taskList([
				["Motion Design", true],
				["Idle Old", false],
			]),
		]);
		expect(plan.start.tasks.map((t) => t.sourceKey)).toEqual([
			"frontend",
			"motion design",
		]);
	});
});

describe("rounding and attention rows", () => {
	test("rounds to the nearest quarter hour with a 15-minute minimum", async () => {
		const { plan } = await planFor([
			timeReport([
				{ hours: "0,1" },
				{ hours: "1,13", date: "2026-08-04" },
				{ hours: "0,0", date: "2026-08-05" },
				{ hours: "1,38", date: "2026-08-06" },
			]),
		]);
		// 0.1 h = 360 s, 1.13 h = 4068 s, 0 s, 1.38 h = 4968 s.
		expect(allRows(plan).map((r) => r.durationSeconds)).toEqual([
			900, 4500, 900, 5400,
		]);
		expect(plan.review.summary.roundingDeltaSeconds).toBeCloseTo(
			900 - 360 + (4500 - 4068) + 900 + (5400 - 4968),
			6,
		);
		expect(plan.review.summary.secondsPerYear).toEqual([
			{ year: "2026", seconds: 900 + 4500 + 900 + 5400 },
		]);
	});

	test("a row over 24 hours and unparseable rows are skipped and listed", async () => {
		const { plan } = await planFor([
			timeReport([
				{ hours: "25,0", notes: "typo" },
				{ hours: "abc", date: "2026-08-04" },
				{ date: "not a date" },
				{ hours: "2,0", date: "2026-08-05" },
			]),
		]);
		expect(allRows(plan).map((r) => r.durationSeconds)).toEqual([7200]);
		expect(plan.review.attention.map((a) => [a.record, a.reason])).toEqual([
			[1, "Longer than 24 hours"],
			[2, "Hours is not a number"],
			[3, "Date is not a date"],
		]);
		expect(plan.review.summary.attentionRows).toBe(3);
		expect(plan.review.summary.rowsInFile).toBe(4);
	});
});

describe("projects", () => {
	test("type suggestions, status, code and budget", async () => {
		const { plan } = await planFor([
			timeReport([
				{ client: "Acme", project: "Website", code: "ACW" },
				{ client: "Acme", project: "Pitch", code: "", billable: false },
				{ client: "Acme", project: "Shop", code: "SHOP-2024-EXTENDED-CODE" },
				{ client: "Profico", project: "Internal", code: "PRINT" },
			]),
			projectList([
				{
					client: "Acme",
					project: "Website",
					code: "ACW",
					budgetBy: "Hours",
					budget: "80,0",
				},
				{ client: "Acme", project: "Pitch", code: "" },
			]),
		]);
		const byName = new Map(
			plan.start.projects.flatMap((p) =>
				p.action === "create" ? [[p.name, p] as const] : [],
			),
		);
		expect(byName.get("Website")).toMatchObject({
			type: "fixed_scope",
			budgetSeconds: 80 * 3600,
			archived: false,
			code: "ACW",
			clientSourceKey: "acme",
		});
		expect(byName.get("Pitch")).toMatchObject({
			type: "internal",
			archived: false,
			code: null,
			budgetSeconds: null,
		});
		// Worked on in the month before the cutoff, so active without a listing.
		expect(byName.get("Shop")).toMatchObject({
			type: "product_team",
			archived: false,
			code: "SHOP-2024-EXTEND",
		});
		// Under the internal client.
		expect(byName.get("Internal")).toMatchObject({ type: "internal" });
		expectServerAccepts(plan);
	});

	test("active is worked on in the 31 days before the cutoff, or listed; a match follows the same rule", async () => {
		const { plan } = await planFor(
			[
				timeReport([
					{ project: "Fresh", code: "FR", date: "2026-08-02" },
					{ project: "Stale", code: "ST", date: "2026-07-31" },
					{ project: "Website", code: "ACW", date: "2026-01-05" },
					{ project: "Dormant", code: "DO", date: "2026-02-01" },
				]),
				projectList([{ client: "Acme", project: "Website", code: "ACW" }]),
			],
			// Acme exists here, so a project under it can match by name.
			anaSnapshot({
				projects: [
					{
						id: ID.dormant,
						clientId: ID.acme,
						name: "Dormant",
						code: "DO",
						type: "product_team",
						archived: false,
					},
				],
			}),
		);
		const byKey = new Map(plan.start.projects.map((p) => [p.sourceKey, p]));
		const key = (name: string, code: string) =>
			JSON.stringify(["acme", name.toLowerCase(), code]);
		expect(byKey.get(key("Fresh", "FR"))).toMatchObject({ archived: false });
		expect(byKey.get(key("Stale", "ST"))).toMatchObject({ archived: true });
		expect(byKey.get(key("Website", "ACW"))).toMatchObject({ archived: false });
		// Exists here as active, but nothing since February: the re-import
		// archives it.
		expect(byKey.get(key("Dormant", "DO"))).toEqual({
			action: "match",
			sourceKey: key("Dormant", "DO"),
			localId: ID.dormant,
			archived: true,
		});
		expect(plan.review.projects.find((p) => p.name === "Dormant")?.status).toBe(
			"archived",
		);
		expectServerAccepts(plan);
	});

	test("a type override replaces the suggestion; the budget stays with fixed_scope", async () => {
		const files = [
			timeReport([{}]),
			projectList([
				{
					client: "Acme",
					project: "Website",
					code: "ACW",
					budgetBy: "Hours",
					budget: "10,0",
				},
			]),
		];
		const parsed = await parseHarvestFiles(files);
		const key = present(parsed.projects[0], "project").sourceKey;
		expect(key).toBe(JSON.stringify(["acme", "website", "ACW"]));
		const plan = planHarvestImport(
			parsed,
			snapshot(),
			choices(parsed, { projectTypes: { [key]: "hourly" } }),
		);
		expect(plan.start.projects[0]).toMatchObject({
			type: "hourly",
			budgetSeconds: null,
		});
		expect(plan.review.projects[0]?.suggestedType).toBe("fixed_scope");
	});
});

describe("clients", () => {
	test("Profico and Internal map to the internal client; others are created", async () => {
		const { plan } = await planFor([
			timeReport([
				{ client: "Profico", project: "Internal", code: "PRINT" },
				{ client: "internal", project: "Web 2.0", code: "W2" },
				{ client: "Acme" },
			]),
			clientList(["Old Client"]),
			projectList([{ client: "Acme", project: "Website", code: "ACW" }]),
		]);
		expect(plan.start.clients).toEqual([
			{ action: "create", sourceKey: "acme", name: "Acme", archived: false },
			{ action: "internal", sourceKey: "internal" },
			{
				action: "create",
				sourceKey: "old client",
				name: "Old Client",
				archived: true,
			},
			{ action: "internal", sourceKey: "profico" },
		]);
	});

	test("the review screen can override the internal default", async () => {
		const files = [
			timeReport([{ client: "Profico", project: "Internal", code: "PRINT" }]),
		];
		const parsed = await parseHarvestFiles(files);
		const plan = planHarvestImport(
			parsed,
			snapshot(),
			choices(parsed, { clients: { profico: { action: "create" } } }),
		);
		// Created rather than mapped to the internal client — and active, since
		// its one project was worked on in the month before the cutoff.
		expect(plan.start.clients).toEqual([
			{
				action: "create",
				sourceKey: "profico",
				name: "Profico",
				archived: false,
			},
		]);
		expect(plan.start.projects[0]).toMatchObject({ type: "product_team" });
	});

	test("a match override to an unknown client blocks", async () => {
		const files = [timeReport([{}])];
		const parsed = await parseHarvestFiles(files);
		const plan = planHarvestImport(
			parsed,
			snapshot(),
			choices(parsed, {
				clients: { acme: { action: "match", localId: ID.other } },
			}),
		);
		expect(plan.ready).toBe(false);
		expect(plan.blocked[0]?.kind).toBe("client");
	});
});

describe("matching existing rows", () => {
	test("client, project, task and member match by name and email", async () => {
		const { plan } = await planFor(
			[
				timeReport([
					{
						client: "Acme",
						project: "Website ",
						code: "ACW",
						task: "frontend",
					},
				]),
				peopleList([{ first: "Ana", last: "Horvat", email: "ANA@profico.hr" }]),
			],
			anaSnapshot(),
		);
		expect(plan.start.clients).toEqual([
			{ action: "match", sourceKey: "acme", localId: ID.acme },
		]);
		expect(plan.start.projects).toEqual([
			{
				action: "match",
				sourceKey: JSON.stringify(["acme", "website", "ACW"]),
				localId: ID.website,
				archived: false,
			},
		]);
		expect(plan.start.tasks).toEqual([
			{ action: "match", sourceKey: "frontend", localId: ID.frontend },
		]);
		expect(plan.start.people).toEqual([
			{
				action: "match",
				sourceKey: "ana horvat",
				localId: "u-ana",
				startDate: null,
			},
		]);
		expect(plan.review.people[0]?.matchedBy).toBe("email");
	});

	test("a member matches by name, and gets a start date only when theirs is empty", async () => {
		const snap = anaSnapshot({
			members: [member("u-ana", "Ana  Horvat", "a.h@elsewhere.com", null)],
		});
		const { plan } = await planFor(
			[timeReport([{ date: "2019-03-01" }, { date: "2020-05-05" }])],
			snap,
		);
		expect(plan.start.people).toEqual([
			{
				action: "match",
				sourceKey: "ana horvat",
				localId: "u-ana",
				startDate: "2019-03-01",
			},
		]);
		expect(plan.review.people[0]?.matchedBy).toBe("name");
	});

	test("a mapping from an earlier run wins over a name match", async () => {
		const snap = anaSnapshot({
			clients: [
				...anaSnapshot().clients,
				{
					id: ID.other,
					name: "Acme Renamed",
					isInternal: false,
					archived: false,
				},
			],
			members: [
				member("u-ana", "Ana Horvat", "ana@profico.hr"),
				member("u-ana-2", "Someone Else", "else@profico.hr"),
			],
			mappings: [
				{ kind: "client", sourceKey: "acme", localId: ID.other },
				{ kind: "person", sourceKey: "ana horvat", localId: "u-ana-2" },
			],
		});
		const { plan } = await planFor([timeReport([{}])], snap);
		expect(plan.start.clients).toEqual([
			{ action: "match", sourceKey: "acme", localId: ID.other },
		]);
		expect(plan.start.people[0]).toMatchObject({
			action: "match",
			localId: "u-ana-2",
		});
		expect(plan.review.people[0]?.matchedBy).toBe("earlier_import");
		// The project name-match now looks under the mapped client, and finds none.
		expect(plan.start.projects[0]?.action).toBe("create");
	});
});

describe("people", () => {
	test("a listed person is created with role, type, capacity and a verified address", async () => {
		const { plan } = await planFor([
			timeReport([
				{ first: "Mateo", last: "Perak", date: "2015-01-02" },
				{ first: "Mateo", last: "Perak", date: "2026-08-03" },
			]),
			peopleList([
				{
					first: "Mateo",
					last: "Perak",
					email: "mateo@profico.hr",
					admin: true,
					permissions: "Owner",
				},
				{
					first: "Iva",
					last: "Ext",
					email: "iva@ext.com",
					employee: false,
					capacity: "25.0",
				},
			]),
		]);
		expect(plan.start.people).toEqual([
			{
				action: "create",
				sourceKey: "iva ext",
				name: "Iva Ext",
				email: "iva@ext.com",
				emailListed: true,
				emailConfirmed: true,
				role: "member",
				type: "contractor_hourly",
				startDate: "2026-09-01",
				archivedOn: null,
				weeklyTargetSeconds: 25 * 3600,
			},
			{
				action: "create",
				sourceKey: "mateo perak",
				name: "Mateo Perak",
				email: "mateo@profico.hr",
				emailListed: true,
				emailConfirmed: true,
				role: "admin",
				type: "employee_billable",
				startDate: "2015-01-02",
				archivedOn: null,
				weeklyTargetSeconds: 40 * 3600,
			},
		]);
	});

	test("a time-report-only person gets a guessed address and is archived", async () => {
		const { plan } = await planFor([
			timeReport([
				{ first: "Đuro", last: "Šimić", date: "2018-01-02", employee: false },
				{ first: "Đuro", last: "Šimić", date: "2019-12-31", employee: false },
			]),
		]);
		expect(plan.start.people).toEqual([
			{
				action: "create",
				sourceKey: "đuro šimić",
				name: "Đuro Šimić",
				email: "dsimic@profico.hr",
				emailListed: false,
				emailConfirmed: false,
				role: "member",
				type: "contractor_hourly",
				startDate: "2018-01-02",
				archivedOn: "2020-01-01",
				weeklyTargetSeconds: 144000,
			},
		]);
		expect(plan.review.people[0]?.emailGuessed).toBe(true);
		expect(plan.ready).toBe(true);
		expectServerAccepts(plan);
	});

	test("each of the four guess collisions blocks the plan", async () => {
		const files = [
			timeReport([
				{ first: "Ivan", last: "Horvat" }, // ihorvat: a member's address
				{ first: "Ivo", last: "Kos" }, // ikos: taken outside the org
				{ first: "Petra", last: "Novak" }, // pnovak: a people-list address
				{ first: "Marko", last: "Babić" }, // mbabic: shared with ...
				{ first: "Mia", last: "Babic" }, // ... this guess
				{ first: "Lana", last: "Ok" },
			]),
			peopleList([
				{ first: "Pero", last: "Novak", email: "pnovak@profico.hr" },
			]),
		];
		const snap = snapshot({
			members: [member("u-x", "Ivana Horvat-Old", "ihorvat@profico.hr")],
			takenEmails: ["ikos@profico.hr"],
		});
		const { plan } = await planFor(files, snap);
		expect(plan.ready).toBe(false);
		const blocked = new Map(
			plan.review.people.map((p) => [p.sourceKey, p.blocked]),
		);
		expect(blocked.get("ivan horvat")).toContain("belongs to the member");
		expect(blocked.get("ivo kos")).toContain("outside this organization");
		expect(blocked.get("petra novak")).toContain("people-list address");
		expect(blocked.get("marko babić")).toContain("another imported person");
		expect(blocked.get("mia babic")).toContain("another imported person");
		expect(blocked.get("lana ok")).toBeNull();
		expect(blocked.get("pero novak")).toBeNull();
		expect(plan.blocked).toHaveLength(5);
	});

	test("two people-list rows with one address block both", async () => {
		const { plan } = await planFor([
			timeReport([{}]),
			peopleList([
				{ first: "Ana", last: "Horvat", email: "team@profico.hr" },
				{ first: "Iva", last: "Horvat", email: "team@profico.hr" },
			]),
		]);
		expect(plan.blocked.map((b) => b.sourceKey)).toEqual([
			"ana horvat",
			"iva horvat",
		]);
	});

	test("a listed address in takenEmails is fine; an override resolves a block", async () => {
		const files = [
			timeReport([
				{ first: "Ivan", last: "Horvat" },
				{ first: "Ana", last: "Kos" },
			]),
			peopleList([{ first: "Ana", last: "Kos", email: "akos@profico.hr" }]),
		];
		const snap = snapshot({
			members: [member("u-x", "Other", "ihorvat@profico.hr")],
			takenEmails: ["akos@profico.hr"],
		});
		const parsed = await parseHarvestFiles(files);
		const blockedPlan = planHarvestImport(parsed, snap, choices(parsed));
		expect(blockedPlan.blocked.map((b) => b.sourceKey)).toEqual([
			"ivan horvat",
		]);

		const plan = planHarvestImport(
			parsed,
			snap,
			choices(parsed, {
				people: {
					"ivan horvat": {
						email: "Ivan.H@Profico.hr",
						role: "admin",
						type: "employee_overhead",
					},
				},
			}),
		);
		expect(plan.ready).toBe(true);
		expect(
			plan.start.people.find((p) => p.sourceKey === "ivan horvat"),
		).toMatchObject({
			email: "ivan.h@profico.hr",
			emailListed: false,
			// The admin typed it, so it is theirs to vouch for, not a guess.
			emailConfirmed: true,
			role: "admin",
			type: "employee_overhead",
		});
		expect(
			plan.review.people.find((p) => p.sourceKey === "ivan horvat")
				?.emailGuessed,
		).toBe(false);
		expect(plan.emailsToCheck).toEqual(["ivan.h@profico.hr"]);
	});

	test("an address the admin typed is confirmed; the untouched guess is not", async () => {
		const files = [
			timeReport([
				{ first: "Ivan", last: "Horvat" },
				{ first: "Lana", last: "Ok" },
			]),
		];
		const parsed = await parseHarvestFiles(files);
		const plan = planHarvestImport(
			parsed,
			snapshot(),
			choices(parsed, {
				people: { "ivan horvat": { email: "ivan@elsewhere.com" } },
			}),
		);
		const bySource = new Map(
			plan.start.people.map((p) => [p.sourceKey, p] as const),
		);
		expect(bySource.get("ivan horvat")).toMatchObject({
			emailListed: false,
			emailConfirmed: true,
		});
		expect(bySource.get("lana ok")).toMatchObject({
			email: "lok@profico.hr",
			emailListed: false,
			emailConfirmed: false,
		});
		expectServerAccepts(plan);
	});
});

describe("project members", () => {
	test("active only for an active project and person with a row in the last 90 days", async () => {
		const { plan } = await planFor([
			timeReport([
				{ date: "2026-07-01" },
				{ date: "2026-01-05", project: "Old", code: "OLD" },
				{ date: "2026-08-20", first: "Gone", last: "Person" },
			]),
			projectList([
				{ client: "Acme", project: "Website", code: "ACW" },
				{ client: "Acme", project: "Old", code: "OLD" },
			]),
			peopleList([{ first: "Ana", last: "Horvat", email: "ana@profico.hr" }]),
		]);
		const website = JSON.stringify(["acme", "website", "ACW"]);
		const old = JSON.stringify(["acme", "old", "OLD"]);
		expect(plan.start.projectMembers).toEqual([
			{ projectSourceKey: old, personSourceKey: "ana horvat", active: false },
			{
				projectSourceKey: website,
				personSourceKey: "ana horvat",
				active: true,
			},
			{
				projectSourceKey: website,
				personSourceKey: "gone person",
				active: false,
			},
		]);
	});
});

// --- Section 5 ------------------------------------------------------------

describe("cutoff (5.1)", () => {
	test("work rows on or after the cutoff are skipped; absence is kept on every date", async () => {
		const { plan } = await planFor([
			timeReport([
				{ date: "2026-08-31" },
				{ date: "2026-09-01" },
				{ date: "2026-10-01" },
				{ date: "2026-12-24", code: "PVC", task: "Vacation", hours: "8,0" },
			]),
		]);
		expect(allRows(plan).map((r) => r.date)).toEqual([
			"2026-08-31",
			"2026-12-24",
		]);
		expect(plan.review.summary.skippedByCutoff).toBe(2);
	});
});

describe("dedupe against this app (5.2)", () => {
	test("absence already booked here skips the Harvest row; a different kind is listed", async () => {
		const { plan } = await planFor(
			[
				timeReport([
					{ code: "PVC", task: "Vacation", hours: "8,0" },
					{ code: "PVC", task: "Vacation", hours: "8,0", date: "2026-08-04" },
					{ code: "PVC", task: "Vacation", hours: "8,0", date: "2026-08-05" },
				]),
			],
			anaSnapshot({
				appEntries: [
					appEntry({
						date: "2026-08-03",
						projectId: null,
						taskId: ID.vacation,
						absence: true,
						durationSeconds: 28800,
					}),
					appEntry({
						date: "2026-08-04",
						projectId: null,
						taskId: ID.sick,
						absence: true,
						durationSeconds: 28800,
					}),
				],
			}),
		);
		expect(allRows(plan).map((r) => r.date)).toEqual(["2026-08-05"]);
		expect(plan.review.summary.skippedDuplicate).toBe(2);
		expect(plan.review.absenceConflicts).toEqual([
			{
				personSourceKey: "ana horvat",
				person: "Ana Horvat",
				date: "2026-08-04",
				harvestTask: "Vacation",
				appTask: "Sick Leave",
			},
		]);
	});

	test("exact work rows count as a multiset: two Harvest rows and one here import one", async () => {
		const { plan } = await planFor(
			[timeReport([{ hours: "1,0" }, { hours: "1,0" }])],
			anaSnapshot({ appEntries: [appEntry({})] }),
		);
		expect(allRows(plan)).toHaveLength(1);
		expect(plan.review.summary.skippedDuplicate).toBe(1);
		expect(plan.review.overlapDays).toEqual([]);
	});

	test("an overlap day keeps this app's entries by default", async () => {
		const { plan } = await planFor(
			[timeReport([{ hours: "2,0" }, { hours: "1,0", task: "Meeting" }])],
			anaSnapshot({
				appEntries: [
					appEntry({ taskId: ID.development, durationSeconds: 5400 }),
				],
			}),
		);
		expect(plan.days).toEqual([]);
		expect(plan.review.summary.skippedOverlap).toBe(2);
		expect(plan.review.overlapDays).toEqual([
			{
				dayKey: JSON.stringify(["2026-08-03", "Ana", "Horvat"]),
				personSourceKey: "ana horvat",
				person: "Ana Horvat",
				date: "2026-08-03",
				harvestSeconds: 3 * 3600,
				appSeconds: 5400,
				automationOnly: false,
				decision: "keep_app",
			},
		]);
	});

	test("keep_both, for all days or one day, imports the Harvest rows too", async () => {
		const files = [
			timeReport([{ hours: "2,0" }, { hours: "2,0", date: "2026-08-04" }]),
		];
		const snap = anaSnapshot({
			appEntries: [
				appEntry({ date: "2026-08-03", taskId: ID.meeting, automation: true }),
				appEntry({ date: "2026-08-04", taskId: ID.meeting, automation: false }),
			],
		});
		const parsed = await parseHarvestFiles(files);
		const all = planHarvestImport(
			parsed,
			snap,
			choices(parsed, { overlap: { default: "keep_both", days: {} } }),
		);
		expect(all.days.map((d) => d.date)).toEqual(["2026-08-03", "2026-08-04"]);
		expect(all.review.overlapDays.map((d) => d.automationOnly)).toEqual([
			true,
			false,
		]);

		const oneDay = planHarvestImport(
			parsed,
			snap,
			choices(parsed, {
				overlap: {
					default: "keep_app",
					days: {
						[JSON.stringify(["2026-08-03", "Ana", "Horvat"])]: "keep_both",
					},
				},
			}),
		);
		expect(oneDay.days.map((d) => d.date)).toEqual(["2026-08-03"]);
		expect(oneDay.review.summary.skippedOverlap).toBe(1);
	});

	test("a created person has no entries here, so nothing is deduped", async () => {
		const { plan } = await planFor(
			[timeReport([{ first: "New", last: "Person" }])],
			anaSnapshot({ appEntries: [appEntry({})] }),
		);
		expect(allRows(plan)).toHaveLength(1);
	});
});

describe("a second import (5.3)", () => {
	async function firstRunDigest(
		files: { name: string; text: string }[],
		date: string,
	) {
		const parsed = await parseHarvestFiles(files);
		const day = present(
			parsed.days.find((d) => d.date === date),
			`day ${date}`,
		);
		return dayDigest(day.rows.map((i) => present(parsed.rows[i], "row").key));
	}

	test("the same day is skipped, a changed day is sent, an edited one is kept", async () => {
		const first = [
			timeReport([
				{ date: "2026-08-03" },
				{ date: "2026-08-04" },
				{ date: "2026-08-05" },
			]),
		];
		const d3 = await firstRunDigest(first, "2026-08-03");
		const d4 = await firstRunDigest(first, "2026-08-04");
		const d5 = await firstRunDigest(first, "2026-08-05");
		const second = [
			timeReport([
				{ date: "2026-08-03" },
				{ date: "2026-08-04", notes: "changed in Harvest" },
				{ date: "2026-08-05", hours: "3,0" },
				{ date: "2026-08-06" },
			]),
		];
		const snap = anaSnapshot({
			mappings: [{ kind: "person", sourceKey: "ana horvat", localId: "u-ana" }],
			importedDays: [
				{
					userId: "u-ana",
					days: [
						["2026-08-03", d3, 0],
						["2026-08-04", d4, 0],
						["2026-08-05", d5, 1],
					],
				},
			],
		});
		const { plan } = await planFor(second, snap);
		expect(plan.days.map((d) => d.date)).toEqual(["2026-08-04", "2026-08-06"]);
		expect(plan.review.summary).toMatchObject({
			newDays: 1,
			unchangedDays: 1,
			changedDays: 1,
			keptDays: 1,
			removedDays: 0,
			rowsImported: 2,
			rowsAlreadyImported: 2,
		});
		expect(plan.review.secondImport.changedDays).toEqual([
			{ personSourceKey: "ana horvat", date: "2026-08-04" },
		]);
		expect(plan.review.secondImport.keptDays).toEqual([
			{ personSourceKey: "ana horvat", date: "2026-08-05" },
		]);
	});

	test("a day that dedupe shrank the same way on both runs reads as unchanged", async () => {
		const files = [timeReport([{ hours: "1,0" }, { hours: "2,0" }])];
		const parsed = await parseHarvestFiles(files);
		// The first run sent only the 2h row: the 1h row matched an entry here.
		const sentKey = present(parsed.rows[1], "row").key;
		const snap = anaSnapshot({
			appEntries: [appEntry({})],
			importedDays: [
				{
					userId: "u-ana",
					days: [["2026-08-03", await dayDigest([sentKey]), 0]],
				},
			],
		});
		const plan = planHarvestImport(parsed, snap, choices(parsed));
		expect(plan.days).toEqual([]);
		expect(plan.review.summary.unchangedDays).toBe(1);
		expect(plan.review.summary.skippedDuplicate).toBe(1);
	});

	test("removed days are listed, and sent only when the admin confirms a full export", async () => {
		const files = [
			timeReport([{ date: "2026-08-03" }, { date: "2026-08-10" }]),
		];
		const parsed = await parseHarvestFiles(files);
		const d3 = await firstRunDigest(files, "2026-08-03");
		const snap = anaSnapshot({
			mappings: [{ kind: "person", sourceKey: "ana horvat", localId: "u-ana" }],
			importedDays: [
				{
					userId: "u-ana",
					days: [
						["2026-08-03", d3, 0],
						["2026-08-05", "0000000000000000", 0], // gone from Harvest
						["2026-08-20", "0000000000000000", 0], // outside the file's range
					],
				},
			],
		});
		const unconfirmed = planHarvestImport(parsed, snap, choices(parsed));
		const removed = [{ personSourceKey: "ana horvat", date: "2026-08-05" }];
		expect(unconfirmed.review.secondImport.removedDays).toEqual(removed);
		expect(unconfirmed.review.summary.removedDays).toBe(1);
		expect(unconfirmed.removedDays).toEqual([]);

		const confirmed = planHarvestImport(
			parsed,
			snap,
			choices(parsed, { confirmFullExport: true }),
		);
		expect(confirmed.removedDays).toEqual(removed);
	});
});

// --- Section 6 ------------------------------------------------------------

describe("two spellings of one name", () => {
	// The real case: "Ive Vasiljević" until 2020, "Ive Vasiljevic" from 2021,
	// and only the second on the people list.
	const files = () => [
		timeReport([
			{ first: "Ive", last: "Vasiljević", date: "2019-02-11" },
			{ first: "Ive", last: "Vasiljevic", date: "2019-02-11", hours: "2,0" },
			{ first: "Ive", last: "Vasiljevic", date: "2021-05-19" },
		]),
		peopleList([{ first: "Ive", last: "Vasiljevic", email: "ive@profico.hr" }]),
	];
	const LISTED = "ive vasiljevic";
	const OLD = "ive vasiljević";

	async function groupKey() {
		const { plan } = await planFor(files());
		return present(plan.review.duplicates[0], "duplicate group").key;
	}

	test("blocks until the admin answers", async () => {
		const { plan } = await planFor(files());
		expect(plan.ready).toBe(false);
		expect(plan.review.duplicates).toEqual([
			{
				key: expect.any(String),
				decision: null,
				people: [
					{
						sourceKey: OLD,
						name: "Ive Vasiljević",
						listed: false,
						rows: 1,
						firstDate: "2019-02-11",
						lastDate: "2019-02-11",
					},
					{
						sourceKey: LISTED,
						name: "Ive Vasiljevic",
						listed: true,
						rows: 2,
						firstDate: "2019-02-11",
						lastDate: "2021-05-19",
					},
				].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey)),
			},
		]);
		expect(plan.blocked.map((b) => b.message)).toContain(
			"Decide whether Ive Vasiljevic and Ive Vasiljević are one person or different people",
		);
	});

	test("one person: one create, an alias, and one day for the shared date", async () => {
		const key = await groupKey();
		const { parsed, plan } = await planFor(files(), snapshot(), {
			duplicates: { [key]: LISTED },
		});
		expect(plan.ready).toBe(true);
		expect(plan.start.people).toEqual([
			expect.objectContaining({
				action: "create",
				sourceKey: LISTED,
				email: "ive@profico.hr",
				startDate: "2019-02-11",
				archivedOn: null,
			}),
			{ action: "alias", sourceKey: OLD, of: LISTED },
		]);
		expect(plan.review.people).toHaveLength(1);
		expect(plan.review.people[0]).toMatchObject({
			name: "Ive Vasiljevic",
			aliases: ["Ive Vasiljević"],
			rows: 3,
		});
		expect(plan.review.duplicates[0]?.decision).toBe(LISTED);
		expect(
			plan.days.map((d) => [d.personSourceKey, d.date, d.rows.length]),
		).toEqual([
			[LISTED, "2019-02-11", 2],
			[LISTED, "2021-05-19", 1],
		]);
		expect(new Set(allRows(plan).map((r) => r.key))).toEqual(
			new Set(parsed.rows.map((r) => r.key)),
		);
		expectServerAccepts(plan);
	});

	test("different people: two creates, no alias", async () => {
		const key = await groupKey();
		const { plan } = await planFor(files(), snapshot(), {
			duplicates: { [key]: "separate" },
		});
		expect(plan.ready).toBe(true);
		expect(plan.start.people.map((p) => [p.action, p.sourceKey])).toEqual([
			["create", LISTED],
			["create", OLD],
		]);
		expect(plan.days.map((d) => [d.personSourceKey, d.date])).toEqual([
			[LISTED, "2019-02-11"],
			[OLD, "2019-02-11"],
			[LISTED, "2021-05-19"],
		]);
	});

	test("an answer that names nobody in the group still blocks", async () => {
		const key = await groupKey();
		const { plan } = await planFor(files(), snapshot(), {
			duplicates: { [key]: "someone else" },
		});
		expect(plan.ready).toBe(false);
		expect(plan.review.duplicates[0]?.decision).toBeNull();
	});

	describe("after an earlier run", () => {
		const ive = () =>
			snapshot({
				members: [member("u-ive", "Ive Vasiljevic", "ive@profico.hr")],
			});

		test("both spellings on one user: no question, and the merged day reads as unchanged", async () => {
			const parsed = await parseHarvestFiles(files());
			const shared = parsed.days
				.filter((d) => d.date === "2019-02-11")
				.flatMap((d) => d.rows.map((i) => present(parsed.rows[i], "row").key));
			const snap = snapshot({
				...ive(),
				mappings: [
					{ kind: "person", sourceKey: LISTED, localId: "u-ive" },
					{ kind: "person", sourceKey: OLD, localId: "u-ive" },
				],
				importedDays: [
					{
						userId: "u-ive",
						days: [["2019-02-11", await dayDigest(shared), 0]],
					},
				],
			});
			const plan = planHarvestImport(parsed, snap, choices(parsed));
			expect(plan.ready).toBe(true);
			expect(plan.review.duplicates).toEqual([]);
			expect(plan.start.people).toEqual([
				{
					action: "match",
					sourceKey: LISTED,
					localId: "u-ive",
					startDate: null,
				},
			]);
			expect(plan.review.people[0]?.aliases).toEqual(["Ive Vasiljević"]);
			expect(plan.days.map((d) => d.date)).toEqual(["2021-05-19"]);
			expect(plan.review.summary.unchangedDays).toBe(1);
		});

		test("two users cannot become one person", async () => {
			const key = await groupKey();
			const snap = snapshot({
				members: [
					member("u-ive", "Ive Vasiljevic", "ive@profico.hr"),
					member("u-ive-2", "Ive Old", "ive.old@profico.hr"),
				],
				mappings: [
					{ kind: "person", sourceKey: LISTED, localId: "u-ive" },
					{ kind: "person", sourceKey: OLD, localId: "u-ive-2" },
				],
			});
			const both = await planFor(files(), snap);
			expect(both.plan.review.duplicates).toEqual([]);
			expect(both.plan.ready).toBe(true);

			const oneMapped = snapshot({
				...ive(),
				mappings: [{ kind: "person", sourceKey: LISTED, localId: "u-ive" }],
			});
			const merged = await planFor(files(), oneMapped, {
				duplicates: { [key]: OLD },
			});
			// The mapped spelling's user becomes the person. That spelling has
			// its mapping already, so it needs no alias plan.
			expect(merged.plan.start.people).toEqual([
				{ action: "match", sourceKey: OLD, localId: "u-ive", startDate: null },
			]);
			expect(merged.plan.days.every((d) => d.personSourceKey === OLD)).toBe(
				true,
			);
		});
	});
});

describe("negative correction rows", () => {
	const files = () => [
		timeReport([
			{ date: "2026-08-03", hours: "7,25" },
			{ date: "2026-08-03", hours: "-7,25" },
			{ date: "2026-08-04", hours: "7,67" },
			{ date: "2026-08-04", hours: "-0,5" },
			{ date: "2026-08-05", hours: "-1,0" },
			{ date: "2026-08-05", hours: "1,0", task: "Backend" },
		]),
	];

	test("block until the admin answers, and list what each subtracts from", async () => {
		const { plan } = await planFor(files());
		expect(plan.ready).toBe(false);
		expect(plan.blocked).toContainEqual({
			kind: "choices",
			sourceKey: "negativeRows",
			message: "Decide what to do with the 3 rows with negative hours",
		});
		expect(
			plan.review.negativeRows.map((n) => [n.date, n.hours, n.against]),
		).toEqual([
			["2026-08-03", "-7,25", "7,25"],
			["2026-08-04", "-0,5", "7,67"],
			["2026-08-05", "-1,0", null],
		]);
	});

	test("subtract: a full cancel removes the row, a partial one rounds again", async () => {
		const { plan } = await planFor(files(), snapshot(), {
			negativeRows: "subtract",
		});
		expect(plan.ready).toBe(true);
		const rows = allRows(plan);
		expect(
			rows.map((r) => [r.date, r.taskSourceKey, r.durationSeconds]),
		).toEqual([
			// 7.67 h - 0.5 h = 25812 s, rounded to 7.25 h.
			["2026-08-04", "frontend", 26_100],
			["2026-08-05", "backend", 3600],
		]);
		expect(rows[0]?.key.endsWith(":net")).toBe(true);
		expect(plan.review.attention.map((a) => [a.date, a.reason])).toEqual([
			[
				"2026-08-05",
				"Hours is negative, and no row of the same project and task that day has that many hours",
			],
		]);
		expect(plan.review.summary.roundingDeltaSeconds).toBeCloseTo(
			26_100 - 25_812,
			6,
		);
		expectServerAccepts(plan);
	});

	test("leave out: the other rows import as they are", async () => {
		const { parsed, plan } = await planFor(files(), snapshot(), {
			negativeRows: "leave_out",
		});
		expect(plan.ready).toBe(true);
		const rows = allRows(plan);
		expect(rows.map((r) => [r.date, r.durationSeconds])).toEqual([
			["2026-08-03", 26_100],
			["2026-08-04", 27_900],
			["2026-08-05", 3600],
		]);
		const positive = parsed.rows.filter((r) => (r.rawSeconds ?? 0) > 0);
		expect(rows.map((r) => r.key)).toEqual(positive.map((r) => r.key));
		expect(plan.review.attention.map((a) => a.reason)).toEqual([
			"Hours is negative",
			"Hours is negative",
			"Hours is negative",
		]);
	});

	test("changing the answer changes the day, so a second run replaces it", async () => {
		const parsed = await parseHarvestFiles(files());
		const leftOut = planHarvestImport(
			parsed,
			snapshot(),
			choices(parsed, { negativeRows: "leave_out" }),
		);
		const day4 = present(
			leftOut.days.find((d) => d.date === "2026-08-04"),
			"2026-08-04",
		);
		const snap = anaSnapshot({
			mappings: [{ kind: "person", sourceKey: "ana horvat", localId: "u-ana" }],
			importedDays: [
				{
					userId: "u-ana",
					days: [
						["2026-08-04", await dayDigest(day4.rows.map((r) => r.key)), 0],
					],
				},
			],
		});
		const again = planHarvestImport(
			parsed,
			snap,
			choices(parsed, { negativeRows: "leave_out" }),
		);
		expect(again.review.secondImport.changedDays).toEqual([]);
		const subtracted = planHarvestImport(
			parsed,
			snap,
			choices(parsed, { negativeRows: "subtract" }),
		);
		expect(subtracted.review.secondImport.changedDays).toEqual([
			{ personSourceKey: "ana horvat", date: "2026-08-04" },
		]);
	});

	test("a correction can cancel a row that was too long for a day", async () => {
		// The real case: "40,0" by mistake, "-40,0" to take it back.
		const { plan } = await planFor(
			[timeReport([{ hours: "40,0" }, { hours: "0,5" }, { hours: "-40,0" }])],
			snapshot(),
			{ negativeRows: "subtract" },
		);
		expect(allRows(plan).map((r) => r.durationSeconds)).toEqual([1800]);
		expect(plan.review.attention).toEqual([]);
		expect(plan.review.negativeRows[0]?.against).toBe("40,0");
	});

	test("a correction larger than the row stays a problem", async () => {
		const { plan } = await planFor(
			[timeReport([{ hours: "1,0" }, { hours: "-2,0" }])],
			snapshot(),
			{ negativeRows: "subtract" },
		);
		expect(allRows(plan).map((r) => r.durationSeconds)).toEqual([3600]);
		expect(plan.review.negativeRows[0]?.against).toBeNull();
	});
});

describe("purity", () => {
	test("the same inputs give the same plan", async () => {
		const files = [
			timeReport([{}, { date: "2026-08-04", task: "Daily Break" }]),
		];
		const parsed = await parseHarvestFiles(files);
		const a = planHarvestImport(parsed, anaSnapshot(), choices(parsed));
		const b = planHarvestImport(parsed, anaSnapshot(), choices(parsed));
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	});
});

// --- Chunks ----------------------------------------------------------------

describe("chunkDays", () => {
	function day(date: string, rows: number): HarvestImportDay {
		return {
			personSourceKey: "p",
			date,
			rows: Array.from({ length: rows }, (_, i) => ({
				key: `${date}:${i}`,
				projectSourceKey: null,
				taskSourceKey: "vacation",
				description: "",
				durationSeconds: 900,
				overtime: false,
			})),
		};
	}

	test("never splits a day and respects the maximum", () => {
		const days = [
			day("a", 3),
			day("b", 4),
			day("c", 2),
			day("d", 7),
			day("e", 1),
		];
		const chunks = chunkDays(days, 7);
		expect(chunks.map((c) => c.map((d) => d.date))).toEqual([
			["a", "b"],
			["c"],
			["d"],
			["e"],
		]);
		for (const chunk of chunks) {
			expect(chunk.reduce((n, d) => n + d.rows.length, 0)).toBeLessThanOrEqual(
				7,
			);
		}
		expect(chunks.flat()).toEqual(days);
	});

	test("a day larger than the maximum gets a chunk of its own", () => {
		expect(
			chunkDays([day("a", 1), day("b", 9), day("c", 1)], 5).map(
				(c) => c.length,
			),
		).toEqual([1, 1, 1]);
	});

	test("the default maximum is the server's", () => {
		const days = Array.from({ length: 30 }, (_, i) => day(`d${i}`, 400));
		const chunks = chunkDays(days);
		expect(
			chunks.every(
				(c) =>
					c.reduce((n, d) => n + d.rows.length, 0) <= HARVEST_CHUNK_MAX_ROWS,
			),
		).toBe(true);
		expect(chunks.map((c) => c.length)).toEqual([12, 12, 6]);
	});
});
