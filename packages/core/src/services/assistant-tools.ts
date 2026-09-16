// What the assistant is allowed to do, and how it is described to the model.
//
// Every tool is a thin adapter onto a service function called with the CALLER'S
// OWN Ctx. That is the whole security model and it is deliberately not restated
// here: a Member's `list_time_entries` returns only their rows because
// `timeEntriesService.listRange` filters on `ctx.userId`, and `create_time_entry`
// refuses a project they aren't assigned to because `assertCanTrackOn` says so.
// A tool that re-implemented either check would be a second copy of the §4
// matrix, and the second copy is always the one that drifts.
//
// The `parameters` are the EXISTING Zod inputs from `src/schema/*`, converted
// with zod 4's own `z.toJSONSchema()`. Not a hand-written JSON Schema per tool:
// `api/v1/time-entries` is what re-validating by hand looks like six months
// later — it re-spelled the range check and dropped the 62-day ceiling doing it.
// Here the model is handed the same ceiling the UI has.
//
// Tools are added in pairs with whatever produces their arguments. A write whose
// ids no read returns cannot be called at all, which is how `file_time_entries`
// spent its first months uncallable: it takes entry ids, and the only tool that
// could have produced one reported a null project for absence too, so the one
// action that clears unfiled time could only be aimed by guessing.

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { member, organization, user } from "../db/schema/auth";
// The one caller outside the scheduler. "Sync now" must share the sweep's
// per-person guard, or a person pressing it while the sweep is on them gets two
// passes over the same days at once — see `runExclusive`.
import { runAutomationSyncForCtx } from "../jobs/automation-sync";
import type { JsonRecord, JsonValue, Serializable } from "../lib/json";
import {
	absenceReportInput,
	absenceTotalsInput,
	overtimeReportInput,
	applyDayAssemblyInput,
	assignProjectMemberInput,
	attachCommitsInput,
	attachPullRequestsInput,
	clientIdInput,
	copyTimeEntriesInput,
	copyWeekEntriesInput,
	createClientInput,
	createProjectInput,
	createRecurringBlockRuleInput,
	createTaskInput,
	createTimeEntryInput,
	deleteFilingRuleInput,
	deleteRecurringBlockRuleInput,
	deleteTimeEntryInput,
	fileTimeEntriesInput,
	listAbsenceForUserInput,
	listTimeEntriesRangeInput,
	logAbsenceRangeInput,
	monthReportInput,
	projectIdInput,
	setTimeEntryOvertimeInput,
	suggestDayAssemblyInput,
	taskIdInput,
	timeReportDetailInput,
	timeReportSummaryInput,
	updateProjectInput,
	updateRecurringBlockRuleInput,
	updateTaskInput,
	updateTimeEntryDescriptionInput,
	updateTimeEntryInput,
	userCommitsRangeInput,
	userPullRequestsRangeInput,
	yearReportInput,
} from "../schema";
import type { Access } from "./access.service";
import { clientsService } from "./clients.service";
import { complianceService, type PeriodTarget } from "./compliance.service";
import { ctxAccess, ctxDb, ctxTimezone, ctxWeekStartsOn } from "./context";
import { dayAssemblyService } from "./day-assembly.service";
import { filingRulesService } from "./filing-rules.service";
import { githubService } from "./github.service";
import { googleCalendarService } from "./google-calendar.service";
import { holidaysService } from "./holidays.service";
import { integrationSettingsService } from "./integration-settings.service";
import { membersService } from "./members.service";
import { orgSettingsService } from "./org-settings.service";
import { projectsService } from "./projects.service";
import { recurringBlockRulesService } from "./recurring-block-rules.service";
import { reportsService } from "./reports.service";
import { tasksService } from "./tasks.service";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";
import { listUnfiledForUser, unfiledTotals } from "./unfiled";
import { workingHoursService } from "./working-hours.service";

/**
 * How much consent a tool needs before it runs.
 *
 *   read         answers a question; runs inline.
 *   write        creates or corrects something; runs inline. Reversible by
 *                doing the opposite thing, and stopping to ask before every
 *                one of them turns "fix up my week from my commits" into
 *                fifteen dialogs, which is the interaction the feature exists
 *                to replace.
 *   destructive  removes or retires something. Suspends the turn for approval.
 *
 * The line is "can the person undo this by asking for the opposite" — editing
 * an entry's hours can be edited back; archiving a project cannot be un-asked
 * for by someone who never saw it happen. Moving a tool between tiers is one
 * word here, deliberately, because where the line sits is a judgement that will
 * be revisited.
 */
export type ToolKind = "read" | "write" | "destructive";

/**
 * What a batch write is about to do, one row per thing it would touch.
 *
 * The third state between "runs inline" and "one dialog per write". A tool that
 * supplies this suspends the turn ONCE for the whole batch and is shown as a
 * checklist — which is not the fifteen dialogs the write tier exists to avoid,
 * because fifteen rows in one card is still one decision. It is also the only
 * place partial consent is expressible: "yes to four of these five" has no
 * spelling in an approve/reject pair, and the alternative is the person
 * rejecting the lot and re-asking with the exception described in prose.
 *
 * `cells` are strings and already resolved — an approval card that shows a row
 * of uuids is not consent, it is a form. Building them costs lookups on the way
 * to ASKING, so every one of them is best-effort (see `preview` below).
 */
export type ApprovalPreview = {
	columns: string[];
	rows: { id: string; cells: string[] }[];
	/** Shown under the table — what was left out, if the batch overran the cap. */
	note?: string;
};

/** How many rows a preview will render. A batch of 200 is a scroll, not a
 *  review; past this the card says so and approval covers the whole batch.
 *
 *  "Covers the whole batch" is what `withSelection` has to honour: the rows
 *  past the cap were never on screen, so nobody could untick them, and they go
 *  through with the approval. Reading the card's answer as "only the ticked
 *  rows" instead silently dropped everything after row 25 of a 40-row batch. */
const MAX_PREVIEW_ROWS = 25;

/** The note under a capped preview. It has to say the hidden rows are part of
 *  the approval, because that is the one thing about them the card cannot show. */
const hiddenRowsNote = (hidden: number) =>
	hidden > 0
		? `+ ${hidden} more not shown. Approving includes them.`
		: undefined;

export type AssistantTool = {
	name: string;
	description: string;
	kind: ToolKind;
	schema: z.ZodType;
	/**
	 * Whether this caller is offered the tool at all.
	 *
	 * NOT a security check. The service behind every tool re-resolves `Access` and
	 * asserts, which is what actually protects the data, and this file must never
	 * hold a second copy of the matrix. This is about what the model is TOLD it
	 * can do: every definition is re-sent on every step of every turn, so offering
	 * a Member the admin reports costs tokens on each one and
	 * buys a tool call that can only come back refused — and a model that has
	 * spent two of its eight steps being refused is a model that answers worse.
	 * A capability the caller does not have is better expressed by the tool being
	 * absent than by them discovering the refusal.
	 *
	 * Absent means "everyone". Predicates stay coarse on purpose — "is a PM
	 * anywhere", never "is a PM on THIS project" — because the arguments do not
	 * exist when the list is built, and narrowing it here would be exactly the
	 * second copy of the matrix.
	 */
	available?: (access: Access) => boolean;
	/**
	 * One line naming what approving would actually do, for the approval card.
	 *
	 * Written from the ARGUMENTS rather than the tool name, because "delete a
	 * time entry" is not a thing anyone can meaningfully consent to — and neither
	 * is "Archive project 3f2a9b1c…", which is what naming an argument without
	 * resolving it produces. So this gets the Ctx and may look the id up: the card
	 * says "Archive Acme Redesign", and the person either recognises it or does
	 * not. That recognition is the entire point of asking.
	 *
	 * Best-effort by construction. A lookup that fails falls back to a generic
	 * phrase rather than throwing, because a card that failed to render is a
	 * person stuck on a turn they can resolve neither way.
	 */
	summarize?: (ctx: Ctx, args: JsonRecord) => string | Promise<string>;
	/**
	 * The rows this call would write, for the approval card. Its PRESENCE is what
	 * makes a `write` tool stop and ask — see `ApprovalPreview`.
	 *
	 * Best-effort in exactly the way `summarize` is, and for the same reason: it
	 * runs on the way to asking for consent, so a lookup that throws must cost
	 * the table, not the card. Returning null falls back to the summary line
	 * alone, which is the behaviour every other approval already has.
	 */
	preview?: (ctx: Ctx, args: JsonRecord) => Promise<ApprovalPreview | null>;
	/**
	 * Rebuild the arguments without the rows the person unticked.
	 *
	 * Only called when the card came back with a selection, and only for tools
	 * that offer it — a tool with a `preview` but no `withSelection` is all-or-
	 * nothing, which is right for a batch whose rows aren't separable. The ids
	 * are the `preview` row ids, so the two are written together or not at all.
	 *
	 * Expressed as what to DROP, not what to keep, because a preview is capped
	 * at `MAX_PREVIEW_ROWS`: a row past the cap was never shown, so it can never
	 * be ticked, and a keep-list would file only the rows that fit on the card.
	 */
	withSelection?: (
		args: JsonRecord,
		unticked: ReadonlySet<string>,
	) => JsonRecord;
	/**
	 * This read must not run beside another call. Ignored on a write, which is
	 * never run beside anything.
	 *
	 * A step asking for four lists is four questions that do not depend on each
	 * other, so the loop claims the run of them at once and awaits them together
	 * (`runClaimedBatch`) — the person waits for the slowest read rather than
	 * for the sum of them. That is only true of a read that READS. A read that
	 * writes on the way through races itself when two of them cover the same
	 * days, so it says so here and goes back to running alone.
	 *
	 * A new read that touches a service which writes MUST set this. There is no
	 * way to detect it from here, and the failure is a race, not an error.
	 */
	serial?: boolean;
	/** Runs the tool. The result is stringified for the model and never
	 *  inspected by the loop, so `Serializable | void` is the whole contract:
	 *  domain rows with their Dates intact, or nothing at all. */
	run: (ctx: Ctx, args: JsonRecord) => Promise<Serializable | void>;
};

/** Seconds → a display string, for approval-card wording.
 *
 *  The argument comes off an unvalidated tool-call payload, so it is PARSED
 *  here rather than hand-narrowed: a card is shown before the tool's own schema
 *  has run, and "?" is the honest rendering of an argument the model got wrong. */
const hours = (seconds: JsonValue | undefined) => {
	const parsed = z.number().safeParse(seconds);
	return parsed.success ? `${(parsed.data / 3600).toFixed(2)}h` : "?";
};

/** Seconds → hours, preserving null. Null is a real answer (nobody set a
 *  figure) and is not the same as zero — a person with no target is not a
 *  person whose target is nothing. */
const nullableHours = (seconds: number | null) =>
	seconds == null ? null : seconds / 3600;

/** The `timeEntryIds` argument, as it arrives from the model.
 *
 *  `.catch([])` rather than a throw: this runs on the way to an approval card,
 *  and an argument the model got wrong should cost the row, not the card. */
const entryIdList = z.array(z.string()).catch([]);

/** One assembled row as it arrives from the model — parsed, not asserted, so a
 *  row that is not an object renders as dashes instead of taking the card down
 *  and leaving a pending write nobody can answer either way. */
const assemblyRow = z.record(z.string(), z.json()).catch({});

/** A display name for an approval card, or a phrase that at least reads as
 *  English. Never throws — see `summarize`. */
const nameOr = async (
	load: () => Promise<{ name: string } | null | undefined>,
	fallback: string,
): Promise<string> => {
	try {
		return (await load())?.name ?? fallback;
	} catch {
		return fallback;
	}
};

// ── availability predicates ──────────────────────────────────────────────────
//
// All phrased as "…anywhere": they answer "is this person ever in a position to
// use this tool", which is the only form of the question that can be answered
// before the arguments exist.

const adminOnly = (access: Access) => access.isAdmin;

/** Every report is scoped by the service to what the caller may see — a
 *  Member gets themselves — so a report tool is offered to everyone. */
const anyone = () => true;

/** Reports refuse a caller who leads nothing — `reportScope` throws outright —
 *  so a plain Member is offered none of them rather than being handed four
 *  tools whose only possible answer is an access error. */
const leadsSomething = (access: Access) =>
	access.isAdmin ||
	access.isTeamLead ||
	access.assignments().some(([, role]) => role !== "member");

const canCreateProjects = (access: Access) => access.canCreateProjects();

export const ASSISTANT_TOOLS: AssistantTool[] = [
	// ── reads: who, and what exists ─────────────────────────────────────────
	{
		name: "whoami",
		kind: "read",
		description:
			"The current user: their name and user id, org role, member type, timezone, working-hours schedule, and the projects they are on with their role on each. Call this when a question depends on who is asking, on what counts as a full day for them, or when another tool needs their user id.",
		schema: z.object({}),
		// One call rather than four, because these are asked together or not at
		// all. Without it the model knew the date and nothing else about the person
		// it was answering as — it could not say whether a 6-hour day was short,
		// and `time_report_summary` grouped by teammate handed back names it had no
		// way to turn back into the ids every other tool takes.
		run: async (ctx) => {
			const [access, people, workingHours, timezone] = await Promise.all([
				ctxAccess(ctx),
				membersService.list(ctx),
				workingHoursService.list(ctx),
				ctxTimezone(ctx),
			]);
			const me = people.find((person) => person.userId === ctx.userId);
			const myProjects = await projectsService.listMine(ctx);

			return {
				userId: ctx.userId,
				name: me?.name ?? null,
				email: me?.email ?? null,
				orgRole: me?.orgRole ?? null,
				isAdmin: access.isAdmin,
				memberType: me?.type ?? null,
				startDate: me?.startDate ?? null,
				timezone,
				// 0 = Sunday. Enabled days only: a list of five IS the schedule, where
				// seven rows with two disabled is the same thing spelled longer.
				workingDays: workingHours
					.filter((day) => day.enabled)
					.map((day) => ({
						dayOfWeek: day.dayOfWeek,
						startTime: day.startTime,
						endTime: day.endTime,
					})),
				canCreateProjects: access.canCreateProjects(),
				projects: myProjects.map((row) => ({
					id: row.id,
					name: row.name,
					role: access.roleOn(row.id),
				})),
			};
		},
	},
	{
		name: "list_time_entries",
		kind: "read",
		// `listRange` recomputes and drops each day's fill block against the rows
		// it just read (CLAUDE.md, Gotchas), so this read writes. Two of them over
		// overlapping days would recompute the same day at once.
		serial: true,
		description:
			"List the current user's own time entries between two dates (inclusive, yyyy-MM-dd, max 62 days apart). Returns each entry's date, duration, description, task and project.",
		schema: listTimeEntriesRangeInput,
		run: async (ctx, args) => {
			const input = listTimeEntriesRangeInput.parse(args);
			const rows = await timeEntriesService.listRange(ctx, input);
			// Projected rather than passed through: the raw row carries ids, sync
			// bookkeeping and commit counts that cost tokens and tell the model
			// nothing it can use.
			return rows.map((row) => ({
				id: row.id,
				date: row.date,
				hours: row.durationSeconds / 3600,
				description: row.description,
				task: row.task?.name ?? null,
				project: row.project?.name ?? null,
				client: row.project?.client?.name ?? null,
				overtime: row.overtime,
			}));
		},
	},
	{
		name: "list_unfiled_entries",
		kind: "read",
		description:
			"The current user's unfiled entries between two dates, with their ids — real worked time (synced meetings, commit blocks) that carries no project yet. These are what file_time_entries attributes, and unfiled time is invisible to every project report.",
		schema: listTimeEntriesRangeInput,
		run: async (ctx, args) => {
			const input = listTimeEntriesRangeInput.parse(args);
			const rows = await listUnfiledForUser(ctx, input);
			return rows.map((row) => ({
				id: row.id,
				date: row.date,
				hours: row.durationSeconds / 3600,
				description: row.description,
				task: row.taskName,
				meetingUrl: row.meetingUrl,
			}));
		},
	},
	{
		name: "list_projects",
		kind: "read",
		description:
			"List the projects the current user may log time against, with their ids, codes, type and clients. Call this before creating a time entry — a project must be named by id.",
		schema: z.object({}),
		run: async (ctx) => {
			const rows = await projectsService.listMine(ctx);
			return rows.map((row) => ({
				id: row.id,
				name: row.name,
				code: row.code,
				type: row.type,
				client: row.client?.name ?? null,
			}));
		},
	},
	{
		name: "list_tasks",
		kind: "read",
		description:
			"List the task types a time entry can be filed under (Development, Meeting, …), with their ids. Every time entry needs one. Absence tasks (Vacation, Sick Leave, Paid Leave) are included and flagged with isAbsence — those carry no project and are what log_absence takes.",
		schema: z.object({}),
		// Both lists. `listSelectable` excludes absence by design, since it feeds
		// the worked-time picker — which left `log_absence` unable to learn the id
		// of the one kind of task it accepts.
		run: async (ctx) => {
			const [selectable, absence] = await Promise.all([
				tasksService.listSelectable(ctx),
				tasksService.listAbsenceTasks(),
			]);
			return [
				...selectable.map((row) => ({
					id: row.id,
					name: row.name,
					isAbsence: false,
				})),
				...absence.map((row) => ({
					id: row.id,
					name: row.name,
					isAbsence: true,
				})),
			];
		},
	},
	{
		name: "list_clients",
		kind: "read",
		description:
			"List the organization's clients with their ids. Needed before creating a project, which must name one.",
		schema: z.object({}),
		run: async (ctx) => {
			const rows = await clientsService.list(ctx);
			return rows.map((row) => ({ id: row.id, name: row.name }));
		},
	},
	{
		name: "list_members",
		kind: "read",
		description:
			"Everyone in the organization with their user ids — how a person named in the question becomes the id the other tools take.",
		schema: z.object({}),
		run: async (ctx) => {
			const [access, rows] = await Promise.all([
				ctxAccess(ctx),
				membersService.list(ctx),
			]);
			return rows.map((row) => ({
				userId: row.userId,
				name: row.name,
				email: row.email,
				orgRole: row.orgRole,
				archived: row.archivedAt !== null,
				// Billable/overhead/contractor decides Expected, so
				// it travels with the money picture rather than with the directory: a
				// roster is not sensitive within an org, and who is a contractor is.
				// Null rather than absent, so the field's meaning does not depend on
				// the reader noticing which key is missing.
				memberType: access.isAdmin ? row.type : null,
			}));
		},
	},
	{
		name: "list_project_members",
		kind: "read",
		description:
			"Who is assigned to a project and in what role (member, team_lead, pm).",
		schema: z.object({ projectId: projectIdInput }),
		available: leadsSomething,
		run: async (ctx, args) => {
			const { projectId } = z.object({ projectId: projectIdInput }).parse(args);
			const rows = await projectsService.listMembers(ctx, projectId);
			return rows.map((row) => ({
				userId: row.userId,
				name: row.name,
				role: row.role,
				active: row.active,
			}));
		},
	},
	{
		name: "list_holidays",
		kind: "read",
		description:
			"The organization's public holidays for a year, as dates. Use this rather than assuming which days are holidays — it follows the org's own country and its opt-outs.",
		schema: yearReportInput,
		run: async (ctx, args) => {
			const { year } = yearReportInput.parse(args);
			return holidaysService.listForYear(ctx, year);
		},
	},
	{
		name: "list_recurring_block_rules",
		kind: "read",
		description:
			"The current user's recurring block rules — the standing entries (a daily break, a weekly stand-up) that materialize automatically. This is what explains entries the person did not type.",
		schema: z.object({}),
		run: async (ctx) => {
			const rows = await recurringBlockRulesService.list(ctx);
			return rows.map((row) => ({
				id: row.id,
				task: row.task?.name ?? null,
				project: row.project?.name ?? null,
				description: row.description,
				daysOfWeek: row.daysOfWeek,
				hours: row.durationSeconds / 3600,
				effectiveFrom: row.effectiveFrom,
				effectiveUntil: row.effectiveUntil,
			}));
		},
	},
	// ── reads: why the timesheet looks the way it does ──────────────────────
	//
	// "Where are my meetings" is the commonest question about this product, and
	// every answer to it is a fact the assistant could not see: the switch is
	// off, the Google token was revoked, the engine has not reached that day, or
	// the month is locked to automations. Without these it guessed, and a guess
	// about somebody's missing hours reads as a diagnosis.
	{
		name: "integration_status",
		kind: "read",
		// Both connection reads refresh an expired OAuth token through
		// better-auth, which writes the new one back to the `account` row. A read
		// that writes does not go in the claimed batch — see `serial`.
		serial: true,
		description:
			"Why entries the current user did not type are, or are not, appearing: whether Google Calendar and GitHub are connected for them, whether each automatic sync is switched on, the day each switch was flipped (nothing before it is ever written), and the day the organization has locked automations up to. Call this before you explain a missing meeting, a missing commit block or an unexpected entry. A connected account whose token was refused is reported as needsReconnect, which no amount of syncing fixes.",
		schema: z.object({}),
		run: async (ctx) => {
			const [settings, google, github, org] = await Promise.all([
				integrationSettingsService.get(ctx),
				googleCalendarService.connectionStatus(ctx),
				githubService.connectionStatus(ctx),
				orgSettingsService.get(ctx),
			]);
			return {
				googleCalendar: {
					connected: google.connected,
					account: google.email,
					// Google answered neither yes nor no. Saying so beats reporting a
					// live connection as dead on a slow network.
					unreachable: google.unreachable,
					autoSyncMeetings: settings.googleAutoSyncMeetings,
					autoSyncMeetingsSince: settings.googleAutoSyncMeetingsSince,
				},
				github: {
					connected: github.connected,
					account: github.login,
					unreachable: github.unreachable,
					needsReconnect: github.needsReconnect,
					loadCommitsIntoSuggestions: settings.githubAutoLoadCommits,
					syncCommitsAsWorkTime: settings.githubSyncCommitsAsWorkTime,
					syncCommitsAsWorkTimeSince: settings.githubSyncCommitsAsWorkTimeSince,
				},
				// The org's floor. No automation may write on or before this day,
				// which is what an invoiced month is protected by.
				automationsLockedThrough: org.automationLockedThrough,
			};
		},
	},
	{
		name: "list_filing_rules",
		kind: "read",
		description:
			'The current user\'s standing filing rules: "always file a meeting called X under project Y". A rule is what makes a synced meeting land on a project instead of as unfiled time, so it explains an entry that already has a project nobody chose by hand. Rules are made by filing a meeting with remember set on file_time_entries, never created from nothing.',
		schema: z.object({}),
		run: async (ctx) => {
			const rows = await filingRulesService.list(ctx);
			return rows.map((row) => ({
				id: row.id,
				meetingTitle: row.title,
				whenTaskIs: row.taskName,
				filesToProject: row.projectName,
				// Null keeps the meeting's own task.
				andChangesTaskTo: row.targetTaskName,
			}));
		},
	},
	{
		name: "list_commits",
		kind: "read",
		description:
			"The current user's GitHub commits between two dates (inclusive, max 31 days apart), across every repo linked to a project in this org, grouped by day. Use this as evidence for what was worked on when reconstructing time.",
		schema: userCommitsRangeInput,
		// A span rather than a day. Reconstructing a WEEK through a day-shaped read
		// is seven round trips out of a turn's eight, so the interaction this
		// feature exists for could run out of steps before writing anything.
		run: async (ctx, args) => {
			const input = userCommitsRangeInput.parse(args);
			// Returns [] rather than throwing when GitHub isn't connected, so the
			// model gets "no evidence" instead of an error it will try to work
			// around — matching how day-assembly degrades.
			const days = await githubService.listUserCommitsByDay(ctx, input);
			return days.map((day) => ({
				date: day.dayKey,
				commits: day.commits.map((commit) => ({
					// Both ids: `attach_commits` needs the repo row and the sha, and a
					// write whose arguments no read produces cannot be called at all.
					projectGithubRepoId: commit.projectGithubRepoId,
					projectId: commit.projectId,
					sha: commit.sha,
					// First line only: commit bodies are long, repetitive, and none of
					// this is worth the context window.
					message: commit.message.split("\n")[0],
					committedAt: commit.committedAt.toISOString(),
				})),
			}));
		},
	},
	{
		name: "list_pull_requests",
		kind: "read",
		description:
			"The current user's pull request activity between two dates (inclusive, max 31 days apart) — pull requests they opened, merged or closed, and reviews they submitted — across the repos linked to projects they are on, grouped by day. Evidence for what was worked on, alongside list_commits.",
		schema: userPullRequestsRangeInput,
		run: async (ctx, args) => {
			const input = userPullRequestsRangeInput.parse(args);
			const days = await githubService.listUserPullRequestActivityByDay(
				ctx,
				input,
			);
			return days.map((day) => ({
				date: day.dayKey,
				activity: day.activity.map((event) => ({
					// The pair `attach_pull_requests` names a pull request by.
					projectGithubRepoId: event.projectGithubRepoId,
					projectId: event.projectId,
					number: event.number,
					title: event.title,
					kind: event.kind,
					reviewState: event.reviewState,
					occurredAt: event.occurredAt.toISOString(),
				})),
			}));
		},
	},
	{
		name: "suggest_day",
		kind: "read",
		description:
			"What is missing from one day: its target, what is already logged, and suggested entries built from the person's calendar meetings, commits, pull request activity, recurring blocks and the rest of the working day. Prefer this over reconstructing a day by hand, then pass the suggestions you are accepting to apply_day_assembly.",
		schema: suggestDayAssemblyInput,
		run: async (ctx, args) => {
			const input = suggestDayAssemblyInput.parse(args);
			const assembly = await dayAssemblyService.suggest(ctx, input);
			return {
				date: assembly.date,
				targetHours: assembly.targetSeconds / 3600,
				loggedHours: assembly.loggedSeconds / 3600,
				suggestions: assembly.suggestions.map((suggestion) => ({
					kind: suggestion.kind,
					taskId: suggestion.taskId,
					task: suggestion.taskName,
					projectId: suggestion.projectId,
					project: suggestion.projectName,
					description: suggestion.description,
					hours: suggestion.durationSeconds / 3600,
					fillsDay: suggestion.fillsDay,
					meetingUrl: suggestion.meetingUrl,
					calendarEventId: suggestion.calendarEventId,
					// Something the person deleted once. Only ever present when the
					// caller asked for those back, and worth saying out loud rather
					// than re-proposing a deletion silently.
					previouslyDismissed: suggestion.dismissed,
					commits: suggestion.commits.map((commit) => ({
						projectGithubRepoId: commit.projectGithubRepoId,
						sha: commit.sha,
					})),
					pullRequests: suggestion.pullRequests.map((pr) => ({
						projectGithubRepoId: pr.projectGithubRepoId,
						number: pr.number,
						kinds: pr.kinds,
					})),
				})),
			};
		},
	},

	// ── reads: aggregates, absence ──────────────────────────────────────────
	{
		name: "time_report_summary",
		kind: "read",
		// The `userId` sentence is load-bearing, and it is the same sentence on
		// `time_report_detail`. "Scoped to what the caller is allowed to see" is
		// true and was read as "scoped to the caller": ten of thirteen models
		// benchmarked answered "how many hours did I log in August" with the whole
		// team's total, presented as the person's own, because a PM, Team Lead or
		// Admin may see everyone. Saying who the default covers fixed it in every
		// model that got it wrong.
		description:
			'Total logged hours over a date range, grouped by client, project or teammate. Scoped to what the caller is allowed to see. Use this for aggregate questions instead of listing every entry. Pass q to total only the entries whose NOTE contains some text — the same filter time_report_detail takes, so the two agree. IMPORTANT: leaving userId out returns EVERY person the caller may see, which for a PM, Team Lead or Admin is the whole team. A question about the caller themselves — "I", "me", "my" — must pass their own userId (from whoami).',
		schema: timeReportSummaryInput,
		available: anyone,
		run: async (ctx, args) => {
			const input = timeReportSummaryInput.parse(args);
			const result = await reportsService.timeSummary(ctx, input);
			return {
				rows: result.rows.map((row) => ({
					name: row.name,
					hours: row.secondsTotal / 3600,
				})),
				totalHours: result.totalSeconds / 3600,
				unfiledHours: result.unfiledSeconds / 3600,
			};
		},
	},
	{
		name: "time_report_detail",
		kind: "read",
		// Same default, same misreading — see the note on `time_report_summary`.
		//
		// It also answers "which entries mention X", through `q`. There is no
		// separate search tool because a search IS a filtered detail report: the
		// same range ceiling, the same access scope, and the summary above answers
		// "how many hours" for the same words.
		description:
			'The individual entries behind a report range — id, date, person, client, project, task, note, hours — with optional client, project, task and user filters. Use time_report_summary first; reach for this only when the question is about specific entries. Pass q to find entries whose NOTE contains some text (case-insensitive, and part of a word matches) — this is how you search for work by what it was about. Each row carries its entry id, which update_time_entry, update_entry_description, set_overtime and delete_time_entry take. Only time that has a project on it is reported here; use list_unfiled_entries for the rest. IMPORTANT: leaving userId out returns EVERY person the caller may see, which for a PM, Team Lead or Admin is the whole team. A question about the caller themselves — "I", "me", "my" — must pass their own userId (from whoami).',
		schema: timeReportDetailInput,
		available: anyone,
		run: async (ctx, args) => {
			const input = timeReportDetailInput.parse(args);
			const result = await reportsService.timeDetail(ctx, input);
			return {
				rows: result.rows.map((row) => ({
					id: row.id,
					date: row.date,
					user: row.userName,
					client: row.clientName,
					project: row.projectName,
					task: row.taskName,
					description: row.description,
					hours: row.durationSeconds / 3600,
					overtime: row.overtime,
				})),
				// Both counts, always: the row list is capped and the totals are not,
				// so reporting only what came back understates the answer silently.
				totalRows: result.totalRows,
				totalHours: result.totalSeconds / 3600,
				truncated: result.truncated,
			};
		},
	},
	// ── reads: the targets people are measured against ──────────────────────
	//
	// Hours logged and hours EXPECTED are different questions, and until these
	// two tools the assistant could only answer the first. Asked "am I behind",
	// it added up a month and guessed against 8 hours a day — which is right
	// only for a full-time person in a month with no public holiday and no day
	// booked off. The rule that the home page, the Tracking report and every
	// reminder read is `compliance.service.ts`, and these hand the model the
	// same numbers, so the assistant cannot give a verdict the screens disagree
	// with.
	{
		name: "my_targets",
		kind: "read",
		description:
			'The caller\'s own week and month against their target: the target for the period, where they should be by today, what they have logged, how much of it is time off, and the verdict (on_track, slightly_behind or behind). Use this for "am I behind", "how many hours do I still owe" and anything about a full day being short — never work a target out from hours alone, because the target is the month hour fund prorated over working days, minus public holidays and days off. A null target means the person has no target at all (an hourly student or contractor without an override, or an overhead employee), which is not the same as a target of zero.',
		schema: z.object({}),
		available: anyone,
		run: async (ctx) => {
			const targets = await complianceService.myTargets(ctx);
			const period = (p: PeriodTarget) => ({
				from: p.from,
				to: p.to,
				workingDays: p.workingDays,
				workingDaysElapsed: p.workingDaysElapsed,
				targetHours: nullableHours(p.targetSeconds),
				targetSoFarHours: nullableHours(p.targetSoFarSeconds),
				workedHours: p.workSeconds / 3600,
				timeOffHours: p.timeOffSeconds / 3600,
				totalHours: p.totalSeconds / 3600,
				// Through today only. The verdict is read from this and not from
				// `totalHours`, so a day booked off next week cannot flatter it.
				totalSoFarHours: p.totalSoFarSeconds / 3600,
				status: p.status,
			});
			return {
				today: targets.today,
				// What one working day is worth for THIS person this month. It is 8
				// only when the official fund applies.
				fullDayHours: targets.daySeconds / 3600,
				tolerancePct: targets.tolerancePct,
				week: period(targets.week),
				month: period(targets.month),
			};
		},
	},
	{
		name: "tracking_report",
		kind: "read",
		description:
			"The Tracking report for one month: every person the caller may see, with hours worked, time off, the month target so far, how far ahead or behind they are, and the verdict. Worst first. This is the report a lead acts on, and the same rule the reminders use, so a person it calls behind is a person the system nudges. Leaving out no filter — it always covers exactly the caller's own people: everyone for an Admin, and otherwise themselves, the people on their list and everyone on the projects they manage.",
		schema: monthReportInput,
		available: leadsSomething,
		run: async (ctx, args) => {
			const input = monthReportInput.parse(args);
			const report = await complianceService.tracking(ctx, input);
			return {
				year: report.year,
				month: report.month,
				// The day the figures are read through, and whether the month is
				// over. A verdict mid-month is about the month SO FAR.
				asOf: report.asOf,
				monthComplete: report.complete,
				workingDaysInMonth: report.workingDaysInMonth,
				workingDaysElapsed: report.workingDaysElapsed,
				tolerancePct: report.tolerancePct,
				rows: report.rows.map((row) => ({
					userId: row.userId,
					name: row.name,
					memberType: row.memberType,
					workedHours: row.workSeconds / 3600,
					timeOffHours: row.timeOffSeconds / 3600,
					totalHours: row.totalSeconds / 3600,
					targetSoFarHours: nullableHours(row.targetSeconds),
					monthTargetHours: nullableHours(row.monthTargetSeconds),
					deltaHours: nullableHours(row.deltaSeconds),
					// Null means no target applies, which is not "on track".
					status: row.status,
				})),
			};
		},
	},
	{
		name: "overtime_report",
		kind: "read",
		description:
			"Overtime per person over a date range — only entries the person flagged as overtime when logging them; nothing is inferred from the hour fund — with the flagged entries behind each figure. Scoped to the caller's projects and people.",
		schema: overtimeReportInput,
		available: anyone,
		run: async (ctx, args) => {
			const input = overtimeReportInput.parse(args);
			const report = await reportsService.overtime(ctx, input);
			return {
				rows: report.rows.map((row) => ({
					userId: row.userId,
					name: row.name,
					entries: row.count,
					hours: row.seconds / 3600,
				})),
				totalHours: report.totalSeconds / 3600,
			};
		},
	},
	{
		name: "unfiled_summary",
		kind: "read",
		description:
			"How much of the current user's logged time has no project attached yet, over a date range. Unfiled time is invisible to every project report.",
		schema: listTimeEntriesRangeInput,
		run: async (ctx, args) => {
			const input = listTimeEntriesRangeInput.parse(args);
			const totals = await unfiledTotals(ctx, input, ctx.userId);
			return { entries: totals.count, hours: totals.seconds / 3600 };
		},
	},
	{
		name: "absence_totals",
		kind: "read",
		description:
			"Absence taken in a year, grouped by task (Vacation, Sick Leave, Paid Leave), in days and hours. Defaults to the current user; naming somebody else needs PM rights over a project they are on. This is the tool for 'how much vacation have I taken'.",
		schema: absenceTotalsInput,
		run: async (ctx, args) =>
			timeEntriesService.absenceTotals(ctx, absenceTotalsInput.parse(args)),
	},
	{
		name: "list_absences",
		kind: "read",
		description:
			"One person's absence entries (Vacation, Sick Leave, Paid Leave) for a month, with their ids. Call whoami for the current user's own id.",
		schema: listAbsenceForUserInput,
		run: async (ctx, args) => {
			const input = listAbsenceForUserInput.parse(args);
			const rows = await timeEntriesService.listAbsenceForUser(ctx, input);
			return rows.map((row) => ({
				id: row.id,
				date: row.date,
				task: row.taskName,
				hours: row.durationSeconds / 3600,
				description: row.description,
			}));
		},
	},
	{
		name: "absence_report",
		kind: "read",
		description:
			"Time off per person over a date range — Vacation, Sick Leave, Paid Leave — in hours, split by task, with the entries behind each figure. Scoped to the people the caller may see: everyone for an Admin, otherwise themselves, their Team Lead people, and everyone on the projects they manage.",
		schema: absenceReportInput,
		available: anyone,
		run: async (ctx, args) => {
			const report = await reportsService.absence(
				ctx,
				absenceReportInput.parse(args),
			);
			return {
				rows: report.rows.map((row) => ({
					userId: row.userId,
					name: row.name,
					hours: row.seconds / 3600,
					byTask: Object.fromEntries(
						Object.entries(row.byTask).map(([key, seconds]) => [
							key,
							seconds / 3600,
						]),
					),
					entries: row.entries.map((e) => ({
						date: e.date,
						task: e.taskName,
						hours: e.durationSeconds / 3600,
						description: e.description,
					})),
				})),
			};
		},
	},
	{
		name: "create_time_entry",
		kind: "write",
		description:
			"Log a new time entry for the current user. Durations are in seconds and must be a multiple of 900 (15 minutes). Needs a taskId; needs a projectId unless it is an absence.",
		schema: createTimeEntryInput,
		summarize: (_ctx, args) =>
			`Log ${hours(args.durationSeconds)} on ${args.date}${
				args.description ? ` — ${String(args.description).slice(0, 80)}` : ""
			}`,
		run: async (ctx, args) =>
			timeEntriesService.create(ctx, createTimeEntryInput.parse(args)),
	},
	{
		name: "update_time_entry",
		kind: "write",
		description:
			"Change an existing time entry of the current user. Send every field, not just the changed one. To change only the note, use update_entry_description.",
		schema: updateTimeEntryInput,
		summarize: (_ctx, args) =>
			`Change an entry on ${args.date} to ${hours(args.durationSeconds)}`,
		run: async (ctx, args) =>
			timeEntriesService.update(ctx, updateTimeEntryInput.parse(args)),
	},
	{
		name: "update_entry_description",
		kind: "write",
		description:
			"Change only the description of one of the current user's entries, leaving its hours, task and project alone.",
		schema: updateTimeEntryDescriptionInput,
		run: async (ctx, args) =>
			timeEntriesService.updateDescription(
				ctx,
				updateTimeEntryDescriptionInput.parse(args),
			),
	},
	{
		name: "set_overtime",
		kind: "write",
		description:
			"Flag one of the current user's entries as overtime, or clear the flag. Overtime is never inferred — somebody has to say so.",
		schema: setTimeEntryOvertimeInput,
		run: async (ctx, args) =>
			timeEntriesService.setOvertime(
				ctx,
				setTimeEntryOvertimeInput.parse(args),
			),
	},
	{
		name: "file_time_entries",
		kind: "write",
		description:
			"Attribute existing unfiled entries (synced meetings, commit blocks) to a project, by id. Get the ids from list_unfiled_entries. Pass taskId only to change the task of every entry in the batch; leave it out to keep each entry's own task. Pass remember to also make it a standing rule, so a meeting with the same title files itself here from now on — offer this when the same meeting keeps coming back unfiled. The user is shown the entries as a checklist and may file only some of them.",
		schema: fileTimeEntriesInput,
		summarize: async (ctx, args) => {
			const count = Array.isArray(args.timeEntryIds)
				? args.timeEntryIds.length
				: 0;
			const project = await nameOr(
				() => projectsService.get(ctx, String(args.projectId ?? "")),
				"a project",
			);
			return `File ${count === 1 ? "1 entry" : `${count} entries`} to ${project}`;
		},
		// The rows are the entries themselves, read back one by one through the
		// caller's own `getOwn` — which filters on ownership rather than throwing,
		// so an id the model invented drops out of the table instead of taking the
		// card down with it.
		preview: async (ctx, args) => {
			const ids = entryIdList.parse(args.timeEntryIds);
			if (ids.length === 0) return null;
			const shown = ids.slice(0, MAX_PREVIEW_ROWS);
			const rows: ApprovalPreview["rows"] = [];
			for (const id of shown) {
				const entry = await timeEntriesService.getOwn(ctx, id);
				if (!entry) continue;
				rows.push({
					id,
					cells: [
						entry.date,
						hours(entry.durationSeconds),
						entry.description || entry.task?.name || "—",
					],
				});
			}
			if (rows.length === 0) return null;
			return {
				columns: ["Date", "Hours", "What"],
				rows,
				note: hiddenRowsNote(ids.length - shown.length),
			};
		},
		withSelection: (args, unticked) => ({
			...args,
			timeEntryIds: entryIdList
				.parse(args.timeEntryIds)
				.filter((id) => !unticked.has(id)),
		}),
		run: async (ctx, args) =>
			timeEntriesService.fileMany(ctx, fileTimeEntriesInput.parse(args)),
	},
	{
		name: "sync_now",
		kind: "write",
		// Through the job's guard, not straight to the service. Two passes over
		// one person at once race each other for the day's fill block and pay
		// somebody's API quota twice, and an agent loop re-reads far harder than a
		// person presses a button. A request for a pass already running joins it.
		description:
			"Run the current user's automatic syncs now — recurring blocks, Google Calendar meetings, and GitHub commits and pull requests — instead of waiting for the next sweep. Reports each engine separately: ran did work, skipped had no days it was allowed to write to, failed broke, and off is an engine this person never switched on. An engine under off is not a sync that went wrong; tell them where the switch is instead of running this again. It only reaches recent days and never the future, so it cannot backfill a month.",
		schema: z.object({}),
		run: async (ctx) => {
			const result = await runAutomationSyncForCtx(ctx);
			return {
				ran: result.ran,
				skipped: result.skipped,
				failed: result.failed,
				off: result.off,
			};
		},
	},
	{
		name: "copy_day",
		kind: "write",
		description:
			"Copy every entry from one day onto another for the current user — 'the same as yesterday'. Both dates are yyyy-MM-dd.",
		schema: copyTimeEntriesInput,
		summarize: (_ctx, args) =>
			`Copy ${args.fromDate}'s entries onto ${args.toDate}`,
		run: async (ctx, args) =>
			timeEntriesService.copyDay(ctx, copyTimeEntriesInput.parse(args)),
	},
	{
		name: "copy_week",
		kind: "write",
		description:
			"Copy a whole week of entries onto another week, pairing days by offset so last Tuesday lands on this Tuesday. Both arguments are the START date of a week.",
		schema: copyWeekEntriesInput,
		run: async (ctx, args) =>
			timeEntriesService.copyWeek(ctx, copyWeekEntriesInput.parse(args)),
	},
	{
		name: "log_absence",
		kind: "write",
		description:
			"Book Vacation or Sick Leave across a span of days for the current user. The span is expanded server-side: public holidays and days this person does not work are skipped, and each booked day takes that day's own working hours. Returns which days were booked and which were skipped and why — say so. Use this rather than one create_time_entry per day.",
		schema: logAbsenceRangeInput,
		summarize: (_ctx, args) => `Book absence from ${args.from} to ${args.to}`,
		run: async (ctx, args) =>
			timeEntriesService.logAbsenceRange(ctx, logAbsenceRangeInput.parse(args)),
	},
	{
		name: "apply_day_assembly",
		kind: "write",
		description:
			"Create a day's entries from suggestions returned by suggest_day. Pass through the taskId, projectId, description, durationSeconds, fillsDay, meetingUrl, calendarEventId, commits and pullRequests of each suggestion being accepted. The user is shown the entries as a checklist and may log only some of them.",
		schema: applyDayAssemblyInput,
		summarize: (_ctx, args) =>
			`Log ${Array.isArray(args.entries) ? args.entries.length : "several"} entries on ${args.date}`,
		// Rows are keyed by POSITION, because an assembled entry does not exist
		// yet and so has no id to key on. Position is stable for exactly as long
		// as it needs to be: the arguments the card was rendered from are the ones
		// stored on the message, and `withSelection` filters that same array.
		preview: async (ctx, args) => {
			const entries = Array.isArray(args.entries) ? args.entries : [];
			if (entries.length === 0) return null;
			// One list each rather than a lookup per row: fifty assembled entries
			// naming five tasks would otherwise be fifty queries for five answers.
			const [tasks, projects] = await Promise.all([
				tasksService.listSelectable(ctx).catch(() => []),
				projectsService.listMine(ctx).catch(() => []),
			]);
			const taskName = new Map(tasks.map((task) => [task.id, task.name]));
			const projectName = new Map(
				projects.map((project) => [project.id, project.name]),
			);
			const shown = entries.slice(0, MAX_PREVIEW_ROWS);
			return {
				columns: ["Task", "Project", "Hours", "Description"],
				rows: shown.map((entry, index) => {
					const row = assemblyRow.parse(entry);
					const seconds = row.durationSeconds;
					return {
						id: String(index),
						cells: [
							taskName.get(String(row.taskId)) ?? "—",
							projectName.get(String(row.projectId)) ?? "No project",
							// A fill block carries no duration: it claims whatever is left
							// of the day, and printing "0h" for it would be a lie the person
							// is being asked to agree to.
							row.fillsDay ? "rest of day" : hours(seconds),
							String(row.description ?? "") || "—",
						],
					};
				}),
				note: hiddenRowsNote(entries.length - shown.length),
			};
		},
		withSelection: (args, unticked) => ({
			...args,
			entries: Array.isArray(args.entries)
				? args.entries.filter((_entry, index) => !unticked.has(String(index)))
				: [],
		}),
		run: async (ctx, args) =>
			dayAssemblyService.apply(ctx, applyDayAssemblyInput.parse(args)),
	},
	{
		name: "attach_commits",
		kind: "write",
		description:
			"Attach GitHub commits to an existing time entry as evidence of what was worked on. Takes the projectGithubRepoId and sha pairs from list_commits.",
		schema: attachCommitsInput,
		run: async (ctx, args) =>
			githubService.attachCommits(ctx, attachCommitsInput.parse(args)),
	},
	{
		name: "attach_pull_requests",
		kind: "write",
		description:
			"Attach pull requests to an existing time entry as evidence. Takes the projectGithubRepoId and number pairs from list_pull_requests. Only the user's own activity on the entry's date is attached, so a pull request they did nothing on that day adds nothing.",
		schema: attachPullRequestsInput,
		run: async (ctx, args) =>
			githubService.attachPullRequests(
				ctx,
				attachPullRequestsInput.parse(args),
			),
	},
	{
		name: "create_client",
		kind: "write",
		description: "Create a client to hang projects off.",
		schema: createClientInput,
		available: canCreateProjects,
		run: async (ctx, args) =>
			clientsService.create(ctx, createClientInput.parse(args)),
	},
	{
		name: "create_project",
		kind: "write",
		description:
			"Create a project for a client. Needs a clientId (call list_clients) and a type: product_team, fixed_scope, hourly, maintenance or internal. Only Fixed Scope carries budgetHours; only Hourly carries hourlyPrice.",
		schema: createProjectInput,
		available: canCreateProjects,
		run: async (ctx, args) =>
			projectsService.create(ctx, createProjectInput.parse(args)),
	},
	{
		name: "update_project",
		kind: "write",
		description:
			"Change a project's name, code, color, type or budget. Send the project type alongside any budget or price field.",
		schema: updateProjectInput,
		available: canCreateProjects,
		run: async (ctx, args) =>
			projectsService.update(ctx, updateProjectInput.parse(args)),
	},
	{
		name: "assign_project_member",
		kind: "write",
		description:
			"Put somebody on a project, or change their role on it (member, team_lead, pm). Team Lead and up.",
		schema: assignProjectMemberInput,
		available: leadsSomething,
		run: async (ctx, args) =>
			projectsService.assignMember(ctx, assignProjectMemberInput.parse(args)),
	},
	{
		name: "create_task",
		kind: "write",
		description:
			"Create an organization task type (the taxonomy every time entry is filed under, e.g. Development, QA). Not a to-do item. Admin only.",
		schema: createTaskInput,
		available: adminOnly,
		run: async (ctx, args) =>
			tasksService.create(ctx, createTaskInput.parse(args)),
	},
	{
		name: "update_task",
		kind: "write",
		description: "Rename or re-describe an organization task type. Admin only.",
		schema: updateTaskInput,
		available: adminOnly,
		run: async (ctx, args) =>
			tasksService.update(ctx, updateTaskInput.parse(args)),
	},
	{
		name: "create_recurring_block_rule",
		kind: "write",
		description:
			"Create a standing entry for the current user that materializes automatically — a daily break, a weekly stand-up. daysOfWeek is 0=Sunday..6=Saturday; duration is text such as '30m' or '1h30m'.",
		schema: createRecurringBlockRuleInput,
		run: async (ctx, args) =>
			recurringBlockRulesService.create(
				ctx,
				createRecurringBlockRuleInput.parse(args),
			),
	},
	{
		name: "update_recurring_block_rule",
		kind: "write",
		description: "Change one of the current user's recurring block rules.",
		schema: updateRecurringBlockRuleInput,
		run: async (ctx, args) =>
			recurringBlockRulesService.update(
				ctx,
				updateRecurringBlockRuleInput.parse(args),
			),
	},
	{
		name: "unarchive",
		kind: "write",
		description:
			"Bring an archived project, client or task type back into use. The counterpart to the archive tools.",
		// One tool over three ids rather than three near-identical tools. The
		// definition list is re-sent on every step of every turn, and "which of
		// these three is it" is a parameter the model answers exactly as reliably
		// as it picks between three tool names.
		schema: z.object({
			kind: z.enum(["project", "client", "task"]),
			id: z.uuid(),
		}),
		run: async (ctx, args) => {
			const { kind, id } = z
				.object({ kind: z.enum(["project", "client", "task"]), id: z.uuid() })
				.parse(args);
			if (kind === "project") return projectsService.unarchive(ctx, id);
			if (kind === "client") return clientsService.unarchive(ctx, id);
			return tasksService.unarchive(ctx, id);
		},
	},
	{
		name: "delete_time_entry",
		kind: "destructive",
		description: "Delete one of the current user's time entries by id.",
		schema: z.object({ timeEntryId: deleteTimeEntryInput }),
		summarize: async (ctx, args) => {
			const row = await timeEntriesService
				.getOwn(ctx, String(args.timeEntryId))
				.catch(() => null);
			if (!row) return "Delete a time entry";
			const what = row.description?.trim() || row.task?.name || "entry";
			return `Delete ${hours(row.durationSeconds)} on ${row.date} — ${what.slice(0, 60)}`;
		},
		run: async (ctx, args) => {
			const { timeEntryId } = z
				.object({ timeEntryId: deleteTimeEntryInput })
				.parse(args);
			// `remove` is a delete-where-owned: an entry belonging to somebody else
			// (or already gone) is a no-op returning null, not a throw. Reporting a
			// flat `{deleted: true}` would have the model tell the user it deleted
			// something it did not touch, which is the one failure mode a write tool
			// must not have.
			const removed = await timeEntriesService.remove(ctx, timeEntryId);
			if (!removed) {
				throw new Error("No entry of yours with that id — nothing was deleted");
			}
			return { deleted: true, date: removed.date };
		},
	},
	{
		name: "remove_absence",
		kind: "destructive",
		description:
			"Delete a Vacation or Sick Leave entry by id. Deleting somebody else's needs PM rights over a project they are on.",
		schema: z.object({ timeEntryId: deleteTimeEntryInput }),
		summarize: async (ctx, args) => {
			// Own entries only, so somebody else's absence falls back to the generic
			// wording rather than leaking whose day it was into the caller's card.
			const row = await timeEntriesService
				.getOwn(ctx, String(args.timeEntryId))
				.catch(() => null);
			return row
				? `Delete ${row.task?.name ?? "absence"} on ${row.date}`
				: "Delete an absence entry";
		},
		run: async (ctx, args) => {
			const { timeEntryId } = z
				.object({ timeEntryId: deleteTimeEntryInput })
				.parse(args);
			const removed = await timeEntriesService.removeAbsence(ctx, timeEntryId);
			return { deleted: true, date: removed.date };
		},
	},
	{
		name: "delete_recurring_block_rule",
		kind: "destructive",
		description:
			"Delete one of the current user's recurring block rules so it stops producing entries. Entries it already created are left alone.",
		schema: z.object({ ruleId: deleteRecurringBlockRuleInput }),
		summarize: async (ctx, args) => {
			const rules = await recurringBlockRulesService.list(ctx).catch(() => []);
			const rule = rules.find((row) => row.id === args.ruleId);
			if (!rule) return "Delete a recurring block rule";
			const what = rule.description?.trim() || rule.task?.name || "block";
			return `Stop the recurring ${what.slice(0, 60)}`;
		},
		run: async (ctx, args) => {
			const { ruleId } = z
				.object({ ruleId: deleteRecurringBlockRuleInput })
				.parse(args);
			return recurringBlockRulesService.remove(ctx, ruleId);
		},
	},
	{
		name: "delete_filing_rule",
		kind: "destructive",
		description:
			"Remove one of the current user's standing filing rules, by id from list_filing_rules. The entries it already filed keep their project; only future meetings with that title stop being filed automatically. There is no way to create one back from here — a rule is made by filing a meeting with remember set.",
		schema: deleteFilingRuleInput,
		summarize: async (ctx, args) => {
			const id = String(args.id ?? "");
			const rules = await filingRulesService.list(ctx).catch(() => []);
			const rule = rules.find((row) => row.id === id);
			if (!rule) return "Remove a filing rule";
			return `Stop filing "${rule.title}" to ${rule.projectName}`;
		},
		run: async (ctx, args) =>
			filingRulesService.remove(ctx, deleteFilingRuleInput.parse(args)),
	},
	{
		name: "archive_project",
		kind: "destructive",
		description:
			"Archive a project. It stops accepting time and leaves the pickers; its history is kept.",
		schema: z.object({ projectId: projectIdInput }),
		summarize: async (ctx, args) =>
			`Archive ${await nameOr(
				() => projectsService.get(ctx, String(args.projectId)),
				"a project",
			)}`,
		run: async (ctx, args) => {
			const { projectId } = z.object({ projectId: projectIdInput }).parse(args);
			return projectsService.archive(ctx, projectId);
		},
	},
	{
		name: "archive_client",
		kind: "destructive",
		description:
			"Archive a client, hiding it and its projects from the pickers.",
		schema: z.object({ clientId: clientIdInput }),
		summarize: async (ctx, args) =>
			`Archive ${await nameOr(async () => {
				const clients = await clientsService.list(ctx);
				return clients.find((row) => row.id === args.clientId);
			}, "a client")} and its projects`,
		run: async (ctx, args) => {
			const { clientId } = z.object({ clientId: clientIdInput }).parse(args);
			return clientsService.archive(ctx, clientId);
		},
	},
	{
		name: "archive_task",
		kind: "destructive",
		description:
			"Archive an organization task type so no new time can be filed under it. Admin only.",
		schema: z.object({ taskId: taskIdInput }),
		available: adminOnly,
		summarize: async (ctx, args) =>
			`Archive the ${await nameOr(async () => {
				const tasks = await tasksService.listSelectable(ctx);
				return tasks.find((row) => row.id === args.taskId);
			}, "selected")} task type`,
		run: async (ctx, args) => {
			const { taskId } = z.object({ taskId: taskIdInput }).parse(args);
			return tasksService.archive(ctx, taskId);
		},
	},
];

const BY_NAME = new Map(ASSISTANT_TOOLS.map((tool) => [tool.name, tool]));

export const findTool = (name: string): AssistantTool | undefined =>
	BY_NAME.get(name);

/** The tools this caller is offered at all. See `AssistantTool.available`. */
export const toolsFor = (access: Access): AssistantTool[] =>
	ASSISTANT_TOOLS.filter((tool) => tool.available?.(access) ?? true);

/**
 * A tool's argument shape as JSON Schema — OpenAI's `parameters` and MCP's
 * `inputSchema` are the same document under two names.
 *
 * One function rather than the conversion spelled out at each call site, so the
 * two options below cannot come to differ between the assistant and the MCP
 * server. A tool that emitted a ceiling to one caller and `{}` to the other
 * would be the `api/v1/time-entries` mistake again, one layer up.
 */
export const toolInputSchema = (tool: AssistantTool): JsonRecord =>
	// SAFETY: `z.toJSONSchema` returns Zod's own JSON Schema type; `JsonRecord` is
	// the same value described as the JSON it is about to be serialized into.
	z.toJSONSchema(tool.schema, {
		// The schemas use `.refine()` for the range ceilings and the
		// mandatory-description rule, which have no JSON Schema equivalent.
		// Emitting them as `{}` (rather than throwing) keeps the shape the
		// model sees honest about the fields while leaving enforcement where
		// it actually happens — the `parse` inside each tool's `run`.
		io: "input",
		unrepresentable: "any",
	}) as JsonRecord;

/** The tool list in OpenAI's function-calling shape, scoped to the caller. */
export const toolDefinitions = (access: Access) =>
	toolsFor(access).map((tool) => ({
		type: "function" as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: toolInputSchema(tool),
		},
	}));

/**
 * The system prompt.
 *
 * Dated and zoned explicitly because every question this assistant gets is
 * relative ("last week", "yesterday") and a model with no date silently anchors
 * on its training cutoff — which produces entries filed months into the past,
 * quietly, onto months that may already be reconciled.
 *
 * `houseRules` is the org's own addition (assistantSettings.systemPrompt),
 * APPENDED rather than substituted, fenced, and explicitly ranked below the
 * rules above it. An admin is trusted — they already hold the API key — so
 * this is not a security boundary. It is a precedence one: the
 * base rules encode facts about the DOMAIN (quarter-hour granularity, ids are
 * looked up not invented, deletes need consent) that stay true no matter what
 * conventions an org layers on top, and a pasted paragraph that happens to
 * contradict one of them should lose rather than silently win.
 */
/**
 * Who the model is talking to, as two lines of the system prompt.
 *
 * It used to be told only the date, and that `whoami` existed. That is not the
 * same thing: asked for "Omar's notes" it read the member list, found no Omar
 * among the first page of a 200-person roster, and reported that no such person
 * works here — to Omar. A model cannot be expected to guess that the question
 * is about the person asking it, and the fix is not a better tool description;
 * it is telling it whose session this is before it reads anything.
 *
 * The name and the id both, because every other tool takes an id and the reader
 * only ever types a name. Deliberately NOT the whole `whoami` answer — working
 * hours, member type and the project list are a real read and belong behind a
 * tool the model calls when a question turns on them, whereas identity is
 * needed to understand the question at all.
 *
 * One query, on `ctxDb`, beside the memoized `Access` the caller already has.
 */
const callerCard = async (ctx: Ctx): Promise<string> => {
	const [access, rows] = await Promise.all([
		ctxAccess(ctx),
		ctxDb(ctx)
			.select({
				name: user.name,
				email: user.email,
				orgName: organization.name,
			})
			.from(member)
			.innerJoin(user, eq(user.id, member.userId))
			.innerJoin(organization, eq(organization.id, member.organizationId))
			.where(
				and(
					eq(member.userId, ctx.userId),
					eq(member.organizationId, ctx.organizationId),
				),
			)
			.limit(1),
	]);
	const me = rows[0];
	// `orgMiddleware` and `resolveApiOrgContext` both refuse a caller with no
	// membership row long before a turn starts, so this is unreachable rather
	// than a case to describe — but a prompt claiming the reader is nobody is
	// worse than one that simply does not mention them.
	if (!me) return "";

	return [
		`You are talking to ${me.name} (${me.email}), user id ${ctx.userId}, in the organization ${me.orgName}. They are ${access.isAdmin ? "an Admin" : "a Member"} of it.`,
		'"I", "me", "my" and their own first or last name all mean this person. A question that names them is a question about them — never search the member list to find out whether they exist.',
	].join("\n");
};

export const systemPrompt = async (
	ctx: Ctx,
	today: string,
	houseRules: string | null | undefined,
	/**
	 * The loop's step ceiling (`MAX_STEPS`), told to the model rather than
	 * sprung on it.
	 *
	 * A model that does not know it has a budget spends it the way it would
	 * spend an unlimited one — one narrow read per step — and the turns that
	 * used to hit the ceiling were mostly that, not real loops. Passed in rather
	 * than imported, so the number cannot come to differ from the loop's.
	 */
	maxSteps: number,
) => {
	const [tz, weekStartsOn, caller] = await Promise.all([
		ctxTimezone(ctx),
		ctxWeekStartsOn(ctx),
		callerCard(ctx),
	]);
	const base = [
		"You are the assistant inside Farmer, a time-tracking app for a software agency.",
		`Today is ${today} in the organization's timezone (${tz}). Resolve every relative date against that.`,
		"",
		caller,
		"",
		// The reader's words, mapped onto the data — because the model only ever
		// sees the schema's words and the two differ where it matters most.
		// Asked who had the most interesting "notes", it answered that it had no
		// access to a notes system: every entry read it has returns `description`,
		// which is the field the UI labels "Note". A missing synonym does not read
		// as a missing synonym, it reads as a missing feature.
		"Vocabulary — what people here say, and what it is in the data:",
		'- A "note" on an entry IS its description field. Every entry has one, and every tool that reads entries returns it. There is no separate notes system.',
		'- A "block" is a time entry. "Time off" is absence — Vacation, Sick Leave, Paid Leave. "Unfiled" is worked time that has no project on it yet.',
		"",
		"Facts about this timesheet that no tool's arguments show:",
		// The week start is an org setting (`organization.week_starts_on`) and the
		// model resolves "last week" itself, so without this every weekly figure in
		// a Sunday-start org is silently a day out — and copy_week takes the START
		// of a week as its argument, so a wrong boundary is a wrong write.
		`- The week starts on ${weekStartsOn === 0 ? "Sunday" : "Monday"} here. Resolve "this week" and "last week" against that, and make copy_week's start dates land on that day.`,
		"- A day holds at most 24 hours, and a write that would take it over is refused. Report that rather than retrying.",
		// Half of a busy timesheet is written by the sync engines, which is why a
		// question about what someone "wrote" is not a question about what they
		// typed.
		"- Not everything here was typed by hand: meetings sync from Google Calendar, commits and pull requests from GitHub, and recurring block rules materialize on their own. A description may be a commit subject or a meeting title rather than something the person wrote.",
		// Hours LOGGED and hours EXPECTED are different questions, and the model
		// answered the second with the first: it summed a month and judged it
		// against eight hours a day, which is right only for a full-time person in
		// a month with no public holiday and no day booked off. A verdict is a
		// number somebody acts on, and an invented one disagrees with the same
		// figure on the home page.
		'- Being "behind" is a rule, not arithmetic. A target is the month\'s hour fund spread over its working days, minus public holidays and time off, and some people have no target at all. Never work one out from hours and a guess at a full day: my_targets answers it for yourself, tracking_report for the people you lead.',
		"",
		"You answer questions about the user's tracked time and act on their behalf: logging and correcting time, booking absence, and creating clients, projects and task types. Everything you do runs as them and with their permissions, so a tool that refuses is a real answer about what they are allowed to do — report it, don't work around it. You are only offered the tools their role allows, so there is nothing to try around the edges.",
		"Rules:",
		"- Durations are seconds, always a multiple of 900 (15 minutes). Round to the nearest quarter hour and say that you did.",
		"- Never invent an id. Call list_projects / list_tasks / list_clients / list_members first and use what comes back. Your own user id is above; whoami adds your working hours, member type and the projects you are on, for a question that turns on those.",
		"- Prefer an aggregate over a list: time_report_summary for hours by client, project or teammate; absence_totals for vacation taken.",
		"- Creating and correcting things happens immediately, so just do what was asked rather than checking first. Deleting and archiving are shown to the user for approval — still call the tool, they will be asked.",
		"- Batch writes (apply_day_assembly, file_time_entries) are shown as a checklist of their rows and the user may approve only some. Send the whole batch you believe in and let them un-tick; the tool result says what was actually written, so read it before reporting what you did.",
		"- Reconstructing a day: suggest_day already assembles it from meetings, commits, pull requests and recurring blocks, so prefer it and then apply_day_assembly. Use list_commits, list_pull_requests and list_time_entries when you need the raw evidence. Do not log the same work twice.",
		"- Absence spanning several days goes through log_absence once, not one entry per day. It skips holidays and non-working days itself, so report which days it actually booked.",
		"- An entry that is missing, or one nobody typed, is usually a setting rather than a mistake. Call integration_status before you explain either: a switch that is off, a connection that needs reconnecting, and a month locked to automations are three different answers, and none of them is fixed by syncing again. list_filing_rules and list_recurring_block_rules explain an entry that already has a project nobody chose.",
		"- sync_now runs the syncs on demand, but only over recent days — it cannot backfill a month, and it does nothing for an engine that is off.",
		"- If a tool returns an error, explain what went wrong in one sentence rather than retrying blindly.",
		`- You get ${maxSteps} rounds of tool calls per question, so spend them wide rather than deep: ask for everything a round needs in one go — several tools in the same round is normal and they run together — and prefer one broad read over four narrow ones. If a result says it dropped rows, work from what you have or narrow the call yourself; do not make the user ask again.`,
		"- Be brief. This is a sidebar, not an essay.",
		"",
		// The renderer is apps/web/src/components/assistant/answer.tsx and it is
		// hand-rolled, so this list is exhaustive rather than "markdown" — a
		// construct it doesn't know renders to the reader as its own syntax.
		// Keep the two in step when either changes.
		"Formatting. Your answer is rendered as markdown, and only these are understood: paragraphs, `#`/`##`/`###` headings, bullet and numbered lists, **bold**, *italic*, `inline code`, fenced code blocks, links, `---` rules, and GitHub-style pipe tables. Anything else arrives as literal characters.",
		"- Any answer that is more than one number per row is a table: hours by project, a week day by day, entries you changed. Include the header separator row (`|---|---:|`) or it is not a table; right-align (`---:`) columns of numbers.",
		"- Keep tables to the columns that were asked about, and put the total in a last row rather than in a sentence underneath.",
		"- One or two facts is a sentence, not a table, and not a heading.",
		// The renderer now reads a fence whose body is nothing but a pipe table as
		// that table, so this rule is belt as well as braces — but it only covers
		// the case where the fence holds the table ALONE.
		"- A fenced code block is for code. Never put a table, a list or a heading inside one: a fenced table reaches the reader as raw pipes. A table with a long text column is still a table — drop the column rather than reaching for monospace to line it up.",
		// Three things that are NOT markdown, and are the only UI the model may
		// place. Spelled out with their exact syntax because a directive the
		// renderer doesn't recognise degrades to a visible code block — legible,
		// but obviously wrong. See answer.tsx, which must gain a construct before
		// this prompt promises one.
		"- Cite a day as [[YYYY-MM-DD]] and it becomes a link to that day's timesheet. Use it wherever you name a date the reader might want to check — it is how they see the entries a figure was summed from.",
		'- To draw a chart, emit a fenced block tagged farmer-chart holding JSON: {"type":"bar"|"trend","title":"…","unit":"h","data":[{"label":"…","value":12.5}]}. `bar` compares categories (projects, people), `trend` runs left to right in time (days, months). Hours as decimal hours, not seconds. Max 40 points. A chart replaces a long table when the SHAPE is the answer; a chart plus its table is duplication, so pick one.',
		'- END EVERY ANSWER with a fenced block tagged farmer-next holding two or three follow-ups, one per line, each phrased as the user would type it. They are the next move, not a menu: draw them from what you just said and what the data showed — the project that stood out, the day that is short, the entries still unfiled — and only offer things you could actually do. Generic ones ("Tell me more") are worse than none, so if nothing specific suggests itself, offer the nearest concrete actions instead.',
		// Spelled out as literal characters because these become BUTTONS, and an
		// untagged fence or a "Next steps" heading above the list is the whole
		// difference between a follow-up the reader can click and one they have to
		// re-type. Nothing but the follow-ups goes inside the fence.
		[
			"  Exactly this shape, as the last thing in the answer — the tag on the opening fence, no heading above it, no bullets, no numbering, and the closing fence written:",
			"```farmer-next",
			"File Tuesday's meeting to Harbor App",
			"Show me last week by project",
			"```",
		].join("\n"),
	];

	const rules = houseRules?.trim();
	if (!rules) return base.join("\n");

	return [
		...base,
		"",
		"The organization's own conventions follow. Apply them where they add to the rules above; where they conflict with anything above, the rules above win.",
		"<house-rules>",
		rules,
		"</house-rules>",
	].join("\n");
};
