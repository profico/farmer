import { summarizeCommitMessages } from "@farmer/core/lib/day-plan";
import { describePullRequestActivity } from "@farmer/core/lib/github-activity";
import { descriptionRequiredFor } from "@farmer/core/lib/task-rules";
import {
	parseDuration,
	snapToQuarterHour,
	weekdayInTz,
} from "@farmer/core/lib/time";
import { dayKeySchema } from "@farmer/core/schema";
import { z } from "zod";

import { readEntryOptions, readLastPick } from "#/lib/entry-options.ts";
import { formatClock } from "#/lib/format-hours.ts";
import type {
	suggestCommitsForEntry,
	suggestPullRequestsForEntry,
} from "#/server/github.ts";
import type { listCalendarEventsForDay } from "#/server/google-calendar.ts";

// Time off is chosen where a project would be: it sits first in the project
// picker, and choosing it narrows the task list to the leave kinds.
export const TIME_OFF = "__time_off__";
// An entry that has no project YET — a synced meeting, a rest-of-day block —
// opened for editing. Not Time-off: it is worked time whose project question
// is still open, and it may be saved with the question still open. Opening
// such an entry as Time-off narrowed the tasks to the leave kinds, so
// "Meeting" vanished from its own entry and the only way to change its day or
// note was to pick a project and a task first.
export const NO_PROJECT_YET = "__no_project_yet__";

export type ExistingTimeEntry = {
	id: string;
	date: string;
	projectId: string | null;
	taskId: string;
	/** Whether the task is a leave kind. Read only to tell a project-less
	 *  worked entry (still unfiled) from time off, which has no project by
	 *  definition. Absent: assume time off, the older behaviour. */
	task?: { isAbsence: boolean };
	description: string;
	durationSeconds: number;
	overtime: boolean;
	fillsDay: boolean;
	generatedFromRuleId: string | null;
};

export const MAX_ENTRY_SECONDS = 24 * 3600;

/** The lengths most entries actually are, offered as a row under the field.
 *
 *  Written as clock strings because that is what the field holds and what its
 *  blur handler normalises to, so a preset and a typed "1.5" end in one state
 *  rather than two that only look alike.
 *
 *  Four, not seven. "Rest of day" sits beside them as a fifth and is not one of
 *  these: it is a different KIND of answer — a block sized from whatever the
 *  day has left rather than a number — which is why it is set apart, and why it
 *  came out of More options, where nobody found it. */
export const QUICK_DURATIONS = ["0:30", "1:00", "2:00", "4:00"] as const;

// The duration rule, apart from the form rule below. It returns the message
// of the first problem, or null when the text is a valid length.
function durationProblem(duration: string): string | null {
	if (!duration.trim()) return "Required";
	const parsed = parseDuration(duration);
	if (parsed === null) return "Try 1.5 or 1:30";
	if (parsed <= 0) return "Required";
	if (snapToQuarterHour(parsed) > MAX_ENTRY_SECONDS) return "Max 24 hours";
	return null;
}

export const formSchema = z
	.object({
		projectId: z.string().min(1),
		taskId: z.uuid("Required"),
		date: dayKeySchema,
		duration: z.string(),
		description: z.string().max(10_000),
		overtime: z.boolean(),
		fillsDay: z.boolean(),
		repeatEnabled: z.boolean(),
		daysOfWeek: z.array(z.number().int().min(0).max(6)),
		repeatEndDate: z.string(),
	})
	.superRefine((data, ctx) => {
		const problem = data.fillsDay ? null : durationProblem(data.duration);
		if (problem) {
			ctx.addIssue({ code: "custom", path: ["duration"], message: problem });
		}
		if (data.repeatEnabled && data.daysOfWeek.length < 1) {
			ctx.addIssue({
				code: "custom",
				path: ["daysOfWeek"],
				message: "Pick a day",
			});
		}
	});

export type FormValues = z.infer<typeof formSchema>;

export type CalendarEvent = Awaited<
	ReturnType<typeof listCalendarEventsForDay>
>[number];
export type SuggestedCommit = Awaited<
	ReturnType<typeof suggestCommitsForEntry>
>[number];
export type SuggestedPullRequest = Awaited<
	ReturnType<typeof suggestPullRequestsForEntry>
>[number];

export function commitKey(projectGithubRepoId: string, sha: string): string {
	return `${projectGithubRepoId}:${sha}`;
}

export function pullRequestKey(
	projectGithubRepoId: string,
	number: number,
): string {
	return `${projectGithubRepoId}:${number}`;
}

export type ActivityKind = "opened" | "merged" | "closed" | "reviewed";
export type ReviewState =
	| "approved"
	| "changes_requested"
	| "commented"
	| "dismissed";

function activityLabel(
	kind: ActivityKind,
	reviewState: ReviewState | null,
): string {
	if (kind === "opened") return "Opened";
	if (kind === "merged") return "Merged";
	if (kind === "closed") return "Closed";
	switch (reviewState) {
		case "approved":
			return "Reviewed (approved)";
		case "changes_requested":
			return "Reviewed (changes requested)";
		case "commented":
			return "Reviewed (commented)";
		case "dismissed":
			return "Reviewed (dismissed)";
		default:
			return "Reviewed";
	}
}

// Distinct activity labels in first-seen order, joined into one line — a PR
// opened and then reviewed twice reads as "Opened · Reviewed (approved)", not
// three repeated words.
export function activitySummary(
	events: Array<{ kind: ActivityKind; reviewState: ReviewState | null }>,
): string {
	const labels: string[] = [];
	for (const event of events) {
		const label = activityLabel(event.kind, event.reviewState);
		if (!labels.includes(label)) labels.push(label);
	}
	return labels.join(" · ");
}

/** An entry with no project that is still worked time. */
export function isUnfiledEdit(entry: ExistingTimeEntry | undefined): boolean {
	return !!entry && entry.projectId == null && entry.task?.isAbsence === false;
}

/** Whether the picker value names a real project, not one of the sentinels. */
export function isProjectPick(projectId: string): boolean {
	return projectId !== TIME_OFF && projectId !== NO_PROJECT_YET;
}

export function buildDefaults(
	entry: ExistingTimeEntry | undefined,
	defaultDate: string,
	defaultProjectId: string | undefined,
	timezone: string,
): FormValues {
	return {
		projectId:
			entry?.projectId ??
			(isUnfiledEdit(entry) ? NO_PROJECT_YET : (defaultProjectId ?? TIME_OFF)),
		taskId: entry?.taskId ?? "",
		date: defaultDate,
		duration: entry ? formatClock(entry.durationSeconds) : "",
		description: entry?.description ?? "",
		overtime: entry?.overtime ?? false,
		fillsDay: entry?.fillsDay ?? false,
		repeatEnabled: false,
		daysOfWeek: [weekdayInTz(defaultDate, timezone)],
		repeatEndDate: "",
	};
}

// A new entry opens on the project + task last logged, while that project can
// still take time. Opened from a project's own page, the page's project wins
// and the task comes along only if it was picked there. The task itself is
// not checked here: the effect in the dialog clears one the project no longer
// offers. Read on open rather than in `buildDefaults`, which also runs on the
// server.
export function rememberedPick(
	entry: ExistingTimeEntry | undefined,
	orgSlug: string,
	defaultProjectId: string | undefined,
	projects: ReadonlyArray<{ id: string; status: string }>,
): Partial<FormValues> {
	if (entry) return {};
	const last = readLastPick("entry", orgSlug);
	if (!last) return {};
	if (defaultProjectId) {
		return last.projectId === defaultProjectId ? { taskId: last.taskId } : {};
	}
	const live = projects.some(
		(p) => p.id === last.projectId && p.status === "active",
	);
	return live ? last : {};
}

/** The options a project + task was last saved with. Time-off has none. */
export function rememberedOptions(
	orgSlug: string,
	projectId: string,
	taskId: string,
	isTimeOff: boolean,
): ReturnType<typeof readEntryOptions> {
	return !isTimeOff && taskId
		? readEntryOptions(orgSlug, projectId, taskId)
		: null;
}

// "Tuesday, September 15, 2026" — the weekday because that is how a day is
// remembered, the year because the stepper can leave this one.
export function dialogDateLabel(key: string): string {
	const parts = key.split("-").map(Number);
	if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return key;
	const [year, month, day] = parts;
	return new Date(
		Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1),
	).toLocaleDateString("en-US", {
		weekday: "long",
		month: "long",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});
}

/** A task the picker no longer offers, while the list is loaded. */
export function isStaleTask(
	taskId: string,
	pickableTasks: ReadonlyArray<{ id: string }>,
): boolean {
	return (
		!!taskId &&
		pickableTasks.length > 0 &&
		!pickableTasks.some((t) => t.id === taskId)
	);
}

/** Whether the day already holds a fill block. Only a new entry asks. */
export function dayHasFillBlock(
	entry: ExistingTimeEntry | undefined,
	dayEntries: ReadonlyArray<{ fillsDay: boolean }> | undefined,
): boolean {
	return !entry && (dayEntries ?? []).some((e) => e.fillsDay);
}

export type AttachedPullRequestRow = {
	id: string;
	pullRequestUrl: string;
	number: number;
	title: string;
	kind: ActivityKind;
	reviewState: ReviewState | null;
};

export type AttachedPullRequestGroup = {
	pullRequestUrl: string;
	number: number;
	title: string;
	ids: string[];
	events: Array<{ kind: ActivityKind; reviewState: ReviewState | null }>;
};

// Attached pull-request activity is one row per event (an entry attached to
// a PR that was both opened and reviewed here has two rows), so it is
// grouped by `pullRequestUrl` before it is shown — one line per PR, with
// every event that touched it summarised on that line.
export function groupAttachedPullRequests(
	rows: ReadonlyArray<AttachedPullRequestRow> | undefined,
): AttachedPullRequestGroup[] {
	const groups = new Map<string, AttachedPullRequestGroup>();
	for (const row of rows ?? []) {
		const event = { kind: row.kind, reviewState: row.reviewState };
		const existing = groups.get(row.pullRequestUrl);
		if (existing) {
			existing.ids.push(row.id);
			existing.events.push(event);
		} else {
			groups.set(row.pullRequestUrl, {
				pullRequestUrl: row.pullRequestUrl,
				number: row.number,
				title: row.title,
				ids: [row.id],
				events: [event],
			});
		}
	}
	return [...groups.values()];
}

export function toggledSet(keys: Set<string>, key: string): Set<string> {
	const next = new Set(keys);
	if (next.has(key)) next.delete(key);
	else next.add(key);
	return next;
}

export function selectedCommitRefs(
	suggested: ReadonlyArray<{ projectGithubRepoId: string; sha: string }>,
	keys: Set<string>,
): Array<{ projectGithubRepoId: string; sha: string }> {
	return suggested
		.filter((c) => keys.has(commitKey(c.projectGithubRepoId, c.sha)))
		.map((c) => ({ projectGithubRepoId: c.projectGithubRepoId, sha: c.sha }));
}

export function selectedPullRequestRefs(
	suggested: ReadonlyArray<{ projectGithubRepoId: string; number: number }>,
	keys: Set<string>,
): Array<{ projectGithubRepoId: string; number: number }> {
	return suggested
		.filter((pr) => keys.has(pullRequestKey(pr.projectGithubRepoId, pr.number)))
		.map((pr) => ({
			projectGithubRepoId: pr.projectGithubRepoId,
			number: pr.number,
		}));
}

/** The note the ticked commits and pull requests would write. */
export function describeSelection(
	commits: ReadonlyArray<SuggestedCommit>,
	pullRequests: ReadonlyArray<SuggestedPullRequest>,
	commitKeys: Set<string>,
	pullRequestKeys: Set<string>,
): string {
	return summarizeCommitMessages([
		...commits
			.filter((c) => commitKeys.has(commitKey(c.projectGithubRepoId, c.sha)))
			.map((c) => c.message),
		...describePullRequestActivity(
			pullRequests
				.filter((pr) =>
					pullRequestKeys.has(
						pullRequestKey(pr.projectGithubRepoId, pr.number),
					),
				)
				.flatMap((pr) =>
					pr.activity.map((a) => ({
						kind: a.kind,
						number: pr.number,
						title: pr.title,
					})),
				),
		),
	]);
}

// Both sentinels are "no project" to the server; only the reason differs, and
// the server does not need the reason.
function serverProjectId(projectId: string): string | undefined {
	return isProjectPick(projectId) ? projectId || undefined : undefined;
}

/** The input of a weekly rule, from the form values. */
export function toRulePayload(values: FormValues) {
	return {
		taskId: values.taskId,
		projectId: serverProjectId(values.projectId),
		description: values.description || undefined,
		daysOfWeek: values.daysOfWeek,
		duration: values.duration,
		effectiveFrom: values.date,
		effectiveUntil: values.repeatEndDate || undefined,
	};
}

/** The input of one entry, from the form values. Read from the submitted
 *  values rather than the render-time snapshot, so what is validated is
 *  exactly what is sent. */
export function toEntryPayload(
	values: FormValues,
	pick: { meetingUrl: string | null; calendarEventId: string | null },
) {
	const parsed = parseDuration(values.duration);
	const seconds =
		parsed !== null && parsed > 0 ? snapToQuarterHour(parsed) : undefined;
	return {
		taskId: values.taskId,
		projectId: serverProjectId(values.projectId),
		description: values.description || undefined,
		date: values.date,
		// A fill block's duration is derived server-side from the day's
		// remaining working hours, so none is sent.
		durationSeconds: values.fillsDay ? undefined : seconds,
		overtime: values.overtime,
		fillsDay: values.fillsDay,
		meetingUrl: values.fillsDay ? undefined : pick.meetingUrl || undefined,
		calendarEventId: values.fillsDay
			? undefined
			: pick.calendarEventId || undefined,
	};
}

export function saveLabel(state: {
	pending: boolean;
	isEdit: boolean;
	repeatEnabled: boolean;
}): string {
	if (state.pending) return "Saving…";
	if (state.isEdit) return "Save entry";
	return state.repeatEnabled ? "Create repeating entry" : "Save entry";
}

/** What the collapsed disclosure says it is holding. "Fill rest of day" is no
 *  longer one of them: it is a preset beside the lengths now, lit whether or
 *  not the disclosure is open. */
export function activeOptionLabels(
	repeatEnabled: boolean,
	overtime: boolean,
): string[] {
	const labels: string[] = [];
	if (repeatEnabled) labels.push("Repeat");
	if (overtime) labels.push("Overtime");
	return labels;
}

type Countable = { length: number };

export type GithubVisibility = {
	showCommitPicker: boolean;
	showAttachedCommits: boolean;
	showAttachedPullRequests: boolean;
	showGithubSection: boolean;
};

// Two different questions, and conflating them hid the commits on exactly the
// entries that always have some. FINDING new activity needs a project and a
// date to look it up by, and makes no sense on a rest-of-day fill block whose
// commits the engine already attached. SHOWING what is attached needs nothing
// but the attachments — a project-less fill block is the commit engine's own
// output, so it is the one entry guaranteed to have them. Pull requests share
// the same gate: a repo linked for commits is the same repo a PR lives in.
function githubVisibility(state: {
	repeatEnabled: boolean;
	fillsDay: boolean;
	hasProject: boolean;
	github: { connected: boolean } | undefined;
	linkedRepos: Countable | undefined;
	attachedCommits: Countable | undefined;
	attachedPullRequests: Countable | undefined;
}): GithubVisibility {
	const { repeatEnabled } = state;
	const showCommitPicker =
		!repeatEnabled &&
		!state.fillsDay &&
		state.hasProject &&
		!!state.github?.connected &&
		(state.linkedRepos?.length ?? 0) > 0;
	const showAttachedCommits =
		!repeatEnabled && (state.attachedCommits?.length ?? 0) > 0;
	const showAttachedPullRequests =
		!repeatEnabled && (state.attachedPullRequests?.length ?? 0) > 0;
	return {
		showCommitPicker,
		showAttachedCommits,
		showAttachedPullRequests,
		showGithubSection:
			showCommitPicker || showAttachedCommits || showAttachedPullRequests,
	};
}

export type DialogVisibility = GithubVisibility & {
	showCalendarPicker: boolean;
	showRepeatSection: boolean;
	showFillPreset: boolean;
	dayLocked: boolean;
};

export function dialogVisibility(state: {
	isEdit: boolean;
	repeatEnabled: boolean;
	fillsDay: boolean;
	isAbsence: boolean;
	hasProject: boolean;
	meetingTask: { systemKey?: string | null } | undefined;
	github: { connected: boolean } | undefined;
	google: { connected: boolean } | undefined;
	linkedRepos: Countable | undefined;
	attachedCommits: Countable | undefined;
	attachedPullRequests: Countable | undefined;
}): DialogVisibility {
	const { repeatEnabled, fillsDay } = state;
	const hasAttachments =
		(state.attachedCommits?.length ?? 0) > 0 ||
		(state.attachedPullRequests?.length ?? 0) > 0;
	return {
		...githubVisibility(state),
		// By systemKey, never by name: an org may rename the built-in Meeting
		// task, and a name match would then hide the calendar picker without a
		// word.
		showCalendarPicker:
			!repeatEnabled &&
			!fillsDay &&
			state.meetingTask?.systemKey === "meeting" &&
			!!state.google?.connected,
		showRepeatSection: !state.isEdit && !fillsDay && !state.isAbsence,
		// The fifth preset. An absence is a whole day off, not a block sized from
		// what the day has left, and a repeating entry has no single day to take a
		// remainder from.
		showFillPreset: !state.isAbsence && !repeatEnabled,
		// Commits and pull request events happened on the entry's day, so an entry
		// holding them stays there. The service refuses the move as well; this only
		// keeps the stepper from offering it.
		dayLocked: state.isEdit && hasAttachments,
	};
}

/** The suggestions one picker shows: the auto-load query when the toggle is
 *  on, the manual mutation's result otherwise. */
export function chooseSuggestions<T>(
	autoLoad: boolean,
	queried: ReadonlyArray<T> | undefined,
	manual: ReadonlyArray<T>,
): ReadonlyArray<T> {
	return autoLoad ? (queried ?? []) : manual;
}

/** The suggested commits that are not attached to the entry yet. */
export function unattachedCommits<T extends { sha: string }>(
	suggested: ReadonlyArray<T>,
	attached: ReadonlyArray<{ sha: string }> | undefined,
): T[] {
	const shas = new Set((attached ?? []).map((c) => c.sha));
	return suggested.filter((c) => !shas.has(c.sha));
}

/** The suggested pull requests that are not attached to the entry yet. */
export function unattachedPullRequests<T extends { url: string }>(
	suggested: ReadonlyArray<T>,
	attached: ReadonlyArray<{ pullRequestUrl: string }> | undefined,
): T[] {
	const urls = new Set((attached ?? []).map((a) => a.pullRequestUrl));
	return suggested.filter((pr) => !urls.has(pr.url));
}

/** Worked time must say what was done; time off and a Break need not. */
export function needsDescriptionFor(
	task: Parameters<typeof descriptionRequiredFor>[0] | undefined,
): boolean {
	return task ? descriptionRequiredFor(task) : true;
}

/** Whether the GitHub panel is drawn: a footer link opened it, or the entry
 *  already holds attachments. */
export function githubPanelShown(
	visibility: GithubVisibility,
	activityOpen: boolean,
): boolean {
	return (
		visibility.showGithubSection &&
		(activityOpen ||
			visibility.showAttachedCommits ||
			visibility.showAttachedPullRequests)
	);
}

/** What the activity buttons and lists say about loading, from whichever
 *  source feeds them: the auto-load queries or the manual mutations. */
export function activityLoadState(
	autoLoad: boolean,
	queries: {
		commits: { isFetching: boolean; isSuccess: boolean };
		pullRequests: { isFetching: boolean; isSuccess: boolean };
	},
	mutations: {
		commits: { isPending: boolean; isSuccess: boolean };
		pullRequests: { isPending: boolean; isSuccess: boolean };
	},
) {
	if (autoLoad) {
		return {
			busy: queries.commits.isFetching || queries.pullRequests.isFetching,
			commitsLoaded: queries.commits.isSuccess,
			pullRequestsLoaded: queries.pullRequests.isSuccess,
		};
	}
	return {
		busy: mutations.commits.isPending || mutations.pullRequests.isPending,
		commitsLoaded: mutations.commits.isSuccess,
		pullRequestsLoaded: mutations.pullRequests.isSuccess,
	};
}
