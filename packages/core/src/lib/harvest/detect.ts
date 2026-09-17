// Identifies a Harvest export by its header row and turns its data rows into
// typed records. Detection keys on a small set of REQUIRED columns per kind
// rather than an exact header match, so column reordering or an extra column
// Harvest adds later does not break it.
//
// The required sets below were chosen against the real exports (see
// `~/Downloads/harvest/*.csv`, 2026-09-11) to be mutually exclusive: each
// name below appears in exactly one file's header, even though the files
// share several column names (`Client`, `Project`, `First Name` ...).
import { canonicalTaskName } from "../task-taxonomy";
import { parseHarvestNumber } from "./number";

export type HarvestFileKind =
	| "time_report"
	| "people"
	| "projects"
	| "tasks"
	| "clients"
	| "unknown";

export interface DetectResult {
	kind: HarvestFileKind;
	reason: string;
}

const KNOWN_KINDS = [
	"time_report",
	"people",
	"projects",
	"tasks",
	"clients",
] as const;

type KnownKind = (typeof KNOWN_KINDS)[number];

const REQUIRED_COLUMNS = {
	// "Date" + "First Name"/"Last Name" also exist elsewhere, but "Hours"
	// together with "Task" (a column name, not "Task name") only occurs here.
	time_report: ["Date", "Project", "Task", "Hours", "First Name", "Last Name"],
	// "First Name"/"Last Name" are shared with time_report, but "Email",
	// "Admin" and "Capacity" are not.
	people: ["First Name", "Last Name", "Email", "Admin", "Capacity"],
	// "Client"/"Project"/"Project Code" are shared with time_report, but
	// "Total Hours" and "Budget By" are not.
	projects: ["Client", "Project", "Project Code", "Total Hours", "Budget By"],
	tasks: ["Task name", "Billable", "Active?"],
	clients: ["Client Name", "Address"],
} satisfies Record<KnownKind, readonly string[]>;

export function detectHarvestFile(header: readonly string[]): DetectResult {
	const columns = new Set(header.map((cell) => cell.trim()));
	const matches: KnownKind[] = [];

	for (const kind of KNOWN_KINDS) {
		if (REQUIRED_COLUMNS[kind].every((col) => columns.has(col))) {
			matches.push(kind);
		}
	}

	const [onlyMatch] = matches;

	if (matches.length === 1 && onlyMatch) {
		return {
			kind: onlyMatch,
			reason: `header has every required column for ${onlyMatch}: ${REQUIRED_COLUMNS[onlyMatch].join(", ")}`,
		};
	}

	if (matches.length > 1) {
		return {
			kind: "unknown",
			reason: `header matches more than one kind (${matches.join(", ")}) — this should not happen for a real Harvest export`,
		};
	}

	const missing = KNOWN_KINDS.map((kind) => {
		const need = REQUIRED_COLUMNS[kind].filter((col) => !columns.has(col));

		return `${kind} is missing ${need.join(", ")}`;
	}).join("; ");

	return {
		kind: "unknown",
		reason: `header matches no known Harvest export kind (${missing})`,
	};
}

// --- Shared helpers -------------------------------------------------------

function parseYesNo(raw: string): boolean {
	return raw.trim().toLowerCase() === "yes";
}

// The real exports write every date as "YYYY-MM-DD" already. This still
// tolerates "D/M/YYYY" and "M/D/YYYY"-shaped input defensively — Harvest's
// locale-dependent CSV export is not guaranteed to stay ISO forever — by
// zero-padding a `YYYY-M-D` or `M/D/YYYY` value. Anything else is `null`.
export function parseHarvestDate(raw: string): string | null {
	const trimmed = raw.trim();

	if (trimmed === "") return null;

	const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);

	if (iso) {
		const [, year, month, day] = iso;

		return `${year}-${(month ?? "").padStart(2, "0")}-${(day ?? "").padStart(2, "0")}`;
	}

	const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);

	if (slash) {
		const [, month, day, year] = slash;

		return `${year}-${(month ?? "").padStart(2, "0")}-${(day ?? "").padStart(2, "0")}`;
	}

	return null;
}

function col(record: ReadonlyMap<string, string>, name: string): string {
	return record.get(name) ?? "";
}

function numCol(
	record: ReadonlyMap<string, string>,
	name: string,
): number | null {
	return parseHarvestNumber(col(record, name));
}

// --- time_report -----------------------------------------------------------

export interface TimeReportRow {
	date: string | null;
	client: string;
	project: string;
	projectCode: string;
	task: string;
	notes: string;
	hoursRaw: string;
	hours: number | null;
	billable: boolean;
	invoiced: boolean;
	approved: boolean;
	firstName: string;
	lastName: string;
	employeeId: string;
	roles: string;
	teams: string;
	employee: boolean;
	billableRate: number | null;
	billableAmount: number | null;
	costRate: number | null;
	costAmount: number | null;
	currency: string;
	externalReferenceUrl: string;
}

export function toTimeReportRow(
	record: ReadonlyMap<string, string>,
): TimeReportRow {
	const hoursRaw = col(record, "Hours");

	return {
		date: parseHarvestDate(col(record, "Date")),
		client: col(record, "Client"),
		project: col(record, "Project"),
		projectCode: col(record, "Project Code"),
		// Harvest's 50 task names fold into the taxonomy's 21 at the door, so the
		// plan matches, creates and groups the task the org actually uses.
		task: canonicalTaskName(col(record, "Task")),
		notes: col(record, "Notes"),
		hoursRaw,
		hours: parseHarvestNumber(hoursRaw),
		billable: parseYesNo(col(record, "Billable?")),
		invoiced: parseYesNo(col(record, "Invoiced?")),
		approved: parseYesNo(col(record, "Approved?")),
		firstName: col(record, "First Name"),
		lastName: col(record, "Last Name"),
		employeeId: col(record, "Employee Id"),
		roles: col(record, "Roles"),
		teams: col(record, "Teams"),
		employee: parseYesNo(col(record, "Employee?")),
		billableRate: numCol(record, "Billable Rate"),
		billableAmount: numCol(record, "Billable Amount"),
		costRate: numCol(record, "Cost Rate"),
		costAmount: numCol(record, "Cost Amount"),
		currency: col(record, "Currency"),
		externalReferenceUrl: col(record, "External Reference URL"),
	};
}

// --- people ------------------------------------------------------------

export interface PeopleRow {
	firstName: string;
	lastName: string;
	email: string;
	employeeId: string;
	roles: string;
	billableRate: number | null;
	costRate: number | null;
	admin: boolean;
	permissions: string;
	employee: boolean;
}

export function toPeopleRow(record: ReadonlyMap<string, string>): PeopleRow {
	return {
		firstName: col(record, "First Name"),
		lastName: col(record, "Last Name"),
		email: col(record, "Email"),
		employeeId: col(record, "Employee Id"),
		roles: col(record, "Roles"),
		billableRate: numCol(record, "Billable Rate"),
		costRate: numCol(record, "Cost Rate"),
		admin: parseYesNo(col(record, "Admin")),
		permissions: col(record, "Permissions"),
		employee: parseYesNo(col(record, "Employee")),
	};
}

// --- projects ------------------------------------------------------------

export interface ProjectRow {
	client: string;
	name: string;
	code: string;
	startDate: string | null;
	endDate: string | null;
	notes: string;
	totalHours: number | null;
	billableHours: number | null;
	billableAmount: number | null;
	budgetBy: string;
	budget: number | null;
	budgetSpent: number | null;
	budgetRemaining: number | null;
	totalCosts: number | null;
	teamCosts: number | null;
	expenses: number | null;
	invoicedAmount: number | null;
}

export function toProjectRow(record: ReadonlyMap<string, string>): ProjectRow {
	return {
		client: col(record, "Client"),
		name: col(record, "Project"),
		code: col(record, "Project Code"),
		startDate: parseHarvestDate(col(record, "Start Date")),
		endDate: parseHarvestDate(col(record, "End Date")),
		notes: col(record, "Project Notes"),
		totalHours: numCol(record, "Total Hours"),
		billableHours: numCol(record, "Billable Hours"),
		billableAmount: numCol(record, "Billable Amount"),
		budgetBy: col(record, "Budget By"),
		budget: numCol(record, "Budget"),
		budgetSpent: numCol(record, "Budget Spent"),
		budgetRemaining: numCol(record, "Budget Remaining"),
		totalCosts: numCol(record, "Total Costs"),
		teamCosts: numCol(record, "Team Costs"),
		expenses: numCol(record, "Expenses"),
		invoicedAmount: numCol(record, "Invoiced Amount"),
	};
}

// --- tasks ------------------------------------------------------------

export interface TaskRow {
	name: string;
	billableRate: number | null;
	billable: boolean;
	active: boolean;
}

export function toTaskRow(record: ReadonlyMap<string, string>): TaskRow {
	return {
		name: canonicalTaskName(col(record, "Task name")),
		billableRate: numCol(record, "Billable rate"),
		billable: parseYesNo(col(record, "Billable")),
		active: parseYesNo(col(record, "Active?")),
	};
}

// --- clients ------------------------------------------------------------

export interface ClientRow {
	name: string;
	address: string;
}

export function toClientRow(record: ReadonlyMap<string, string>): ClientRow {
	return {
		name: col(record, "Client Name"),
		address: col(record, "Address"),
	};
}
