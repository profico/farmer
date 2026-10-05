import { z } from "zod";

import { printDayKey } from "./markdown";

// The step as a trace row reads it, the same words as the web app's
// `TOOL_LABELS` (`apps/web/src/components/assistant/primitives.tsx`). A tool
// that is not here shows its name without the underscores.
const TOOL_LABELS = new Map(
	Object.entries({
		whoami: "Checked who you are",
		list_time_entries: "Read time entries",
		list_unfiled_entries: "Read unfiled time",
		list_projects: "Read projects",
		list_tasks: "Read tasks",
		list_clients: "Read clients",
		list_members: "Read the team",
		list_project_members: "Read a project's team",
		list_holidays: "Checked the holidays",
		list_recurring_block_rules: "Read your recurring blocks",
		list_commits: "Read your commits",
		list_pull_requests: "Read your pull requests",
		suggest_day: "Assembled the day",
		time_report_summary: "Ran a time report",
		time_report_detail: "Read the report's entries",
		overtime_report: "Ran the overtime report",
		unfiled_summary: "Checked unfiled time",
		absence_totals: "Checked absence taken",
		list_absences: "Read absence entries",
		absence_report: "Ran the absence report",
		my_targets: "Checked your targets",
		tracking_report: "Ran the tracking report",
		integration_status: "Checked the integrations",
		sync_now: "Ran a sync",
		list_filing_rules: "Read the filing rules",
		create_time_entry: "Log time",
		update_time_entry: "Change an entry",
		update_entry_description: "Reword an entry",
		set_overtime: "Flag overtime",
		file_time_entries: "File entries onto a project",
		copy_day: "Copy a day",
		copy_week: "Copy a week",
		log_absence: "Book absence",
		apply_day_assembly: "Log the day's entries",
		attach_commits: "Attach commits",
		attach_pull_requests: "Attach pull requests",
		create_client: "Create a client",
		create_project: "Create a project",
		update_project: "Change a project",
		assign_project_member: "Change a project's team",
		create_task: "Create a task type",
		update_task: "Change a task type",
		create_recurring_block_rule: "Create a recurring block",
		update_recurring_block_rule: "Change a recurring block",
		unarchive: "Restore from the archive",
		delete_time_entry: "Delete an entry",
		remove_absence: "Delete an absence entry",
		delete_recurring_block_rule: "Delete a recurring block",
		archive_project: "Archive a project",
		archive_client: "Archive a client",
		archive_task: "Archive a task type",
	}),
);

export const toolLabel = (name: string) =>
	TOOL_LABELS.get(name) ?? name.replaceAll("_", " ");

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/** The arguments that a trace row can name. Parsed, because a model wrote
 *  them: a malformed call gives a row with its label only. */
const detailArgs = z
	.object({
		date: z.string().optional(),
		from: z.string().optional(),
		to: z.string().optional(),
		year: z.number().optional(),
		month: z.number().optional(),
		search: z.string().optional(),
		name: z.string().optional(),
	})
	.catch({});

/** What a step was about: a search or a name, then the period. Null when
 *  the arguments name nothing. */
export const toolDetail = (raw: string): string | null => {
	let args: z.infer<typeof detailArgs>;
	try {
		args = detailArgs.parse(JSON.parse(raw || "{}"));
	} catch {
		return null;
	}
	const parts: string[] = [];
	const subject = args.search ?? args.name;
	if (subject) parts.push(subject);
	const from = args.from ? printDayKey(args.from) : null;
	const to = args.to ? printDayKey(args.to) : null;
	const day = args.date ? printDayKey(args.date) : null;
	if (from && to) parts.push(from === to ? from : `${from} - ${to}`);
	else if (day) parts.push(day);
	else if (args.year && args.month) {
		parts.push(`${MONTHS[args.month - 1] ?? args.month} ${args.year}`);
	} else if (args.year) parts.push(String(args.year));
	return parts.length > 0 ? parts.join(", ") : null;
};
