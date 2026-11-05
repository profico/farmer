// Written as the step reads in a trace, not as the tool is named: "Read time
// entries", not "list_time_entries". Unlabelled tools fall back to their name
// with the underscores taken out, which is legible but reads as plumbing — so a
// tool added to `assistant-tools.ts` belongs here too.
// A Map, not an object: the lookup key is a tool name off a stored transcript,
// so `get` answering `string | undefined` is the honest contract — an object
// would have to claim every string is a key.
export const TOOL_LABELS = new Map(
	Object.entries({
		// reads
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
		list_assignable_people: "Read who can be assigned",
		list_calendar_events: "Read your calendar",
		list_filing_rules: "Read the filing rules",
		list_attached_commits: "Read attached commits",
		list_attached_pull_requests: "Read attached pull requests",
		list_linked_github_repos: "Read linked repositories",
		list_available_github_repos: "Read available repositories",
		integration_status: "Checked the integrations",
		get_timer: "Checked the timer",
		get_hour_fund: "Read the hour fund",
		my_targets: "Checked your targets",
		tracking_report: "Ran the tracking report",
		project_overview: "Read a project overview",
		suggest_commits: "Matched commits to entries",
		suggest_pull_requests: "Matched pull requests to entries",
		// writes
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
		start_timer: "Start the timer",
		pause_timer: "Pause the timer",
		resume_timer: "Resume the timer",
		stop_timer: "Stop the timer",
		set_hour_fund: "Set the hour fund",
		remember_filing_rule: "Save a filing rule",
		update_filing_rule: "Change a filing rule",
		link_github_repo: "Link a repository",
		update_integration_settings: "Change integration settings",
		sync_now: "Sync now",
		// destructive
		delete_time_entry: "Delete an entry",
		remove_absence: "Delete an absence entry",
		delete_recurring_block_rule: "Delete a recurring block",
		archive_project: "Archive a project",
		archive_client: "Archive a client",
		archive_task: "Archive a task type",
		discard_timer: "Discard the timer",
		clear_hour_fund: "Clear the hour fund",
		delete_filing_rule: "Delete a filing rule",
		unlink_commits: "Detach commits",
		unlink_pull_requests: "Detach pull requests",
		unlink_github_repo: "Unlink a repository",
	}),
);

// The fallback is sentence case, so a tool with no label still reads as a step.
export const toolLabel = (name: string) => {
	const label = TOOL_LABELS.get(name);
	if (label) return label;
	const words = name.replaceAll("_", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
};
